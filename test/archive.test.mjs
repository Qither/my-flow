/**
 * Spec bases and conflict diagnosis (contract C-05). Covers AC-07 (archive cannot silently
 * overwrite intent: a stale base blocks, mere overlap does not) and AC-12 (historical files are
 * never touched, and the existing result keys survive).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { archivePreflight, captureBaseline, compareBases, deltaClaims, mainRequirements, normalizeRequirement, readBaseline, requirementHash } from '../scripts/lib/archive.mjs';
import { withIntentLock } from '../scripts/lib/intent-io.mjs';
import { createManifest } from '../scripts/lib/intent-state.mjs';
import { beginAttempt, recordAttempt } from '../scripts/lib/evidence.mjs';
import { cleanEnv, cleanup, gitInit, makeTmp, readText, runSpec, runSpecJson, write } from './helpers.mjs';

const scenario = '#### Scenario: It works\n- **WHEN** something happens\n- **THEN** something follows\n';
const req = (name, body = `The system SHALL ${name}.`) => `### Requirement: ${name}\n${body}\n\n${scenario}\n`;
const mainSpec = (...blocks) => `# cap Specification\n\n## Purpose\nFixture.\n\n## Requirements\n\n${blocks.join('')}`;

function project(prefix, { main = mainSpec(req('Keep records'), req('Retire nothing')), delta = null } = {}) {
  const root = makeTmp(prefix);
  write(root, 'specs/cap/spec.md', main);
  write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n  - id: T-01\n');
  if (delta) write(root, 'changes/demo/specs/cap/spec.md', delta);
  withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', {}, token));
  return root;
}
const where = (root) => ({ dir: join(root, 'changes', 'demo'), rel: 'changes/demo' });
const baseline = (root, opts) => withIntentLock(root, (token) => captureBaseline(root, where(root), opts ?? {}, token));
const conflicts = (root) => compareBases(root, where(root));

describe('reading delta claims', () => {
  it('reads ADDED, MODIFIED and REMOVED from their headings', () => {
    const { claims, diagnostics } = deltaClaims(
      `## ADDED Requirements\n\n${req('Brand new')}## MODIFIED Requirements\n\n${req('Keep records', 'The system SHALL keep better records.')}## REMOVED Requirements\n\n### Requirement: Retire nothing\n**Reason**: obsolete\n`
    );
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(
      claims.map((c) => [c.operation, c.requirement]),
      [
        ['ADDED', 'Brand new'],
        ['MODIFIED', 'Keep records'],
        ['REMOVED', 'Retire nothing'],
      ]
    );
    assert.equal(claims[2].proposedText, null, 'a removal proposes no text');
    assert.match(claims[1].proposedText, /keep better records/);
  });

  it('reads a RENAMED pair from its FROM and TO lines', () => {
    const { claims, diagnostics } = deltaClaims('## RENAMED Requirements\n\n- FROM: `### Requirement: Keep records`\n- TO: `### Requirement: Keep audited records`\n');
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(claims, [{ operation: 'RENAMED', requirement: 'Keep records', destination: 'Keep audited records', proposedText: null }]);
  });

  it('reports a half-written rename instead of guessing the other side', () => {
    assert.match(deltaClaims('## RENAMED Requirements\n\n- FROM: `### Requirement: A`\n').diagnostics[0].message, /has no "- TO:" line/);
    assert.match(deltaClaims('## RENAMED Requirements\n\n- TO: `### Requirement: B`\n').diagnostics[0].message, /has no "- FROM:" line/);
  });

  it('reports a requirement claimed twice under one operation', () => {
    const { diagnostics } = deltaClaims(`## ADDED Requirements\n\n${req('Twice')}${req('Twice')}`);
    assert.equal(diagnostics.length, 1);
    assert.match(diagnostics[0].message, /names "Twice" twice/);
  });

  it('ignores the generated via marker but not an ordinary comment', () => {
    assert.equal(normalizeRequirement('### Requirement: X\n<!-- via: 2026-01-01-old -->\n\nBody.'), '### Requirement: X\n\nBody.');
    assert.notEqual(requirementHash('### Requirement: X\n<!-- mine -->\nBody.'), requirementHash('### Requirement: X\nBody.'));
  });
});

describe('capturing the base', () => {
  let root;
  after(() => cleanup(root));

  it('records the base text and hash of every claim, and the absence of an ADDED one', () => {
    root = project('arc-capture', {
      delta: `## ADDED Requirements\n\n${req('Brand new')}## MODIFIED Requirements\n\n${req('Keep records', 'The system SHALL keep better records.')}`,
    });
    const b = baseline(root);
    assert.equal(b.schemaVersion, 2);
    const added = b.entries.find((e) => e.operation === 'ADDED');
    const modified = b.entries.find((e) => e.operation === 'MODIFIED');
    assert.equal(added.baseText, null, 'an ADDED requirement has no base');
    assert.equal(added.baseHash, null);
    assert.match(modified.baseText, /SHALL Keep records/);
    assert.equal(modified.baseHash, requirementHash(modified.baseText));
    assert.ok(existsSync(join(root, 'changes', 'demo', 'spec-base.json')));
    assert.deepEqual(readBaseline(join(root, 'changes', 'demo')).entries, b.entries);
  });

  it('refuses to capture over an existing base without a reviewed amendment', () => {
    root = project('arc-recapture', { delta: `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}` });
    baseline(root);
    assert.throws(() => baseline(root), (e) => e.code === 'baseline-exists' && /reviewed amendment/.test(e.message));
    const rebased = baseline(root, { amendment: 'A-1' });
    assert.equal(rebased.rebasedBy, 'A-1');
  });

  it('refuses an ADDED collision, a missing base and a rename onto an existing name', () => {
    root = project('arc-refuse', { delta: `## ADDED Requirements\n\n${req('Keep records')}` });
    assert.throws(() => baseline(root), (e) => e.code === 'baseline-refused' && /already exists/.test(e.message));

    write(root, 'changes/demo/specs/cap/spec.md', `## MODIFIED Requirements\n\n${req('Never existed')}`);
    assert.throws(() => baseline(root), (e) => /is not in specs\/cap\/spec\.md/.test(e.message));

    write(root, 'changes/demo/specs/cap/spec.md', '## RENAMED Requirements\n\n- FROM: `### Requirement: Keep records`\n- TO: `### Requirement: Retire nothing`\n');
    assert.throws(() => baseline(root), (e) => /destination "Retire nothing" already exists/.test(e.message));
    assert.equal(existsSync(join(root, 'changes', 'demo', 'spec-base.json')), false, 'a refused capture writes nothing');
  });

  it('refuses a main spec with two requirements of the same name', () => {
    root = project('arc-dup-main', { main: mainSpec(req('Keep records'), req('Keep records')), delta: `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}` });
    assert.equal(mainRequirements(root, 'cap').diagnostics.length, 1);
    assert.throws(() => baseline(root), (e) => /appears twice/.test(e.message));
  });

  it('requires the coordinated lock', () => {
    root = project('arc-nolock', { delta: `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}` });
    assert.throws(() => captureBaseline(root, where(root), {}, null), (e) => e.code === 'lock-lost');
  });
});

describe('comparing the base against the spec as it is now', () => {
  let root;
  after(() => cleanup(root));

  const setup = (prefix, delta) => {
    root = project(prefix, { delta });
    baseline(root);
    assert.deepEqual(conflicts(root).conflicts, [], 'the fixture starts clean');
  };

  it('reports no conflict while nothing moved', () => {
    setup('arc-clean', `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}`);
    const r = conflicts(root);
    assert.deepEqual(r.conflicts, []);
    assert.deepEqual(r.diagnostics, []);
  });

  it('MODIFIED: a main spec edited after the base was captured is a stale base, with all three texts', () => {
    setup('arc-stale-mod', `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}`);
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records', 'Somebody else changed this.'), req('Retire nothing')));
    const [c] = conflicts(root).conflicts;
    assert.equal(c.operation, 'MODIFIED');
    assert.equal(c.requirement, 'Keep records');
    assert.match(c.reason, /the main spec changed after the base was captured/);
    assert.match(c.base, /SHALL Keep records/);
    assert.match(c.current, /Somebody else changed this/);
    assert.match(c.proposed, /Reworded/);
  });

  it('MODIFIED: a requirement removed from the main spec is a conflict, not an append', () => {
    setup('arc-gone-mod', `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}`);
    write(root, 'specs/cap/spec.md', mainSpec(req('Retire nothing')));
    const [c] = conflicts(root).conflicts;
    assert.match(c.reason, /no longer in the main spec/);
    assert.equal(c.current, null);
  });

  it('ADDED: a requirement that appeared in the meantime is a collision', () => {
    setup('arc-added', `## ADDED Requirements\n\n${req('Brand new')}`);
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records'), req('Retire nothing'), req('Brand new', 'Someone else added this first.')));
    const [c] = conflicts(root).conflicts;
    assert.equal(c.operation, 'ADDED');
    assert.match(c.reason, /requires the requirement to be absent/);
    assert.equal(c.base, null);
    assert.match(c.current, /Someone else added this first/);
  });

  it('REMOVED: a stale base blocks the removal', () => {
    setup('arc-removed', '## REMOVED Requirements\n\n### Requirement: Retire nothing\n**Reason**: obsolete\n');
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records'), req('Retire nothing', 'Now it does something important.')));
    const [c] = conflicts(root).conflicts;
    assert.equal(c.operation, 'REMOVED');
    assert.match(c.reason, /written against a different text/);
    assert.equal(c.proposed, null);
  });

  it('RENAMED: a destination that appeared in the meantime is a conflict', () => {
    setup('arc-renamed', '## RENAMED Requirements\n\n- FROM: `### Requirement: Keep records`\n- TO: `### Requirement: Keep audited records`\n');
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records'), req('Retire nothing'), req('Keep audited records', 'Someone else took the name.')));
    const [c] = conflicts(root).conflicts;
    assert.equal(c.operation, 'RENAMED');
    assert.equal(c.destination, 'Keep audited records');
    assert.match(c.reason, /destination "Keep audited records" now exists/);
  });

  it('reports a claim added after the base was captured, rather than publishing it unchecked', () => {
    setup('arc-new-claim', `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}`);
    write(root, 'changes/demo/specs/cap/spec.md', `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}${req('Retire nothing', 'And this one too, without a base.')}`);
    const c = conflicts(root).conflicts.find((x) => x.requirement === 'Retire nothing');
    assert.ok(c, 'the new claim is a conflict');
    assert.match(c.reason, /added after the base was captured/);
  });

  it('reports a claim dropped from the delta after the base was captured', () => {
    setup('arc-dropped-claim', `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}`);
    write(root, 'changes/demo/specs/cap/spec.md', '## ADDED Requirements\n\n### Requirement: Something else\nBody.\n\n#### Scenario: S\n- **WHEN** a\n- **THEN** b\n');
    const c = conflicts(root).conflicts.find((x) => x.requirement === 'Keep records');
    assert.match(c.reason, /no longer claims this requirement/);
  });

  it('asks for a base rather than inventing one', () => {
    root = project('arc-nobase', { delta: `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}` });
    const r = conflicts(root);
    assert.equal(r.baseline, null);
    assert.equal(r.diagnostics[0].code, 'no-baseline');
    assert.match(r.diagnostics[0].message, /capture the base with "spec baseline demo"/);
  });

  it('is unmoved by a via marker added to the main spec by an unrelated archive', () => {
    setup('arc-via', `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}`);
    const current = readText(join(root, 'specs', 'cap', 'spec.md'));
    write(root, 'specs/cap/spec.md', current.replace('### Requirement: Keep records\n', '### Requirement: Keep records\n<!-- via: 2026-02-02-other -->\n'));
    assert.deepEqual(conflicts(root).conflicts, [], 'a generated provenance marker is not a content change');
  });
});

// ---------------------------------------------------------------- archive preflight (T-12, AC-05/06/07/12)
describe('archive preflight', () => {
  let root;
  after(() => cleanup(root));

  /** A finished, verified v2 change, ready to publish. */
  const verified = (prefix, { delta = null } = {}) => {
    root = makeTmp(prefix);
    gitInit(root);
    write(root, 'src/app.mjs', 'export const answer = 42;\n');
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records')));
    write(root, 'changes/demo/proposal.md', '## Why\n\nBecause.\n');
    write(root, 'changes/demo/design.md', '### D-01 — A decision\n\nBody.\n');
    write(root, 'changes/demo/acceptance.md', '### AC-01 — One\n\n- evidence-mode: automated\n- required: true\n- checks: test/x.test.mjs\n');
    write(root, 'changes/demo/tasks.md', '- [x] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n');
    if (delta) write(root, 'changes/demo/specs/cap/spec.md', delta);
    withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', { stage: 'execute' }, token));
    if (delta) baseline(root);
    const required = [{ id: 'AC-01', modes: ['automated'] }];
    const started = withIntentLock(root, (token) => beginAttempt(root, { ...where(root), inputs: {}, requiredCriteria: required }, token));
    withIntentLock(root, (token) =>
      recordAttempt(
        root,
        {
          ...where(root),
          sequence: started.sequence,
          result: {
            verdict: 'PASS',
            criteria: [{ id: 'AC-01', status: 'VERIFIED', modes: ['automated'], evidenceRefs: ['commands[0]'] }],
            commands: [{ command: 'node --test', exitCode: 0, summary: 'ok', logHash: null }],
            origin: { kind: 'native-agent', actorId: 'verifier-1', writerActorId: 'writer-1', sourceRef: 'agent:verifier#1' },
          },
          reportText: '# report\n\n### Verdict: PASS\n',
          requiredCriteria: required,
        },
        token
      )
    );
    return root;
  };
  const preflight = (opts = {}) => archivePreflight(root, { ...where(root), slug: 'demo', schemaVersion: 2 }, opts);
  const codes = (r) => r.blockers.map((b) => b.code).sort();

  it('passes for a finished, verified change and computes its output in memory', () => {
    verified('pre-ok', { delta: `## MODIFIED Requirements\n\n${req('Keep records', 'The system SHALL keep better records.')}` });
    const r = preflight();
    assert.deepEqual(r.blockers, []);
    assert.equal(r.ok, true);
    assert.equal(r.classification, 'verified-v2');
    assert.deepEqual(r.outputs.map((o) => o.path), ['specs/cap/spec.md']);
    assert.match(r.outputs[0].content, /keep better records/);
    assert.match(r.outputs[0].content, /<!-- via: \d{4}-\d{2}-\d{2}-demo -->/);
    assert.equal(readText(join(root, 'specs', 'cap', 'spec.md')).includes('keep better records'), false, 'preflight writes nothing');
    assert.equal(r.receipt.verification, 'verified-v2');
    assert.equal(r.receipt.attempt, 'V-1');
  });

  it('refuses stale evidence after a source edit or a contract edit', () => {
    verified('pre-drift');
    write(root, 'src/app.mjs', 'export const answer = 43;\n');
    assert.deepEqual(codes(preflight()), ['source-drift']);

    verified('pre-drift-contract');
    write(root, 'changes/demo/design.md', '### D-01 — A decision\n\nReworded.\n');
    assert.deepEqual(codes(preflight()), ['contract-drift']);
  });

  it('is unmoved by bookkeeping written after the verified attempt', () => {
    verified('pre-bookkeeping');
    write(root, 'changes/demo/tasks.md', '- [x] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n  - evidence: V-1\n');
    assert.deepEqual(preflight().blockers, [], 'an evidence link is bookkeeping, not a changed promise');
  });

  it('refuses an unfinished ledger and an unlinked task, and --force changes nothing', () => {
    verified('pre-ledger');
    write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n- [ ] 1.2 later and verify it\n  - id: T-02\n');
    const r = preflight();
    assert.ok(r.blockers.some((b) => b.code === 'unfinished-tasks'));
    assert.ok(r.blockers.some((b) => b.code === 'undeclared-dependency' && /T-02/.test(b.message)));
    assert.ok(r.blockers.some((b) => b.code === 'unlinked-task' && /T-02/.test(b.message)));
    assert.deepEqual(codes(preflight({ force: true })), codes(r), 'force removes no check from a linked change');
  });

  it('refuses a required criterion with no declared evidence mode or checks', () => {
    verified('pre-incomplete-ac');
    write(root, 'changes/demo/acceptance.md', '### AC-01 — One\n\n- required: true\n');
    assert.ok(preflight().blockers.some((b) => b.code === 'incomplete-acceptance'));
  });

  it('refuses a stale spec base, and reports the conflict rather than overwriting', () => {
    verified('pre-stale-base', { delta: `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}` });
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records', 'Somebody else changed this.')));
    const r = preflight();
    const conflict = r.blockers.find((b) => b.code === 'base-conflict');
    assert.ok(conflict, 'the stale base blocks');
    assert.match(conflict.conflict.current, /Somebody else changed this/);
    assert.match(conflict.conflict.base, /SHALL Keep records/);
    assert.equal(readText(join(root, 'specs', 'cap', 'spec.md')).includes('Reworded'), false);
  });

  it('treats an overlapping active proposal as a warning, never a deadlock', () => {
    verified('pre-overlap', { delta: `## MODIFIED Requirements\n\n${req('Keep records', 'Reworded.')}` });
    write(root, 'changes/rival/tasks.md', '- [ ] 1.1 rival work and verify it\n');
    write(root, 'changes/rival/specs/cap/spec.md', `## MODIFIED Requirements\n\n${req('Keep records', 'A rival wording.')}`);
    const r = preflight();
    assert.deepEqual(r.blockers, [], 'a competing proposal does not block a finished, verified change');
    assert.ok(r.warnings.some((w) => /overlap: cap "Keep records"/.test(w)));
  });

  it('refuses an occupied destination', () => {
    verified('pre-dest');
    const date = new Date().toISOString().slice(0, 10);
    write(root, `changes/archive/${date}-demo/proposal.md`, '# already there\n');
    assert.ok(preflight().blockers.some((b) => b.code === 'destination-exists'));
  });

  it('refuses a pending amendment', () => {
    verified('pre-amend');
    write(root, 'changes/demo/amendments/A-1/state.json', JSON.stringify({ state: 'pending' }, null, 2) + '\n');
    assert.ok(preflight().blockers.some((b) => b.code === 'amendment-pending'));
  });

  it('refuses a merge that would produce an invalid main spec', () => {
    verified('pre-bad-output', { delta: '## ADDED Requirements\n\n### Requirement: No scenarios here\nThe system SHALL do something.\n' });
    assert.ok(preflight().blockers.some((b) => b.code === 'invalid-output' && /no "#### Scenario:"/.test(b.message)));
  });

  it('refuses an attempt that is no longer eligible, without falling back to an older one', () => {
    verified('pre-superseded');
    withIntentLock(root, (token) => beginAttempt(root, { ...where(root), inputs: {}, requiredCriteria: [{ id: 'AC-01', modes: ['automated'] }] }, token));
    const r = preflight();
    assert.ok(r.blockers.some((b) => b.code === 'no-eligible-evidence' && /V-2 is open/.test(b.message)));
  });
});

