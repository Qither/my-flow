/**
 * Dashboard server: API parity with the CLI, push updates, the guarded save endpoint and the
 * same-origin guard. Every test builds its own fixture project and starts a server on port 0.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, renameSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../scripts/dashboard.mjs';
import { IntentIoError, acquireLock, pendingTransactions, recoverTransaction, releaseLock, runTransaction, withIntentLock } from '../scripts/lib/intent-io.mjs';
import { acquireLease, createManifest, resolveSessionIdentity, sessionPath } from '../scripts/lib/intent-state.mjs';
import { beginAttempt, recordAttempt } from '../scripts/lib/evidence.mjs';
import { captureBaseline } from '../scripts/lib/archive.mjs';
import { ROOT, cleanup, makeTmp, runSpecJson, write } from './helpers.mjs';

const CRLF = (s) => s.replace(/\n/g, '\r\n');
const SPEC_MAIN = `# cap Specification

## Purpose
Fixture capability.

## Requirements

### Requirement: Existing thing
<!-- via: 2026-01-01-old -->

It exists.

#### Scenario: It works
- **WHEN** something happens
- **THEN** something follows
`;
const SPEC_DELTA = `## ADDED Requirements

### Requirement: New thing

It is new.

#### Scenario: It also works
- **WHEN** something happens
- **THEN** something follows
`;
const PROPOSAL = `## Why

Fixture.

## What Changes

A thing.

## Non-Goals

None.

## Decision Boundaries

None.
`;
const DESIGN = `## Context

Fixture.

## Do-Not-Touch

none

## Rebuild / Re-run After Change

none
`;
const TASKS = `## 1. Group

- [x] 1.1 first and verify a
- [ ] 1.2 second and verify b
- [ ] 1.3 third and verify c
`;

function fixture() {
  const root = makeTmp('dash');
  write(root, 'changes/demo/proposal.md', PROPOSAL);
  write(root, 'changes/demo/design.md', DESIGN);
  write(root, 'changes/demo/tasks.md', TASKS);
  write(root, 'changes/demo/notes.txt', 'not markdown\n');
  write(root, 'changes/demo/crlf.md', CRLF('line one\nline two\n'));
  write(root, 'changes/demo/specs/cap/spec.md', SPEC_DELTA);
  write(root, 'specs/cap/spec.md', SPEC_MAIN);
  write(root, 'changes/archive/2026-01-01-old/proposal.md', PROPOSAL);
  write(root, 'changes/archive/2026-01-01-old/specs/cap/spec.md', SPEC_DELTA);
  write(root, 'changes/archive/2026-01-02-dropped-abandoned/proposal.md', `${PROPOSAL}\n## Abandoned\n\n**Reason**: superseded\n`);
  write(root, '.my-flow/ask/x.md', '# ask\n');
  write(root, '.my-flow/verify/y.md', '# verify\n');
  write(root, '.my-flow/interviews/z.md', '# interview\n');
  write(root, '.my-flow/state/current-change.json', JSON.stringify({ change: 'demo', stage: 'mf-plan', updated: new Date().toISOString() }, null, 2) + '\n'); // not execute: that stage locks saves
  return root;
}

/** Fixture + server on an ephemeral port, torn down after the test. */
async function up(t) {
  const root = fixture();
  const h = await startServer({ root, port: 0 });
  t.after(async () => {
    await h.close();
    cleanup(root);
  });
  const get = async (path, init) => {
    const r = await fetch(h.url + path.replace(/^\//, ''), init);
    return { status: r.status, headers: r.headers, body: await r.text() };
  };
  const getJson = async (path, init) => {
    const r = await get(path, init);
    return { status: r.status, headers: r.headers, json: JSON.parse(r.body) };
  };
  const post = (body, init = {}) =>
    getJson('/api/file', {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    });
  return { root, h, get, getJson, post };
}

/** POST /api/file over node:http with verbatim headers (fetch drops a custom Host). */
function rawPost(port, body, headers) {
  return new Promise((resolve, reject) => {
    const req = request({ host: '127.0.0.1', port, method: 'POST', path: '/api/file', headers: { ...headers, 'content-length': Buffer.byteLength(body) } }, (res) => {
      let data = '';
      res.on('data', (c) => (data += c));
      res.on('end', () => resolve({ status: res.statusCode, json: JSON.parse(data) }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

/** Minimal SSE reader over fetch: events as { event, data }. */
async function openEvents(url) {
  const ac = new AbortController();
  const r = await fetch(url + 'api/events', { signal: ac.signal });
  const reader = r.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  const queue = [];
  let waiter = null;
  (async () => {
    try {
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let i;
        while ((i = buf.indexOf('\n\n')) >= 0) {
          const frame = buf.slice(0, i);
          buf = buf.slice(i + 2);
          if (frame.startsWith(':')) continue;
          const ev = { event: 'message', data: null };
          for (const line of frame.split('\n')) {
            if (line.startsWith('event:')) ev.event = line.slice(6).trim();
            else if (line.startsWith('data:')) ev.data = JSON.parse(line.slice(5).trim());
          }
          queue.push(ev);
          if (waiter) {
            waiter();
            waiter = null;
          }
        }
      }
    } catch {
      /* aborted */
    }
  })();
  const next = (pred, timeoutMs) =>
    new Promise((resolve, reject) => {
      const deadline = Date.now() + timeoutMs;
      const check = () => {
        while (queue.length) {
          const ev = queue.shift();
          if (pred(ev)) return resolve({ ...ev, at: Date.now() });
        }
        if (Date.now() >= deadline) return reject(new Error(`no matching event within ${timeoutMs} ms`));
        waiter = check;
        setTimeout(() => {
          if (waiter === check) check();
        }, Math.min(50, Math.max(1, deadline - Date.now())));
      };
      check();
    });
  const none = async (pred, ms) => {
    try {
      const ev = await next(pred, ms);
      throw new Error(`unexpected event ${JSON.stringify(ev)}`);
    } catch (e) {
      if (!/no matching event/.test(e.message)) throw e;
    }
  };
  return { next, none, close: () => ac.abort() };
}

// ---------------------------------------------------------------- 2.3 parity
test('api: /api/status and /api/validate deep-equal the CLI JSON for the same root', async (t) => {
  const { root, getJson } = await up(t);
  const status = await getJson('/api/status');
  assert.equal(status.status, 200);
  assert.deepStrictEqual(status.json, runSpecJson(root, ['status']).json);
  assert.equal(status.json.changes[0].tasks.done, 1);
  const validate = await getJson('/api/validate');
  assert.deepStrictEqual(validate.json, runSpecJson(root, ['validate']).json);
  assert.equal(validate.json.ok, true);
  // a second request sees a change made after the first (no per-process cache)
  write(root, 'changes/demo/tasks.md', TASKS.replace('- [ ] 1.2', '- [x] 1.2'));
  const again = await getJson('/api/status');
  assert.equal(again.json.changes[0].tasks.done, 2);
  assert.deepStrictEqual(again.json, runSpecJson(root, ['status']).json);
});

test('api: health names this process and the fixture root', async (t) => {
  const { root, getJson, h } = await up(t);
  const { json } = await getJson('/api/health');
  assert.equal(json.ok, true);
  assert.equal(json.pid, process.pid);
  assert.equal(json.root, root);
  assert.equal(json.port, h.port);
  assert.ok(existsSync(join(root, '.my-flow', 'state', 'dashboard.json')));
});

// ---------------------------------------------------------------- 2.4 read-only routes
test('api: change detail, specs index, archive index and scratch index', async (t) => {
  const { getJson } = await up(t);
  const change = await getJson('/api/changes/demo');
  assert.equal(change.status, 200);
  const delta = change.json.files.find((f) => f.kind === 'delta');
  assert.equal(delta.capability, 'cap');
  assert.equal(delta.path, 'changes/demo/specs/cap/spec.md');
  assert.deepStrictEqual(
    change.json.files.filter((f) => f.kind !== 'delta').map((f) => [f.kind, f.exists]),
    [['proposal', true], ['design', true], ['tasks', true]]
  );
  assert.equal(change.json.row.name, 'demo');
  assert.equal(change.json.row.current, true);
  assert.equal((await getJson('/api/changes/ghost')).status, 404);

  const specs = await getJson('/api/specs');
  assert.equal(specs.json.capabilities[0].name, 'cap');
  assert.deepStrictEqual(specs.json.capabilities[0].requirements, [{ name: 'Existing thing', via: '2026-01-01-old' }]);

  const archive = await getJson('/api/archive');
  assert.deepStrictEqual(
    archive.json.entries.map((e) => [e.change, e.kind, e.reason, e.capabilities]),
    [['dropped', 'abandoned', 'superseded', []], ['old', 'archived', null, ['cap']]]
  );

  const scratch = await getJson('/api/scratch');
  assert.deepStrictEqual(Object.keys(scratch.json), ['ask', 'verify', 'interviews']);
  assert.equal(scratch.json.ask[0].path, '.my-flow/ask/x.md');
  assert.equal(scratch.json.verify[0].name, 'y.md');
});

// ---------------------------------------------------------------- 2.5 handler contract
test('api: a change directory deleted mid-request yields 200 or a 500 error body, never a crash', async (t) => {
  const { root, getJson, h } = await up(t);
  for (let i = 0; i < 40; i++) write(root, `changes/doomed/deep/${i}/file.md`, `# ${i}\n`);
  write(root, 'changes/doomed/tasks.md', '- [ ] 1.1 x and verify y\n');
  let rejections = 0;
  const onRej = () => rejections++;
  process.on('unhandledRejection', onRej);
  t.after(() => process.off('unhandledRejection', onRej));
  const hits = [];
  const hammer = (async () => {
    for (let i = 0; i < 25; i++) hits.push(await getJson('/api/status'));
  })();
  await new Promise((r) => setTimeout(r, 5));
  rmSync(join(root, 'changes', 'doomed'), { recursive: true, force: true, maxRetries: 5 });
  await hammer;
  for (const r of hits) {
    if (r.status === 200) assert.ok(Array.isArray(r.json.changes));
    else {
      assert.equal(r.status, 500);
      assert.equal(r.json.ok, false);
      assert.ok(r.json.error);
    }
  }
  assert.equal(rejections, 0);
  assert.equal((await getJson('/api/health')).status, 200, 'server still answers');
  assert.ok(h.server.listening);
});

// ---------------------------------------------------------------- 2.6 static handler
test('static: containment, index fallback and unknown api routes', async (t) => {
  const { get, getJson } = await up(t);
  assert.equal((await get('/../package.json')).status, 404);
  assert.equal((await get('/%2e%2e/package.json')).status, 404);
  assert.equal((await get('/%2e%2e/%2e%2e/package.json')).status, 404);
  const index = await get('/');
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type'), /^text\/html/);
  assert.match(index.body, /<main id="view"/);
  const deep = await get('/changes/demo'); // extensionless deep link lands on the shell
  assert.equal(deep.status, 200);
  assert.match(deep.body, /<main id="view"/);
  assert.equal((await getJson('/api/nope')).status, 404);
  assert.equal((await get('/index.html', { method: 'POST' })).status, 405);
});

// ---------------------------------------------------------------- 3.1 SSE
test('events: hello on connect, then a change naming the edited file within 2 s', async (t) => {
  const { root, h } = await up(t);
  const es = await openEvents(h.url);
  t.after(() => es.close());
  const hello = await es.next((e) => e.event === 'hello', 2000);
  assert.equal(hello.data.root, root);
  assert.equal(hello.data.port, h.port);
  const t0 = Date.now();
  writeFileSync(join(root, 'changes', 'demo', 'tasks.md'), `${TASKS}- [ ] 1.4 fourth and verify d\n`);
  const ev = await es.next((e) => e.event === 'change' && e.data.paths.includes('changes/demo/tasks.md'), 2000);
  assert.ok(ev.at - t0 < 2000);
  assert.ok(ev.data.paths.every((p) => !p.includes('\\')), `no backslashes: ${ev.data.paths}`);
  assert.match(ev.data.at, /^\d{4}-\d{2}-\d{2}T/);
});

// ---------------------------------------------------------------- 3.2 watch filter and fallback
for (const polling of [false, true]) {
  test(`events: snapshot reads stay silent but task and journal changes notify (${polling ? 'polling' : 'watcher'})`, async (t) => {
    const { root, h, getJson } = await up(t);
    const es = await openEvents(h.url);
    t.after(() => es.close());
    await es.next((e) => e.event === 'hello', 2000);
    if (polling) h.watchers[1].emit('error', Object.assign(new Error('forced'), { code: 'EFORCED' }));
    for (let i = 0; i < 3; i++) assert.equal((await getJson('/api/changes/demo')).status, 200);
    if (!polling) h.watchers[1].emit('change', 'change', null);
    await es.none((e) => e.event === 'change', polling ? 2600 : 700);
    write(root, 'changes/demo/tasks.md', `${TASKS}- [ ] 1.4 edited and verify notification\n`);
    await es.next((e) => e.event === 'change' && e.data.paths.some((p) => p.startsWith('changes')), 5000);
    write(root, 'changes/.transactions/notification-probe/journal.json', '{}\n');
    await es.next((e) => e.event === 'change' && e.data.paths.some((p) => p.startsWith('changes')), 5000);
    rmSync(join(root, 'changes/.transactions/notification-probe/journal.json'));
    await es.next((e) => e.event === 'change' && e.data.paths.some((p) => p.startsWith('changes')), 5000);
  });
}

test('events: the state file is silent, specs are not, and a watcher error degrades to polling', async (t) => {
  const { root, h, getJson } = await up(t);
  const es = await openEvents(h.url);
  t.after(() => es.close());
  await es.next((e) => e.event === 'hello', 2000);
  const stateFile = join(root, '.my-flow', 'state', 'dashboard.json');
  writeFileSync(stateFile, readFileSync(stateFile, 'utf8'));
  await es.none((e) => e.event === 'change', 1000);
  writeFileSync(join(root, 'specs', 'cap', 'spec.md'), `${SPEC_MAIN}\nMore.\n`);
  const ev = await es.next((e) => e.event === 'change', 2000);
  assert.ok(ev.data.paths.includes('specs/cap/spec.md'), JSON.stringify(ev.data));
  assert.ok(!ev.data.paths.includes('.my-flow/state/dashboard.json'));
  // force the specs watcher to fail: the server must stay up and fall back to polling
  assert.ok(h.watchers.length >= 3);
  h.watchers[0].emit('error', Object.assign(new Error('forced'), { code: 'EFORCED' }));
  assert.equal((await getJson('/api/health')).status, 200);
  await new Promise((r) => setTimeout(r, 300));
  const then = Date.now() / 1000 + 5;
  writeFileSync(join(root, 'specs', 'cap', 'spec.md'), `${SPEC_MAIN}\nEven more.\n`);
  utimesSync(join(root, 'specs', 'cap', 'spec.md'), then, then);
  const polled = await es.next((e) => e.event === 'change' && e.data.paths.some((p) => p.startsWith('specs')), 5000);
  assert.ok(polled);
});

// ---------------------------------------------------------------- 4.1 read allow-list
test('file: read allow-list and the writable flag', async (t) => {
  const { getJson } = await up(t);
  assert.equal((await getJson('/api/file?path=package.json')).status, 403);
  assert.equal((await getJson('/api/file?path=changes/demo/notes.txt')).status, 403);
  const ask = await getJson('/api/file?path=.my-flow/ask/x.md');
  assert.equal(ask.status, 200);
  assert.equal(ask.json.writable, false);
  assert.equal(ask.json.content, '# ask\n');
  const verify = await getJson('/api/file?path=.my-flow/verify/y.md');
  assert.equal(verify.json.writable, false);
  const old = await getJson('/api/file?path=changes/archive/2026-01-01-old/proposal.md');
  assert.equal(old.status, 200);
  assert.equal(old.json.writable, false);
  const proposal = await getJson('/api/file?path=changes/demo/proposal.md');
  assert.equal(proposal.json.writable, true);
  assert.equal(proposal.json.eol, 'lf');
  assert.equal(typeof proposal.json.mtimeMs, 'number');
  assert.equal((await getJson('/api/file?path=changes/demo/ghost.md')).status, 404);
});

// ---------------------------------------------------------------- 4.2 write guard order
test('file: traversal, absolute and drive-relative paths are refused before any write', async (t) => {
  const { root, post } = await up(t);
  const bad = async (path, expected) => {
    const r = await post({ path, content: 'x', mtimeMs: 0, force: true });
    assert.equal(r.status, expected, `${path}: ${JSON.stringify(r.json)}`);
    assert.equal(r.json.ok, false);
  };
  await bad('../escape.md', 400);
  await bad(join(root, 'changes', 'demo', 'proposal.md'), 400);
  // Drive-relative: isAbsolute() is false, yet resolve() lands on that drive's cwd, outside root.
  // A drive-relative path on the root's own drive resolves inside root and is then caught by the
  // allow-list; on POSIX the same string is a plain relative name that does not exist.
  const otherDrive = /^c:/i.test(root) ? 'D:' : 'C:';
  await bad(`${otherDrive}foo.md`, process.platform === 'win32' ? 400 : 404);
  const sameDrive = await post({ path: `${root.slice(0, 2)}foo.md`, content: 'x', mtimeMs: 0, force: true });
  assert.ok(sameDrive.status >= 400 && sameDrive.json.ok === false);
  await bad('', 400);
  await bad('changes/demo/a\0.md', 400);
  const r = await post('{"path":42,"content":"x"}');
  assert.equal(r.status, 400);
  assert.equal(existsSync(join(root, '..', 'escape.md')), false);
  await bad('changes/archive/2026-01-01-old/proposal.md', 403);
  await bad('.my-flow/ask/x.md', 403);
  await bad('changes/demo/notes.txt', 403);
  await bad('changes/demo/ghost.md', 404);
  assert.equal(readFileSync(join(root, 'changes', 'archive', '2026-01-01-old', 'proposal.md'), 'utf8'), PROPOSAL);
  assert.equal(readFileSync(join(root, 'changes', 'demo', 'notes.txt'), 'utf8'), 'not markdown\n');
  assert.deepStrictEqual(readdirSync(join(root, 'changes', 'demo')).sort(), ['crlf.md', 'design.md', 'notes.txt', 'proposal.md', 'specs', 'tasks.md']);
});

// ---------------------------------------------------------------- 4.3 same-origin guard
test('file: foreign Host, foreign Origin, simple content type and oversized bodies are refused', async (t) => {
  const { root, h, getJson, post } = await up(t);
  const target = join(root, 'changes', 'demo', 'proposal.md');
  const { json: loaded } = await getJson('/api/file?path=changes/demo/proposal.md');
  const body = { path: 'changes/demo/proposal.md', content: 'pwned\n', mtimeMs: loaded.mtimeMs };
  // fetch() refuses to send a custom Host header, so the rebinding case goes over node:http.
  const evilHost = await rawPost(h.port, JSON.stringify(body), { host: 'evil.example', 'content-type': 'application/json' });
  assert.equal(evilHost.status, 403);
  assert.equal(evilHost.json.error, 'bad-host');
  const evilOrigin = await post(body, { headers: { origin: 'http://evil.example' } });
  assert.equal(evilOrigin.status, 403);
  assert.equal(evilOrigin.json.error, 'bad-origin');
  assert.equal(evilOrigin.headers.get('access-control-allow-origin'), null);
  const plain = await getJson('/api/file', { method: 'POST', headers: { 'content-type': 'text/plain' }, body: JSON.stringify(body) });
  assert.equal(plain.status, 415);
  const huge = await post({ ...body, content: 'a'.repeat(5 * 1024 * 1024 + 1) });
  assert.equal(huge.status, 413);
  assert.equal(readFileSync(target, 'utf8'), PROPOSAL, 'file byte-identical after all refusals');
  const own = await post(body, { headers: { origin: `http://127.0.0.1:${h.port}` } });
  assert.equal(own.status, 200);
  assert.equal(readFileSync(target, 'utf8'), 'pwned\n');
});

// ---------------------------------------------------------------- execute lock
const setStage = (root, stage) => write(root, '.my-flow/state/current-change.json', JSON.stringify({ change: 'demo', stage, updated: new Date().toISOString() }, null, 2) + '\n');

test('lock: a save during stage execute is refused 423 and the file is untouched', async (t) => {
  const { root, getJson, post } = await up(t);
  const target = join(root, 'changes', 'demo', 'proposal.md');
  const { json: loaded } = await getJson('/api/file?path=changes/demo/proposal.md');
  setStage(root, 'execute');
  const r = await post({ path: 'changes/demo/proposal.md', content: 'locked out\n', mtimeMs: loaded.mtimeMs });
  assert.equal(r.status, 423);
  assert.equal(r.json.error, 'locked');
  assert.equal(r.json.change, 'demo');
  assert.equal(r.json.stage, 'execute');
  assert.match(r.json.message, /"demo".*execute/);
  assert.equal(readFileSync(target, 'utf8'), PROPOSAL);
});

test('lock: reads report writable:false with a reason during execute, and null otherwise', async (t) => {
  const { root, getJson } = await up(t);
  setStage(root, 'execute');
  const locked = await getJson('/api/file?path=changes/demo/proposal.md');
  assert.equal(locked.json.writable, false);
  assert.match(locked.json.lockReason, /read-only while "demo"/);
  const archived = await getJson('/api/file?path=changes/archive/2026-01-01-old/proposal.md');
  assert.equal(archived.json.writable, false);
  assert.equal(archived.json.lockReason, null, 'a read-only file never claims a lock');
});

test('lock: rewriting the state file lifts the lock with no restart', async (t) => {
  const { root, getJson, post } = await up(t);
  setStage(root, 'execute');
  assert.equal((await getJson('/api/file?path=changes/demo/proposal.md')).json.writable, false);
  setStage(root, 'done');
  const after = await getJson('/api/file?path=changes/demo/proposal.md');
  assert.equal(after.json.writable, true);
  assert.equal(after.json.lockReason, null);
  const saved = await post({ path: 'changes/demo/proposal.md', content: 'free again\n', mtimeMs: after.json.mtimeMs });
  assert.equal(saved.status, 200);
  assert.equal(readFileSync(join(root, 'changes', 'demo', 'proposal.md'), 'utf8'), 'free again\n');
});

test('lock: a non-writable target still answers 403, never 423, during execute', async (t) => {
  const { root, post } = await up(t);
  setStage(root, 'execute');
  // the reserved .md artifacts are records of what happened; a save would rewrite them (C-02)
  for (const path of [
    'changes/archive/2026-01-01-old/proposal.md',
    '.my-flow/ask/x.md',
    'changes/demo/notes.txt',
    'changes/demo/verify/V-1/report.md',
    'changes/demo/reviews/R-1/contract/contract.md',
    'changes/demo/amendments/A-1/candidate/acceptance.md',
    'changes/demo/migration/original/tasks.md',
  ]) {
    const r = await post({ path, content: 'x', mtimeMs: 0, force: true });
    assert.equal(r.status, 403, path);
    assert.equal(r.json.error, 'not-writable', path);
  }
});

test('lock: the lock fires before the mtime check and echoes no content', async (t) => {
  const { root, post } = await up(t);
  setStage(root, 'execute');
  const r = await post({ path: 'changes/demo/proposal.md', content: 'x\n', mtimeMs: 1 });
  assert.equal(r.status, 423);
  assert.equal(r.json.error, 'locked');
  assert.equal(r.json.content, undefined);
  const forced = await post({ path: 'changes/demo/proposal.md', content: 'x\n', mtimeMs: 1, force: true });
  assert.equal(forced.status, 423, 'force does not bypass the lock');
  assert.equal(readFileSync(join(root, 'changes', 'demo', 'proposal.md'), 'utf8'), PROPOSAL);
});

// ---------------------------------------------------------------- 4.4 mtime conflict
test('file: a stale mtime is refused with the on-disk content, force overwrites', async (t) => {
  const { root, getJson, post } = await up(t);
  const target = join(root, 'changes', 'demo', 'proposal.md');
  const { json: loaded } = await getJson('/api/file?path=changes/demo/proposal.md');
  const stale = await post({ path: 'changes/demo/proposal.md', content: 'new\n', mtimeMs: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.json.error, 'mtime');
  assert.equal(stale.json.content, PROPOSAL);
  assert.equal(stale.json.mtimeMs, loaded.mtimeMs);
  assert.equal(readFileSync(target, 'utf8'), PROPOSAL);
  const forced = await post({ path: 'changes/demo/proposal.md', content: 'new\n', mtimeMs: 1, force: true });
  assert.equal(forced.status, 200);
  assert.equal(readFileSync(target, 'utf8'), 'new\n');
  assert.equal(forced.json.eol, 'lf');
  const clean = await post({ path: 'changes/demo/proposal.md', content: 'newer\n', mtimeMs: forced.json.mtimeMs });
  assert.equal(clean.status, 200);
  assert.equal(readFileSync(target, 'utf8'), 'newer\n');
});

// ---------------------------------------------------------------- 4.5 line endings
test('file: CRLF files stay CRLF and LF files stay LF', async (t) => {
  const { root, getJson, post } = await up(t);
  const crlf = join(root, 'changes', 'demo', 'crlf.md');
  const loaded = await getJson('/api/file?path=changes/demo/crlf.md');
  assert.equal(loaded.json.eol, 'crlf');
  assert.equal(loaded.json.content, 'line one\nline two\n');
  const saved = await post({ path: 'changes/demo/crlf.md', content: 'line one\nline two\nline three\n', mtimeMs: loaded.json.mtimeMs });
  assert.equal(saved.status, 200);
  assert.equal(saved.json.eol, 'crlf');
  const disk = readFileSync(crlf, 'utf8');
  assert.equal(disk, 'line one\r\nline two\r\nline three\r\n');
  assert.equal(/(^|[^\r])\n/.test(disk), false, 'no lone LF');
  const lf = await getJson('/api/file?path=changes/demo/tasks.md');
  await post({ path: 'changes/demo/tasks.md', content: `${TASKS}- [ ] 1.4 more and verify e\n`, mtimeMs: lf.json.mtimeMs });
  assert.equal(readFileSync(join(root, 'changes', 'demo', 'tasks.md'), 'utf8').includes('\r'), false);
});

// ---------------------------------------------------------------- offline (5.3)
test('static: no served file references an external URL, and the shell assets are served', async (t) => {
  const web = join(ROOT, 'web');
  for (const f of readdirSync(web)) {
    const text = readFileSync(join(web, f), 'utf8');
    assert.equal(/https?:\/\//.test(text), false, `${f} must not reference http(s)://`);
  }
  const { get } = await up(t);
  for (const [path, type] of [['/', 'text/html'], ['/app.mjs', 'text/javascript'], ['/app.css', 'text/css'], ['/md.mjs', 'text/javascript']]) {
    const r = await get(path);
    assert.equal(r.status, 200, path);
    assert.match(r.headers.get('content-type'), new RegExp(`^${type}`));
  }
});

// ---------------------------------------------------------------- coordinated I/O (C-09, AC-07)
test('io: a held intent lock answers reads 503 and saves 423, and never discloses file state', async (t) => {
  const { root, getJson, post } = await up(t);
  const held = acquireLock(root, { purpose: 'holder' });
  try {
    const status = await getJson('/api/status');
    assert.equal(status.status, 503);
    assert.equal(status.json.error, 'busy');
    assert.equal(status.json.retryable, true);

    const save = await post({ path: 'changes/demo/does-not-exist.md', content: 'x', mtimeMs: 1 });
    assert.equal(save.status, 423, 'the lock answers before the 404 that would disclose the file');
    assert.equal(save.json.error, 'busy');
  } finally {
    releaseLock(root, held);
  }
  const after = await getJson('/api/status');
  assert.equal(after.status, 200);
  assert.equal(after.json.changes[0].name, 'demo');
});

test('io: an unfinished journal makes readers report recovery-pending and refuses saves', async (t) => {
  const { root, getJson, post } = await up(t);
  assert.throws(
    () =>
      withIntentLock(root, (token) =>
        runTransaction(root, { purpose: 'x', steps: [{ kind: 'file', path: 'specs/cap/spec.md', content: 'half published\n' }], hooks: { failpoint: (n) => { if (n === 'before-file') throw new IntentIoError('failpoint', 'stop'); } } }, token)
      ),
    (e) => e.code === 'failpoint'
  );
  const id = pendingTransactions(root)[0].id;

  const status = await getJson('/api/status');
  assert.equal(status.status, 503);
  assert.equal(status.json.error, 'recovery-pending');
  assert.match(status.json.message, new RegExp(`spec recover ${id}`));

  const before = readFileSync(join(root, 'changes', 'demo', 'tasks.md'), 'utf8');
  const save = await post({ path: 'changes/demo/tasks.md', content: 'edited\n', mtimeMs: 1 });
  assert.equal(save.status, 423);
  assert.equal(save.json.error, 'recovery-pending');
  assert.equal(readFileSync(join(root, 'changes', 'demo', 'tasks.md'), 'utf8'), before);

  recoverTransaction(root, id);
  assert.equal((await getJson('/api/status')).status, 200);
});

// ---------------------------------------------------------------- intent projection (C-02, AC-02/03/12)
/** Upgrades the fixture's `demo` change to v2: stable ids, acceptance and design blocks. */
function upgradeDemo(root) {
  write(
    root,
    'changes/demo/tasks.md',
    [
      '## 1. Group',
      '',
      '- [x] 1.1 first and verify a',
      '  - id: T-01',
      '  - depends-on: none',
      '  - accepts: AC-01',
      '  - design: D-01',
      '- [ ] 1.2 second and verify b',
      '  - id: T-02',
      '  - depends-on: T-01',
      '  - accepts: AC-01',
      '- [ ] 1.3 third and verify c',
      '  - id: T-03',
      '  - depends-on: T-02',
      '  - accepts: AC-01',
      '',
    ].join('\n')
  );
  write(root, 'changes/demo/acceptance.md', '### AC-01 — Something observable\n\n- evidence-mode: automated\n- checks: test/demo.test.mjs\n');
  write(root, 'changes/demo/design.md', `${DESIGN}\n### D-01 — A decision\n\nBody.\n`);
  return withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', {}, token));
}

test('intent: the API projection is byte-identical to the CLI projection', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = upgradeDemo(root);

  const cli = runSpecJson(root, ['inspect', 'demo']);
  assert.equal(cli.status, 0, cli.stderr);
  const api = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(api.status, 200);
  assert.deepEqual(api.json, cli.json, 'one resolver projection, two surfaces');

  assert.equal(api.json.schemaVersion, 2);
  assert.equal(api.json.identity.id, manifest.id);
  assert.equal(api.json.identity.slug, 'demo');
  assert.equal(api.json.location.rel, 'changes/demo');
  assert.deepEqual(api.json.counts, { total: 3, done: 1 });
  assert.equal(api.json.invalid, false);

  const [one, two, three] = api.json.tasks;
  assert.equal(one.readiness, 'complete');
  assert.equal(two.readiness, 'ready');
  assert.equal(three.readiness, 'waiting');
  assert.deepEqual(one.outgoing.find((r) => r.type === 'acceptance'), { type: 'acceptance', id: 'AC-01', field: 'accepts', resolved: true, label: 'Something observable' });
  assert.deepEqual(one.incoming, [{ type: 'task', from: 'T-02', field: 'depends-on', label: 'second and verify b' }]);
  assert.deepEqual(api.json.acceptance[0].incoming.map((i) => i.from), ['T-01', 'T-02', 'T-03']);
});

test('intent: a slug, a uuid and a single task all resolve, and the CLI agrees', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = upgradeDemo(root);

  const bySlug = await getJson('/api/intent/demo');
  assert.equal(bySlug.status, 200);
  assert.equal(bySlug.json.identity.id, manifest.id);

  const task = await getJson(`/api/intent/${manifest.id}/task/T-02`);
  assert.equal(task.status, 200);
  assert.equal(task.json.type, 'task');
  assert.equal(task.json.item.id, 'T-02');
  assert.equal(task.json.item.readiness, 'ready');

  const cliTask = runSpecJson(root, ['inspect', manifest.id, '--task', 'T-02']);
  assert.equal(cliTask.status, 0);
  assert.deepEqual(cliTask.json.task, task.json.item, 'the same task record on both surfaces');

  const acceptance = await getJson(`/api/intent/demo/acceptance/AC-01`);
  assert.equal(acceptance.status, 200);
  assert.equal(acceptance.json.item.title, 'Something observable');
  const design = await getJson(`/api/intent/demo/design/D-01`);
  assert.equal(design.status, 200);
  assert.equal(design.json.item.title, 'A decision');
});

test('intent: an archived change stays reachable by its uuid after the directory moved', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = upgradeDemo(root);
  // the move `spec archive` performs; the identity does not change
  renameSync(join(root, 'changes', 'demo'), join(root, 'changes', 'archive', '2026-03-03-demo'));

  const r = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.location.location, 'archive');
  assert.equal(r.json.location.rel, 'changes/archive/2026-03-03-demo');
  assert.equal(r.json.identity.slug, 'demo');
  assert.equal(r.json.tasks[0].path, 'changes/archive/2026-03-03-demo/tasks.md');
});

test('intent: unknown ids are 404, a bad type is 400 and malformed encoding never reaches the resolver', async (t) => {
  const { root, getJson } = await up(t);
  upgradeDemo(root);
  assert.equal((await getJson('/api/intent/nope')).status, 404);
  assert.equal((await getJson('/api/intent/demo/task/T-99')).status, 404);
  assert.equal((await getJson('/api/intent/demo/nonsense/X-1')).status, 400);
  assert.equal((await getJson('/api/intent/demo/task/T-01/extra/bits')).status, 404);
  const bad = await getJson('/api/intent/%E0%A4%A');
  assert.equal(bad.status, 400);
  assert.equal(bad.json.error, 'bad-path');
  const traversal = await getJson('/api/intent/..%2F..%2Fetc');
  assert.equal(traversal.status, 400);
  assert.equal(traversal.json.error, 'bad-path');
});

test('intent: a duplicate identity and an invalid graph are 409, with the diagnostics attached', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = upgradeDemo(root);

  // an unresolvable reference makes the derived graph untrustworthy for navigation
  write(root, 'changes/demo/tasks.md', '- [ ] 1.1 broken and verify it\n  - id: T-01\n  - depends-on: T-GONE\n');
  const invalid = await getJson('/api/intent/demo');
  assert.equal(invalid.status, 409);
  assert.equal(invalid.json.error, 'invalid-graph');
  assert.equal(invalid.json.diagnostics[0].code, 'unknown-dependency');
  assert.equal(runSpecJson(root, ['inspect', 'demo']).status, 1, 'the CLI refuses the same graph');

  // two directories claiming one uuid is never resolved to one of them
  write(root, 'changes/twin/tasks.md', '- [ ] 1.1 twin and verify it\n');
  writeFileSync(join(root, 'changes', 'twin', 'change.json'), JSON.stringify({ ...manifest, slug: 'twin' }, null, 2) + '\n');
  const dup = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(dup.status, 409);
  assert.equal(dup.json.error, 'duplicate-identity');
  assert.deepEqual(dup.json.paths, ['changes/demo', 'changes/twin']);
});

test('intent: a legacy change is projected without a stable id and never modified', async (t) => {
  const { root, getJson } = await up(t);
  const before = readFileSync(join(root, 'changes', 'demo', 'tasks.md'), 'utf8');
  const r = await getJson('/api/intent/demo');
  assert.equal(r.status, 200);
  assert.equal(r.json.schemaVersion, 1);
  assert.equal(r.json.identity.id, null);
  assert.equal(r.json.tasks.length, 3);
  assert.deepEqual(r.json.tasks.map((x) => x.readiness), ['complete', 'unknown', 'unknown']);
  assert.equal(existsSync(join(root, 'changes', 'demo', 'change.json')), false);
  assert.equal(readFileSync(join(root, 'changes', 'demo', 'tasks.md'), 'utf8'), before);
});

test('intent: status keeps its existing keys and adds identity fields on both surfaces', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = upgradeDemo(root);
  const api = await getJson('/api/status');
  const cli = runSpecJson(root, ['status']);
  assert.equal(api.status, 200);
  assert.deepEqual(api.json.changes, cli.json.changes, 'status parity survives the additive fields');
  const row = api.json.changes.find((c) => c.name === 'demo');
  for (const key of ['name', 'current', 'stage', 'tasks', 'artifacts', 'deltaSpecs', 'stale', 'staleDays', 'lastModified']) {
    assert.ok(key in row, `the existing key ${key} is still present`);
  }
  assert.equal(row.id, manifest.id);
  assert.equal(row.schemaVersion, 2);
  assert.ok(Array.isArray(api.json.diagnostics));
});

test('intent: the typed endpoints never widen the raw read allow-list', async (t) => {
  const { getJson } = await up(t);
  // the file endpoint still refuses everything outside specs/, changes/ and the three scratch dirs
  assert.equal((await getJson('/api/file?path=package.json')).status, 403);
  assert.equal((await getJson('/api/file?path=.my-flow/state/current-change.json')).status, 403);
  // and the intent endpoint takes identifiers, not paths
  assert.equal((await getJson('/api/intent/changes%2Fdemo%2Ftasks.md')).status, 400);
});

test('intent: a stable reference survives renumbering, retitling and reordering', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = upgradeDemo(root);
  const before = await getJson(`/api/intent/${manifest.id}/task/T-02`);
  assert.equal(before.status, 200);
  assert.equal(before.json.item.number, '1.2');
  assert.equal(before.json.item.title, 'second and verify b');

  // renumber every task, rename the group, reword the title and move the task to the end
  write(
    root,
    'changes/demo/tasks.md',
    [
      '## 9. A different group name',
      '',
      '- [x] 9.1 first and verify a',
      '  - id: T-01',
      '  - depends-on: none',
      '  - accepts: AC-01',
      '  - design: D-01',
      '- [ ] 9.2 third and verify c',
      '  - id: T-03',
      '  - depends-on: T-02',
      '- [ ] 9.3 second, reworded, and verify b differently',
      '  - id: T-02',
      '  - depends-on: T-01',
      '  - accepts: AC-01',
      '',
    ].join('\n')
  );

  const after = await getJson(`/api/intent/${manifest.id}/task/T-02`);
  assert.equal(after.status, 200, 'the same link still resolves');
  assert.equal(after.json.item.id, 'T-02');
  assert.equal(after.json.item.number, '9.3', 'the number moved');
  assert.equal(after.json.item.title, 'second, reworded, and verify b differently');
  assert.deepEqual(after.json.item.incoming, [{ type: 'task', from: 'T-03', field: 'depends-on', label: 'third and verify c' }], 'reverse links follow the declaration, not the order');
  assert.equal(after.json.item.readiness, 'ready');
});

test('intent: a stable reference survives the move into changes/archive', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = upgradeDemo(root);
  const route = `/api/intent/${manifest.id}/acceptance/AC-01`;
  assert.equal((await getJson(route)).status, 200);

  renameSync(join(root, 'changes', 'demo'), join(root, 'changes', 'archive', '2026-04-04-demo'));

  const after = await getJson(route);
  assert.equal(after.status, 200);
  assert.equal(after.json.location.location, 'archive');
  assert.equal(after.json.item.path, 'changes/archive/2026-04-04-demo/acceptance.md');
  assert.deepEqual(after.json.item.incoming.map((i) => i.from), ['T-01', 'T-02', 'T-03'], 'reverse references survive the relocation');
  // and the old name-based route still answers for the active-change listing
  assert.equal((await getJson('/api/intent/demo')).status, 200);
});

test('events: a linked view is told about a task edit, a target edit and the archive move', async (t) => {
  const { root, h, getJson } = await up(t);
  const manifest = upgradeDemo(root);
  const es = await openEvents(h.url);
  t.after(() => es.close());
  await es.next((e) => e.event === 'hello', 2000);

  // 1. the task itself changes
  writeFileSync(join(root, 'changes', 'demo', 'tasks.md'), readFileSync(join(root, 'changes', 'demo', 'tasks.md'), 'utf8').replace('- [ ] 1.2', '- [x] 1.2'));
  const taskEvent = await es.next((e) => e.event === 'change' && e.data.paths.includes('changes/demo/tasks.md'), 3000);
  assert.ok(taskEvent, 'a task edit is announced');
  assert.equal((await getJson(`/api/intent/${manifest.id}/task/T-02`)).json.item.checked, true, 'the refetch sees the new state');

  // 2. a link target changes: the row's label must follow the target, not a stored copy
  writeFileSync(join(root, 'changes', 'demo', 'acceptance.md'), '### AC-01 — Renamed criterion\n\n- evidence-mode: automated\n- checks: test/demo.test.mjs\n');
  await es.next((e) => e.event === 'change' && e.data.paths.includes('changes/demo/acceptance.md'), 3000);
  const after = await getJson(`/api/intent/${manifest.id}/task/T-01`);
  assert.equal(after.json.item.outgoing.find((r) => r.type === 'acceptance').label, 'Renamed criterion');

  // 3. the whole change moves into the archive
  renameSync(join(root, 'changes', 'demo'), join(root, 'changes', 'archive', '2026-05-05-demo'));
  const moved = await es.next((e) => e.event === 'change' && e.data.paths.some((p) => p.startsWith('changes/')), 3000);
  assert.ok(moved, 'the relocation is announced');
  const archived = await getJson(`/api/intent/${manifest.id}/task/T-01`);
  assert.equal(archived.status, 200, 'the same link still resolves after the move');
  assert.equal(archived.json.location.location, 'archive');
});

// ---------------------------------------------------------------- versioned evidence (T-14, AC-02/06/07/08)
/** Upgrades `demo` to v2 and records one eligible PASS attempt against it. */
async function verifiedDemo(root) {
  const manifest = upgradeDemo(root);
  const required = [{ id: 'AC-01', modes: ['automated'] }];
  const dir = join(root, 'changes', 'demo');
  const where = { dir, rel: 'changes/demo' };
  // the dashboard fixture is not a Git repository; the input scope says so explicitly
  const inputs = { allowNonGit: true };
  const started = withIntentLock(root, (token) => beginAttempt(root, { ...where, inputs, requiredCriteria: required }, token));
  write(root, 'scratch-log.txt', 'the full command log\n');
  withIntentLock(root, (token) =>
    recordAttempt(
      root,
      {
        ...where,
        sequence: started.sequence,
        result: {
          verdict: 'PASS',
          criteria: [{ id: 'AC-01', status: 'VERIFIED', modes: ['automated'], evidenceRefs: ['commands[0]'] }],
          commands: [{ command: 'node --test test/demo.test.mjs', exitCode: 0, summary: '3 passing', logHash: null }],
          origin: { kind: 'native-agent', actorId: 'verifier-1', writerActorId: 'writer-1', sourceRef: 'agent:verifier#9' },
        },
        reportText: '# report\n\n### Verdict: PASS\n\nEvery required criterion was run.\n',
        artifacts: [{ sourcePath: 'scratch-log.txt', relativePath: 'logs/run.txt' }],
        requiredCriteria: required,
      },
      token
    )
  );
  return manifest;
}

test('evidence: the change projection carries the durable head, its attempts and its spec base', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = await verifiedDemo(root);
  const r = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.verification.eligible, true);
  assert.equal(r.json.verification.head.state, 'closed');
  assert.equal(r.json.verification.head.verdict, 'PASS');
  assert.equal(r.json.verification.highWater, 1);
  assert.deepEqual(r.json.verification.attempts.map((a) => [a.id, a.verdict, a.qualified]), [['V-1', 'PASS', true]]);
  assert.deepEqual(r.json.verification.reasons, []);
  assert.equal(r.json.specBase.conflicts.length, 0);
});

