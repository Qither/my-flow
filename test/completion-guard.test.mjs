import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, writeFileSync } from 'node:fs';
import { HOUR, cleanEnv, cleanup, gitInit, hasGit, iso, makeTmp, runContextHook, runHook, write, writeState } from './helpers.mjs';
import { withIntentLock } from '../scripts/lib/intent-io.mjs';
import { acquireLease, resolveSessionIdentity, sessionPath } from '../scripts/lib/intent-state.mjs';

const skip = hasGit() ? false : 'git is not available';
const CLAIM = 'All tasks are done and verified.';
const NO_CLAIM = 'Continuing with task 1.2.';
const OPEN_TASK = '## 1. Group\n- [ ] 1.1 foo and verify bar\n';

function project(t, { tasks = OPEN_TASK, state } = {}) {
  const root = makeTmp('hook');
  t.after(() => cleanup(root));
  gitInit(root);
  write(root, 'changes/demo/tasks.md', tasks);
  if (state !== null) writeState(root, { change: 'demo', stage: 'execute', updated: iso(), ...(state ?? {}) });
  return root;
}

// ---------------------------------------------------------------- fail-open paths
test('allows when stop_hook_active is set (never loops on its own block)', { skip }, (t) => {
  const root = project(t);
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM, stop_hook_active: true }), {});
});

test('allows on empty stdin', { skip }, (t) => {
  const root = project(t);
  assert.deepEqual(runHook(root, {}, cleanEnv(), ''), {});
});

test('MY_FLOW_SKIP_HOOKS=all disables both rules', { skip }, (t) => {
  const root = project(t);
  write(root, 'stub.js', '// TODO: implement this\n');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM }, cleanEnv({ MY_FLOW_SKIP_HOOKS: 'all' })), {});
});

// ---------------------------------------------------------------- execute-guard
test('execute-guard blocks a completion claim while fresh execute state has unticked tasks', { skip }, (t) => {
  const root = project(t);
  const out = runHook(root, { last_assistant_message: CLAIM });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^\[my-flow execute-guard\]/);
  assert.match(out.reason, /1\.1 foo and verify bar/);
  assert.match(out.reason, /stage demo done/);
});

test('execute-guard does not block a message without a completion claim', { skip }, (t) => {
  const root = project(t);
  assert.deepEqual(runHook(root, { last_assistant_message: NO_CLAIM }), {});
});

test('execute-guard allows the /goal handoff message although it contains completion words', { skip }, (t) => {
  const root = project(t);
  const handoff =
    'Paste this to keep the session on task, then say "continue":\n' +
    '/goal Complete every unchecked task in changes/demo/tasks.md. Done only when every box is ticked.';
  assert.deepEqual(runHook(root, { last_assistant_message: handoff }), {});
});

test('execute-guard still blocks a claim that only mentions /goal mid-sentence', { skip }, (t) => {
  const root = project(t);
  const out = runHook(root, { last_assistant_message: 'All tasks are done; the /goal was active throughout.' });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^\[my-flow execute-guard\]/);
});

test('execute-guard reads the claim from the transcript when last_assistant_message is absent', { skip }, (t) => {
  const root = project(t);
  const transcript = write(
    root,
    'transcript.jsonl',
    [
      JSON.stringify({ type: 'user', message: { role: 'user', content: 'go' } }),
      JSON.stringify({ type: 'assistant', message: { role: 'assistant', content: [{ type: 'text', text: 'Everything is implemented.' }] } }),
    ].join('\n') + '\n'
  );
  assert.equal(runHook(root, { transcript_path: transcript }).decision, 'block');
});

test('execute-guard ignores stale state: old, missing, or unparseable updated', { skip }, (t) => {
  for (const state of [{ updated: iso(-13 * HOUR) }, { updated: undefined }, { updated: 'garbage' }]) {
    const root = project(t, { state });
    assert.deepEqual(runHook(root, { last_assistant_message: CLAIM }), {}, JSON.stringify(state));
  }
});

test('execute-guard honors MY_FLOW_EXECUTE_GUARD_TTL_HOURS and falls back to 12 on junk', { skip }, (t) => {
  const thirteenHoursOld = project(t, { state: { updated: iso(-13 * HOUR) } });
  assert.equal(runHook(thirteenHoursOld, { last_assistant_message: CLAIM }, cleanEnv({ MY_FLOW_EXECUTE_GUARD_TTL_HOURS: '24' })).decision, 'block');
  assert.deepEqual(runHook(thirteenHoursOld, { last_assistant_message: CLAIM }, cleanEnv({ MY_FLOW_EXECUTE_GUARD_TTL_HOURS: 'abc' })), {});

  const twoHoursOld = project(t, { state: { updated: iso(-2 * HOUR) } });
  assert.deepEqual(runHook(twoHoursOld, { last_assistant_message: CLAIM }, cleanEnv({ MY_FLOW_EXECUTE_GUARD_TTL_HOURS: '1' })), {});
  assert.equal(runHook(twoHoursOld, { last_assistant_message: CLAIM }).decision, 'block');
});

