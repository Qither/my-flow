import assert from 'node:assert/strict';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { TEMPLATES, cleanup, makeTmp, readState, readText, runSpec, runSpecJson, write } from './helpers.mjs';

const scenario = (name) => `#### Scenario: ${name}\n- **WHEN** something happens\n- **THEN** something follows\n`;
const requirement = (name, sc = `${name}-basic`) => `### Requirement: ${name}\nThe system SHALL ${name}.\n\n${scenario(sc)}\n`;
const mainSpec = (...names) => `# cap Specification\n\n## Purpose\nTest capability.\n\n## Requirements\n\n${names.map((n) => requirement(n)).join('')}`;

function fresh(t, prefix = 'spec') {
  const root = makeTmp(prefix);
  t.after(() => cleanup(root));
  return root;
}
function tickAll(root, name) {
  const p = join(root, 'changes', name, 'tasks.md');
  write(root, `changes/${name}/tasks.md`, readText(p).replace(/- \[ \]/g, '- [x]'));
}

// ---------------------------------------------------------------- new
test('new: creates the three artifacts from templates and marks the change current', (t) => {
  const root = fresh(t);
  const r = runSpec(root, ['new', 'demo']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /created changes\/demo\//);
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) {
    assert.equal(readText(join(root, 'changes', 'demo', f)), readText(join(TEMPLATES, f)), `${f} equals template`);
  }
  const state = readState(root);
  assert.equal(state.change, 'demo');
  assert.equal(state.stage, 'new');
  assert.ok(Date.now() - Date.parse(state.updated) < 60_000, 'updated is recent');
});

test('new: refuses an existing change and a non-kebab-case name', (t) => {
  const root = fresh(t);
  assert.equal(runSpec(root, ['new', 'demo']).status, 0);
  const dup = runSpec(root, ['new', 'demo']);
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /already exists/);
  const bad = runSpec(root, ['new', 'Bad_Name']);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /kebab-case/);
});

// ---------------------------------------------------------------- status
test('status: reports ticked/total tasks, artifact state, and the current change', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  const r = runSpec(root, ['status']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /demo <- current \(new\): 0\/6 tasks; proposal=empty design=empty tasks=empty/);
  const j = runSpecJson(root, ['status']).json;
  assert.equal(j.current.change, 'demo');
  assert.equal(j.changes[0].tasks.total, 6);
  assert.deepEqual(j.changes[0].artifacts, { proposal: 'empty', design: 'empty', tasks: 'empty' });
  assert.match(runSpec(root, ['status', 'ghost']).stdout, /ghost: \(missing\)/);
});

test('status: empty project says so', (t) => {
  const root = fresh(t);
  const r = runSpec(root, ['status']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /no active changes/);
});

// ---------------------------------------------------------------- validate
test('validate: an untouched new change passes with warnings only', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  const r = runSpec(root, ['validate']);
  assert.equal(r.status, 0, r.stdout);
  assert.match(r.stdout, /^ok +demo/m);
  assert.match(r.stdout, /warn:/);
  assert.match(r.stdout, /1 passed, 0 failed/);
});

test('validate: design.md without the required sections is an error', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  write(root, 'changes/demo/design.md', '## Context\nSomething.\n\n## Rebuild / Re-run After Change\nnone\n');
  const r = runSpec(root, ['validate', 'demo']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /missing the required section "## Do-Not-Touch"/);
  assert.doesNotMatch(r.stdout, /missing the required section "## Rebuild/);
});

test('validate: MODIFIED requirement must exist in the main spec', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  write(root, 'changes/demo/specs/cap/spec.md', `## MODIFIED Requirements\n\n${requirement('Foo')}`);
  let r = runSpec(root, ['validate', 'demo']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MODIFIED "Foo" but specs\/cap\/spec.md does not exist/);

  write(root, 'specs/cap/spec.md', mainSpec('Bar'));
  r = runSpec(root, ['validate', 'demo']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /MODIFIED "Foo" is not in specs\/cap\/spec.md/);
});

test('validate: REMOVED requirement needs a Reason (error) and a Migration (warning)', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  write(root, 'specs/cap/spec.md', mainSpec('Foo'));
  write(root, 'changes/demo/specs/cap/spec.md', '## REMOVED Requirements\n\n### Requirement: Foo\n');
  const r = runSpec(root, ['validate', 'demo']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /REMOVED "Foo" needs a "\*\*Reason\*\*:" line/);
  assert.match(r.stdout, /warn:.*REMOVED "Foo" has no "\*\*Migration\*\*:" line/);
});

