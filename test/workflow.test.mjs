/**
 * Risk-based review lanes (contract C-07, design D-07). Covers AC-10 (risk selects review roles
 * with recorded reasons, and independent review is never weakened to save effort) and AC-12 (a
 * change that never recorded a lane keeps working exactly as it did).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import {
  approvalChain,
  applyAmendment,
  contractApproval,
  currentContractDigest,
  higherLane,
  laneApproval,
  laneRequirements,
  proposeAmendment,
  recordReview,
  selectLane,
  beginAttempt,
} from '../scripts/lib/evidence.mjs';
import { archivePreflight } from '../scripts/lib/archive.mjs';
import { runTransaction, withIntentLock } from '../scripts/lib/intent-io.mjs';
import { parseAcceptanceMarkdown, parseTasksMarkdown, readChangeIntentDir } from '../scripts/lib/intent-graph.mjs';
import { createManifest, readManifest, updateLifecycle } from '../scripts/lib/intent-state.mjs';
import { ROOT, cleanEnv, cleanup, gitInit, makeTmp, readText, runSpec, runSpecJson, write } from './helpers.mjs';

describe('live workflow baseline inputs', () => {
  it('has meaningful failing targets and equivalent checks in disposable copies', () => {
    const root = makeTmp('live-inputs');
    try {
      cpSync(join(ROOT, 'test/fixtures/live-workflow'), root, { recursive: true });
      const env = cleanEnv();
      for (const name of Object.keys(env)) if (name.startsWith('NODE_TEST_')) delete env[name];
      const check = (dir, args) => spawnSync(process.execPath, args, {
        cwd: join(root, dir), env, encoding: 'utf8', windowsHide: true, timeout: 20000,
      });
      const medium = () => check('medium', ['--test', 'test/medium.test.mjs']);
      const initial = medium();
      assert.equal(initial.status, 1, initial.stderr);
      assert.match(initial.stdout, /left label is ready/, 'the fixture check actually ran');
      write(root, 'medium/source/left.mjs', "export const label = 'Left ready';\n");
      write(root, 'medium/source/right.mjs', "export const label = 'Right ready';\n");
      assert.equal(medium().status, 0, 'changing both labels satisfies the fixed acceptance');
      assert.equal(check('high', ['--test', 'test/high.test.mjs']).status, 1, 'baseline CLI lacks JSON output');
      write(root, 'high/cli.mjs', "console.log(process.argv.includes('--json') ? JSON.stringify({ greeting: 'Hello, fixture' }) : 'Hello, fixture');\n");
      assert.equal(check('high', ['--test', 'test/high.test.mjs']).status, 0, 'text compatibility and JSON are both checked');
      assert.equal(check('amend', ['--test', 'test/amend-a.test.mjs', 'test/amend-b.test.mjs', 'test/amend-c.test.mjs']).status, 0);
      assert.equal(check('amend', ['scripts/check-a.mjs']).status, 0);
      write(root, 'amend/source/a.mjs', "export const value = 'wrong';\n");
      assert.equal(check('amend', ['--test', 'test/amend-a.test.mjs']).status, 1);
      assert.equal(check('amend', ['scripts/check-a.mjs']).status, 1, 'the alternative check rejects the same bad value');
      assert.equal(check('verify', ['--test', 'test/verify.test.mjs']).status, 0);
    } finally { cleanup(root); }
  });
});

describe('selecting a review lane', () => {
  it('reads the automatic lane off the shape of the change, and says why', () => {
    assert.equal(selectLane({}).lane, 'low');
    assert.match(selectLane({}).reasons[0], /one reversible file/);
    assert.equal(selectLane({ multiFile: true }).lane, 'medium');
    assert.equal(selectLane({ uncertain: true }).lane, 'high');
    const auth = selectLane({ categories: ['auth'], paths: ['scripts\\spec.mjs'] });
    assert.equal(auth.lane, 'high');
    assert.match(auth.reasons[0], /high-risk categories: auth/);
    assert.deepEqual(auth.paths, ['scripts/spec.mjs'], 'the touched paths are recorded, in one spelling');
  });

  it('refuses a risk category it does not know, rather than treating it as no risk', () => {
    assert.throws(() => selectLane({ categories: ['vibes'] }), (e) => e.code === 'bad-lane');
    assert.throws(() => selectLane({ current: 'urgent' }), (e) => e.code === 'bad-lane');
  });

  it('treats the flags as requests: --deliberate forces high, --fast asks for medium', () => {
    assert.equal(selectLane({ deliberate: true }).lane, 'high');
    const fast = selectLane({ fast: true });
    assert.equal(fast.lane, 'medium');
    assert.equal(fast.flags.fast, true);
    const both = selectLane({ fast: true, deliberate: true });
    assert.equal(both.lane, 'high');
    assert.equal(both.flags.fast, false);
    assert.match(both.refusals[0], /--deliberate wins/);
  });

  it('refuses --fast for a high-risk category instead of quietly running it', () => {
    const r = selectLane({ categories: ['migrations'], fast: true });
    assert.equal(r.lane, 'high', 'a flag never overrides the automatic high lane');
    assert.match(r.refusals[0], /--fast is refused here: high-risk categories: migrations/);
    assert.equal(r.flags.fast, false);
  });

  it('keeps --go tied to an explicit --fast handoff', () => {
    const alone = selectLane({ go: true });
    assert.equal(alone.flags.go, false);
    assert.match(alone.refusals[0], /--go requires --fast/);
    assert.equal(selectLane({ go: true, fast: true }).flags.go, true);
    for (const risk of [{ categories: ['auth'] }, { deliberate: true }, { uncertain: true }, { current: 'high' }]) {
      const refused = selectLane({ go: true, fast: true, ...risk });
      assert.equal(refused.flags.go, false, 'a high/deliberate refusal cannot continue into execution');
      assert.equal(refused.flags.fast, false);
      assert.ok(refused.refusals.some((r) => r.includes('--go')));
    }
    assert.equal(selectLane({ multiFile: true, go: true }).flags.go, false, 'automatic medium is not an explicit go handoff');
  });

  it('escalates a recorded lane and never downgrades one', () => {
    assert.equal(higherLane('low', 'high'), 'high');
    const r = selectLane({ current: 'high' });
    assert.equal(r.lane, 'high');
    assert.match(r.reasons.at(-1), /may escalate a lane, never downgrade one/);
    assert.equal(selectLane({ categories: ['auth'], current: 'low' }).lane, 'high', 'wider scope still escalates');
  });

  it('says in the record itself that a selection authorizes nothing', () => {
    assert.equal(selectLane({ categories: ['auth'] }).authorizesImplementation, false);
    assert.equal(selectLane({ fast: true }).authorizesImplementation, false);
  });

  it('names the roles each lane must show', () => {
    assert.deepEqual(laneRequirements('high').roles, ['planner', 'architect', 'critic']);
    assert.deepEqual(laneRequirements('medium').roles, ['critic']);
    assert.deepEqual(laneRequirements('low').roles, []);
    assert.throws(() => laneRequirements('none'), (e) => e.code === 'bad-lane');
  });
});

const D = 'a'.repeat(64);
const review = (over) => ({ id: 'R-x', role: 'critic', verdict: 'OKAY', contractDigest: D, amendment: null, independent: true, findings: [], ...over });

describe('what each lane accepts as approval', () => {
  it('approves a high lane only on a planner draft plus an independent architect and critic', () => {
    const full = [
      review({ id: 'R-1', role: 'planner', verdict: 'DRAFT' }),
      review({ id: 'R-2', role: 'architect', verdict: 'CLEAR' }),
      review({ id: 'R-3', role: 'critic', verdict: 'OKAY' }),
    ];
    const ok = laneApproval('high', full, D);
    assert.equal(ok.approved, true);
    assert.deepEqual(ok.used, ['R-1', 'R-2', 'R-3']);
    assert.equal(laneApproval('high', full.slice(1), D).approved, false, 'no planner draft');
    assert.match(laneApproval('high', full.slice(1), D).reasons[0], /recorded planner draft/);
  });

  it('refuses an architect BLOCK, a blocking finding, and a reviewer who wrote the work', () => {
    const base = [review({ id: 'R-1', role: 'planner', verdict: 'DRAFT' }), review({ id: 'R-3', role: 'critic', verdict: 'OKAY' })];
    const with_ = (architect) => laneApproval('high', [...base, architect], D);
    assert.equal(with_(review({ id: 'R-2', role: 'architect', verdict: 'WATCH' })).approved, true, 'WATCH is a pass with a caveat');
    assert.equal(with_(review({ id: 'R-2', role: 'architect', verdict: 'BLOCK' })).approved, false);
    assert.equal(with_(review({ id: 'R-2', role: 'architect', verdict: 'CLEAR', findings: [{ severity: 'BLOCK', title: 'no' }] })).approved, false);
    assert.equal(with_(review({ id: 'R-2', role: 'architect', verdict: 'CLEAR', independent: false })).approved, false, 'the writer reviewing their own work is not an independent pass');
  });

  it('approves a medium lane on one independent critic OKAY, and no less', () => {
    assert.equal(laneApproval('medium', [review({ id: 'R-1' })], D).approved, true);
    assert.equal(laneApproval('medium', [review({ id: 'R-1', verdict: 'REJECT' })], D).approved, false);
    assert.equal(laneApproval('medium', [review({ id: 'R-1', independent: false })], D).approved, false);
    assert.match(laneApproval('medium', [], D).reasons[0], /independent critic OKAY/);
  });

  it('approves a low lane on its explicit acceptance contract and a recorded rationale', () => {
    assert.equal(laneApproval('low', [], D, { rationale: 'one reversible file' }).approved, true);
    assert.equal(laneApproval('low', [], D, { rationale: '  ' }).approved, false);
    assert.equal(laneApproval('low', [], D, { rationale: 'x', acceptanceComplete: false }).approved, false);
  });

  it('counts only reviews of this exact contract, and never a review of an amendment candidate', () => {
    assert.equal(laneApproval('medium', [review({ id: 'R-1', contractDigest: 'b'.repeat(64) })], D).approved, false);
    assert.equal(laneApproval('medium', [review({ id: 'R-1', amendment: 'A-1' })], D).approved, false);
  });
});

describe('carrying approval across an applied amendment', () => {
  const approvedBase = 'b'.repeat(64);
  const reviews = [review({ id: 'R-1', contractDigest: approvedBase })];
  const link = (over = {}) => ({
    id: 'A-1',
    state: 'applied',
    oldDigest: approvedBase,
    newDigest: D,
    candidate: { id: 'A-1', type: 'locator', oldDigest: approvedBase, candidateDigest: D, authority: { kind: 'executor-locator', actorId: 'exec-1' } },
    ...over,
  });
  const chain = (amendments, digest = D) => approvalChain({ digest, lane: 'medium', reviews, amendments });

  it('accepts a chain whose every link binds its predecessor digest and carries its authority', () => {
    const r = chain([link()]);
    assert.equal(r.approved, true);
    assert.equal(r.via, 'chain');
    assert.deepEqual(r.chain, ['A-1']);
  });

  it('prefers a direct review over the chain when the current digest has one', () => {
    const r = approvalChain({ digest: D, lane: 'medium', reviews: [review({ id: 'R-9' })], amendments: [link()] });
    assert.equal(r.via, 'direct');
    assert.deepEqual(r.chain, []);
  });

  it('rejects a link with no authority, a broken binding, a pending state and a cycle', () => {
    const noAuthority = chain([link({ candidate: { ...link().candidate, authority: null } })]);
    assert.equal(noAuthority.approved, false);
    assert.match(noAuthority.reasons.at(-1), /does not carry the authority its type requires/);

    const broken = chain([link({ oldDigest: 'c'.repeat(64) })]);
    assert.equal(broken.approved, false);
    assert.match(broken.reasons.at(-1), /does not bind the digest it was written against/);

    assert.equal(chain([link({ state: 'pending' })]).approved, false, 'a candidate that was never applied is not a link');
    const cycle = chain([link({ id: 'A-1', oldDigest: D, candidate: { ...link().candidate, oldDigest: D } })]);
    assert.equal(cycle.approved, false);
  });

  it('stops at an unapproved base instead of walking past it', () => {
    const r = approvalChain({ digest: D, lane: 'medium', reviews: [], amendments: [link()] });
    assert.equal(r.approved, false);
    assert.match(r.reasons.at(-1), /leads to \w{12}, which is not approved for the medium lane/);
  });
});

describe('the recorded lane, end to end', () => {
  let root;
  const rel = 'changes/demo';
  const where = () => ({ dir: join(root, 'changes', 'demo'), rel });
  const ACCEPTANCE = ['### AC-01 — It works', '', '- evidence-mode: automated', '- required: true', '- checks: test/unit.test.mjs', ''].join('\n');

  beforeEach(() => {
    root = makeTmp('lane');
    gitInit(root);
    write(root, 'src/app.mjs', 'export const answer = 42;\n');
    write(root, `${rel}/proposal.md`, '## Why\n\nBecause.\n');
    write(root, `${rel}/design.md`, '### D-01 — A decision\n\nBody.\n');
    write(root, `${rel}/acceptance.md`, ACCEPTANCE);
    write(root, `${rel}/tasks.md`, '- [ ] 1.1 build it and verify the unit suite passes\n  - id: T-A\n  - depends-on: none\n  - accepts: AC-01\n');
    withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', { stage: 'execute' }, token));
  });
  const done = () => cleanup(root);

  const setLane = (lane, reason = 'one reversible file') => withIntentLock(root, (token) => updateLifecycle(root, join(root, 'changes', 'demo'), { review: { lane, reason, paths: [] } }, {}, token));
  const digest = () => currentContractDigest(root, join(root, 'changes', 'demo'), rel);
  const record = (r) => withIntentLock(root, (token) => recordReview(root, { ...where(), review: { contractDigest: digest(), ...r } }, token));
  const approval = () => contractApproval(root, where());

  it('leaves a change that never recorded a lane exactly as it was', () => {
    const r = approval();
    assert.equal(r.declared, false);
    assert.equal(r.approved, false);
    assert.match(r.reasons[0], /has not recorded a review lane/);
    const begun = withIntentLock(root, (token) => beginAttempt(root, { ...where(), requiredCriteria: [] }, token));
    assert.equal(begun.sequence, 1, 'an undeclared lane never blocks the work that was already possible');
    done();
  });

  it('approves a recorded low lane on its rationale, and drops that approval when the contract moves', () => {
    setLane('low');
    assert.equal(approval().approved, true);
    write(root, `${rel}/acceptance.md`, ACCEPTANCE.replace('test/unit.test.mjs', 'test/other.test.mjs'));
    assert.equal(approval().approved, true, 'a low lane is approved by its rationale, which the edit did not change');
    write(root, `${rel}/acceptance.md`, '### AC-01 — It works\n\n- required: true\n');
    assert.equal(approval().approved, false, 'an acceptance criterion with no mode and no checks is not an explicit contract');
    done();
  });

  it('holds a recorded high lane to all three reviews of this exact contract', () => {
    setLane('high', 'it changes a trust boundary');
    assert.equal(approval().approved, false);
    record({ id: 'R-1', role: 'planner', verdict: 'DRAFT', actorId: 'p', writerActorId: 'w' });
    record({ id: 'R-2', role: 'architect', verdict: 'CLEAR', actorId: 'a', writerActorId: 'w' });
    assert.equal(approval().approved, false);
    record({ id: 'R-3', role: 'critic', verdict: 'OKAY', actorId: 'c', writerActorId: 'w' });
    const ok = approval();
    assert.equal(ok.approved, true);
    assert.equal(ok.via, 'direct');

    write(root, `${rel}/design.md`, '### D-01 — A different decision\n\nBody.\n');
    assert.equal(approval().approved, false, 'the reviews named the contract that was, not the one that is');
    done();
  });

  it('requires fresh review when the risk classification itself changes', () => {
    setLane('medium');
    record({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'c', writerActorId: 'w' });
    assert.equal(approval().approved, true);
    setLane('high', 'a trust boundary moved');
    const r = approval();
    assert.equal(r.approved, false, 'a higher lane cannot inherit the cheaper lane’s approval');
    assert.equal(r.lane, 'high');
    done();
  });

  it('refuses an amendment that would rewrite the manifest the lane lives in', () => {
    setLane('high', 'public API');
    assert.throws(
      () =>
        withIntentLock(root, (token) =>
          proposeAmendment(root, { ...where(), candidate: { id: 'A-1', type: 'locator', cause: 'relabel the lane', files: { [`${rel}/change.json`]: '{}' } } }, token)
        ),
      (e) => e.code === 'bad-amendment' && /risk lane or identity change needs fresh review/.test(e.message)
    );
    done();
  });

  it('blocks verification and archive while a declared contract is unapproved, and names why', () => {
    setLane('medium');
    assert.throws(
      () => withIntentLock(root, (token) => beginAttempt(root, { ...where(), requiredCriteria: [] }, token)),
      (e) => e.code === 'unapproved-contract' && /independent critic OKAY/.test(e.message)
    );
    const pre = archivePreflight(root, { dir: join(root, 'changes', 'demo'), rel, slug: 'demo', schemaVersion: 2 }, { force: false, date: '2026-01-01' });
    assert.ok(pre.blockers.some((b) => b.code === 'unapproved-contract'), 'an unreviewed contract is never merged into the specs');
    done();
  });

  it('carries approval through an applied locator amendment, without rerunning the lane', () => {
    setLane('medium');
    record({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'c', writerActorId: 'w' });
    const before = digest();
    const candidate = {
      id: 'A-1',
      type: 'locator',
      cause: 'the named suite moved',
      authority: { kind: 'executor-locator', actorId: 'exec-1' },
      files: { [`${rel}/acceptance.md`]: ACCEPTANCE.replace('test/unit.test.mjs', 'test/unit/suite.test.mjs') },
    };
    const proposed = withIntentLock(root, (token) => {
      const planned = proposeAmendment(root, { ...where(), candidate }, token);
      runTransaction(root, { purpose: 'propose', steps: planned.steps }, token);
      return planned.record;
    });
    assert.equal(proposed.oldDigest, before);
    withIntentLock(root, (token) => {
      const planned = applyAmendment(root, { ...where(), id: 'A-1' }, token);
      runTransaction(root, { purpose: 'apply', steps: planned.steps }, token);
    });
    assert.equal(digest(), proposed.candidateDigest, 'the digest the link promised is the digest publishing produced');
    const after = approval();
    assert.equal(after.approved, true);
    assert.equal(after.via, 'chain');
    assert.deepEqual(after.chain, ['A-1']);
    done();
  });

  it('is driven from the CLI: select advises, set records and refuses a silent downgrade, status reports', () => {
    const selection = runSpecJson(root, ['lane', 'select', 'demo', '--fast']);
    assert.equal(selection.status, 0);
    assert.equal(selection.json.lane, 'medium');
    assert.equal(readManifest(join(root, 'changes', 'demo')).review, null, 'selecting records nothing');

    assert.match(runSpec(root, ['lane', 'set', 'demo', '--lane', 'high']).stderr, /--reason/);
    assert.equal(runSpec(root, ['lane', 'set', 'demo', '--lane', 'high', '--reason', 'public API change']).status, 0);
    assert.equal(readManifest(join(root, 'changes', 'demo')).review.lane, 'high');

    const down = runSpec(root, ['lane', 'set', 'demo', '--lane', 'low', '--reason', 'it is small really']);
    assert.notEqual(down.status, 0);
    assert.match(down.stderr, /downgrade/);
    assert.equal(runSpec(root, ['lane', 'set', 'demo', '--lane', 'low', '--reason', 'it is small really', '--force']).status, 0);

    const status = runSpecJson(root, ['lane', 'status', 'demo']);
    assert.equal(status.status, 0, 'the low lane it was just set to is approved by its own rationale');
    assert.equal(status.json.lane, 'low');
    done();
  });

  it('uses one digest for a change that declares both a lane and a supporting contract file', () => {
    // regression: the approval gate and the verification attempt once hashed different contracts,
    // because only `evidence begin` passed the declared supportingContractPaths. A change like
    // this one — a lane plus a contract that reaches past the four standard documents — could
    // then satisfy neither gate, whichever digest its reviews named.
    write(root, `${rel}/contracts.md`, '# Contracts\n\nC-01: the writer is atomic.\n');
    write(root, `${rel}/verification-inputs.json`, JSON.stringify({ supportingContractPaths: [`${rel}/contracts.md`] }, null, 2) + '\n');
    setLane('medium');

    const declared = { supportingContractPaths: [`${rel}/contracts.md`] };
    assert.equal(currentContractDigest(root, join(root, 'changes', 'demo'), rel), currentContractDigest(root, join(root, 'changes', 'demo'), rel, declared), 'the default scope is the declared one');
    assert.notEqual(currentContractDigest(root, join(root, 'changes', 'demo'), rel), currentContractDigest(root, join(root, 'changes', 'demo'), rel, { supportingContractPaths: [] }), 'and it really is a different contract from the bare one');

    record({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'c', writerActorId: 'w' });
    assert.equal(approval().approved, true, 'the review the CLI recorded approves the contract the gate reads');
    const begun = runSpecJson(root, ['evidence', 'begin', 'demo']);
    assert.equal(begun.status, 0, begun.stderr, 'and the attempt opens against that same contract');
    assert.equal(begun.json.acceptanceDigest, digest());

    // the supporting file is part of the contract: editing it invalidates the review
    write(root, `${rel}/contracts.md`, '# Contracts\n\nC-01: the writer is atomic, usually.\n');
    assert.equal(approval().approved, false, 'a declared contract file is contract, not decoration');
    done();
  });
  it('refuses to enter execute on a contract that is not executable, or that its lane has not approved', () => {
    // C-01, C-06 and C-07 all name `stage execute` as a gate; it once enforced nothing.
    write(root, `${rel}/tasks.md`, readText(join(root, rel, 'tasks.md')) + '- [ ] 1.2 do more and verify more\n  - id: T-B\n  - depends-on: none\n');
    const unlinked = runSpec(root, ['stage', 'demo', 'execute', '--session', 'gate-1']);
    assert.notEqual(unlinked.status, 0);
    assert.match(unlinked.stderr, /not an executable contract/);
    assert.match(unlinked.stderr, /task T-B names no acceptance criterion/);
    assert.equal(runSpec(root, ['stage', 'demo', 'execute', '--session', 'gate-1', '--force']).status, 1, '--force is about the lease, and never waives the contract gate');
    assert.equal(runSpec(root, ['stage', 'demo', 'execute', '--session', 'gate-1', '--skip-contract-gate']).status, 0, 'waiving the gate is its own explicit decision');

    write(root, `${rel}/tasks.md`, readText(join(root, rel, 'tasks.md')).replace('  - id: T-B\n  - depends-on: none\n', '  - id: T-B\n  - depends-on: none\n  - accepts: AC-01\n'));
    setLane('high', 'it changes a trust boundary');
    const unapproved = runSpec(root, ['stage', 'demo', 'execute', '--session', 'gate-1']);
    assert.notEqual(unapproved.status, 0);
    assert.match(unapproved.stderr, /declares the high review lane, and this contract is not approved/);

    record({ id: 'R-1', role: 'planner', verdict: 'DRAFT', actorId: 'p', writerActorId: 'w' });
    record({ id: 'R-2', role: 'architect', verdict: 'CLEAR', actorId: 'a', writerActorId: 'w' });
    record({ id: 'R-3', role: 'critic', verdict: 'OKAY', actorId: 'c', writerActorId: 'w' });
    assert.equal(runSpec(root, ['stage', 'demo', 'execute', '--session', 'gate-1']).status, 0, 'the approved contract enters execute');
    done();
  });
  it('holds a scope amendment to the lane the change recorded, not to one reviewer who said OKAY', () => {
    // a scope amendment is the one type that can reduce a guarantee, so C-07 binds it to the
    // recorded lane's reviews. It once accepted any single independent OKAY from any role.
    setLane('high', 'it changes a trust boundary');
    const candidate = {
      id: 'A-1',
      type: 'scope',
      cause: 'the guarantee is narrower than we promised',
      authority: { kind: 'user-scope', sourceRef: 'user:2026-09-14 decision' },
      changed: { acceptance: ['AC-01'] },
      files: { [`${rel}/acceptance.md`]: ACCEPTANCE.replace('It works', 'It mostly works') },
    };
    const proposed = withIntentLock(root, (token) => {
      const planned = proposeAmendment(root, { ...where(), candidate }, token);
      runTransaction(root, { purpose: 'propose', steps: planned.steps }, token);
      return planned.record;
    });

    const forCandidate = (over) => withIntentLock(root, (token) => recordReview(root, { ...where(), review: { contractDigest: proposed.candidateDigest, amendment: 'A-1', ...over } }, token));
    forCandidate({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'c', writerActorId: 'w' });
    const apply = () => withIntentLock(root, (token) => applyAmendment(root, { ...where(), id: 'A-1' }, token));
    assert.throws(apply, (e) => e.code === 'unauthorised-amendment' && /the high lane's review of the candidate/.test(e.message), 'one critic is the medium lane, not the high one');

    forCandidate({ id: 'R-2', role: 'planner', verdict: 'DRAFT', actorId: 'p', writerActorId: 'w' });
    forCandidate({ id: 'R-3', role: 'architect', verdict: 'CLEAR', actorId: 'a', writerActorId: 'w' });
    const planned = apply();
    assert.deepEqual(planned.affected, ['T-A'], 'the full lane reviewed it, so it applies');
    done();
  });
  it('reports an unapproved contract through a non-zero exit', () => {
    setLane('high', 'public API');
    const status = runSpecJson(root, ['lane', 'status', 'demo']);
    assert.equal(status.status, 1);
    assert.equal(status.json.approved, false);
    assert.match(status.json.requirements.summary, /planner draft/);
    done();
  });

  it('keeps the lane as history, and refuses a downgrade that would inherit stricter reviews', () => {
    // the lane decides how much review the contract needs, so it is history like everything else
    // that decides that. `lane set --lane low --force` was once the cheapest link in the design.
    assert.equal(runSpec(root, ['lane', 'set', 'demo', '--lane', 'medium', '--reason', 'several files']).status, 0);
    assert.equal(runSpec(root, ['lane', 'set', 'demo', '--lane', 'high', '--reason', 'it moves a trust boundary']).status, 0, 'escalation is free');
    const history = runSpecJson(root, ['lane', 'status', 'demo']).json.history;
    assert.deepEqual(history.map((h) => [h.lane, h.direction]), [['medium', 'initial'], ['high', 'escalation']]);
    assert.equal(history[1].previous, 'medium');

    record({ id: 'R-1', role: 'planner', verdict: 'DRAFT', actorId: 'p', writerActorId: 'w' });
    record({ id: 'R-2', role: 'architect', verdict: 'CLEAR', actorId: 'a', writerActorId: 'w' });
    record({ id: 'R-3', role: 'critic', verdict: 'OKAY', actorId: 'c', writerActorId: 'w' });
    assert.equal(approval().approved, true);

    const forced = runSpec(root, ['lane', 'set', 'demo', '--lane', 'low', '--reason', 'it is small really', '--force']);
    assert.notEqual(forced.status, 0);
    assert.match(forced.stderr, /already carries 3 review\(s\) recorded under the high lane; a downgrade cannot inherit them/);
    assert.equal(readManifest(join(root, 'changes', 'demo')).review.lane, 'high', 'and the lane it was reviewed in is what stands');
    done();
  });
  it('refuses an unknown lane at the boundary rather than recording it', () => {
    const r = runSpec(root, ['lane', 'set', 'demo', '--lane', 'urgent', '--reason', 'because']);
    assert.notEqual(r.status, 0);
    assert.match(r.stderr, /unknown lane .urgent./);
    done();
  });
});

describe('the handoff both hosts receive', () => {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');
  const claudeSkill = (name) => read(`skills/${name}/SKILL.md`);
  const codexSkill = (name) => read(`codex/skills/my-flow-${name}/SKILL.md`);
  const bothSkills = (name) => [claudeSkill(name), codexSkill(name)];
  const bothAgents = (name) => [read(`agents/${name}.md`), read(`codex/agents/${name}.toml`)];

  it('is generated, not hand-written: the checked-in surfaces match src/', () => {
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--check'], { encoding: 'utf8', cwd: ROOT, timeout: 60000, windowsHide: true });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
  });

  it('teaches mf-plan to record the lane and the reviews it needs, in each host spelling', () => {
    assert.match(claudeSkill('mf-plan'), /`\/my-flow:spec lane set <name> --lane <low\|medium\|high>/);
    assert.match(codexSkill('mf-plan'), /`\$my-flow-spec lane set <name> --lane <low\|medium\|high>/);
    for (const text of bothSkills('mf-plan')) {
      assert.match(text, /lane select <name> --file <risk\.json> \[--fast\] \[--deliberate\] \[--go\]/);
      assert.match(text, /records nothing and\s+authorizes nothing/);
      assert.match(text, /review record <name> --file <review\.json>/);
      assert.match(text, /`--fast` is the\s+medium lane: record it as `medium`, never as `low`/);
    }
  });

  it('dispatches automatic medium review and requires re-review before approval', () => {
    for (const text of bothSkills('mf-plan')) {
      const choose = text.slice(text.indexOf('## Choose the lane before delegation'), text.indexOf('## Low lane'));
      const medium = text.slice(text.indexOf('## Medium lane'), text.indexOf('## High lane'));
      const high = text.slice(text.indexOf('## High lane'), text.indexOf('## Delegation and context'));
      assert.match(choose, /select medium automatically/);
      assert.match(choose, /Dispatch only the selected lane/);
      assert.match(medium, /selected automatically/);
      assert.match(medium, /Draft in the main context/);
      assert.match(medium, /independent read-only critic/);
      assert.match(medium, /critic re-review before\s+approval/);
      assert.match(medium, /Repeated rejection escalates to the high lane/);
      assert.match(high, /Delegate the draft to the planner/);
      assert.match(high, /independent read-only architect/);
      assert.match(high, /independent read-only critic/);
      const preparation = text.slice(text.indexOf('## Prepare the review target\n'), text.indexOf('## Delegation and context'));
      assert.match(preparation, /validate <name>/);
      assert.match(preparation, /Then build/);
      assert.match(preparation, /Any later contract edit returns to this preparation/);
      const finish = text.slice(text.indexOf('## Finish and record approval\n'), text.indexOf('## Amend an existing contract\n'));
      assert.doesNotMatch(finish, /Write applicable delta/);
      assert.doesNotMatch(text, /There is no second review|REJECT-fixed/);
      assert.match(text, /A high-risk or deliberate refusal also refuses go/);
      assert.match(text, /amend propose <name> --file <candidate\.json>/);
      assert.match(text, /amend apply <name> --id A-<id>/);
    }
  });

  it('keeps configured Claude review roles out of named teammate routing', () => {
    for (const name of ['mf-plan', 'mf-verify']) {
      const text = claudeSkill(name);
      assert.match(text, /ordinary foreground Agent/);
      for (const field of ['name', 'team_name', 'run_in_background']) assert.ok(text.includes('`' + field + '`'));
    }
  });

  it('documents automatic lanes consistently in core blocks and every README language', () => {
    for (const path of ['claude/CLAUDE.block.md', 'codex/AGENTS.block.md']) {
      const text = read(path);
      assert.match(text, /selects low, medium or high review automatically/);
      assert.match(text, /Medium uses a main-context short draft and an independent critic/);
      assert.match(text, /or deliberate refusal also refuses go/);
    }
    assert.match(read('README.md'), /## Automatic review lanes/);
    for (const language of ['de', 'es', 'fr', 'ja', 'ko', 'zh-CN', 'zh-TW']) {
      const text = read('README.' + language + '.md');
      assert.match(text, /README\.md#automatic-review-lanes/);
      assert.ok(text.indexOf('> Planning policy update:') > text.indexOf('</p>'), 'compatibility note is outside the HTML navigation block');
      assert.doesNotMatch(text, /`mf-plan --fast \[--go\] → execute → mf-verify`/);
    }
  });

  it('teaches execute to escalate a repeated cause instead of patching a third time', () => {
    for (const text of bothSkills('execute')) {
      assert.match(text, /finding record <name> --file <finding\.json>/);
      assert.match(text, /every independent task stays runnable/);
      assert.match(text, /A ticked box is never reopened by a finding/);
      assert.match(text, /amend propose <name> --file <candidate\.json>/);
      assert.match(text, /A scope change needs the user, not a reviewer/);
      assert.match(text, /context <name> --task <id>/);
      assert.match(text, /usage import <name> --file <event\.json>/);
      assert.match(text, /never becomes zero/);
    }
  });

  it('keeps the final verification a fresh, version-bound and complete pass on both hosts', () => {
    for (const text of bothSkills('mf-verify')) {
      assert.match(text, /evidence begin <name>/);
      assert.match(text, /context <name>` with no `--task`/);
      assert.match(text, /every criterion, not a writer-selected subset/);
      assert.match(text, /evidence record <name> --attempt <n>/);
      assert.match(text, /A FAIL or an INCOMPLETE is recorded too/);
      assert.match(text, /never reinstated by scanning backwards/);
    }
  });

  it('documents every new subcommand in the spec skill on both hosts', () => {
    for (const text of bothSkills('spec')) {
      for (const heading of ['## lane select|set|status', '## review record', '## finding record|resolve|status', '## amend propose|apply|cancel|status', '## evidence begin|record|cancel|status', '## context <name>', '## usage <name>', '## session new|show|release|recover']) {
        assert.ok(text.includes(heading), `${heading} is missing from a generated spec skill`);
      }
      assert.match(text, /No price, no quota, no estimate/);
    }
  });

  it('gives each role the same standing instruction in both host formats', () => {
    for (const text of bothAgents('verifier')) {
      assert.match(text, /carries the complete criteria\s+index/);
      assert.match(text, /VERIFIED \/ PARTIAL \/ MISSING \/ CONTRADICTED/);
      assert.match(text, /never a softened VERIFIED/);
      assert.match(text, /not the one that closes the change/);
    }
    for (const text of bothAgents('architect')) assert.match(text, /moves a trust boundary, goes back to the user and to the\s+full lane/);
    for (const text of bothAgents('critic')) assert.match(text, /a shorter packet is not a lower bar/);
    for (const text of bothAgents('planner')) assert.match(text, /rather than from the numbering/);
  });

  it('states the same rules in both core blocks', () => {
    for (const text of [read('claude/CLAUDE.block.md'), read('codex/AGENTS.block.md')]) {
      assert.match(text, /lane \/ review \/ finding \/ amend \/ evidence \/ context \/ usage \/ session/);
      assert.match(text, /Legacy changes keep working unchanged; the upgrade is explicit/);
      assert.match(text, /never how much evidence a claim needs/);
      assert.match(text, /no price, no claimed saving/);
    }
  });

  it("never leaks one host's call syntax into the other", () => {
    for (const name of ['mf-plan', 'execute', 'mf-verify', 'spec']) {
      assert.equal(claudeSkill(name).includes('$my-flow-'), false, `${name}: Codex syntax reached the Claude surface`);
      assert.equal(codexSkill(name).includes('/my-flow:'), false, `${name}: Claude syntax reached the Codex surface`);
      assert.equal(claudeSkill(name).includes('{{CALL:'), false, `${name}: an unrendered placeholder survived`);
      assert.equal(codexSkill(name).includes('{{CALL:'), false, `${name}: an unrendered placeholder survived`);
    }
  });
});

describe('the documentation and the surfaces a temporary install receives', () => {
  const read = (rel) => readFileSync(join(ROOT, rel), 'utf8');

  it('documents every linked-intent command in the README command table', () => {
    const readme = read('README.md');
    for (const command of [
      '`spec inspect <name-or-uuid> [--task T-01]`',
      '`spec upgrade <name> [--apply]`',
      '`spec lane select\\|set\\|status <name>`',
      '`spec review record <name> --file <json>`',
      '`spec finding record\\|resolve\\|status <name>`',
      '`spec amend propose\\|apply\\|cancel\\|status <name>`',
      '`spec evidence begin\\|record\\|cancel\\|status <name>`',
      '`spec context <name> [--task T-01] [--since <digest>]`',
      '`spec usage <name>`',
      '`spec session new\\|show\\|release\\|recover <key>`',
    ]) {
      assert.ok(readme.includes(`| ${command}`), `${command} is not in the README command table`);
    }
    // one table row per command: the earlier duplication into the skills table must not come back
    assert.equal(readme.split('| `spec lane select\\|set\\|status <name>`').length - 1, 1);
  });

  it('says plainly, in the README and in the project template, that the upgrade is additive', () => {
    const readme = read('README.md');
    assert.match(readme, /\*\*Compatibility\.\*\* Every one of these is additive\./);
    assert.match(readme, /keeps its\s+old `tasks\.md` grammar/);
    assert.match(readme, /`changes\/archive\/\*\*` is never rewritten/);
    assert.match(readme, /Simple mode[\s\S]{0,120}stays legacy on purpose/);
    assert.match(readme, /no recorded review lane is undeclared/);

    const specsReadme = read('templates/specs-README.md');
    assert.match(specsReadme, /After `spec upgrade <name> --apply`, that change also has:/);
    assert.match(specsReadme, /changes\/<name>\/acceptance\.md/);
    assert.match(specsReadme, /a change you never upgrade keeps working exactly as before/);
    assert.match(read('templates/simple/change.md'), /Simple mode stays deliberately legacy/);
  });

  it('ships the v2 change template that `spec new` and `init` copy', () => {
    assert.equal(read('templates/change/.template-version').trim(), '2');
    assert.match(read('templates/change/acceptance.md'), /evidence-mode/);
    assert.match(read('templates/change/tasks.md'), /- id: T-01/);
    assert.match(read('templates/change/design.md'), /### D-01/);
  });

  it('runs every new suite from the explicit test list, never a bare node --test', () => {
    const pkg = JSON.parse(read('package.json'));
    for (const suite of ['test/workflow.test.mjs', 'test/context.test.mjs', 'test/usage.test.mjs']) {
      assert.ok(pkg.scripts.test.includes(suite), `${suite} is not in the explicit test list`);
    }
    assert.equal(/node --test\s*$/.test(pkg.scripts.test), false);
  });

  it('installs the regenerated skills and agents into a temporary Codex home, touching no real one', (t) => {
    const tmp = makeTmp('install');
    t.after(() => cleanup(tmp));
    const homes = { my: join(tmp, 'my-flow'), codex: join(tmp, 'codex'), claude: join(tmp, 'claude') };
    for (const d of Object.values(homes)) mkdirSync(d, { recursive: true });
    const fake = join(tmp, 'fake-schtasks.mjs');
    writeFileSync(fake, 'process.exit(0);\n', 'utf8');
    const env = { ...cleanEnv(), MY_FLOW_HOME: homes.my, CODEX_HOME: homes.codex, CLAUDE_CONFIG_DIR: homes.claude, MY_FLOW_SCHTASKS: fake, MY_FLOW_PLUGIN_FAKE_CLAUDE: 'missing' };

    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'install.mjs'), 'codex'], { encoding: 'utf8', cwd: ROOT, timeout: 60000, windowsHide: true, env });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);

    const skill = readFileSync(join(homes.codex, 'skills', 'my-flow-spec', 'SKILL.md'), 'utf8');
    assert.match(skill, /## lane select\|set\|status <name>/);
    assert.match(skill, /## evidence begin\|record\|cancel\|status <name>/);
    assert.equal(skill.includes('/my-flow:'), false, 'the installed Codex skill carries Codex call syntax only');
    const verifier = readFileSync(join(homes.codex, 'agents', 'verifier.toml'), 'utf8');
    assert.match(verifier, /VERIFIED \/ PARTIAL \/ MISSING \/ CONTRADICTED/);
    assert.match(readFileSync(join(homes.codex, 'AGENTS.md'), 'utf8'), /lane \/ review \/ finding \/ amend \/ evidence \/ context \/ usage \/ session/);
  });

  it('initializes a temporary project with the v2 template and the updated layout note', (t) => {
    const project = makeTmp('init-project');
    t.after(() => cleanup(project));
    const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'init.mjs'), project], { encoding: 'utf8', cwd: ROOT, timeout: 60000, windowsHide: true, env: cleanEnv() });
    assert.equal(r.status, 0, `${r.stdout}${r.stderr}`);
    assert.match(readFileSync(join(project, 'specs', 'README.md'), 'utf8'), /After `spec upgrade <name> --apply`/);
    assert.equal(readFileSync(join(project, 'changes', '.templates', '.template-version'), 'utf8').trim(), '2');
    assert.ok(existsSync(join(project, 'changes', '.templates', 'acceptance.md')));
  });
});

/**
 * The rehearsal AC-12 requires before the real plan makes the same switch: a legacy active change,
 * upgraded with every command present, then driven through baseline, a full-lane review, the
 * session stage refresh and an evidence attempt — in that order — while the historical archive and
 * the progress already claimed stay exactly as they were.
 */