test('evidence: an attempt reference shows what it was opened against and what it found', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = await verifiedDemo(root);
  const r = await getJson(`/api/intent/${manifest.id}/evidence/V-1`);
  assert.equal(r.status, 200);
  assert.equal(r.json.type, 'evidence');
  const a = r.json.item;
  assert.equal(a.id, 'V-1');
  assert.equal(a.verdict, 'PASS');
  assert.equal(a.qualified, true);
  assert.deepEqual(a.criteria.map((c) => [c.id, c.status]), [['AC-01', 'VERIFIED']]);
  assert.deepEqual(a.commands.map((c) => c.exitCode), [0]);
  assert.deepEqual(a.artifacts.map((x) => x.relativePath), ['logs/run.txt']);
  assert.equal('sourcePath' in a.artifacts[0], false, 'the original location is never served');
  assert.match(a.implementationDigest, /^[0-9a-f]{64}$/);
  assert.ok(a.capturedContract.includes('changes/demo/acceptance.md'));

  assert.equal((await getJson(`/api/intent/${manifest.id}/evidence/V-9`)).status, 404);
  assert.equal((await getJson(`/api/intent/${manifest.id}/evidence/not-an-attempt`)).status, 404);
});

test('evidence: the acceptance subroute shows the text the attempt captured, not the text today', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = await verifiedDemo(root);
  // the criterion is reworded after the attempt; the attempt must keep saying what it claimed
  write(root, 'changes/demo/acceptance.md', '### AC-01 — Renamed after the fact\n\n- evidence-mode: manual\n- checks: something else entirely\n');

  const captured = await getJson(`/api/intent/${manifest.id}/evidence/V-1/acceptance/AC-01`);
  assert.equal(captured.status, 200);
  assert.equal(captured.json.item.capturedAcceptance.title, 'Something observable');
  assert.deepEqual(captured.json.item.capturedAcceptance.evidenceModes, ['automated']);
  assert.match(captured.json.item.capturedAcceptance.text, /### AC-01 — Something observable/);
  assert.equal(captured.json.item.capturedAcceptance.capturedFrom, 'changes/demo/acceptance.md');

  const now = await getJson(`/api/intent/${manifest.id}/acceptance/AC-01`);
  assert.equal(now.json.item.title, 'Renamed after the fact', 'the latest route shows the current text');
  assert.equal((await getJson(`/api/intent/${manifest.id}/evidence/V-1/acceptance/AC-99`)).status, 404);
});