test('validate: a consistent delta against the main spec passes', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  write(root, 'specs/cap/spec.md', mainSpec('Foo', 'Baz'));
  write(
    root,
    'changes/demo/specs/cap/spec.md',
    `## ADDED Requirements\n\n${requirement('Bar')}## MODIFIED Requirements\n\n${requirement('Foo', 'Foo-v2')}## REMOVED Requirements\n\n### Requirement: Baz\n- **Reason**: superseded\n- **Migration**: none\n`
  );
  const r = runSpec(root, ['validate', 'demo']);
  assert.equal(r.status, 0, r.stdout);
  assert.doesNotMatch(r.stdout, /error:/);
});

test('validate: scenarios must use exactly four hashes and WHEN / THEN', (t) => {
  const root = fresh(t);
  write(root, 'specs/cap/spec.md', '# cap\n\n## Requirements\n\n### Requirement: Foo\n\n### Scenario: wrong\n- **WHEN** a\n- **THEN** b\n');
  const r = runSpec(root, ['validate']);
  assert.equal(r.status, 1);
  assert.match(r.stdout, /scenarios must use exactly four hashes/);
  assert.match(r.stdout, /requirement "Foo" has no "#### Scenario:"/);
});

// ---------------------------------------------------------------- archive
test('archive: refuses while tasks are unticked or no PASS report exists, then succeeds', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  let r = runSpec(root, ['archive', 'demo']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /task\(s\) still unticked/);

  tickAll(root, 'demo');
  r = runSpec(root, ['archive', 'demo']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no PASS verification report/);

  write(root, '.my-flow/verify/demo-2026.md', '## Verification Report\n### Verdict: PASS\n');
  r = runSpec(root, ['archive', 'demo']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(root, 'changes', 'demo')), 'change directory moved');
  const archived = readdirSync(join(root, 'changes', 'archive')).filter((d) => d.endsWith('-demo'));
  assert.equal(archived.length, 1);
  assert.equal(readState(root).stage, 'archived');
});

test('archive --force: merges ADDED / MODIFIED / REMOVED into the main spec', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'merge']);
  write(root, 'specs/cap/spec.md', mainSpec('Old', 'Gone'));
  write(
    root,
    'changes/merge/specs/cap/spec.md',
    `## ADDED Requirements\n\n${requirement('New')}## MODIFIED Requirements\n\n${requirement('Old', 'Old-v2')}## REMOVED Requirements\n\n### Requirement: Gone\n- **Reason**: obsolete\n`
  );
  const r = runSpec(root, ['archive', 'merge', '--force']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /removed requirement "Gone"/);
  assert.match(r.stdout, /merged delta into specs\/cap\/spec.md/);
  const merged = readText(join(root, 'specs', 'cap', 'spec.md'));
  assert.match(merged, /### Requirement: New/);
  assert.match(merged, /#### Scenario: Old-v2/);
  assert.doesNotMatch(merged, /#### Scenario: Old-basic/);
  assert.doesNotMatch(merged, /### Requirement: Gone/);
  assert.match(merged, /^## Purpose\nTest capability\./m, 'head of the main spec is preserved');
});

test('archive: leaves the state alone when another change is current', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'first']);
  runSpec(root, ['new', 'second']);
  const r = runSpec(root, ['archive', 'first', '--force']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([readState(root).change, readState(root).stage], ['second', 'new']);
});

// ---------------------------------------------------------------- stage
test('stage: sets the stage and refreshes updated', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  const before = readState(root).updated;
  const r = runSpec(root, ['stage', 'demo', 'execute']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^demo: stage execute \(updated \d{4}-/);
  const state = readState(root);
  assert.equal(state.stage, 'execute');
  assert.ok(Date.parse(state.updated) >= Date.parse(before));
  assert.ok(Date.now() - Date.parse(state.updated) < 60_000);

  const j = runSpecJson(root, ['stage', 'demo', 'done']).json;
  assert.equal(j.change, 'demo');
  assert.equal(j.stage, 'done');
  assert.ok(Number.isFinite(Date.parse(j.updated)));
});

test('stage: validates the stage name, the change, and the arguments', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  let r = runSpec(root, ['stage', 'demo', 'nope']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /unknown stage "nope"/);

  r = runSpec(root, ['stage', 'ghost', 'execute']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /changes\/ghost does not exist/);
  assert.equal(readState(root).change, 'demo', 'state untouched on failure');

  r = runSpec(root, ['stage', 'ghost', 'execute', '--force']);
  assert.equal(r.status, 0);
  assert.equal(readState(root).change, 'ghost');

  r = runSpec(root, ['stage', 'demo']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: spec.mjs stage/);
});

test('stage: accepts a simple-mode change (docs/changes/<name>.md)', (t) => {
  const root = fresh(t);
  write(root, 'docs/changes/simple.md', '# simple\n');
  const r = runSpec(root, ['stage', 'simple', 'interview']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([readState(root).change, readState(root).stage], ['simple', 'interview']);
});
