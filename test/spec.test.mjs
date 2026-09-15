import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, rmSync, statSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { TEMPLATES, cleanEnv, cleanup, makeTmp, readState, readText, runSpec, runSpecJson, write } from './helpers.mjs';

const NL = String.fromCharCode(10);
const NL2 = NL + NL;
const scenario = (name) => `#### Scenario: ${name}\n- **WHEN** something happens\n- **THEN** something follows\n`;
const requirement = (name, sc = `${name}-basic`) => `### Requirement: ${name}\nThe system SHALL ${name}.\n\n${scenario(sc)}\n`;
const mainSpec = (...names) => `# cap Specification\n\n## Purpose\nTest capability.\n\n## Requirements\n\n${names.map((n) => requirement(n)).join('')}`;

function fresh(t, prefix = 'spec') {
  const root = makeTmp(prefix);
  t.after(() => cleanup(root));
  return root;
}
/**
 * A legacy change: three documents, no stable identity and no linked contract. Archive keeps
 * serving these through its pre-v2 path, and they are how that path is tested.
 */
function newLegacy(root, name) {
  write(root, `changes/${name}/proposal.md`, '## Why' + NL2 + 'Fixture.' + NL2 + '## Non-Goals' + NL2 + 'None.' + NL2 + '## Decision Boundaries' + NL2 + 'None.' + NL);
  write(root, `changes/${name}/design.md`, '## Context' + NL2 + 'Fixture.' + NL2 + '## Do-Not-Touch' + NL2 + 'none' + NL2 + '## Rebuild / Re-run After Change' + NL2 + 'none' + NL);
  write(root, `changes/${name}/tasks.md`, '- [ ] 1.1 do the work and verify it' + NL + '- [ ] 1.2 do more and verify it' + NL);
  runSpec(root, ['stage', name, 'new']);
  return join(root, 'changes', name);
}
function tickAll(root, name) {
  const p = join(root, 'changes', name, 'tasks.md');
  write(root, `changes/${name}/tasks.md`, readText(p).replace(/- \[ \]/g, '- [x]'));
}
/** Sets the mtime of dir and of everything under it to `days` days ago. */
function backdate(dir, days) {
  const when = new Date(Date.now() - days * 86_400_000);
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    if (d.isDirectory()) backdate(p, days);
    else utimesSync(p, when, when);
  }
  utimesSync(dir, when, when);
  return when;
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

test('status: marks a change untouched for 30 days as stale, a fresh one not', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'quiet']);
  runSpec(root, ['new', 'active']);
  backdate(join(root, 'changes', 'quiet'), 30);
  const r = runSpec(root, ['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^quiet: .* \[stale 30d\]$/m);
  assert.match(r.stdout, /^active <- current \(new\): [^\n]*tasks=empty$/m, 'fresh row has no stale suffix');
  const j = runSpecJson(root, ['status']).json;
  const quiet = j.changes.find((c) => c.name === 'quiet');
  const active = j.changes.find((c) => c.name === 'active');
  assert.equal(quiet.stale, true);
  assert.match(quiet.lastModified, /^\d{4}-\d{2}-\d{2}T/);
  assert.ok(Date.now() - Date.parse(quiet.lastModified) > 29 * 86_400_000, 'lastModified reflects the back-dated files');
  assert.equal(active.stale, false);
  assert.ok(Date.now() - Date.parse(active.lastModified) < 60_000);
  assert.ok(statSync(join(root, 'changes', 'quiet', 'tasks.md')).mtimeMs < Date.now() - 29 * 86_400_000, 'fixture really is back-dated');
});