test('execute-guard stays silent for stages other than execute and when all tasks are ticked', { skip }, (t) => {
  const done = project(t, { state: { stage: 'done' } });
  assert.deepEqual(runHook(done, { last_assistant_message: CLAIM }), {});
  const ticked = project(t, { tasks: '## 1. Group\n- [x] 1.1 foo and verify bar\n' });
  assert.deepEqual(runHook(ticked, { last_assistant_message: CLAIM }), {});
});

test('execute-guard treats an indented "blocked:" note as blocked, but not one on the task line', { skip }, (t) => {
  const blocked = project(t, { tasks: '## 1. Group\n- [ ] 1.1 foo and verify bar\n  - blocked: waiting on the user\n' });
  assert.deepEqual(runHook(blocked, { last_assistant_message: CLAIM }), {});
  const inline = project(t, { tasks: '## 1. Group\n- [ ] 1.1 foo and verify bar blocked: nope\n' });
  assert.equal(runHook(inline, { last_assistant_message: CLAIM }).decision, 'block');
});

test('execute-guard handles CRLF tasks.md and simple-mode docs/changes/<name>.md', { skip }, (t) => {
  const crlf = project(t, { tasks: '## 1. Group\r\n- [ ] 1.1 foo and verify bar\r\n' });
  assert.equal(runHook(crlf, { last_assistant_message: CLAIM }).decision, 'block');

  const simple = makeTmp('hook-simple');
  t.after(() => cleanup(simple));
  gitInit(simple);
  write(simple, 'docs/changes/demo.md', '# demo\n- [ ] 2.1 baz and verify qux\n');
  writeState(simple, { change: 'demo', stage: 'execute', updated: iso() });
  assert.match(runHook(simple, { last_assistant_message: CLAIM }).reason, /2\.1 baz/);
});

// ---------------------------------------------------------------- completion-guard
test('completion-guard blocks a claim when untracked code contains fake-completion markers', { skip }, (t) => {
  const root = project(t, { state: null });
  write(root, 'stub.js', 'export function f() {\n  // TODO: implement later\n  return null; // stub\n}\n');
  const out = runHook(root, { last_assistant_message: CLAIM });
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^\[my-flow completion-guard\]/);
  assert.match(out.reason, /stub\.js: placeholder TODO/);
  assert.match(out.reason, /stub\.js: placeholder return/);
});

test('completion-guard allows a claim when the diff is clean', { skip }, (t) => {
  const root = project(t, { state: null });
  write(root, 'clean.js', 'export const a = 1;\n');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM }), {});
});

test('completion-guard still runs when only execute-guard is skipped', { skip }, (t) => {
  const root = project(t);
  write(root, 'stub.js', 'test.skip("later", () => {});\n');
  const out = runHook(root, { last_assistant_message: CLAIM }, cleanEnv({ MY_FLOW_SKIP_HOOKS: 'execute-guard' }));
  assert.equal(out.decision, 'block');
  assert.match(out.reason, /^\[my-flow completion-guard\]/);
  assert.match(out.reason, /skipped test/);
});

test('execute-guard wins over completion-guard when both would fire', { skip }, (t) => {
  const root = project(t);
  write(root, 'stub.js', '// TODO: implement this\n');
  assert.match(runHook(root, { last_assistant_message: CLAIM }).reason, /^\[my-flow execute-guard\]/);
});

// ---------------------------------------------------------------- shared session view (T-16, AC-09/AC-12)
const bind = (root, sessionId, change, stage, extra = {}) =>
  withIntentLock(root, (token) => {
    const identity = resolveSessionIdentity({ option: sessionId });
    return acquireLease(root, { key: identity.key, sessionId, changeId: change, stage, ...extra }, token);
  });

test('execute-guard: a session with its own execute lease is guarded by its own lease', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'session-a', 'demo', 'execute');
  const r = runHook(root, { last_assistant_message: CLAIM, session_id: 'session-a' });
  assert.equal(r.decision, 'block');
  assert.match(r.reason, /change "demo" is in stage execute/);
  assert.match(r.reason, /1 unticked task/);
});

