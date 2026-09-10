/**
 * Dashboard server: API parity with the CLI, push updates, the guarded save endpoint and the
 * same-origin guard. Every test builds its own fixture project and starts a server on port 0.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { request } from 'node:http';
import { join } from 'node:path';
import { test } from 'node:test';
import { startServer } from '../scripts/dashboard.mjs';
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
  for (const path of ['changes/archive/2026-01-01-old/proposal.md', '.my-flow/ask/x.md', 'changes/demo/notes.txt']) {
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