test('evidence: every attempt link still resolves after the change is archived', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = await verifiedDemo(root);
  const before = await getJson(`/api/intent/${manifest.id}/evidence/V-1`);
  renameSync(join(root, 'changes', 'demo'), join(root, 'changes', 'archive', '2026-06-06-demo'));

  const after = await getJson(`/api/intent/${manifest.id}/evidence/V-1`);
  assert.equal(after.status, 200);
  assert.equal(after.json.location.location, 'archive');
  assert.equal(after.json.item.path, 'changes/archive/2026-06-06-demo/verify/V-1');
  assert.equal(after.json.item.verdict, before.json.item.verdict);
  assert.deepEqual(after.json.item.criteria, before.json.item.criteria);

  const captured = await getJson(`/api/intent/${manifest.id}/evidence/V-1/acceptance/AC-01`);
  assert.equal(captured.status, 200);
  assert.match(captured.json.item.capturedAcceptance.text, /Something observable/);
  const change = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(change.json.verification.attempts.length, 1, 'the archived change still lists its attempts');
});

test('evidence: a newer unfinished attempt is shown as what blocks the older PASS', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = await verifiedDemo(root);
  withIntentLock(root, (token) =>
    beginAttempt(root, { dir: join(root, 'changes', 'demo'), rel: 'changes/demo', inputs: { allowNonGit: true }, requiredCriteria: [{ id: 'AC-01', modes: ['automated'] }] }, token)
  );
  const r = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(r.json.verification.eligible, false);
  assert.match(r.json.verification.reasons.join('; '), /V-2 is open/);
  assert.deepEqual(r.json.verification.attempts.map((a) => a.id), ['V-2', 'V-1'], 'newest first');
  assert.equal(r.json.verification.attempts[0].incomplete, true);
});