test('status: --stale-days, MY_FLOW_STALE_DAYS, and a fully ticked change all clear the stale mark', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'quiet']);
  backdate(join(root, 'changes', 'quiet'), 30);
  assert.match(runSpec(root, ['status']).stdout, /\[stale 30d\]/, 'precondition: stale at the default threshold');
  const flag = runSpec(root, ['status', '--stale-days', '60']);
  assert.equal(flag.status, 0, flag.stderr);
  assert.doesNotMatch(flag.stdout, /stale/);
  assert.doesNotMatch(flag.stdout, /60: \(missing\)/, 'the option value is consumed, not read as a change name');
  assert.equal(runSpecJson(root, ['status', '--stale-days', '60']).json.changes[0].stale, false);
  const env = runSpec(root, ['status'], cleanEnv({ MY_FLOW_STALE_DAYS: '60' }));
  assert.doesNotMatch(env.stdout, /stale/);
  assert.match(runSpec(root, ['status', '--stale-days', '7'], cleanEnv({ MY_FLOW_STALE_DAYS: '60' })).stdout, /\[stale 30d\]/, 'flag wins over env');
  assert.match(runSpec(root, ['status'], cleanEnv({ MY_FLOW_STALE_DAYS: 'soon' })).stdout, /\[stale 30d\]/, 'non-numeric env falls back to the default');
  tickAll(root, 'quiet');
  backdate(join(root, 'changes', 'quiet'), 30);
  const ticked = runSpec(root, ['status']);
  assert.match(ticked.stdout, /6\/6 tasks/);
  assert.doesNotMatch(ticked.stdout, /stale/, 'a finished change waiting for archive is never stale');
});

test('status: warns when the state file names a stale or missing change, not after archive', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'quiet']);
  backdate(join(root, 'changes', 'quiet'), 30);
  let r = runSpec(root, ['status']);
  assert.match(r.stdout, /^quiet <- current \(new\).*\[stale 30d\]\nstate: current change "quiet" is stale \[30d\]$/m, 'warning follows the rows');
  let j = runSpecJson(root, ['status']).json;
  assert.deepEqual(j.warnings, ['state: current change "quiet" is stale [30d]']);

  rmSync(join(root, 'changes', 'quiet'), { recursive: true, force: true });
  r = runSpec(root, ['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^no active changes.*\nstate: current change "quiet" no longer exists under changes\/$/m);
  assert.deepEqual(runSpecJson(root, ['status']).json.warnings, ['state: current change "quiet" no longer exists under changes/']);

  newLegacy(root, 'demo');
  tickAll(root, 'demo');
  write(root, '.my-flow/verify/demo-2026.md', '## Verification Report\n### Verdict: PASS\n');
  assert.equal(runSpec(root, ['archive', 'demo']).status, 0);
  assert.equal(readState(root).stage, 'archived');
  j = runSpecJson(root, ['status']).json;
  assert.deepEqual(j.warnings, [], 'a just-archived current change does not warn');
  assert.doesNotMatch(runSpec(root, ['status']).stdout, /state:/);
});

// ---------------------------------------------------------------- abandon
test('abandon: refuses without a recorded reason, refuses a fully ticked change unless forced', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'dropped']);
  let r = runSpec(root, ['abandon', 'dropped']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /no "## Abandoned" section with a "\*\*Reason\*\*:" line/);
  assert.ok(existsSync(join(root, 'changes', 'dropped')), 'change is left in place');

  runSpec(root, ['new', 'done-work']);
  tickAll(root, 'done-work');
  r = runSpec(root, ['abandon', 'done-work', '--reason', 'never mind']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /every task .* is ticked; this is an archive/);
  assert.ok(existsSync(join(root, 'changes', 'done-work')));
  r = runSpec(root, ['abandon', 'done-work', '--reason', 'never mind', '--force']);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(root, 'changes', 'done-work')));
});

