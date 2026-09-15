/**
 * Coordinated intent I/O (contract C-09): one repository lock, one generic journal, explicit
 * recovery. Covers AC-06 (interrupted attempts), AC-07 (publication cannot silently overwrite
 * intent, paused readers, every failpoint, idempotent recovery, external-edit refusal) and
 * AC-12 (existing CLI keys and exits stay supported).
 */
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { hostname } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import {
  IntentIoError,
  acquireLock,
  confine,
  holdsLock,
  lockPath,
  ownerLiveness,
  pendingTransactions,
  readLockOwner,
  recoverTransaction,
  releaseLock,
  runTransaction,
  sha256,
  transactionJournal,
  withIntentLock,
  withIntentSnapshot,
  writeFileAtomic,
} from '../scripts/lib/intent-io.mjs';
import { pathToFileURL } from 'node:url';
import { ROOT, cleanEnv, cleanup, makeTmp, readText, runSpec, runSpecJson, write } from './helpers.mjs';

const SPAWN = { encoding: 'utf8', timeout: 30000, windowsHide: true };
const readFile = (root, rel) => readText(join(root, rel));

/** A minimal but complete change, so `spec status` and `spec validate` have something to read. */
function seed(root, name = 'demo') {
  write(root, `changes/${name}/proposal.md`, '# p\n\ncontent\n\n## Non-Goals\n\n- none\n\n## Decision Boundaries\n\n- none\n');
  write(root, `changes/${name}/design.md`, '# d\n\ncontent\n\n## Do-Not-Touch\n\nnone\n\n## Rebuild / Re-run After Change\n\nnone\n');
  write(root, `changes/${name}/tasks.md`, '# t\n\n- [ ] 1.1 do a thing and verify it\n');
  return join(root, 'changes', name);
}

describe('intent-io: the one repository lock', () => {
  let root;
  before(() => {
    root = makeTmp('io-lock');
    seed(root);
  });
  after(() => cleanup(root));

  it('acquires, reports its holder and releases exactly one lock file', () => {
    const token = acquireLock(root, { purpose: 'test' });
    assert.ok(existsSync(lockPath(root)));
    assert.equal(lockPath(root), join(root, 'changes', '.transactions', 'intent.lock'));
    const owner = readLockOwner(root);
    assert.equal(owner.nonce, token.nonce);
    assert.equal(owner.purpose, 'test');
    assert.equal(owner.pid, process.pid);
    assert.equal(ownerLiveness(owner), 'alive');
    assert.ok(holdsLock(root, token));
    assert.equal(releaseLock(root, token), true);
    assert.equal(existsSync(lockPath(root)), false);
    assert.equal(holdsLock(root, token), false);
  });

  it('returns a retryable busy error rather than waiting forever or breaking the lock', () => {
    const held = acquireLock(root, { purpose: 'holder' });
    const started = Date.now();
    try {
      acquireLock(root, { purpose: 'second', timeoutMs: 150 });
      assert.fail('expected busy');
    } catch (e) {
      assert.ok(e instanceof IntentIoError);
      assert.equal(e.code, 'busy');
      assert.equal(e.retryable, true);
      assert.match(e.message, /holder/);
    }
    assert.ok(Date.now() - started >= 140, 'acquisition waits for the whole bounded window');
    assert.equal(readLockOwner(root).nonce, held.nonce, 'the existing lock is never broken');
    releaseLock(root, held);
  });

  it('reuses the caller token for a nested call instead of acquiring a second lock', () => {
    let innerToken = null;
    const outer = withIntentLock(
      root,
      (token) => {
        innerToken = withIntentLock(root, (t) => t, { token, timeoutMs: 0 });
        return token;
      },
      { purpose: 'outer' }
    );
    assert.equal(innerToken.nonce, outer.nonce);
    assert.equal(innerToken.depth, 2);
    assert.equal(existsSync(lockPath(root)), false, 'the outer call released the only lock');
  });

  it('refuses a token that is no longer the live holder', () => {
    const token = acquireLock(root, { purpose: 'stale' });
    releaseLock(root, token);
    assert.throws(() => withIntentLock(root, () => 1, { token }), (e) => e.code === 'lock-lost');
  });

  it('never releases another holder lock with a foreign token', () => {
    const mine = acquireLock(root, { purpose: 'mine' });
    assert.equal(releaseLock(root, { root, nonce: 'not-mine' }), false);
    assert.equal(readLockOwner(root).nonce, mine.nonce);
    releaseLock(root, mine);
  });
});