test('evidence: a spec-base conflict is reported with its base, current and proposed texts', async (t) => {
  const { root, getJson } = await up(t);
  const manifest = await verifiedDemo(root);
  withIntentLock(root, (token) => captureBaseline(root, { dir: join(root, 'changes', 'demo'), rel: 'changes/demo' }, {}, token));
  const clean = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(clean.json.specBase.conflicts.length, 0);
  assert.equal(clean.json.specBase.entries, 1);

  // somebody else adds the very requirement this change claims to introduce
  write(
    root,
    'specs/cap/spec.md',
    `${SPEC_MAIN}\n### Requirement: New thing\n\nSomebody else added this first.\n\n#### Scenario: Theirs\n- **WHEN** something happens\n- **THEN** something follows\n`
  );
  const r = await getJson(`/api/intent/${manifest.id}`);
  assert.equal(r.json.specBase.conflicts.length, 1);
  const c = r.json.specBase.conflicts[0];
  assert.equal(c.operation, 'ADDED');
  assert.equal(c.requirement, 'New thing');
  assert.match(c.reason, /requires the requirement to be absent/);
  assert.equal(c.base, null);
  assert.match(c.current, /Somebody else added this first/);
  assert.match(c.proposed, /It is new/);
});

// ---------------------------------------------------------------- scoped edit locks (T-17, AC-09/AC-12)
const lease = (root, sessionId, changeRef, stage, extra = {}) =>
  withIntentLock(root, (token) => {
    const identity = resolveSessionIdentity({ option: sessionId });
    return { identity, lease: acquireLease(root, { key: identity.key, sessionId, changeId: changeRef, stage, ...extra }, token) };
  });