// ---------------------------------------------------------------- recoverable publication (T-13, AC-07/08/12)
describe('archive publishes through a recoverable journal', () => {
  let root;
  after(() => cleanup(root));

  /** A legacy change with one MODIFIED delta and a captured base, ready for a forced archive. */
  const ready = (prefix) => {
    root = makeTmp(prefix);
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records')));
    write(root, 'changes/demo/proposal.md', '## Why\n\nBecause.\n');
    write(root, 'changes/demo/design.md', '## Do-Not-Touch\n\nnone\n\n## Rebuild / Re-run After Change\n\nnone\n');
    write(root, 'changes/demo/tasks.md', '- [x] 1.1 do it and verify it\n');
    write(root, 'changes/demo/specs/cap/spec.md', `## MODIFIED Requirements\n\n${req('Keep records', 'The system SHALL keep better records.')}`);
    write(root, '.my-flow/verify/demo-2026.md', '## Verification Report\n### Verdict: PASS\n');
    baseline(root);
    return root;
  };
  const date = () => new Date().toISOString().slice(0, 10);
  const archivedDir = () => join(root, 'changes', 'archive', `${date()}-demo`);

  it('publishes the spec, the relocation and the receipt, and leaves the journal for inspection', () => {
    ready('pub-ok');
    const r = runSpecJson(root, ['archive', 'demo', '--force']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.json.archived, 'demo', 'the existing result keys are unchanged');
    assert.equal(r.json.verification, 'unverified-legacy');
    assert.match(readText(join(root, 'specs', 'cap', 'spec.md')), /keep better records/);
    assert.equal(existsSync(join(root, 'changes', 'demo')), false);
    const receipt = JSON.parse(readText(join(archivedDir(), 'archive-receipt.json')));
    assert.equal(receipt.verification, 'unverified-legacy');
    assert.equal(receipt.archivedAs, `changes/archive/${date()}-demo`);
    assert.equal(receipt.outputs[0].path, 'specs/cap/spec.md');
    const journals = readdirSync(join(root, 'changes', '.transactions')).filter((d) => d.startsWith('tx-'));
    assert.equal(journals.length, 1, 'the journal survives a successful publication');
    assert.equal(JSON.parse(readText(join(root, 'changes', '.transactions', journals[0], 'journal.json'))).phase, 'committed');
  });

  for (const failpoint of ['before-file', 'after-file', 'before-move', 'after-move', 'before-commit']) {
    it(`recovers a publication interrupted at ${failpoint}`, () => {
      ready(`pub-${failpoint.replace(/[^a-z]/g, '')}`);
      const crashed = runSpec(root, ['archive', 'demo', '--force'], cleanEnv({ MY_FLOW_IO_FAILPOINT: failpoint }));
      assert.equal(crashed.status, 1);
      assert.match(crashed.stderr, /failpoint/);

      // whatever half-state exists, a reader refuses rather than serving it
      const blocked = runSpecJson(root, ['status']);
      assert.equal(blocked.status, 1);
      assert.equal(blocked.json.error, 'recovery-pending');
      assert.equal(runSpec(root, ['archive', 'demo', '--force']).status, 1, 'a second publication never starts on top of the first');

      const id = runSpecJson(root, ['recover']).json.pending[0].id;
      const recovered = runSpecJson(root, ['recover', id]);
      assert.equal(recovered.status, 0, recovered.stderr);
      assert.equal(recovered.json.phase, 'committed');

      assert.match(readText(join(root, 'specs', 'cap', 'spec.md')), /keep better records/);
      assert.equal(existsSync(join(root, 'changes', 'demo')), false, 'the change is relocated exactly once');
      assert.ok(existsSync(join(archivedDir(), 'archive-receipt.json')));
      assert.equal(runSpecJson(root, ['status']).status, 0, 'reads work again');
      assert.equal(runSpecJson(root, ['recover', id]).json.applied, 0, 're-entry is idempotent');
    });
  }

  it('refuses to recover over an external edit, and preserves it', () => {
    ready('pub-external');
    assert.equal(runSpec(root, ['archive', 'demo', '--force'], cleanEnv({ MY_FLOW_IO_FAILPOINT: 'before-file' })).status, 1);
    write(root, 'specs/cap/spec.md', mainSpec(req('Keep records', 'A human typed this while the publication was down.')));
    const id = runSpecJson(root, ['recover']).json.pending[0].id;
    const r = runSpec(root, ['recover', id]);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /recovery-conflict/);
    assert.match(r.stderr, /edited outside my-flow/);
    assert.match(readText(join(root, 'specs', 'cap', 'spec.md')), /A human typed this/);
    assert.equal(runSpecJson(root, ['recover']).json.pending.length, 1, 'the journal stays pending until a human resolves it');
  });

  it('abandon relocates through the same journal and says it merged nothing', () => {
    ready('pub-abandon');
    write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n');
    const r = runSpecJson(root, ['abandon', 'demo', '--reason', 'superseded']);
    assert.equal(r.status, 0, r.stderr);
    const dir = join(root, 'changes', 'archive', `${date()}-demo-abandoned`);
    const receipt = JSON.parse(readText(join(dir, 'archive-receipt.json')));
    assert.equal(receipt.verification, 'abandoned');
    assert.deepEqual(receipt.outputs, []);
    assert.equal(readText(join(root, 'specs', 'cap', 'spec.md')).includes('keep better records'), false, 'nothing from an abandoned change reaches specs/');
  });
});