test('execute-guard: a session whose lease is for another stage is not guarded', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'session-a', 'demo', 'mf-plan');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM, session_id: 'session-a' }), {});
});

test('execute-guard: one session is never guarded by another session lease', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'session-a', 'demo', 'execute');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM, session_id: 'session-b' }), {}, 'a different identified session');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM }), {}, 'and an unidentified caller');
});

test('execute-guard: an unidentified caller is not guarded by the legacy pointer while a lease is live', { skip }, (t) => {
  const root = project(t); // a fresh legacy pointer at stage execute
  assert.equal(runHook(root, { last_assistant_message: CLAIM }).decision, 'block', 'precondition: the legacy backstop works');
  bind(root, 'session-a', 'demo', 'execute');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM }), {}, 'a live lease exists, so the pointer is not read');
});

test('execute-guard: an expired lease stops guarding and the legacy pointer takes over again', { skip }, (t) => {
  const root = project(t);
  bind(root, 'session-a', 'demo', 'execute', { now: Date.now() - 20 * HOUR });
  const r = runHook(root, { last_assistant_message: CLAIM, session_id: 'session-b' });
  assert.equal(r.decision, 'block', 'no live lease remains, so the fresh legacy pointer applies');
});

test('execute-guard: the host session id wins over a transcript path', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'session-a', 'demo', 'execute');
  const transcript = write(root, 'transcript.jsonl', '{}\n');
  assert.equal(runHook(root, { last_assistant_message: CLAIM, session_id: 'session-a', transcript_path: transcript }).decision, 'block');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM, session_id: 'session-other', transcript_path: transcript }), {});
});

test('execute-guard: MY_FLOW_SESSION_ID identifies the session when the host payload does not', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'env-session', 'demo', 'execute');
  assert.equal(runHook(root, { last_assistant_message: CLAIM }, cleanEnv({ MY_FLOW_SESSION_ID: 'env-session' })).decision, 'block');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM }, cleanEnv({ MY_FLOW_SESSION_ID: 'somebody-else' })), {});
});

test('execute-guard: the goal handoff is still exempt when a lease is live', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'session-a', 'demo', 'execute');
  const handoff = '/goal Complete every unchecked task in changes/demo/tasks.md. Done only when every box is ticked.';
  assert.deepEqual(runHook(root, { last_assistant_message: handoff, session_id: 'session-a' }), {}, 'the handoff quotes the goal, it does not claim a result');
});

test('execute-guard: a corrupt lease fails open rather than crashing the session', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'session-a', 'demo', 'execute');
  const identity = resolveSessionIdentity({ option: 'session-a' });
  writeFileSync(sessionPath(root, identity.key), '{ not json');
  assert.deepEqual(runHook(root, { last_assistant_message: CLAIM, session_id: 'session-a' }), {});
});

test('session-context: reports a live lease as this session, and ambiguity to an unidentified one', { skip }, (t) => {
  const root = project(t, { state: null });
  bind(root, 'session-a', 'demo', 'execute');
  const mine = runContextHook(root, { session_id: 'session-a' });
  assert.match(mine.systemMessage, /<- current \(stage: execute, this session\)/);
  const stranger = runContextHook(root, {});
  assert.match(stranger.systemMessage, /Another session holds a live lease/);
  assert.equal(/<- current/.test(stranger.systemMessage), false, "another session's work is never shown as current here");
});

test('session-context: falls back to the legacy pointer when no lease exists', { skip }, (t) => {
  const root = project(t);
  const r = runContextHook(root, {});
  assert.match(r.systemMessage, /<- current \(stage: execute, legacy pointer\)/);
});

test('session-context: isolates model routing from inherited user homes', { skip }, (t) => {
  const root = project(t);
  const external = makeTmp('external-model-state');
  t.after(() => cleanup(external));
  const state = JSON.stringify({ pending: { line: 'external state must stay untouched' }, lastSpawn: { at: new Date().toISOString() } });
  const statePath = write(external, 'models-state.json', state);
  const output = runContextHook(root, {}, cleanEnv({ MY_FLOW_HOME: external }));
  assert.equal(readFileSync(statePath, 'utf8'), state, 'the hook must not mutate an inherited home');
  assert.doesNotMatch(output.systemMessage ?? '', /external state must stay untouched/, 'outside model state must not leak into fixture context');
  assert.match(output.systemMessage, /test-only model routing state/, 'routing remains active inside the fixture');
});