test('lock: a live execute lease locks its own change, and leaves another change editable', async (t) => {
  const { root, getJson, post } = await up(t);
  // a second, independent change nobody is executing
  write(root, 'changes/other/tasks.md', '- [ ] 1.1 other work and verify it\n');
  write(root, 'changes/other/proposal.md', '## Why\n\nOther.\n');
  rmSync(join(root, '.my-flow', 'state', 'current-change.json')); // no legacy pointer; leases decide
  lease(root, 'session-a', 'demo', 'execute');

  const locked = await post({ path: 'changes/demo/tasks.md', content: 'x', mtimeMs: 1 });
  assert.equal(locked.status, 423);
  assert.equal(locked.json.error, 'locked');
  assert.match(locked.json.message, /"demo" is at stage execute in another session/);

  const free = await getJson('/api/file?path=changes/other/tasks.md');
  assert.equal(free.status, 200);
  assert.equal(free.json.writable, true, 'an independent change is not locked by somebody else execute lease');
  assert.equal(free.json.lockReason, null);
  const saved = await post({ path: 'changes/other/tasks.md', content: '- [ ] 1.1 other work and verify it, reworded\n', mtimeMs: free.json.mtimeMs });
  assert.equal(saved.status, 200);
});

test('lock: an execute lease also locks the main specs its deltas claim, and no others', async (t) => {
  const { root, getJson } = await up(t);
  write(root, 'specs/untouched/spec.md', '# untouched\n\n## Requirements\n');
  rmSync(join(root, '.my-flow', 'state', 'current-change.json'));
  lease(root, 'session-a', 'demo', 'execute');

  const claimed = await getJson('/api/file?path=specs/cap/spec.md');
  assert.equal(claimed.json.writable, false, 'demo claims cap through its delta');
  assert.match(claimed.json.lockReason, /specs\/cap is claimed by its delta/);

  const other = await getJson('/api/file?path=specs/untouched/spec.md');
  assert.equal(other.json.writable, true, 'a capability nobody claims stays editable');
});