describe('upgrading a legacy active change with every command present', () => {
  let root;
  const rel = 'changes/legacy';
  const dir = () => join(root, 'changes', 'legacy');
  const LEGACY_TASKS = [
    '# Tasks',
    '',
    '- [x] 1.1 Write the reader and verify the fixture parses',
    '- [ ] 1.2 Write the writer and verify the crash fixture recovers',
    '- [ ] 1.3 Wire them together and verify the integration fixture',
    '',
  ].join('\n');
  const ARCHIVED = '- [x] 1.1 An old finished task and verify it\n';
  const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');

  beforeEach(() => {
    root = makeTmp('t32');
    gitInit(root);
    write(root, 'src/app.mjs', 'export const answer = 42;\n');
    write(root, `${rel}/proposal.md`, '## Why\n\nBecause.\n\n## Non-Goals\n\n- Nothing else.\n');
    write(root, `${rel}/design.md`, '## Context\n\nA fixture.\n\n## Do-Not-Touch\n\nNothing.\n\n## Rebuild / Re-run After Change\n\nRun the suite.\n');
    write(root, `${rel}/tasks.md`, LEGACY_TASKS);
    write(root, 'changes/archive/2026-01-01-old/tasks.md', ARCHIVED);
    write(root, 'specs/cap/spec.md', '# cap\n\n## Purpose\n\nOne paragraph.\n\n## Requirements\n\n### Requirement: Existing\n\nIt exists.\n\n#### Scenario: It is there\n\n- **WHEN** asked\n- **THEN** it answers\n');
  });
  const done = () => cleanup(root);

  it('is a dry run until it is asked to write, and then preserves the originals', () => {
    const before = readText(join(root, rel, 'tasks.md'));
    const dry = runSpecJson(root, ['upgrade', 'legacy']);
    assert.equal(dry.status, 0);
    assert.equal(readText(join(root, rel, 'tasks.md')), before, 'a dry run writes nothing');
    assert.ok(dry.json.decisions.some((d) => /no dependency was inferred/.test(d)));
    assert.ok(dry.json.decisions.some((d) => /no ticked box was treated as newly verified/.test(d)));

    const archiveHash = hash(join(root, 'changes/archive/2026-01-01-old/tasks.md'));
    assert.equal(runSpec(root, ['upgrade', 'legacy', '--apply']).status, 0);
    assert.equal(readText(join(root, rel, 'migration/original/tasks.md')), before, 'the original is kept verbatim');
    assert.equal(hash(join(root, 'changes/archive/2026-01-01-old/tasks.md')), archiveHash, 'the historical archive is untouched');
    done();
  });

  it('keeps every progress claim exactly as it was, and invents no acceptance', () => {
    assert.equal(runSpec(root, ['upgrade', 'legacy', '--apply']).status, 0);
    const parsed = parseTasksMarkdown(readText(join(root, rel, 'tasks.md')));
    assert.deepEqual(parsed.tasks.map((t) => t.checked), [true, false, false], 'a ticked box stays ticked, an open box stays open');
    assert.deepEqual(parsed.tasks.map((t) => t.id), ['T-01', 'T-02', 'T-03']);
    assert.deepEqual(parsed.tasks.map((t) => t.accepts), [null, null, null], 'no task was pointed at a criterion nobody wrote');
    assert.deepEqual(parsed.tasks.map((t) => t.dependsOn), [null, null, null], 'numbering never becomes a dependency');
    const acceptance = readText(join(root, rel, 'acceptance.md'));
    assert.match(acceptance, /Draft, unapproved/);
    assert.equal(parseAcceptanceMarkdown(acceptance).criteria.length, 0, 'the draft is commented out, so nothing is in force');
    done();
  });

  it('runs baseline, the full-lane review, the stage refresh and evidence begin, in that order', () => {
    assert.equal(runSpec(root, ['upgrade', 'legacy', '--apply']).status, 0);

    // 1. the base every delta claim is written against
    assert.equal(runSpec(root, ['baseline', 'legacy']).status, 0);
    assert.ok(existsSync(join(dir(), 'spec-base.json')));
    assert.equal(runSpec(root, ['conflicts', 'legacy']).status, 0);

    // 2. an executable contract, then the lane it will be reviewed in
    write(root, `${rel}/acceptance.md`, '### AC-01 — The reader works\n\n- evidence-mode: automated\n- required: true\n- checks: `test/reader.test.mjs`\n');
    write(root, `${rel}/tasks.md`, readText(join(root, rel, 'tasks.md')).replace(/  - id: (T-0\d)\n/g, '  - id: $1\n  - depends-on: none\n  - accepts: AC-01\n'));
    assert.equal(runSpec(root, ['lane', 'set', 'legacy', '--lane', 'high', '--reason', 'it changes the intent layer itself']).status, 0);
    assert.equal(runSpec(root, ['lane', 'status', 'legacy']).status, 1, 'a recorded lane is not an approval');

    // 3. the reviews that lane requires, each naming the current contract digest
    const digest = runSpecJson(root, ['lane', 'status', 'legacy']).json.digest;
    const file = join(root, 'review.json');
    for (const [id, role, verdict] of [['R-1', 'planner', 'DRAFT'], ['R-2', 'architect', 'CLEAR'], ['R-3', 'critic', 'OKAY']]) {
      writeFileSync(file, JSON.stringify({ id, role, verdict, contractDigest: digest, actorId: `${role}-1`, writerActorId: 'writer-1' }));
      assert.equal(runSpec(root, ['review', 'record', 'legacy', '--file', file]).status, 0, `${id} was refused`);
    }
    const approved = runSpecJson(root, ['lane', 'status', 'legacy']);
    assert.equal(approved.status, 0);
    assert.equal(approved.json.via, 'direct');

    // 4. the stage and session binding
    const staged = runSpecJson(root, ['stage', 'legacy', 'execute', '--session', 'rehearsal-1']);
    assert.equal(staged.status, 0);
    const shown = runSpecJson(root, ['session', 'show', '--session', 'rehearsal-1']);
    assert.equal(shown.json.current.lease.changeId, readManifest(dir()).id, 'the session holds the lease on this change');
    assert.equal(shown.json.current.lease.stage, 'execute');

    // 5. and only now can an attempt open against this exact contract
    const begun = runSpecJson(root, ['evidence', 'begin', 'legacy', '--session', 'rehearsal-1']);
    assert.equal(begun.status, 0, begun.stderr);
    assert.equal(begun.json.sequence, 1);
    assert.equal(begun.json.acceptanceDigest, digest, 'the attempt is bound to the contract the reviewers approved');
    assert.equal(parseTasksMarkdown(readText(join(root, rel, 'tasks.md'))).tasks[0].checked, true, 'the switch never re-opened a claim');
    done();
  });

  it('refuses to upgrade an archived change or a simple-mode one', () => {
    const archived = runSpec(root, ['upgrade', '2026-01-01-old', '--apply']);
    assert.notEqual(archived.status, 0);
    assert.match(archived.stderr, /archived; historical changes are preserved exactly as they are/);
    write(root, 'docs/changes/simple.md', '# Change: simple\n\n## Tasks\n\n- [ ] 1.1 do it and verify it\n');
    write(root, 'changes/simple/tasks.md', '- [ ] 1.1 do it and verify it\n');
    const simple = runSpec(root, ['upgrade', 'simple', '--apply']);
    assert.notEqual(simple.status, 0);
    assert.match(simple.stderr, /simple mode keeps legacy reading and is not upgraded/);
    done();
  });

  it('refuses to upgrade the same change twice', () => {
    assert.equal(runSpec(root, ['upgrade', 'legacy', '--apply']).status, 0);
    const again = runSpec(root, ['upgrade', 'legacy', '--apply']);
    assert.notEqual(again.status, 0);
    assert.match(again.stderr, /already has a change\.json and an id on every task/);
    done();
  });
});