test('abandon: records the reason, moves to -abandoned, never merges, and follows the state file', (t) => {
  const root = fresh(t);
  write(root, 'specs/cap/spec.md', mainSpec('Foo'));
  const before = readText(join(root, 'specs', 'cap', 'spec.md'));
  runSpec(root, ['new', 'dropped']);
  write(root, 'changes/dropped/specs/cap/spec.md', `## ADDED Requirements\n\n${requirement('Brand New')}`);
  assert.equal(readState(root).change, 'dropped');
  const r = runSpec(root, ['abandon', 'dropped', '--reason', 'superseded by rework']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /merged/, 'no delta was read or merged');
  assert.match(r.stdout, /abandoned changes\/dropped \(\*\*Reason\*\*: superseded by rework\)/);
  const archived = readdirSync(join(root, 'changes', 'archive')).filter((d) => /^\d{4}-\d{2}-\d{2}-dropped-abandoned$/.test(d));
  assert.equal(archived.length, 1, 'lands at changes/archive/<date>-dropped-abandoned/');
  const proposal = readText(join(root, 'changes', 'archive', archived[0], 'proposal.md'));
  assert.match(proposal, /\n## Abandoned\n\n\*\*Reason\*\*: superseded by rework\n$/);
  assert.equal(readText(join(root, 'specs', 'cap', 'spec.md')), before, 'specs/ is byte-identical');
  assert.equal(readState(root).stage, 'archived', 'the abandoned change was current');

  runSpec(root, ['new', 'victim']);
  runSpec(root, ['new', 'other']);
  const state = readState(root);
  assert.equal(state.change, 'other');
  assert.equal(runSpec(root, ['abandon', 'victim', '--reason', 'dup']).status, 0);
  assert.deepEqual(readState(root), state, 'state untouched when another change is current');
  const j = runSpecJson(root, ['abandon', 'other', '--reason', 'x']).json;
  assert.equal(j.abandoned, 'other');
  assert.match(j.dest.replace(/\\/g, '/'), /changes\/archive\/\d{4}-\d{2}-\d{2}-other-abandoned$/);
});

test('usage: an unknown subcommand prints the usage naming abandon and exits 1', (t) => {
  const root = fresh(t);
  const r = runSpec(root, ['bogus']);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /usage: spec\.mjs <.*abandon <name> \[--reason "\.\.\."\].*stage <name> <stage>.*>/);
  assert.match(r.stderr, /--stale-days n/);
  assert.match(r.stderr, /recover \[tx-id\]/);
});

// ---------------------------------------------------------------- audit nudge
/** Creates changes/archive/<name>/ carrying specs/<cap>/spec.md for each cap. */
function archivedDir(root, name, caps = ['cap']) {
  for (const cap of caps) write(root, `changes/archive/${name}/specs/${cap}/spec.md`, `## ADDED Requirements\n\n${requirement('X')}`);
  if (!caps.length) write(root, `changes/archive/${name}/proposal.md`, '## Why\nx\n');
}
const NUDGE = 'audit suggested: cap (5 merges since last audit)';