test('lock: a lease at any stage other than execute locks nothing', async (t) => {
  const { root, getJson } = await up(t);
  rmSync(join(root, '.my-flow', 'state', 'current-change.json'));
  lease(root, 'session-a', 'demo', 'mf-plan');
  const r = await getJson('/api/file?path=changes/demo/tasks.md');
  assert.equal(r.json.writable, true);
  assert.equal(r.json.lockReason, null);
});

test('lock: an expired lease lifts with no restart', async (t) => {
  const { root, getJson } = await up(t);
  rmSync(join(root, '.my-flow', 'state', 'current-change.json'));
  const { identity } = lease(root, 'session-a', 'demo', 'execute');
  assert.equal((await getJson('/api/file?path=changes/demo/tasks.md')).json.writable, false);
  // the same session, twenty hours ago
  withIntentLock(root, (token) => acquireLease(root, { key: identity.key, sessionId: 'session-a', changeId: 'demo', stage: 'execute', now: Date.now() - 20 * 3600_000 }, token));
  assert.equal((await getJson('/api/file?path=changes/demo/tasks.md')).json.writable, true);
});

test('lock: a corrupt lease naming a change holds only that change', async (t) => {
  const { root, getJson } = await up(t);
  write(root, 'changes/other/tasks.md', '- [ ] 1.1 other and verify it\n');
  rmSync(join(root, '.my-flow', 'state', 'current-change.json'));
  const { identity } = lease(root, 'session-a', 'demo', 'execute');
  const lease_ = JSON.parse(readFileSync(sessionPath(root, identity.key), 'utf8'));
  writeFileSync(sessionPath(root, identity.key), JSON.stringify({ ...lease_, leaseUntil: 'not a date' }, null, 2) + '\n');

  const held = await getJson('/api/file?path=changes/demo/tasks.md');
  assert.equal(held.json.writable, false);
  assert.match(held.json.lockReason, /lease for "demo" is corrupt/);
  assert.equal((await getJson('/api/file?path=changes/other/tasks.md')).json.writable, true, 'other changes are unaffected');
});