describe('intent-io: path confinement and atomic single-file writes', () => {
  let root;
  before(() => {
    root = makeTmp('io-paths');
  });
  after(() => cleanup(root));

  it('refuses absolute paths, traversal, empty names and NUL bytes', () => {
    for (const bad of ['', '/etc/passwd', '../outside.md', 'a/../../outside.md', 'a\0b']) {
      assert.throws(() => confine(root, bad), (e) => e instanceof IntentIoError && ['bad-path', 'outside-root'].includes(e.code), `expected refusal for ${JSON.stringify(bad)}`);
    }
    assert.equal(confine(root, 'changes/x/tasks.md'), join(root, 'changes', 'x', 'tasks.md'));
  });

  it('replaces a file through a temporary file and leaves no temporary behind', () => {
    const abs = join(root, 'specs', 'cap', 'spec.md');
    writeFileAtomic(abs, 'one\n');
    writeFileAtomic(abs, 'two\n');
    assert.equal(readFileSync(abs, 'utf8'), 'two\n');
    const leftovers = readFileSync(abs, 'utf8') && existsSync(`${abs}.tmp`);
    assert.equal(leftovers, false);
  });
});

describe('intent-io: generic journal transactions', () => {
  let root;
  before(() => {
    root = makeTmp('io-tx');
    seed(root);
    write(root, 'specs/alpha/spec.md', '# alpha\n\nbefore\n');
  });
  after(() => cleanup(root));

  it('records before and after bytes and hashes, then commits', () => {
    const tx = withIntentLock(root, (token) =>
      runTransaction(
        root,
        {
          purpose: 'test-publish',
          steps: [
            { kind: 'file', path: 'specs/alpha/spec.md', content: '# alpha\n\nafter\n' },
            { kind: 'file', path: 'specs/beta/spec.md', content: '# beta\n' },
          ],
        },
        token
      )
    );
    const j = transactionJournal(root, tx.id);
    assert.equal(j.phase, 'committed');
    assert.equal(j.purpose, 'test-publish');
    const alpha = j.steps.find((s) => s.path === 'specs/alpha/spec.md');
    assert.equal(alpha.before.hash, sha256(Buffer.from('# alpha\n\nbefore\n')));
    assert.equal(Buffer.from(alpha.before.bytes, 'base64').toString(), '# alpha\n\nbefore\n');
    assert.equal(alpha.after.hash, sha256(Buffer.from('# alpha\n\nafter\n')));
    const beta = j.steps.find((s) => s.path === 'specs/beta/spec.md');
    assert.equal(beta.before.exists, false);
    assert.equal(readFile(root, 'specs/alpha/spec.md'), '# alpha\n\nafter\n');
    assert.equal(readFile(root, 'specs/beta/spec.md'), '# beta\n');
    assert.deepEqual(pendingTransactions(root), []);
  });

  it('aborts before any write when a preimage changed after preparation', () => {
    write(root, 'specs/gamma/spec.md', 'original\n');
    assert.throws(
      () =>
        withIntentLock(root, (token) =>
          runTransaction(
            root,
            {
              purpose: 'drift',
              steps: [{ kind: 'file', path: 'specs/gamma/spec.md', content: 'published\n' }],
              hooks: {
                failpoint: (name) => {
                  if (name === 'after-journal') writeFileSync(join(root, 'specs', 'gamma', 'spec.md'), 'edited elsewhere\n');
                },
              },
            },
            token
          )
        ),
      (e) => e.code === 'preimage-changed'
    );
    assert.equal(readFile(root, 'specs/gamma/spec.md'), 'edited elsewhere\n', 'the external edit survived');
  });

  it('requires the live lock token', () => {
    assert.throws(() => runTransaction(root, { purpose: 'x', steps: [] }, null), (e) => e.code === 'lock-lost');
  });
});