test('status: suggests an audit after five merges into a capability, not after four', (t) => {
  const root = fresh(t);
  write(root, 'specs/cap/spec.md', mainSpec('Foo'));
  for (let i = 1; i <= 4; i++) archivedDir(root, `2026-01-0${i}-chg${i}`);
  let r = runSpec(root, ['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.doesNotMatch(r.stdout, /audit suggested/);
  archivedDir(root, '2026-01-05-chg5');
  r = runSpec(root, ['status']);
  assert.match(r.stdout, new RegExp(`^${NUDGE.replace(/[()]/g, '\\$&')}$`, 'm'));
  assert.deepEqual(runSpecJson(root, ['status']).json.warnings, [NUDGE]);
  assert.doesNotMatch(runSpec(root, ['status'], cleanEnv({ MY_FLOW_AUDIT_EVERY: '6' })).stdout, /audit suggested/, 'threshold is configurable');
});

test('status: audit nudge edge cases (anchor resets, abandoned not counted, no archive dir, no specs)', (t) => {
  const root = fresh(t);
  write(root, 'specs/cap/spec.md', mainSpec('Foo'));
  assert.equal(runSpec(root, ['status']).status, 0, 'specs/ without changes/archive/ is fine');
  assert.doesNotMatch(runSpec(root, ['status']).stdout, /audit suggested/);
  assert.ok(!existsSync(join(root, 'changes', 'archive')));

  for (let i = 1; i <= 4; i++) archivedDir(root, `2026-01-0${i}-chg${i}`);
  archivedDir(root, '2026-01-05-something-audit-cap', []);
  archivedDir(root, '2026-01-06-chg6');
  assert.doesNotMatch(runSpec(root, ['status']).stdout, /audit suggested/, 'count restarts at the audit anchor');

  archivedDir(root, '2026-01-07-chg7-abandoned');
  archivedDir(root, '2026-01-08-chg8');
  archivedDir(root, '2026-01-09-chg9');
  archivedDir(root, '2026-01-10-chg10');
  assert.doesNotMatch(runSpec(root, ['status']).stdout, /audit suggested/, '4 merges + 1 abandoned: an abandoned delta is not a merge');
  archivedDir(root, '2026-01-11-chg11');
  assert.match(runSpec(root, ['status']).stdout, /audit suggested: cap \(5 merges since last audit\)/);

  rmSync(join(root, 'specs'), { recursive: true, force: true });
  const r = runSpec(root, ['status']);
  assert.equal(r.status, 0);
  assert.doesNotMatch(r.stdout, /audit suggested/, 'no specs/, no nudge');
});

test('status: the audit anchor is bound to the whole capability name', (t) => {
  const root = fresh(t);
  write(root, 'specs/spec/spec.md', mainSpec('Foo'));
  write(root, 'specs/spec-helper/spec.md', mainSpec('Bar'));
  for (let i = 1; i <= 5; i++) archivedDir(root, `2026-01-0${i}-chg${i}`, ['spec', 'spec-helper']);
  archivedDir(root, '2026-02-01-audit-spec-helper', []);
  const j = runSpecJson(root, ['status']).json;
  assert.deepEqual(j.warnings, ['audit suggested: spec (5 merges since last audit)'], 'spec-helper is reset, spec is not');
});

test('status: a clean audit recorded with new + abandon clears the nudge yet never counts as a merge', (t) => {
  const root = fresh(t);
  write(root, 'specs/cap/spec.md', mainSpec('Foo'));
  for (let i = 1; i <= 5; i++) archivedDir(root, `2026-01-0${i}-chg${i}`);
  assert.match(runSpec(root, ['status']).stdout, /audit suggested: cap/);
  assert.equal(runSpec(root, ['new', 'audit-cap']).status, 0);
  assert.equal(runSpec(root, ['abandon', 'audit-cap', '--reason', 'audit clean, no findings']).status, 0);
  const dirs = readdirSync(join(root, 'changes', 'archive'));
  const anchor = dirs.find((d) => /^\d{4}-\d{2}-\d{2}-audit-cap-abandoned$/.test(d));
  assert.ok(anchor, 'the abandoned audit is archived under <date>-audit-cap-abandoned');
  assert.doesNotMatch(runSpec(root, ['status']).stdout, /audit suggested/, 'the abandoned audit is an anchor');
  // even if the abandoned audit dir carried a delta, it is never a merge
  write(root, `changes/archive/${anchor}/specs/cap/spec.md`, `## ADDED Requirements\n\n${requirement('Y')}`);
  for (let i = 1; i <= 4; i++) archivedDir(root, `2999-01-0${i}-later${i}`);
  assert.doesNotMatch(runSpec(root, ['status']).stdout, /audit suggested/, '4 merges after the anchor, abandoned audit not counted');
  archivedDir(root, '2999-01-05-later5');
  assert.match(runSpec(root, ['status']).stdout, /audit suggested: cap \(5 merges since last audit\)/);
});

// ---------------------------------------------------------------- overlap
const removedDelta = (name) => `## REMOVED Requirements\n\n### Requirement: ${name}\n**Reason**: gone\n**Migration**: none\n`;
function overlapFixture(root) {
  write(root, 'specs/cap/spec.md', mainSpec('Foo', 'Bar'));
  runSpec(root, ['new', 'a']);
  runSpec(root, ['new', 'b']);
  write(root, 'changes/a/specs/cap/spec.md', `## MODIFIED Requirements\n\n${requirement('Foo')}${requirement('Bar')}`);
  write(root, 'changes/b/specs/cap/spec.md', removedDelta('Foo'));
}

test('status: reports a requirement claimed by two changes with each section kind', (t) => {
  const root = fresh(t);
  overlapFixture(root);
  const r = runSpec(root, ['status']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^overlap: cap "Foo" in changes a \(MODIFIED\) and b \(REMOVED\)$/m);
  assert.doesNotMatch(r.stdout, /"Bar"/, 'a single-claimant requirement is not an overlap');
  const j = runSpecJson(root, ['status']).json;
  assert.deepEqual(j.warnings, ['overlap: cap "Foo" in changes a (MODIFIED) and b (REMOVED)']);
});

test('validate: reports the overlap as a warning naming the other change, never as an error', (t) => {
  const root = fresh(t);
  overlapFixture(root);
  const r = runSpec(root, ['validate', 'a']);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^ok {3}a$/m);
  assert.match(r.stdout, /^ {2}warn: {2}overlap: cap "Foo" in changes a \(MODIFIED\) and b \(REMOVED\)$/m);
  assert.doesNotMatch(r.stdout, /error:.*overlap/);
  const json = runSpecJson(root, ['validate', 'a']).json;
  assert.equal(json.ok, true);
  assert.ok(json.results[0].warnings.some((w) => w.includes('b (REMOVED)')));
});

test('overlap: a RENAMED FROM line collides with a MODIFIED requirement', (t) => {
  const root = fresh(t);
  write(root, 'specs/cap/spec.md', mainSpec('Foo'));
  runSpec(root, ['new', 'r']);
  runSpec(root, ['new', 'm']);
  write(root, 'changes/r/specs/cap/spec.md', '## RENAMED Requirements\n\n- FROM: `### Requirement: Foo`\n- TO: `### Requirement: Baz`\n');
  write(root, 'changes/m/specs/cap/spec.md', `## MODIFIED Requirements\n\n${requirement('Foo')}`);
  const r = runSpec(root, ['status']);
  assert.match(r.stdout, /^overlap: cap "Foo" in changes m \(MODIFIED\) and r \(RENAMED\)$/m);
  assert.match(runSpec(root, ['validate', 'r']).stdout, /warn: {2}overlap: cap "Foo" in changes m \(MODIFIED\) and r \(RENAMED\)/);
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
  newLegacy(root, 'demo');
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
  newLegacy(root, 'merge');
  write(root, 'specs/cap/spec.md', mainSpec('Old', 'Gone'));
  write(
    root,
    'changes/merge/specs/cap/spec.md',
    `## ADDED Requirements\n\n${requirement('New')}## MODIFIED Requirements\n\n${requirement('Old', 'Old-v2')}## REMOVED Requirements\n\n### Requirement: Gone\n- **Reason**: obsolete\n`
  );
  assert.equal(runSpec(root, ['baseline', 'merge']).status, 0, 'a delta is publishable only against a captured base');
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

/** Lines of the `### Requirement: <name>` block in a merged main spec. */
function blockLines(spec, name) {
  const start = spec.indexOf(`### Requirement: ${name}\n`);
  assert.ok(start >= 0, `block "${name}" exists`);
  const rest = spec.slice(start + 1);
  const next = rest.search(/^### Requirement:/m);
  return spec.slice(start, next < 0 ? spec.length : start + 1 + next).trimEnd().split('\n');
}

test('archive: stamps exactly one via-marker directly after each merged requirement heading', (t) => {
  const root = fresh(t);
  newLegacy(root, 'merge');
  write(root, 'specs/cap/spec.md', mainSpec('Old', 'Keep'));
  write(root, 'changes/merge/specs/cap/spec.md', `## ADDED Requirements\n\n${requirement('New')}## MODIFIED Requirements\n\n${requirement('Old', 'Old-v2')}`);
  assert.equal(runSpec(root, ['baseline', 'merge']).status, 0);
  assert.equal(runSpec(root, ['archive', 'merge', '--force']).status, 0);
  const merged = readText(join(root, 'specs', 'cap', 'spec.md'));
  const date = new Date().toISOString().slice(0, 10);
  for (const name of ['New', 'Old']) {
    const lines = blockLines(merged, name);
    assert.equal(lines[1], `<!-- via: ${date}-merge -->`, `${name}: marker is the line after the heading`);
    assert.equal(lines.filter((l) => l.startsWith('<!-- via: ')).length, 1, `${name}: exactly one marker`);
  }
  assert.equal(blockLines(merged, 'Keep').filter((l) => l.startsWith('<!-- via: ')).length, 0, 'untouched requirements are not stamped');
  assert.equal(runSpec(root, ['validate']).status, 0, 'markers do not break validation');
});

test('archive: a stale via-marker inside a MODIFIED delta block is replaced, not stacked', (t) => {
  const root = fresh(t);
  newLegacy(root, 'first');
  write(root, 'changes/first/specs/cap/spec.md', `## ADDED Requirements\n\n${requirement('Foo')}`);
  assert.equal(runSpec(root, ['archive', 'first', '--force']).status, 0);
  newLegacy(root, 'second');
  // A hand-edited copy of the current block: old marker several lines below the heading, mid-text.
  const copied = `### Requirement: Foo\nThe system SHALL Foo, revised.\n\nMore normative text here.\n<!-- via: 2020-01-01-old -->\n\n${scenario('Foo-v2')}`;
  write(root, 'changes/second/specs/cap/spec.md', `## MODIFIED Requirements\n\n${copied}`);
  assert.equal(runSpec(root, ['baseline', 'second']).status, 0);
  const r = runSpec(root, ['archive', 'second', '--force']);
  assert.equal(r.status, 0, r.stderr);
  const merged = readText(join(root, 'specs', 'cap', 'spec.md'));
  const lines = blockLines(merged, 'Foo');
  const markers = lines.filter((l) => l.startsWith('<!-- via: '));
  assert.equal(markers.length, 1, 'exactly one marker');
  assert.equal(lines[1], `<!-- via: ${new Date().toISOString().slice(0, 10)}-second -->`);
  assert.doesNotMatch(merged, /2020-01-01-old/);
  assert.match(merged, /#### Scenario: Foo-v2/);
  const v = runSpec(root, ['validate']);
  assert.equal(v.status, 0, v.stdout + v.stderr);
});

test('archive: leaves the state alone when another change is current', (t) => {
  const root = fresh(t);
  newLegacy(root, 'first');
  newLegacy(root, 'second');
  const r = runSpec(root, ['archive', 'first', '--force']);
  assert.equal(r.status, 0, r.stderr);
  assert.deepEqual([readState(root).change, readState(root).stage], ['second', 'new']);
});

// ---------------------------------------------------------------- stage
test('stage: sets the stage and refreshes updated', (t) => {
  const root = fresh(t);
  runSpec(root, ['new', 'demo']);
  // an untouched template is not an executable contract, and `stage execute` says so; this test
  // is about the timestamp, so give it the finished plan a real run would have by then
  write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do the thing and verify the suite passes\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n');
  write(root, 'changes/demo/acceptance.md', '### AC-01 — The thing works\n\n- evidence-mode: automated\n- checks: test/demo.test.mjs\n');
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

// ---------------------------------------------------------------- v2 templates and explicit upgrade (T-05)
const LEGACY_TASKS = `## 1. Group

- [x] 1.1 Do the first thing and verify the suite passes
  - a historical note that must survive untouched
- [ ] 1.2 Do the second thing and verify it by hand

## 2. Later

- [ ] 2.1 Do the third thing and verify the build succeeds
`;

function legacyChange(root, name = 'legacy') {
  write(root, `changes/${name}/proposal.md`, '## Why\n\nBecause.\n\n## Non-Goals\n\nNone.\n\n## Decision Boundaries\n\nNone.\n');
  write(root, `changes/${name}/design.md`, '## Context\n\nFixture.\n\n## Do-Not-Touch\n\nnone\n\n## Rebuild / Re-run After Change\n\nnone\n');
  write(root, `changes/${name}/tasks.md`, LEGACY_TASKS);
  return join(root, 'changes', name);
}

test('new: a project with no customized templates gets the linked-intent set and a stable identity', (t) => {
  const root = fresh(t, 'tpl-v2');
  const r = runSpecJson(root, ['new', 'demo']);
  assert.equal(r.status, 0);
  assert.equal(r.json.schemaVersion, 2);
  for (const f of ['proposal.md', 'design.md', 'tasks.md', 'acceptance.md', 'change.json']) {
    assert.ok(existsSync(join(root, 'changes', 'demo', f)), `${f} was created`);
  }
  const manifest = JSON.parse(readText(join(root, 'changes', 'demo', 'change.json')));
  assert.match(manifest.id, /^[0-9a-f-]{36}$/);
  assert.equal(manifest.slug, 'demo');
  assert.equal(manifest.stage, 'new');
  const inspect = runSpecJson(root, ['inspect', 'demo']);
  assert.equal(inspect.json.schemaVersion, 2);
  assert.equal(inspect.json.identity.id, manifest.id);
});

test('new: a customized pre-v2 template set keeps making legacy changes and says how to move on', (t) => {
  const root = fresh(t, 'tpl-legacy');
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) write(root, `changes/.templates/${f}`, `# our own ${f}\n`);
  const r = runSpec(root, ['new', 'demo']);
  assert.equal(r.status, 0);
  assert.match(r.stdout, /customized template set/);
  assert.match(r.stdout, /\.template-version/);
  assert.equal(existsSync(join(root, 'changes', 'demo', 'acceptance.md')), false);
  assert.equal(existsSync(join(root, 'changes', 'demo', 'change.json')), false);
  assert.equal(readText(join(root, 'changes', 'demo', 'tasks.md')), '# our own tasks.md\n');

  // and once the project opts in by adding the marker, new changes are v2 again
  write(root, 'changes/.templates/.template-version', '2\n');
  write(root, 'changes/.templates/acceptance.md', '# our acceptance\n');
  const second = runSpecJson(root, ['new', 'later']);
  assert.equal(second.json.schemaVersion, 2);
  assert.equal(readText(join(root, 'changes', 'later', 'acceptance.md')), '# our acceptance\n');
});

test('upgrade: a dry run writes nothing and lists the decisions that remain', (t) => {
  const root = fresh(t, 'upgrade-dry');
  const dir = legacyChange(root);
  const before = readText(join(dir, 'tasks.md'));
  const r = runSpecJson(root, ['upgrade', 'legacy']);
  assert.equal(r.status, 0);
  assert.equal(r.json.applied, false);
  assert.equal(r.json.counts.tasks, 3);
  assert.equal(r.json.counts.idsAdded, 3);
  assert.match(r.json.decisions.join('\n'), /no dependency was inferred/);
  assert.match(r.json.decisions.join('\n'), /no ticked box was treated as newly verified/);
  assert.equal(readText(join(dir, 'tasks.md')), before, 'the dry run changed nothing');
  assert.equal(existsSync(join(dir, 'change.json')), false);
  assert.equal(existsSync(join(dir, 'migration')), false);
});

test('upgrade --apply: ids are added, every other byte and checkbox is preserved, originals are kept', (t) => {
  const root = fresh(t, 'upgrade-apply');
  const dir = legacyChange(root);
  const before = readText(join(dir, 'tasks.md'));
  const r = runSpecJson(root, ['upgrade', 'legacy', '--apply']);
  assert.equal(r.status, 0);
  assert.equal(r.json.applied, true);

  const after = readText(join(dir, 'tasks.md'));
  assert.deepEqual(
    after.split('\n').filter((l) => !/^\s+- id: T-\d+$/.test(l)),
    before.split('\n'),
    'the only new lines are the id lines'
  );
  assert.match(after, /- \[x\] 1\.1 Do the first thing/);
  assert.match(after, /  - a historical note that must survive untouched/);
  assert.equal(/- depends-on:/.test(after), false, 'no dependency is invented');
  assert.equal(/- accepts:/.test(after), false, 'no acceptance reference is invented');

  assert.equal(readText(join(dir, 'migration', 'original', 'tasks.md')), before);
  assert.ok(existsSync(join(dir, 'migration', 'original', 'proposal.md')));
  assert.ok(existsSync(join(dir, 'migration', 'original', 'design.md')));

  const inspect = runSpecJson(root, ['inspect', 'legacy']);
  assert.equal(inspect.json.schemaVersion, 2);
  assert.deepEqual(inspect.json.tasks.map((x) => x.id), ['T-01', 'T-02', 'T-03']);
  assert.deepEqual(inspect.json.tasks.map((x) => x.checked), [true, false, false]);
  assert.deepEqual(inspect.json.tasks.map((x) => x.readiness), ['complete', 'unknown', 'unknown'], 'prerequisites stay unknown, not none');
  assert.deepEqual(inspect.json.acceptance, [], 'the draft inventory is commented out, so nothing is in force');
  assert.match(readText(join(dir, 'acceptance.md')), /Draft, unapproved/);
  assert.match(readText(join(dir, 'acceptance.md')), /<!--\n### AC-01/);
});

test('upgrade: refuses an archived change, a simple-mode change and a change already upgraded', (t) => {
  const root = fresh(t, 'upgrade-refuse');
  legacyChange(root, 'active-one');
  write(root, 'changes/archive/2026-01-01-old/tasks.md', LEGACY_TASKS);
  write(root, 'docs/changes/simple.md', '# simple\n\n- [ ] 1.1 do it and verify it\n');
  write(root, 'changes/simple/tasks.md', LEGACY_TASKS);

  const archived = runSpec(root, ['upgrade', '2026-01-01-old']);
  assert.equal(archived.status, 1);
  assert.match(archived.stderr, /not-active: .*archived; historical changes are preserved/);

  const simple = runSpec(root, ['upgrade', 'simple']);
  assert.equal(simple.status, 1);
  assert.match(simple.stderr, /simple-mode/);

  assert.equal(runSpec(root, ['upgrade', 'active-one', '--apply']).status, 0);
  const again = runSpec(root, ['upgrade', 'active-one']);
  assert.equal(again.status, 1);
  assert.match(again.stderr, /already-v2/);
});

test('upgrade: an interrupted migration is recoverable and rolls forward exactly once', (t) => {
  const root = fresh(t, 'upgrade-recover');
  const dir = legacyChange(root);
  const before = readText(join(dir, 'tasks.md'));

  const crashed = runSpec(root, ['upgrade', 'legacy', '--apply'], cleanEnv({ MY_FLOW_IO_FAILPOINT: 'before-file' }));
  assert.equal(crashed.status, 1);
  assert.match(crashed.stderr, /failpoint/);
  assert.equal(readText(join(dir, 'tasks.md')), before, 'nothing was published before the failure');

  // the unfinished journal blocks ordinary reads and writes until it is resolved
  const blocked = runSpecJson(root, ['status']);
  assert.equal(blocked.status, 1);
  assert.equal(blocked.json.error, 'recovery-pending');

  const list = runSpecJson(root, ['recover']);
  assert.equal(list.json.pending.length, 1);
  const id = list.json.pending[0].id;

  const recovered = runSpecJson(root, ['recover', id]);
  assert.equal(recovered.status, 0);
  assert.equal(recovered.json.phase, 'committed');
  assert.match(readText(join(dir, 'tasks.md')), /- id: T-01/);
  assert.equal(readText(join(dir, 'migration', 'original', 'tasks.md')), before);
  assert.ok(existsSync(join(dir, 'change.json')));

  const again = runSpecJson(root, ['recover', id]);
  assert.equal(again.json.applied, 0, 're-entry is idempotent');
  assert.equal(runSpecJson(root, ['status']).status, 0);
});

test('upgrade: historical archives and their bytes are never touched', (t) => {
  const root = fresh(t, 'upgrade-archives');
  legacyChange(root, 'active-one');
  write(root, 'changes/archive/2026-01-01-old/tasks.md', LEGACY_TASKS);
  write(root, 'changes/archive/2026-01-01-old/proposal.md', '# old\n');
  const hashOf = (p) => createHash('sha256').update(readText(p)).digest('hex');
  const archiveBefore = ['tasks.md', 'proposal.md'].map((f) => hashOf(join(root, 'changes', 'archive', '2026-01-01-old', f)));

  assert.equal(runSpec(root, ['upgrade', 'active-one', '--apply']).status, 0);

  const archiveAfter = ['tasks.md', 'proposal.md'].map((f) => hashOf(join(root, 'changes', 'archive', '2026-01-01-old', f)));
  assert.deepEqual(archiveAfter, archiveBefore);
  assert.equal(existsSync(join(root, 'changes', 'archive', '2026-01-01-old', 'change.json')), false);
});