test('lock: a corrupt lease naming nothing holds every intent write, with a repair diagnostic', async (t) => {
  const { root, getJson, post } = await up(t);
  rmSync(join(root, '.my-flow', 'state', 'current-change.json'));
  const { identity } = lease(root, 'session-a', 'demo', 'execute');
  writeFileSync(sessionPath(root, identity.key), '{ not json');

  const r = await getJson('/api/file?path=changes/demo/tasks.md');
  assert.equal(r.json.writable, false);
  assert.match(r.json.lockReason, /unreadable and name no change/);
  const save = await post({ path: 'changes/demo/tasks.md', content: 'x', mtimeMs: 1 });
  assert.equal(save.status, 423);
});

test('lock: the legacy global lock still applies when a project has no session data at all', async (t) => {
  const { root, getJson } = await up(t);
  write(root, '.my-flow/state/current-change.json', JSON.stringify({ change: 'demo', stage: 'execute', updated: new Date().toISOString() }, null, 2) + '\n');
  const r = await getJson('/api/file?path=changes/demo/tasks.md');
  assert.equal(r.json.writable, false);
  assert.match(r.json.lockReason, /read-only while "demo" is at stage execute/);
});

test('lock: a stale legacy pointer no longer locks, because the TTL now applies to it too', async (t) => {
  const { root, getJson } = await up(t);
  write(root, '.my-flow/state/current-change.json', JSON.stringify({ change: 'demo', stage: 'execute', updated: new Date(Date.now() - 20 * 3600_000).toISOString() }, null, 2) + '\n');
  const r = await getJson('/api/file?path=changes/demo/tasks.md');
  assert.equal(r.json.writable, true);
  assert.equal(r.json.lockReason, null);
});