describe('intent-io: failpoints and recovery', () => {
  let root;
  before(() => {
    root = makeTmp('io-recover');
  });
  after(() => cleanup(root));

  const FAILPOINTS = ['after-journal', 'before-file', 'after-file', 'before-move', 'after-move', 'before-commit'];

  for (const fp of FAILPOINTS) {
    it(`recovers a transaction interrupted at ${fp}`, () => {
      const dir = makeTmp(`io-fp-${fp.replace(/[^a-z]/g, '')}`);
      try {
        write(dir, 'specs/one/spec.md', 'v1\n');
        write(dir, 'changes/move-me/tasks.md', '# t\n');
        const steps = [
          { kind: 'file', path: 'specs/one/spec.md', content: 'v2\n' },
          { kind: 'file', path: 'specs/two/spec.md', content: 'new\n' },
          { kind: 'move', from: 'changes/move-me', to: 'changes/archive/2026-01-01-move-me' },
        ];
        let txId = null;
        assert.throws(
          () =>
            withIntentLock(dir, (token) =>
              runTransaction(
                dir,
                {
                  purpose: 'interrupted',
                  steps,
                  hooks: {
                    failpoint: (name, ctx) => {
                      if (name === fp) {
                        txId = txId ?? ctx.id ?? pendingTransactions(dir)[0]?.id;
                        throw new IntentIoError('failpoint', `injected at ${name}`);
                      }
                    },
                  },
                },
                token
              )
            ),
          (e) => e.code === 'failpoint'
        );
        const pending = pendingTransactions(dir);
        assert.equal(pending.length, 1, `${fp} leaves exactly one unfinished journal`);
        const id = pending[0].id;
        assert.notEqual(pending[0].phase, 'committed');

        const first = recoverTransaction(dir, id);
        assert.equal(first.phase, 'committed');
        assert.equal(readFile(dir, 'specs/one/spec.md'), 'v2\n');
        assert.equal(readFile(dir, 'specs/two/spec.md'), 'new\n');
        assert.equal(existsSync(join(dir, 'changes', 'archive', '2026-01-01-move-me', 'tasks.md')), true);
        assert.equal(existsSync(join(dir, 'changes', 'move-me')), false);
        assert.deepEqual(pendingTransactions(dir), []);

        // idempotent re-entry
        const second = recoverTransaction(dir, id);
        assert.equal(second.phase, 'committed');
        assert.equal(second.applied, 0);
        assert.equal(readFile(dir, 'specs/one/spec.md'), 'v2\n');
      } finally {
        cleanup(dir);
      }
    });
  }

  it('leaves a committed transaction alone and reports nothing to do', () => {
    write(root, 'specs/done/spec.md', 'a\n');
    const tx = withIntentLock(root, (token) => runTransaction(root, { purpose: 'ok', steps: [{ kind: 'file', path: 'specs/done/spec.md', content: 'b\n' }] }, token));
    const r = recoverTransaction(root, tx.id);
    assert.equal(r.applied, 0);
    assert.match(r.log.join('\n'), /already committed/);
  });

  it('refuses to overwrite an external edit and preserves it', () => {
    const dir = makeTmp('io-external');
    try {
      write(dir, 'specs/one/spec.md', 'v1\n');
      assert.throws(
        () =>
          withIntentLock(dir, (token) =>
            runTransaction(dir, { purpose: 'x', steps: [{ kind: 'file', path: 'specs/one/spec.md', content: 'v2\n' }], hooks: { failpoint: (n) => { if (n === 'before-file') throw new IntentIoError('failpoint', 'stop'); } } }, token)
          ),
        (e) => e.code === 'failpoint'
      );
      const id = pendingTransactions(dir)[0].id;
      writeFileSync(join(dir, 'specs', 'one', 'spec.md'), 'a human typed this\n');
      assert.throws(() => recoverTransaction(dir, id), (e) => e.code === 'recovery-conflict' && /edited outside my-flow/.test(e.message));
      assert.equal(readFile(dir, 'specs/one/spec.md'), 'a human typed this\n');
      assert.equal(pendingTransactions(dir).length, 1, 'the journal stays pending until a human resolves it');
    } finally {
      cleanup(dir);
    }
  });

  it('diagnoses a relocation with two copies or none instead of choosing', () => {
    for (const shape of ['both', 'neither']) {
      const dir = makeTmp(`io-move-${shape}`);
      try {
        write(dir, 'changes/c/tasks.md', '# t\n');
        assert.throws(
          () =>
            withIntentLock(dir, (token) =>
              runTransaction(dir, { purpose: 'x', steps: [{ kind: 'move', from: 'changes/c', to: 'changes/archive/c' }], hooks: { failpoint: (n) => { if (n === 'before-move') throw new IntentIoError('failpoint', 'stop'); } } }, token)
            ),
          (e) => e.code === 'failpoint'
        );
        const id = pendingTransactions(dir)[0].id;
        if (shape === 'both') write(dir, 'changes/archive/c/tasks.md', '# copy\n');
        else cleanup(join(dir, 'changes', 'c'));
        assert.throws(() => recoverTransaction(dir, id), (e) => e.code === 'recovery-conflict');
        if (shape === 'both') assert.equal(readFile(dir, 'changes/c/tasks.md'), '# t\n');
      } finally {
        cleanup(dir);
      }
    }
  });

  it('refuses to reclaim a live lock owner, and reclaims a provably dead one explicitly', () => {
    const dir = makeTmp('io-stale');
    try {
      write(dir, 'specs/one/spec.md', 'v1\n');
      assert.throws(
        () =>
          withIntentLock(dir, (token) =>
            runTransaction(dir, { purpose: 'x', steps: [{ kind: 'file', path: 'specs/one/spec.md', content: 'v2\n' }], hooks: { failpoint: (n) => { if (n === 'before-file') throw new IntentIoError('failpoint', 'stop'); } } }, token)
          ),
        (e) => e.code === 'failpoint'
      );
      const id = pendingTransactions(dir)[0].id;

      // a live owner (this very process) is never reclaimed
      const live = acquireLock(dir, { purpose: 'someone-else' });
      assert.throws(() => recoverTransaction(dir, id), (e) => e.code === 'busy' && /refuses to reclaim/.test(e.message));
      assert.equal(readLockOwner(dir).nonce, live.nonce);
      releaseLock(dir, live);

      // a dead owner is reclaimed only by explicit recovery, never by age
      const dead = spawnSync(process.execPath, ['-e', 'process.exit(0)'], SPAWN);
      assert.equal(dead.status, 0, 'a process that has certainly exited');
      assert.equal(ownerLiveness({ pid: dead.pid, host: hostname() }), 'dead');
      mkdirSync(join(dir, 'changes', '.transactions'), { recursive: true });
      writeFileSync(lockPath(dir), JSON.stringify({ nonce: 'dead', pid: dead.pid, host: hostname(), purpose: 'crashed' }) + '\n');
      const r = recoverTransaction(dir, id);
      assert.equal(r.phase, 'committed');
      assert.equal(readFile(dir, 'specs/one/spec.md'), 'v2\n');
      assert.equal(existsSync(lockPath(dir)), false);
    } finally {
      cleanup(dir);
    }
  });
});