/**
 * One change walked end to end through the linked workflow in an isolated fixture: planned,
 * reviewed in its lane, executed with a repeated cause and an amendment, verified against exact
 * inputs and archived — with a legacy change sitting beside it the whole time, unaffected.
 *
 * This is the scenario every acceptance criterion describes from its own angle, run once as a
 * whole so the pieces are checked against each other rather than only against their own suites.
 */
/** Commit everything, so the implementation inventory sees a clean tracked tree. */
const gitCommit = (dir) => {
  const opts = { encoding: 'utf8', cwd: dir, timeout: 20000, windowsHide: true };
  assert.equal(spawnSync('git', ['add', '-A'], opts).status, 0);
  spawnSync('git', ['-c', 'user.email=t@e', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '--allow-empty', '-m', 'fixture'], opts);
};

describe('the complete linked workflow, in one isolated fixture', () => {
  let root;
  const rel = 'changes/demo';
  const dir = () => join(root, 'changes', 'demo');
  const SESSION = 'e2e-session-1';
  const spec = (...args) => runSpec(root, [...args, '--session', SESSION]);
  const specJson = (...args) => runSpecJson(root, [...args, '--session', SESSION]);
  const json = (name, value) => {
    const p = join(root, `${name}.json`);
    writeFileSync(p, JSON.stringify(value, null, 2));
    return p;
  };
  const digest = () => specJson('lane', 'status', 'demo').json.digest;
  const tasks = () => new Map(parseTasksMarkdown(readText(join(root, rel, 'tasks.md'))).tasks.map((t) => [t.id, t]));

  const ACCEPTANCE = [
    '# Acceptance and test map',
    '',
    '### AC-01 — The reader parses the fixture',
    '',
    '- evidence-mode: automated',
    '- required: true',
    '- checks: `test/reader.test.mjs`',
    '',
    '### AC-02 — The writer survives a crash',
    '',
    '- evidence-mode: automated',
    '- required: true',
    '- checks: `test/writer.test.mjs`',
    '',
    '### AC-03 — The prose reads well',
    '',
    '- evidence-mode: manual',
    '- required: false',
    '- checks: read the rendered page',
    '',
  ].join('\n');
  const TASKS = [
    '# Tasks',
    '',
    '- [ ] 1.1 Write the reader and verify the fixture parses',
    '  - id: T-01',
    '  - depends-on: none',
    '  - accepts: AC-01',
    '  - design: D-01',
    '- [ ] 1.2 Write the writer and verify the crash fixture recovers',
    '  - id: T-02',
    '  - depends-on: T-01',
    '  - accepts: AC-02',
    '  - design: D-02',
    '- [ ] 1.3 Polish the page and verify a reader can follow it',
    '  - id: T-03',
    '  - depends-on: none',
    '  - accepts: AC-03',
    '',
  ].join('\n');
  const DESIGN = [
    '## Context',
    '',
    'A fixture change.',
    '',
    '## Do-Not-Touch',
    '',
    'Nothing outside src/.',
    '',
    '## Rebuild / Re-run After Change',
    '',
    'Run the suite.',
    '',
    '### D-01 — Parse with one pass',
    '',
    'One scan, no backtracking.',
    '',
    '### D-02 — Write through a temporary file',
    '',
    'Stage beside the destination, then rename.',
    '',
  ].join('\n');
  const DELTA = [
    '# reader Specification',
    '',
    '## ADDED Requirements',
    '',
    '### Requirement: The reader parses the fixture',
    'The system SHALL parse the fixture in one pass.',
    '',
    '#### Scenario: A well-formed fixture',
    '- **WHEN** the fixture is well formed',
    '- **THEN** every record is returned in order',
    '',
  ].join('\n');

  beforeEach(() => {
    root = makeTmp('e2e');
    gitInit(root);
    write(root, 'src/reader.mjs', 'export const read = () => [];\n');
    write(root, 'src/writer.mjs', 'export const write = () => {};\n');
    write(root, 'test/reader.test.mjs', '// the check AC-01 names\n');
    write(root, 'test/writer.test.mjs', '// the check AC-02 names\n');
    // a legacy change beside it, which must keep working untouched throughout (AC-12)
    write(root, 'changes/legacy/proposal.md', '## Why\n\nOld.\n');
    write(root, 'changes/legacy/design.md', '## Do-Not-Touch\n\nNothing.\n\n## Rebuild / Re-run After Change\n\nNothing.\n');
    write(root, 'changes/legacy/tasks.md', '- [x] 1.1 An older task and verify it\n- [ ] 1.2 Another older task and verify it\n');
    // and the change itself
    write(root, `${rel}/proposal.md`, '## Why\n\nBecause.\n\n## Non-Goals\n\n- Nothing else.\n\n## Decision Boundaries\n\nThe executor picks the file names.\n');
    write(root, `${rel}/design.md`, DESIGN);
    write(root, `${rel}/acceptance.md`, ACCEPTANCE);
    write(root, `${rel}/tasks.md`, TASKS);
    write(root, `${rel}/specs/reader/spec.md`, DELTA);
    withIntentLock(root, (token) => createManifest(root, dir(), 'demo', {}, token));
    gitCommit(root);
  });
  const done = () => cleanup(root);

  /** The three reviews the high lane needs, all naming the contract as it stands right now. */
  const approveHighLane = () => {
    const d = digest();
    for (const [id, role, verdict] of [['R-1', 'planner', 'DRAFT'], ['R-2', 'architect', 'CLEAR'], ['R-3', 'critic', 'OKAY']]) {
      const file = json('review', { id, role, verdict, contractDigest: d, actorId: `${role}-1`, writerActorId: 'writer-1' });
      assert.equal(spec('review', 'record', 'demo', '--file', file).status, 0, `${id} was refused`);
    }
    return d;
  };
  const passResult = (over = {}) => ({
    verdict: 'PASS',
    criteria: [
      { id: 'AC-01', status: 'VERIFIED', modes: ['automated'], evidenceRefs: ['node --test test/reader.test.mjs'] },
      { id: 'AC-02', status: 'VERIFIED', modes: ['automated'], evidenceRefs: ['node --test test/writer.test.mjs'] },
    ],
    commands: ['node --test'],
    origin: { kind: 'native-agent', actorId: 'verifier-1', writerActorId: 'writer-1', sourceRef: 'agent:my-flow:verifier#run-1' },
    ...over,
  });
  const report = (verdict) => {
    const p = join(root, 'report.md');
    writeFileSync(p, `# Verification report\n\n### Verdict: ${verdict}\n\nEvery check named in the acceptance map was run.\n`);
    return p;
  };

  it('walks plan, review, execution, amendment, evidence and archive without losing a link', () => {
    // ---- the graph the plan describes is derived, and it is valid (AC-01, AC-02, AC-03)
    assert.equal(spec('validate', 'demo').status, 0);
    const inspected = specJson('inspect', 'demo').json;
    assert.deepEqual(inspected.tasks.map((t) => t.id), ['T-01', 'T-02', 'T-03']);
    assert.deepEqual(inspected.diagnostics, []);
    const t2 = inspected.tasks.find((t) => t.id === 'T-02');
    assert.deepEqual(t2.outgoing.filter((r) => r.field === 'depends-on').map((r) => r.id), ['T-01']);
    assert.equal(t2.readiness, 'waiting', 'T-02 waits on a prerequisite that is not done');
    assert.equal(inspected.tasks.find((t) => t.id === 'T-03').readiness, 'ready', 'an independent task is ready');

    // ---- the base every delta claim is written against, captured before anything reviews it:
    // spec-base.json is part of the contract, so capturing it later would move the digest
    // out from under the reviews that named it (AC-07)
    assert.equal(spec('baseline', 'demo').status, 0);
    assert.equal(spec('conflicts', 'demo').status, 0);

    // ---- risk decides the review, and recording the lane is not approving it (AC-10)
    assert.equal(spec('lane', 'set', 'demo', '--lane', 'high', '--reason', 'it changes the on-disk format').status, 0);
    assert.equal(spec('lane', 'status', 'demo').status, 1);
    const approved = approveHighLane();
    const laneOk = specJson('lane', 'status', 'demo');
    assert.equal(laneOk.status, 0);
    assert.equal(laneOk.json.via, 'direct');

    // ---- the session binds to the change, and the packet it gets is complete (AC-09, AC-10)
    assert.equal(spec('stage', 'demo', 'execute').status, 0);
    const lease = specJson('session', 'show').json;
    assert.equal(lease.current.lease.changeId, readManifest(dir()).id);
    const packet = specJson('context', 'demo', '--task', 'T-02').json.packet;
    assert.deepEqual(packet.tasks.map((t) => t.id), ['T-01', 'T-02']);
    assert.deepEqual(packet.acceptance.map((c) => c.id), ['AC-01', 'AC-02', 'AC-03'], 'a task lane still sees every criterion');
    assert.match(packet.constraints.doNotTouch, /Nothing outside src\//);

    // ---- ticking a box is bookkeeping: the contract it was verified against does not move (AC-08)
    write(root, `${rel}/tasks.md`, readText(join(root, rel, 'tasks.md')).replace('- [ ] 1.1', '- [x] 1.1'));
    assert.equal(digest(), approved, 'a ticked box never invalidates a review');
    assert.equal(specJson('lane', 'status', 'demo').json.approved, true);

    // ---- a cause that defeats two different approaches goes to design review (AC-04)
    const finding = (attempt, tasks_) => json('finding', { id: 'F-1', cause: 'the rename is not atomic on this filesystem', ...(tasks_ ? { tasks: tasks_ } : {}), attempt });
    assert.equal(spec('finding', 'record', 'demo', '--file', finding({ approach: 'retry the rename', outcome: 'failed' }, ['T-02'])).status, 0);
    const escalated = runSpecJson(root, ['finding', 'record', 'demo', '--file', finding({ approach: 'write through a temporary file and fsync', outcome: 'failed' }), '--session', SESSION]);
    assert.equal(escalated.status, 1, 'the next attempt waits for a reviewer');
    assert.equal(escalated.json.escalation.lane, 'design');
    assert.match(tasks().get('T-02').blocked, /F-1 needs design review/);
    assert.equal(tasks().get('T-03').blocked, null, 'an independent task is still runnable');
    assert.equal(tasks().get('T-01').checked, true, 'and verified work stays verified');

    // ---- the reviewer's remedy is a locator correction, staged and then applied (AC-04)
    const fixReview = json('review', { id: 'R-4', role: 'architect', verdict: 'CLEAR', contractDigest: digest(), actorId: 'architect-1', writerActorId: 'writer-1' });
    assert.equal(spec('review', 'record', 'demo', '--file', fixReview).status, 0);
    assert.equal(spec('finding', 'resolve', 'demo', '--id', 'F-1', '--review', 'R-4', '--remedy', 'serialize the writer behind the repository lock').status, 0);
    assert.equal(tasks().get('T-02').blocked, null, 'resolving the finding releases exactly its own hold');

    const before = digest();
    const candidate = json('amend', {
      id: 'A-1',
      type: 'locator',
      cause: 'the named writer suite moved into a folder',
      authority: { kind: 'executor-locator', actorId: 'executor-1' },
      oldDigest: before,
      changed: { acceptance: ['AC-02'] },
      files: { [`${rel}/acceptance.md`]: ACCEPTANCE.replace('`test/writer.test.mjs`', '`test/writer/suite.test.mjs`') },
    });
    assert.equal(spec('amend', 'propose', 'demo', '--file', candidate).status, 0);
    assert.equal(spec('evidence', 'begin', 'demo').status, 1, 'no attempt opens while the contract is mid-revision');
    assert.equal(spec('amend', 'apply', 'demo', '--id', 'A-1').status, 0);
    write(root, 'test/writer/suite.test.mjs', '// the check AC-02 now names\n');

    // ---- approval survives the applied amendment, through the chain and not by forgetting (AC-10)
    const chained = specJson('lane', 'status', 'demo');
    assert.equal(chained.status, 0);
    assert.equal(chained.json.via, 'chain');
    assert.deepEqual(chained.json.chain, ['A-1']);
    assert.notEqual(chained.json.digest, before, 'the contract really did change');

    // ---- evidence is bound to exact inputs, and a claim in a mode nobody exercised is refused (AC-05, AC-06)
    write(root, `${rel}/tasks.md`, readText(join(root, rel, 'tasks.md')).replace('- [ ] 1.2', '- [x] 1.2').replace('- [ ] 1.3', '- [x] 1.3'));
    const begun = specJson('evidence', 'begin', 'demo');
    assert.equal(begun.status, 0, begun.stderr + begun.stdout);
    assert.equal(begun.json.sequence, 1);

    const wrongMode = json('result', passResult({ criteria: [{ id: 'AC-01', status: 'VERIFIED', modes: [], evidenceRefs: ['x'] }, { id: 'AC-02', status: 'VERIFIED', modes: ['automated'], evidenceRefs: ['y'] }] }));
    const refused = spec('evidence', 'record', 'demo', '--attempt', 'V-1', '--result', wrongMode, '--report', report('PASS'));
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /evidence mode\(s\) automated that this attempt did not cover/);

    const unqualified = json('result', passResult({ origin: { kind: 'native-agent', actorId: 'writer-1', writerActorId: 'writer-1', sourceRef: 'agent:self' } }));
    const sameActor = spec('evidence', 'record', 'demo', '--attempt', 'V-1', '--result', unqualified, '--report', report('PASS'));
    assert.notEqual(sameActor.status, 0);
    assert.match(sameActor.stderr, /a PASS needs independent provenance/);

    assert.equal(spec('evidence', 'record', 'demo', '--attempt', 'V-1', '--result', json('result', passResult()), '--report', report('PASS')).status, 0);
    const status = specJson('evidence', 'status', 'demo');
    assert.equal(status.status, 0);
    assert.equal(status.json.eligible, true);
    assert.equal(status.json.head.verdict, 'PASS');

    // ---- what the work cost, as reported, with its unknowns intact (AC-11)
    const usage = json('usage', { eventId: 'evt-1', source: 'claude-code', actorId: 'writer-1', stage: 'execute', attemptId: 'V-1', outcome: 'succeeded', accountingScope: 'self', inputTokens: 1200, outputTokens: 300, cachedInputTokens: 500, started: '2026-01-01T10:00:00Z', finished: '2026-01-01T10:20:00Z' });
    assert.equal(spec('usage', 'import', 'demo', '--file', usage).status, 0);
    const measured = specJson('usage', 'demo').json;
    assert.equal(measured.scopes.self.tokens.inputTokens.value, 1200);
    assert.equal(measured.scopes.self.tokens.reasoningTokens.value, null, 'a field the host never reported stays unknown');

    // ---- changed source after the verified attempt is drift, not a smaller PASS (AC-06)
    write(root, 'src/reader.mjs', 'export const read = () => [1];\n');
    gitCommit(root);
    const drifted = spec('archive', 'demo');
    assert.notEqual(drifted.status, 0);
    assert.match(drifted.stderr, /source changed after the verified attempt/);

    // ---- a fresh attempt against the current inputs, and only then the publication (AC-07)
    assert.equal(specJson('evidence', 'begin', 'demo').json.sequence, 2);
    assert.equal(spec('evidence', 'record', 'demo', '--attempt', 'V-2', '--result', json('result', passResult()), '--report', report('PASS')).status, 0);
    const archived = specJson('archive', 'demo');
    assert.equal(archived.status, 0, archived.stderr);
    assert.equal(archived.json.verification, 'verified-v2');
    const merged = readText(join(root, 'specs', 'reader', 'spec.md'));
    assert.match(merged, /### Requirement: The reader parses the fixture/);
    assert.match(merged, /<!-- via: \d{4}-\d{2}-\d{2}-demo -->/, 'the requirement points back at the change that produced it');
    assert.equal(existsSync(join(root, 'changes', 'demo')), false, 'the change left the active set');

    // ---- and the legacy change beside it never moved (AC-12)
    assert.equal(readText(join(root, 'changes', 'legacy', 'tasks.md')), '- [x] 1.1 An older task and verify it\n- [ ] 1.2 Another older task and verify it\n');
    assert.equal(runSpec(root, ['validate', 'legacy']).status, 0);
    const legacy = runSpecJson(root, ['inspect', 'legacy']).json;
    assert.equal(legacy.schemaVersion, 1);
    assert.deepEqual(legacy.tasks.map((t) => t.readiness), ['complete', 'unknown'], 'a legacy task has unknown prerequisites, never invented ones');
    done();
  });
});

/**
 * This repository's own plan, checked against itself. A plan that claims a check nobody wrote, or
 * a criterion no task claims, is not a plan anyone can verify — and these are exactly the claims
 * an executor is most tempted to leave stale.
 */
describe('the acceptance map of this change points at things that exist', () => {
  const dir = join(ROOT, 'changes', 'linked-evidence-workflow');
  const rel = 'changes/linked-evidence-workflow';
  const intent = () => readChangeIntentDir(dir, 'linked-evidence-workflow', { rel });

  it('names a real file for every check it writes as a path', () => {
    const missing = [];
    for (const c of intent().acceptance.criteria) {
      // the prose parts of a checks line are deliberate; only the ones shaped like paths are claims
      for (const m of String(c.checks ?? '').matchAll(/`([A-Za-z0-9_.\/-]+\.(?:mjs|cjs|js|json|md))`/g)) {
        if (!existsSync(join(ROOT, m[1]))) missing.push(`${c.id} -> ${m[1]}`);
      }
    }
    assert.deepEqual(missing, [], 'an acceptance criterion names a check that does not exist');
  });

  it('is claimed end to end: every criterion has a task, and every task a criterion', () => {
    const i = intent();
    const claimed = new Set();
    const unlinked = [];
    for (const node of i.graph.nodes.values()) {
      const accepts = node.task.accepts ?? [];
      if (!accepts.length) unlinked.push(node.id);
      accepts.forEach((id) => claimed.add(id));
    }
    assert.deepEqual(unlinked, [], 'every task names the criterion it satisfies');
    const unclaimed = i.acceptance.criteria.filter((c) => !claimed.has(c.id)).map((c) => c.id);
    assert.deepEqual(unclaimed, [], 'every criterion is claimed by at least one task');
  });

  it('has no structural error, and one notice that names an authorised hold', () => {
    const i = intent();
    assert.deepEqual(i.diagnostics.filter((d) => d.severity === 'error'), []);
    const notices = i.diagnostics.filter((d) => d.severity !== 'error');
    for (const n of notices) assert.equal(n.code, 'checked-with-unfinished-prerequisite', n.message);
  });

  it('never ticks a blocked task, and never holds one without saying why', () => {
    const i = intent();
    for (const node of i.graph.nodes.values()) {
      if (!node.task.blocked) continue;
      assert.ok(node.task.blocked.trim().length > 20, `${node.id} is blocked without a usable reason`);
      assert.equal(node.task.checked, false, `${node.id} is ticked while it carries a blocker`);
    }
  });

  it('links every live-host task to a required live-evidence criterion', () => {
    const i = intent();
    for (const id of ['T-29', 'T-31', 'T-28']) {
      const node = i.graph.nodes.get(id);
      assert.ok(node, `${id} is missing from the plan`);
      assert.ok(
        i.acceptance.criteria.some((criterion) =>
          (node.task.accepts ?? []).includes(criterion.id)
          && criterion.required
          && (criterion.evidenceModes ?? []).includes('live')
        ),
        `${id} has no required acceptance criterion demanding live evidence`,
      );
    }
  });
});
