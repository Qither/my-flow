/**
 * Change identity and lifecycle (contracts C-01, C-02). Covers AC-02 (identity-based links that
 * survive renumbering, renaming and archive) and AC-12 (legacy changes stay readable and no
 * historical file acquires new guarantees).
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, before, beforeEach, describe, it } from 'node:test';
import { withIntentLock } from '../scripts/lib/intent-io.mjs';
import {
  changeIndex,
  createManifest,
  lifecycleOf,
  newManifest,
  readManifest,
  resolveChange,
  resolveChildren,
  updateLifecycle,
  validateManifest,
  acquireLease,
  currentSession,
  listLeases,
  readLease,
  recoverExpiredLease,
  releaseLease,
  resolveSessionIdentity,
  sessionPath,
  ttlHours,
  addRepository,
  readRepositories,
  removeRepository,
  resolveUmbrella,
} from '../scripts/lib/intent-state.mjs';
import { cleanEnv, cleanup, makeTmp, readText, runSpec, runSpecJson, write } from './helpers.mjs';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const seedChange = (root, name, extra = {}) => {
  write(root, `changes/${name}/tasks.md`, `# ${name}\n\n- [ ] 1.1 do it and verify it\n`);
  return withIntentLock(root, (token) => createManifest(root, join(root, 'changes', name), name, extra, token));
};
const messages = (errors) => errors.map((e) => e.message).join('\n');

describe('change identity', () => {
  let root;
  before(() => {
    root = makeTmp('state-identity');
  });
  after(() => cleanup(root));

  it('generates a UUID once and refuses to replace it', () => {
    const m = seedChange(root, 'demo');
    assert.match(m.id, UUID_RE);
    assert.equal(m.slug, 'demo');
    assert.equal(m.kind, 'change');
    assert.equal(m.stage, 'new');
    assert.equal(m.revision, 1);
    assert.deepEqual(m.children, []);
    assert.deepEqual(m.verification, { highWater: 0, head: null });
    assert.throws(() => seedChange(root, 'demo'), (e) => e.code === 'identity-exists');
    assert.equal(readManifest(join(root, 'changes', 'demo')).id, m.id);
  });

  it('refuses to write a manifest outside the coordinated lock', () => {
    write(root, 'changes/nolock/tasks.md', '# x\n');
    assert.throws(() => createManifest(root, join(root, 'changes', 'nolock'), 'nolock', {}, null), (e) => e.code === 'lock-lost');
    assert.equal(existsSync(join(root, 'changes', 'nolock', 'change.json')), false);
  });
});

describe('validateManifest', () => {
  it('accepts a fresh manifest', () => {
    assert.deepEqual(validateManifest(newManifest('demo')), []);
  });

  it('names every structural problem it finds', () => {
    const bad = { ...newManifest('demo'), schemaVersion: 1, id: 'not-a-uuid', kind: 'thing', stage: 'later', revision: 0 };
    const errors = validateManifest(bad);
    const text = messages(errors);
    assert.match(text, /schemaVersion must be 2/);
    assert.match(text, /id must be a UUID/);
    assert.match(text, /kind must be one of change, umbrella/);
    assert.match(text, /stage must be one of/);
    assert.match(text, /revision must be a positive integer/);
  });

  it('refuses a slug that disagrees with its directory', () => {
    assert.match(messages(validateManifest(newManifest('demo'), { slug: 'other' })), /does not match its directory/);
  });

  it('refuses repeated children, self-membership and a dangling after', () => {
    const base = newManifest('umb', { kind: 'umbrella' });
    const a = '11111111-1111-4111-8111-111111111111';
    const b = '22222222-2222-4222-8222-222222222222';
    const repeated = { ...base, children: [{ repo: 'self', changeId: a }, { repo: 'self', changeId: a }] };
    assert.match(messages(validateManifest(repeated)), /repeats child self\//);
    const selfChild = { ...base, children: [{ repo: 'self', changeId: base.id }] };
    assert.match(messages(validateManifest(selfChild)), /cannot be its own child/);
    const dangling = { ...base, children: [{ repo: 'self', changeId: a, after: [b] }] };
    assert.match(messages(validateManifest(dangling)), /is not a sibling child/);
  });

  it('refuses a verification head beyond its high-water mark', () => {
    const m = { ...newManifest('demo'), verification: { highWater: 1, head: { sequence: 4, state: 'open' } } };
    assert.match(messages(validateManifest(m)), /beyond the high-water mark/);
  });
});

describe('lifecycle compare-and-swap', () => {
  let root;
  let dir;
  beforeEach(() => {
    root = makeTmp('state-lifecycle');
    seedChange(root, 'demo');
    dir = join(root, 'changes', 'demo');
  });

  it('advances the stage and bumps the revision', () => {
    const next = withIntentLock(root, (t) => updateLifecycle(root, dir, { stage: 'execute' }, {}, t));
    assert.equal(next.stage, 'execute');
    assert.equal(next.revision, 2);
    assert.equal(readManifest(dir).stage, 'execute');
    cleanup(root);
  });

  it('refuses a stale writer and leaves the newer decision standing', () => {
    withIntentLock(root, (t) => updateLifecycle(root, dir, { stage: 'execute' }, {}, t));
    assert.throws(
      () => withIntentLock(root, (t) => updateLifecycle(root, dir, { stage: 'done' }, { expectedRevision: 1 }, t)),
      (e) => e.code === 'stale-revision' && /revision is 2, not the expected 1/.test(e.message)
    );
    assert.equal(readManifest(dir).stage, 'execute');
    cleanup(root);
  });

  it('refuses an unknown stage and a change with no identity', () => {
    assert.throws(() => withIntentLock(root, (t) => updateLifecycle(root, dir, { stage: 'shipping' }, {}, t)), (e) => e.code === 'bad-manifest');
    write(root, 'changes/legacy/tasks.md', '# legacy\n');
    assert.throws(() => withIntentLock(root, (t) => updateLifecycle(root, join(root, 'changes', 'legacy'), { stage: 'execute' }, {}, t)), (e) => e.code === 'no-identity');
    cleanup(root);
  });
});

describe('changeIndex and resolveChange', () => {
  let root;
  let ids;
  before(() => {
    root = makeTmp('state-index');
    ids = {
      active: seedChange(root, 'active-one').id,
      other: seedChange(root, 'active-two').id,
      archived: seedChange(root, 'archived-one').id,
    };
    // archive it the way `spec archive` does: the directory moves, the identity does not
    mkdirSync(join(root, 'changes', 'archive'), { recursive: true });
    renameSync(join(root, 'changes', 'archived-one'), join(root, 'changes', 'archive', '2026-01-02-archived-one'));
    write(root, 'changes/legacy-change/tasks.md', '- [ ] 1.1 legacy and verify it\n');
  });
  after(() => cleanup(root));

  it('lists active, archived and legacy changes with their schema version', () => {
    const { entries, diagnostics } = changeIndex(root);
    assert.deepEqual(diagnostics, []);
    const byDir = new Map(entries.map((e) => [e.dirName, e]));
    assert.equal(byDir.get('active-one').location, 'active');
    assert.equal(byDir.get('active-one').schemaVersion, 2);
    assert.equal(byDir.get('2026-01-02-archived-one').location, 'archive');
    assert.equal(byDir.get('2026-01-02-archived-one').slug, 'archived-one', 'the archived directory name never replaces the slug');
    const legacy = byDir.get('legacy-change');
    assert.equal(legacy.id, null);
    assert.equal(legacy.schemaVersion, 1);
    assert.equal(legacy.slug, 'legacy-change');
  });

  it('resolves a UUID to an archived change after the directory moved', () => {
    const r = resolveChange(root, ids.archived);
    assert.equal(r.entry.location, 'archive');
    assert.equal(r.entry.rel, 'changes/archive/2026-01-02-archived-one');
    assert.equal(r.entry.id, ids.archived);
  });

  it('resolves a slug, and prefers the active change when a name repeats', () => {
    assert.equal(resolveChange(root, 'active-one').entry.id, ids.active);
    assert.equal(resolveChange(root, 'archived-one').entry.id, ids.archived);
    assert.equal(resolveChange(root, 'legacy-change').entry.slug, 'legacy-change');
  });

  it('reports unknown and malformed references instead of guessing', () => {
    assert.equal(resolveChange(root, 'nope').error, 'no-such-change');
    assert.equal(resolveChange(root, '').error, 'bad-reference');
    assert.equal(resolveChange(root, '99999999-9999-4999-8999-999999999999').error, 'no-such-change');
  });

  it('treats a duplicate UUID as an error, never as one of the two', () => {
    const dup = makeTmp('state-dup');
    try {
      const m = seedChange(dup, 'one');
      write(dup, 'changes/two/tasks.md', '# two\n');
      writeFileSync(join(dup, 'changes', 'two', 'change.json'), JSON.stringify({ ...m, slug: 'two' }, null, 2) + '\n');
      const index = changeIndex(dup);
      const d = index.diagnostics.find((x) => x.code === 'duplicate-identity');
      assert.ok(d, 'the clash is reported');
      assert.deepEqual(d.paths, ['changes/one', 'changes/two']);
      const r = resolveChange(dup, m.id);
      assert.equal(r.error, 'duplicate-identity');
      assert.equal(r.entry, undefined);
    } finally {
      cleanup(dup);
    }
  });

  it('keeps identity stable across a slug rename of the directory', () => {
    const dir = makeTmp('state-rename');
    try {
      const m = seedChange(dir, 'before-rename');
      renameSync(join(dir, 'changes', 'before-rename'), join(dir, 'changes', 'after-rename'));
      const index = changeIndex(dir);
      assert.equal(index.byId.get(m.id).dirName, 'after-rename');
      assert.equal(resolveChange(dir, m.id).entry.id, m.id);
      // the slug inside the manifest is now stale, and validation says so rather than rewriting it
      assert.ok(index.diagnostics.some((d) => /does not match its directory/.test(d.message)));
    } finally {
      cleanup(dir);
    }
  });

  it('projects lifecycle without mixing in session activity', () => {
    const entry = resolveChange(root, 'active-one').entry;
    const life = lifecycleOf(entry);
    assert.deepEqual(Object.keys(life).sort(), ['id', 'kind', 'location', 'revision', 'schemaVersion', 'slug', 'stage', 'updated', 'verification']);
    assert.equal(life.stage, 'new');
  });
});

describe('umbrella children', () => {
  let root;
  let child;
  let umbrella;
  before(() => {
    root = makeTmp('state-children');
    child = seedChange(root, 'child-one');
    umbrella = seedChange(root, 'umbrella', { kind: 'umbrella' });
  });
  after(() => cleanup(root));

  it('resolves a same-repository child by id', () => {
    const m = { ...umbrella, children: [{ repo: 'self', changeId: child.id, after: [] }] };
    const { children, diagnostics } = resolveChildren(root, m);
    assert.deepEqual(diagnostics, []);
    assert.equal(children[0].resolved, true);
    assert.equal(children[0].entry.slug, 'child-one');
  });

  it('leaves an unknown child unresolved and says why', () => {
    const m = { ...umbrella, children: [{ repo: 'self', changeId: '33333333-3333-4333-8333-333333333333' }] };
    const { children, diagnostics } = resolveChildren(root, m);
    assert.equal(children[0].resolved, false);
    assert.equal(diagnostics[0].code, 'unresolved-child');
  });

  it('does not pretend to resolve a cross-repository child', () => {
    const m = { ...umbrella, children: [{ repo: 'sibling', changeId: child.id }] };
    const { children } = resolveChildren(root, m);
    assert.equal(children[0].resolved, false);
    assert.match(children[0].reason, /repository alias map/);
  });

  it('reports a membership cycle between two umbrellas', () => {
    const dir = makeTmp('state-cycle');
    try {
      const a = seedChange(dir, 'a', { kind: 'umbrella' });
      const b = seedChange(dir, 'b', { kind: 'umbrella' });
      writeFileSync(join(dir, 'changes', 'a', 'change.json'), JSON.stringify({ ...a, children: [{ repo: 'self', changeId: b.id }] }, null, 2) + '\n');
      writeFileSync(join(dir, 'changes', 'b', 'change.json'), JSON.stringify({ ...b, children: [{ repo: 'self', changeId: a.id }] }, null, 2) + '\n');
      const { diagnostics } = resolveChildren(dir, readManifest(join(dir, 'changes', 'a')));
      const cycle = diagnostics.find((d) => d.code === 'child-cycle');
      assert.ok(cycle, 'the membership cycle is reported');
      assert.match(cycle.message, /->/);
    } finally {
      cleanup(dir);
    }
  });
});

describe('legacy compatibility (AC-12)', () => {
  it('never writes into a legacy change while reading it', () => {
    const root = makeTmp('state-legacy');
    try {
      write(root, 'changes/legacy/tasks.md', '- [ ] 1.1 legacy and verify it\n');
      write(root, 'changes/legacy/proposal.md', '# p\n');
      const before_ = readFileSync(join(root, 'changes', 'legacy', 'tasks.md'), 'utf8');
      const index = changeIndex(root);
      resolveChange(root, 'legacy', index);
      assert.equal(existsSync(join(root, 'changes', 'legacy', 'change.json')), false);
      assert.equal(readFileSync(join(root, 'changes', 'legacy', 'tasks.md'), 'utf8'), before_);
      assert.equal(index.entries[0].stage, null, 'a legacy change has no lifecycle stage to report');
    } finally {
      cleanup(root);
    }
  });
});

// ---------------------------------------------------------------- session leases (T-15, AC-09/AC-12)
describe('session identity precedence', () => {
  it('prefers an explicit option, then the environment, then the host id, then a transcript', () => {
    const env = { MY_FLOW_SESSION_ID: 'from-env' };
    const hook = { session_id: 'from-host', transcript_path: 'C:\\x\\y.jsonl' };
    assert.equal(resolveSessionIdentity({ option: 'from-option', env, hook }).source, 'option');
    assert.equal(resolveSessionIdentity({ option: 'from-option', env, hook }).sessionId, 'from-option');
    assert.equal(resolveSessionIdentity({ env, hook }).sessionId, 'from-env');
    assert.equal(resolveSessionIdentity({ env: {}, hook }).sessionId, 'from-host');
    const t = resolveSessionIdentity({ env: {}, hook: { transcript_path: 'C:\\x\\y.jsonl' } });
    assert.equal(t.source, 'transcript');
    assert.match(t.sessionId, /^transcript:[0-9a-f]{16}$/);
    // the same transcript in either slash spelling is one session
    assert.equal(resolveSessionIdentity({ env: {}, hook: { transcript_path: 'C:/x/y.jsonl' } }).key, t.key);
  });

  it('is unidentified rather than guessing from the working directory or the process', () => {
    const r = resolveSessionIdentity({ env: {}, hook: { cwd: 'H:/project', pid: 1234 } });
    assert.equal(r.source, 'unidentified');
    assert.equal(r.sessionId, null);
    assert.equal(r.key, null);
    assert.equal(resolveSessionIdentity({ option: '   ', env: { MY_FLOW_SESSION_ID: '' }, hook: { session_id: '' } }).source, 'unidentified');
  });

  it('derives one stable key per session id', () => {
    const a = resolveSessionIdentity({ option: 'alpha' });
    assert.equal(a.key, resolveSessionIdentity({ option: 'alpha' }).key);
    assert.notEqual(a.key, resolveSessionIdentity({ option: 'beta' }).key);
    assert.match(a.key, /^[0-9a-f]{64}$/);
  });
});

describe('leases: two sessions never overwrite each other', () => {
  let root;
  let a;
  let b;
  beforeEach(() => {
    root = makeTmp('sess-lease');
    seedChange(root, 'demo');
    seedChange(root, 'other');
    a = resolveSessionIdentity({ option: 'session-a' });
    b = resolveSessionIdentity({ option: 'session-b' });
  });

  const bind = (identity, change, stage, extra = {}) =>
    withIntentLock(root, (token) => acquireLease(root, { key: identity.key, sessionId: identity.sessionId, changeId: change, stage, ...extra }, token));

  it('keeps each binding in its own file, and each session sees only its own', () => {
    bind(a, 'demo', 'mf-plan');
    bind(b, 'other', 'interview');
    assert.equal(currentSession(root, a).lease.changeId, 'demo');
    assert.equal(currentSession(root, b).lease.changeId, 'other');
    assert.equal(listLeases(root).length, 2);
    cleanup(root);
  });

  it('allows one execute lease per physical root, and says who holds it', () => {
    bind(a, 'demo', 'execute');
    assert.throws(() => bind(b, 'other', 'execute'), (e) => e.code === 'execute-lease-held' && /one physical root has one writer/.test(e.message));
    bind(a, 'demo', 'execute'); // the holder renews its own lease freely
    assert.equal(currentSession(root, a).lease.revision, 2);
    bind(b, 'other', 'mf-plan'); // any other stage is fine
    assert.equal(currentSession(root, b).lease.stage, 'mf-plan');
    cleanup(root);
  });

  it('releases only the requesting session', () => {
    bind(a, 'demo', 'execute');
    bind(b, 'other', 'mf-plan');
    withIntentLock(root, (token) => releaseLease(root, b.key, token));
    assert.equal(currentSession(root, a).lease.changeId, 'demo', "a's lease is untouched");
    assert.equal(currentSession(root, b).lease, null);
    cleanup(root);
  });

  it('treats an expired lease as inactive, and lets a new actor take it over explicitly', () => {
    bind(a, 'demo', 'execute', { now: Date.now() - 20 * 3600_000 });
    const mine = currentSession(root, a);
    assert.equal(mine.lease, null);
    assert.match(mine.reason, /expired/);
    // an expired execute lease no longer blocks another session
    bind(b, 'other', 'execute');
    assert.equal(currentSession(root, b).lease.stage, 'execute');
    const recovered = withIntentLock(root, (token) => recoverExpiredLease(root, a.key, {}, token));
    assert.equal(recovered.state, 'expired');
    assert.throws(() => withIntentLock(root, (token) => recoverExpiredLease(root, b.key, {}, token)), (e) => e.code === 'lease-live');
    cleanup(root);
  });

  it('refuses a lease that claims to run far past any possible TTL', () => {
    bind(a, 'demo', 'execute');
    const p = sessionPath(root, a.key);
    const lease = JSON.parse(readText(p));
    writeFileSync(p, JSON.stringify({ ...lease, leaseUntil: new Date(Date.now() + 365 * 24 * 3600_000).toISOString() }, null, 2) + '\n');
    assert.equal(readLease(root, a.key).state, 'corrupt');
    assert.equal(currentSession(root, a).lease, null);
    cleanup(root);
  });

  it('reports a corrupt lease rather than treating it as absent', () => {
    bind(a, 'demo', 'execute');
    writeFileSync(sessionPath(root, a.key), '{ not json');
    const l = readLease(root, a.key);
    assert.equal(l.state, 'corrupt');
    assert.match(l.reason, /not readable JSON/);
    cleanup(root);
  });

  it('requires an identified session and the coordinated lock', () => {
    assert.throws(() => withIntentLock(root, (token) => acquireLease(root, { key: null, sessionId: null, changeId: 'demo', stage: 'execute' }, token)), (e) => e.code === 'no-session');
    assert.throws(() => acquireLease(root, { key: a.key, sessionId: a.sessionId, changeId: 'demo', stage: 'execute' }, null), (e) => e.code === 'lock-lost');
    cleanup(root);
  });

  it('loses leases with scratch, and nothing else', () => {
    bind(a, 'demo', 'execute');
    const before = readManifest(join(root, 'changes', 'demo'));
    rmSync(join(root, '.my-flow'), { recursive: true, force: true });
    assert.deepEqual(listLeases(root), []);
    assert.equal(currentSession(root, a).lease, null);
    assert.deepEqual(readManifest(join(root, 'changes', 'demo')), before, 'lifecycle survives scratch loss');
    cleanup(root);
  });
});

describe('an unidentified caller never borrows another session', () => {
  let root;
  let a;
  beforeEach(() => {
    root = makeTmp('sess-unknown');
    seedChange(root, 'demo');
    a = resolveSessionIdentity({ option: 'session-a' });
  });

  it('reports ambiguity while any live lease exists', () => {
    withIntentLock(root, (token) => acquireLease(root, { key: a.key, sessionId: a.sessionId, changeId: 'demo', stage: 'execute' }, token));
    const unknown = currentSession(root, resolveSessionIdentity({ env: {} }));
    assert.equal(unknown.ambiguous, true);
    assert.equal(unknown.lease, null, "another session's lease is never adopted");
    assert.match(unknown.reason, /1 live session lease/);
    cleanup(root);
  });

  it('falls back to the legacy pointer only when no lease can be meant', () => {
    const unknown = currentSession(root, resolveSessionIdentity({ env: {} }));
    assert.equal(unknown.ambiguous, false);
    assert.match(unknown.reason, /the legacy pointer applies/);
    cleanup(root);
  });

  it('does not treat a known session with no binding as unidentified', () => {
    const r = currentSession(root, a);
    assert.equal(r.ambiguous, false);
    assert.equal(r.lease, null);
    assert.equal(r.state, 'none');
    assert.match(r.reason, /holds no lease/);
    cleanup(root);
  });
});

describe('the TTL is one shared number', () => {
  it('reads the option, then the environment variable, then twelve hours', () => {
    assert.equal(ttlHours({ env: {} }), 12);
    assert.equal(ttlHours({ env: { MY_FLOW_EXECUTE_GUARD_TTL_HOURS: '3' } }), 3);
    assert.equal(ttlHours({ hours: 1, env: { MY_FLOW_EXECUTE_GUARD_TTL_HOURS: '3' } }), 1);
    assert.equal(ttlHours({ env: { MY_FLOW_EXECUTE_GUARD_TTL_HOURS: 'soon' } }), 12);
    assert.equal(ttlHours({ env: { MY_FLOW_EXECUTE_GUARD_TTL_HOURS: '0' } }), 12);
  });
});

describe('spec stage binds a session', () => {
  let root;
  before(() => {
    root = makeTmp('sess-cli');
    write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n');
    write(root, 'changes/demo/acceptance.md', '### AC-01 — It works\n\n- evidence-mode: automated\n- checks: test/demo.test.mjs\n');
    write(root, 'changes/demo/proposal.md', '## Why\n\nx\n');
    write(root, 'changes/demo/design.md', '## Do-Not-Touch\n\nnone\n\n## Rebuild / Re-run After Change\n\nnone\n');
    withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', {}, token));
  });
  after(() => cleanup(root));

  it('writes a lease and advances the lifecycle, and never the global pointer', () => {
    const r = runSpecJson(root, ['stage', 'demo', 'execute', '--session', 'cli-session-1']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.session, 'cli-session-1');
    assert.equal(r.json.source, 'option');
    assert.equal(r.json.lease.stage, 'execute');
    assert.equal(r.json.lifecycle.stage, 'execute');
    assert.equal(r.json.lifecycle.revision, 2);
    assert.equal(existsSync(join(root, '.my-flow', 'state', 'current-change.json')), false, 'an identified session leaves the legacy pointer alone');
    assert.equal(readManifest(join(root, 'changes', 'demo')).stage, 'execute');
  });

  it('reads the session from the environment when no option is given', () => {
    const r = runSpecJson(root, ['stage', 'demo', 'mf-plan'], cleanEnv({ MY_FLOW_SESSION_ID: 'cli-session-1' }));
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.source, 'env');
    assert.equal(r.json.lease.revision, 2, 'the same session renewed its own lease');
  });

  it('refuses a stale expected revision', () => {
    const r = runSpec(root, ['stage', 'demo', 'done', '--session', 'cli-session-1', '--expected-revision', '1']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /stale-revision/);
  });

  it('asks an unidentified caller for a session while another session holds a lease', () => {
    const r = runSpec(root, ['stage', 'demo', 'done']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /session-required/);
    assert.match(r.stderr, /pass --session/);
  });

  it('shows and releases only its own lease', () => {
    const shown = runSpecJson(root, ['session', 'show', '--session', 'cli-session-1']);
    assert.equal(shown.json.current.lease.changeId, readManifest(join(root, 'changes', 'demo')).id);
    const released = runSpecJson(root, ['session', 'release', '--session', 'cli-session-1']);
    assert.equal(released.json.released, true);
    assert.equal(runSpecJson(root, ['session', 'show', '--session', 'cli-session-1']).json.current.lease, null);
    // with no lease left, an unidentified caller may use the legacy pointer again
    assert.equal(runSpec(root, ['stage', 'demo', 'done']).status, 0);
  });
});

// ---------------------------------------------------------------- umbrellas (T-18, AC-02/AC-09)
describe('repository aliases', () => {
  let root;
  let sibling;
  beforeEach(() => {
    root = makeTmp('umb-alias');
    sibling = makeTmp('umb-sibling');
    write(sibling, 'changes/child/tasks.md', '- [ ] 1.1 child work and verify it\n');
  });

  const add = (alias, path) => withIntentLock(root, (token) => addRepository(root, alias, path, token));

  it('registers an alias only for a real intent root, and never for "self"', () => {
    const r = add('sibling', sibling);
    assert.equal(r.alias, 'sibling');
    assert.deepEqual(readRepositories(root), { sibling: { root: r.root } });
    assert.throws(() => add('self', sibling), (e) => e.code === 'bad-alias' && /reserved/.test(e.message));
    assert.throws(() => add('Bad Alias', sibling), (e) => e.code === 'bad-alias');
    assert.throws(() => add('missing', join(sibling, 'nope')), (e) => e.code === 'no-such-repository');
    const plain = makeTmp('umb-plain');
    try {
      assert.throws(() => add('plain', plain), (e) => e.code === 'not-an-intent-root');
    } finally {
      cleanup(plain);
    }
    cleanup(root);
    cleanup(sibling);
  });

  it('removes an alias, and an unreadable map is simply empty', () => {
    add('sibling', sibling);
    assert.equal(withIntentLock(root, (token) => removeRepository(root, 'sibling', token)), true);
    assert.deepEqual(readRepositories(root), {});
    assert.equal(withIntentLock(root, (token) => removeRepository(root, 'sibling', token)), false);
    write(root, '.my-flow/state/repositories.json', '{ not json');
    assert.deepEqual(readRepositories(root), {});
    cleanup(root);
    cleanup(sibling);
  });

  it('requires the coordinated lock to change the map', () => {
    assert.throws(() => addRepository(root, 'sibling', sibling, null), (e) => e.code === 'lock-lost');
    cleanup(root);
    cleanup(sibling);
  });
});

describe('umbrella children', () => {
  let root;
  let sibling;
  let umbrella;
  let localChild;
  let remoteChild;

  const seedTasks = (where, name, { done = 0, total = 2 } = {}) => {
    const lines = [];
    for (let i = 1; i <= total; i++) lines.push(`- [${i <= done ? 'x' : ' '}] 1.${i} step ${i} and verify it`);
    write(where, `changes/${name}/tasks.md`, lines.join('\n') + '\n');
  };

  beforeEach(() => {
    root = makeTmp('umb-children');
    sibling = makeTmp('umb-remote');
    seedTasks(root, 'child-a', { done: 2 });
    seedTasks(root, 'child-b', { done: 1 });
    seedTasks(root, 'integration');
    seedTasks(sibling, 'remote-child', { done: 2 });
    localChild = withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'child-a'), 'child-a', {}, token));
    withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'child-b'), 'child-b', {}, token));
    remoteChild = withIntentLock(sibling, (token) => createManifest(sibling, join(sibling, 'changes', 'remote-child'), 'remote-child', {}, token));
    umbrella = withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'integration'), 'integration', { kind: 'umbrella' }, token));
  });
  const withChildren = (children) => ({ ...umbrella, children });
  const done = () => {
    cleanup(root);
    cleanup(sibling);
  };

  it('derives each local child state fresh, and never copies a counter into the umbrella', () => {
    const r = resolveUmbrella(root, withChildren([{ repo: 'self', changeId: localChild.id, after: [] }]));
    assert.deepEqual(r.blockers, []);
    assert.equal(r.children[0].resolved, true);
    assert.deepEqual(r.children[0].state.tasks, { done: 2, total: 2 });
    assert.equal(r.derived.complete, 1);
    assert.match(r.note, /never ticks a task in this umbrella/);
    // the child moves on; the umbrella's own manifest is untouched and the view follows
    seedTasks(root, 'child-a', { done: 1 });
    assert.deepEqual(resolveUmbrella(root, withChildren([{ repo: 'self', changeId: localChild.id }])).children[0].state.tasks, { done: 1, total: 2 });
    assert.deepEqual(readManifest(join(root, 'changes', 'integration')).children, [], 'nothing was written back');
    done();
  });

  it('resolves a cross-repository child only through a registered alias', () => {
    const children = [{ repo: 'sibling', changeId: remoteChild.id, after: [] }];
    const before = resolveUmbrella(root, withChildren(children));
    assert.equal(before.children[0].available, false);
    assert.equal(before.children[0].resolved, false);
    assert.match(before.children[0].reason, /not registered in this checkout/);
    assert.ok(before.blockers.some((b) => b.code === 'unavailable-repository'));

    withIntentLock(root, (token) => addRepository(root, 'sibling', sibling, token));
    const after = resolveUmbrella(root, withChildren(children));
    assert.deepEqual(after.blockers, []);
    assert.equal(after.children[0].resolved, true);
    assert.equal(after.children[0].state.slug, 'remote-child');
    assert.deepEqual(after.children[0].state.tasks, { done: 2, total: 2 });
    assert.equal('dir' in after.children[0].state, false, 'a cross-repository projection exposes state, never a path');
    assert.equal('root' in after.children[0], false);
    done();
  });

  it('keeps an unknown child visible and unresolved rather than dropping it', () => {
    const r = resolveUmbrella(root, withChildren([{ repo: 'self', changeId: '44444444-4444-4444-8444-444444444444' }]));
    assert.equal(r.children.length, 1);
    assert.equal(r.children[0].resolved, false);
    assert.ok(r.blockers.some((b) => b.code === 'unresolved-child'));
    done();
  });

  it('refuses an abandoned child and an abandoned prerequisite', () => {
    mkdirSync(join(root, 'changes', 'archive'), { recursive: true });
    renameSync(join(root, 'changes', 'child-a'), join(root, 'changes', 'archive', '2026-01-01-child-a-abandoned'));
    const r = resolveUmbrella(
      root,
      withChildren([
        { repo: 'self', changeId: localChild.id },
        { repo: 'self', changeId: readManifest(join(root, 'changes', 'child-b')).id, after: [localChild.id] },
      ])
    );
    assert.equal(r.children[0].state.abandoned, true);
    assert.ok(r.blockers.some((b) => b.code === 'abandoned-child'));
    assert.ok(r.blockers.some((b) => b.code === 'abandoned-prerequisite'));
    done();
  });

  it('reports an ordering constraint that names a change which is not a sibling', () => {
    const r = resolveUmbrella(root, withChildren([{ repo: 'self', changeId: localChild.id, after: ['55555555-5555-4555-8555-555555555555'] }]));
    assert.ok(r.blockers.some((b) => b.code === 'unknown-prerequisite'));
    done();
  });
});