describe('intent-io through the spec CLI', () => {
  let root;
  before(() => {
    root = makeTmp('io-cli');
    seed(root);
  });
  after(() => cleanup(root));

  it('exits 2 with a retryable busy error while another operation holds the lock', () => {
    const held = acquireLock(root, { purpose: 'holder' });
    try {
      const r = runSpec(root, ['stage', 'demo', 'execute', '--lock-timeout', '100']);
      assert.equal(r.status, 2);
      assert.match(r.stderr, /^busy: /m);
      const j = runSpecJson(root, ['status', '--lock-timeout', '100']);
      assert.equal(j.status, 2);
      assert.equal(j.json.error, 'busy');
      assert.equal(j.json.retryable, true);
    } finally {
      releaseLock(root, held);
    }
  });

  it('keeps the existing status, validate and stage behaviour once the lock is free', () => {
    const st = runSpecJson(root, ['stage', 'demo', 'execute']);
    assert.equal(st.status, 0);
    assert.equal(st.json.change, 'demo');
    assert.equal(st.json.stage, 'execute');
    const status = runSpecJson(root, ['status']);
    assert.equal(status.status, 0);
    assert.equal(status.json.current.change, 'demo');
    assert.equal(status.json.changes[0].tasks.total, 1);
    assert.equal(existsSync(lockPath(root)), false, 'no lock file is left behind');
  });

  it('refuses reads and writes while a journal is pending, and recovers on request', () => {
    write(root, 'specs/one/spec.md', 'v1\n');
    assert.throws(
      () =>
        withIntentLock(root, (token) =>
          runTransaction(root, { purpose: 'x', steps: [{ kind: 'file', path: 'specs/one/spec.md', content: 'v2\n' }], hooks: { failpoint: (n) => { if (n === 'before-file') throw new IntentIoError('failpoint', 'stop'); } } }, token)
        ),
      (e) => e.code === 'failpoint'
    );
    const id = pendingTransactions(root)[0].id;

    const blockedRead = runSpecJson(root, ['status']);
    assert.equal(blockedRead.status, 1);
    assert.equal(blockedRead.json.error, 'recovery-pending');
    assert.match(blockedRead.json.message, new RegExp(`spec recover ${id}`));
    const blockedWrite = runSpec(root, ['stage', 'demo', 'mf-plan']);
    assert.equal(blockedWrite.status, 1);
    assert.match(blockedWrite.stderr, /recovery-pending/);

    const list = runSpecJson(root, ['recover']);
    assert.equal(list.status, 0);
    assert.equal(list.json.pending[0].id, id);

    const done = runSpecJson(root, ['recover', id]);
    assert.equal(done.status, 0);
    assert.equal(done.json.phase, 'committed');
    assert.equal(readFile(root, 'specs/one/spec.md'), 'v2\n');
    assert.equal(runSpecJson(root, ['status']).status, 0);
  });
});