test('lock: request validation still happens before any lock is disclosed', async (t) => {
  const { root, post } = await up(t);
  rmSync(join(root, '.my-flow', 'state', 'current-change.json'));
  lease(root, 'session-a', 'demo', 'execute');
  // a path outside the writable set is 403, never 423: the lock is not disclosed for it
  assert.equal((await post({ path: 'changes/demo/notes.txt', content: 'x', mtimeMs: 1 })).status, 403);
  assert.equal((await post({ path: '../escape.md', content: 'x', mtimeMs: 1 })).status, 400);
  assert.equal((await post('not json')).status, 400);
});

test('umbrella: children and their derived state are projected separately from integration', async (t) => {
  const { root, getJson } = await up(t);
  // demo becomes a child; a second change becomes the umbrella that integrates it
  const child = upgradeDemo(root);
  write(root, 'changes/integration/tasks.md', '- [ ] 1.1 integrate and verify the whole flow\n  - id: T-01\n  - depends-on: none\n');
  write(root, 'changes/integration/proposal.md', '## Why\n\nIntegration.\n');
  write(root, 'changes/integration/design.md', DESIGN);
  const umbrella = withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'integration'), 'integration', { kind: 'umbrella' }, token));
  writeFileSync(
    join(root, 'changes', 'integration', 'change.json'),
    JSON.stringify({ ...umbrella, children: [{ repo: 'self', changeId: child.id, after: [] }, { repo: 'elsewhere', changeId: '66666666-6666-4666-8666-666666666666', after: [] }] }, null, 2) + '\n'
  );

  const r = await getJson(`/api/intent/${umbrella.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.json.identity.kind, 'umbrella');
  assert.equal(r.json.umbrella.derived.total, 2);
  assert.equal(r.json.umbrella.derived.resolved, 1);
  const [local, remote] = r.json.umbrella.children;
  assert.equal(local.resolved, true);
  assert.equal(local.state.slug, 'demo');
  assert.deepEqual(local.state.tasks, { done: 1, total: 3 }, 'the child state is derived from the child, not stored here');
  assert.equal(remote.available, false);
  assert.match(remote.reason, /not registered in this checkout/);
  assert.ok(r.json.umbrella.blockers.some((b) => b.code === 'unavailable-repository'));
  assert.match(r.json.umbrella.note, /never ticks a task in this umbrella/);

  // the umbrella's own tasks and verification stay separate from all of that
  assert.deepEqual(r.json.tasks.map((x) => x.id), ['T-01']);
  assert.equal(r.json.tasks[0].checked, false, 'a finished child never ticks an umbrella box');
  assert.equal(r.json.verification.eligible, false);

  // an ordinary change carries no umbrella view at all
  assert.equal((await getJson(`/api/intent/${child.id}`)).json.umbrella, null);
});