describe('intent-io: a paused reader and a competing writer', () => {
  let root;
  before(() => {
    root = makeTmp('io-race');
    seed(root);
  });
  after(() => cleanup(root));

  /** A child that takes one locked snapshot, pauses inside it, then prints what it read. */
  const READER = (ms) => `
    import { withIntentSnapshot } from ${JSON.stringify(pathToFileURL(join(ROOT, 'scripts', 'lib', 'intent-io.mjs')).href)};
    import { readFileSync } from 'node:fs';
    import { join } from 'node:path';
    const root = process.env.IO_TEST_ROOT;
    const wait = (n) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, n);
    const out = withIntentSnapshot(root, () => {
      const a = readFileSync(join(root, 'changes', 'demo', 'tasks.md'), 'utf8');
      process.stdout.write('READING\\n');
      wait(${ms});
      const b = readFileSync(join(root, 'changes', 'demo', 'proposal.md'), 'utf8');
      return { a, b };
    }, { purpose: 'slow-read' });
    process.stdout.write(JSON.stringify(out) + '\\n');
  `;

  it('blocks a publication until the reader has materialized one coherent snapshot', async () => {
    const child = spawn(process.execPath, ['--input-type=module', '-e', READER(2500)], { windowsHide: true, env: cleanEnv({ IO_TEST_ROOT: root }) });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stderr.on('data', (c) => {
      stderr += c;
    });
    const reading = new Promise((done, reject) => {
      child.stdout.on('data', (c) => {
        stdout += c;
        if (stdout.includes('READING')) done();
      });
      child.on('close', () => reject(new Error(`reader exited before it read anything: ${stderr}`)));
    });
    await reading;

    // while the reader holds the lock, a writer gets a bounded, retryable refusal
    const busy = runSpec(root, ['stage', 'demo', 'done', '--lock-timeout', '300']);
    assert.equal(busy.status, 2);
    assert.match(busy.stderr, /busy: the intent lock is held/);
    assert.match(busy.stderr, /slow-read/);

    await new Promise((done) => child.on('close', done));
    const snapshotLine = stdout.trim().split('\n').at(-1);
    const seen = JSON.parse(snapshotLine);
    assert.match(seen.a, /1\.1 do a thing/);
    assert.match(seen.b, /Decision Boundaries/);

    // and the same write succeeds as soon as the reader has released
    const ok = runSpecJson(root, ['stage', 'demo', 'done']);
    assert.equal(ok.status, 0);
    assert.equal(ok.json.stage, 'done');
  });

  it('serializes competing writers instead of interleaving them', async () => {
    const stages = ['interview', 'mf-plan', 'execute'];
    const results = await Promise.all(
      stages.map(
        (s) =>
          new Promise((done) => {
            const c = spawn(process.execPath, [join(ROOT, 'scripts', 'spec.mjs'), 'stage', 'demo', s, '--root', root, '--lock-timeout', '5000'], { windowsHide: true, env: cleanEnv() });
            c.on('close', (code) => done({ s, code }));
          })
      )
    );
    assert.deepEqual(results.filter((r) => r.code !== 0), [], 'every writer either waited for the lock or finished');
    const state = JSON.parse(readFile(root, '.my-flow/state/current-change.json'));
    assert.ok(stages.includes(state.stage), 'exactly one writer produced the final, whole state file');
    assert.equal(existsSync(lockPath(root)), false);
  });
});
