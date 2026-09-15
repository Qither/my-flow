/**
 * Context packets (contract C-07, design D-07). Covers AC-03 (a packet reports the same
 * structural diagnostics the graph does) and AC-10 (a repeat receives what changed, never a
 * thinner version of the contract itself).
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync, rmSync, utimesSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { DEFAULT_DETAIL_LIMIT, buildPacket, diffPackets, packetDir, persistPacket, prerequisiteClosure, readPersisted, renderPacket } from '../scripts/lib/context.mjs';
import { recordFinding, resolveFinding, recordReview } from '../scripts/lib/evidence.mjs';
import { readChangeIntentDir } from '../scripts/lib/intent-graph.mjs';
import { runTransaction, withIntentLock } from '../scripts/lib/intent-io.mjs';
import { createManifest } from '../scripts/lib/intent-state.mjs';
import { cleanup, gitInit, makeTmp, runSpec, runSpecJson, write } from './helpers.mjs';

const TASKS = [
  '- [x] 1.1 write scripts/lib/writer.mjs and verify the crash fixture recovers',
  '  - id: T-A',
  '  - depends-on: none',
  '  - accepts: AC-01',
  '  - design: D-01',
  '- [x] 1.2 build on the writer and verify the integration fixture',
  '  - id: T-B',
  '  - depends-on: T-A',
  '  - accepts: AC-01',
  '- [ ] 1.3 finish the feature and verify the end-to-end fixture',
  '  - id: T-C',
  '  - depends-on: T-B',
  '  - accepts: AC-02',
  '  - design: D-02',
  '- [ ] 1.4 do something unrelated and verify it separately',
  '  - id: T-D',
  '  - depends-on: none',
  '  - accepts: AC-03',
  '',
].join('\n');

const ACCEPTANCE = [
  '### AC-01 — The writer is atomic',
  '',
  '- evidence-mode: automated',
  '- required: true',
  '- checks: `test/writer.test.mjs`',
  '',
  'A reader never observes a half-written file.',
  '',
  '### AC-02 — The feature works end to end',
  '',
  '- evidence-mode: automated',
  '- required: true',
  '- checks: `test/e2e.test.mjs`',
  '',
  '### AC-03 — The unrelated thing works',
  '',
  '- evidence-mode: manual',
  '- required: false',
  '- checks: read the fixture',
  '',
].join('\n');

const DESIGN = [
  '## Context',
  '',
  'A fixture.',
  '',
  '## Do-Not-Touch',
  '',
  'Do not edit specs/** outside this change.',
  '',
  '## Rebuild / Re-run After Change',
  '',
  'Run `npm test`.',
  '',
  '### D-01 — Write through a temporary file',
  '',
  'Stage beside the destination, then rename.',
  '',
  '### D-02 — Keep the feature behind one entry point',
  '',
  'One module owns it.',
  '',
].join('\n');

const PROPOSAL = ['## Why', '', 'Because.', '', '## Non-Goals', '', '- No rewrite of the reader.', '', '## Decision Boundaries', '', 'The executor picks the file names.', ''].join('\n');

describe('context packets', () => {
  let root;
  const rel = 'changes/demo';
  const dir = () => join(root, 'changes', 'demo');
  const where = () => ({ dir: dir(), rel, slug: 'demo' });

  beforeEach(() => {
    root = makeTmp('context');
    gitInit(root);
    write(root, 'scripts/lib/writer.mjs', 'export const write = () => {};\n');
    write(root, 'test/writer.test.mjs', '// the named check\n');
    write(root, 'test/e2e.test.mjs', '// the other named check\n');
    write(root, `${rel}/proposal.md`, PROPOSAL);
    write(root, `${rel}/design.md`, DESIGN);
    write(root, `${rel}/acceptance.md`, ACCEPTANCE);
    write(root, `${rel}/tasks.md`, TASKS);
    withIntentLock(root, (token) => createManifest(root, dir(), 'demo', { stage: 'execute' }, token));
  });
  const done = () => cleanup(root);
  const build = (over = {}) => buildPacket(root, { ...where(), ...over });

  it('carries the selected task with its prerequisite closure, in the order it was assumed', () => {
    const packet = build({ taskId: 'T-C' });
    assert.deepEqual(
      packet.tasks.map((t) => t.id),
      ['T-A', 'T-B', 'T-C'],
      'a task cannot be judged without what it was allowed to assume'
    );
    assert.equal(packet.tasks.at(-1).selected, true);
    assert.equal(packet.tasks.some((t) => t.id === 'T-D'), false, 'an independent task is not context');
    assert.equal(packet.mode, 'task');
    done();
  });

  it('computes the closure from declared dependencies, never from numbering', () => {
    const intent = readChangeIntentDir(dir(), 'demo', { rel });
    assert.deepEqual(prerequisiteClosure(intent.graph, 'T-D'), ['T-D']);
    assert.deepEqual(prerequisiteClosure(intent.graph, 'T-A'), ['T-A']);
    done();
  });

  it('always carries the complete criteria index and the constraints in full', () => {
    const packet = build({ taskId: 'T-A' });
    assert.deepEqual(packet.acceptance.map((c) => c.id), ['AC-01', 'AC-02', 'AC-03'], 'a task lane never hides a criterion');
    assert.equal(packet.acceptance[2].required, false);
    assert.match(packet.constraints.doNotTouch, /Do not edit specs/);
    assert.match(packet.constraints.rebuild, /npm test/);
    assert.match(packet.constraints.nonGoals, /No rewrite of the reader/);
    assert.match(packet.constraints.decisionBoundaries, /picks the file names/);
    done();
  });

  it('copies only the blocks this lane references, verbatim from the documents that own them', () => {
    const packet = build({ taskId: 'T-B' });
    assert.deepEqual(Object.keys(packet.blocks.design), ['D-01'], 'T-B cites nothing; its prerequisite cites D-01');
    assert.deepEqual(Object.keys(packet.blocks.acceptance), ['AC-01']);
    assert.match(packet.blocks.design['D-01'], /^### D-01 — Write through a temporary file/);
    assert.match(packet.blocks.design['D-01'], /Stage beside the destination, then rename\./);
    assert.equal(packet.blocks.design['D-01'].includes('D-02'), false, 'a block ends where the next heading starts');
    done();
  });

  it('hashes every file locator it names, and reports one that is not there', () => {
    const packet = build({ taskId: 'T-A' });
    assert.deepEqual(packet.locators.map((l) => l.path), ['scripts/lib/writer.mjs', 'test/writer.test.mjs']);
    assert.match(packet.locators[0].hash, /^[0-9a-f]{64}$/);
    rmSync(join(root, 'test/writer.test.mjs'));
    const missing = build({ taskId: 'T-A' });
    assert.deepEqual(missing.locators.map((l) => l.path), ['scripts/lib/writer.mjs']);
    const d = missing.diagnostics.find((x) => x.code === 'missing-locator');
    assert.equal(d.path, 'test/writer.test.mjs');
    assert.match(d.message, /the locator moved or was never written/);
    done();
  });

  it('includes the open findings of this lane, and drops one that was resolved', () => {
    const record = (finding) =>
      withIntentLock(root, (token) => {
        const planned = recordFinding(root, { dir: dir(), rel, finding }, token);
        runTransaction(root, { purpose: 'finding', steps: planned.steps }, token);
      });
    record({ id: 'F-1', cause: 'the rename is not atomic here', tasks: ['T-A'], attempt: { approach: 'one', outcome: 'failed' } });
    record({ id: 'F-2', cause: 'unrelated', tasks: ['T-D'], attempt: { approach: 'one', outcome: 'failed' } });
    const packet = build({ taskId: 'T-B' });
    assert.deepEqual(packet.findings.map((f) => f.id), ['F-1'], 'the reason the next attempt is not a first one');
    assert.equal(packet.findings[0].escalation.required, false);

    withIntentLock(root, (token) => recordReview(root, { dir: dir(), rel, review: { id: 'R-1', role: 'architect', verdict: 'CLEAR', contractDigest: 'a'.repeat(64) } }, token));
    withIntentLock(root, (token) => {
      const planned = resolveFinding(root, { dir: dir(), rel, id: 'F-1', reviewId: 'R-1', remedy: 'serialize it' }, token);
      runTransaction(root, { purpose: 'resolve', steps: planned.steps }, token);
    });
    assert.deepEqual(build({ taskId: 'T-B' }).findings, []);
    done();
  });

  it('gives the final verifier every criterion and every task, with no lane filter', () => {
    const packet = build({});
    assert.equal(packet.mode, 'final');
    assert.equal(packet.taskId, null);
    assert.deepEqual(packet.tasks.map((t) => t.id), ['T-A', 'T-B', 'T-C', 'T-D']);
    assert.deepEqual(packet.acceptance.map((c) => c.id), ['AC-01', 'AC-02', 'AC-03']);
    assert.deepEqual(Object.keys(packet.blocks.design), ['D-01', 'D-02']);
    assert.ok(packet.locators.some((l) => l.path === 'test/e2e.test.mjs'));
    done();
  });

  it('replaces detail with a retrieval reference under pressure, never a required criterion', () => {
    write(root, `${rel}/design.md`, DESIGN.replace('One module owns it.', 'One module owns it. ' + 'x'.repeat(4000)));
    const packet = build({ detailLimit: 500 });
    assert.equal(packet.truncated.length > 0, true);
    assert.equal(packet.truncated[0].kind, 'design');
    assert.equal(packet.truncated[0].id, 'D-02', 'the longest block goes first');
    assert.match(packet.truncated[0].retrieve, /^changes\/demo\/design\.md:\d+-\d+$/);
    assert.equal(packet.truncated[0].path, 'changes/demo/design.md');
    assert.deepEqual(packet.acceptance.map((c) => c.id), ['AC-01', 'AC-02', 'AC-03'], 'the index survives the budget');
    assert.match(packet.constraints.doNotTouch, /Do not edit specs/);
    assert.match(renderPacket(packet), /D-02 not included \(\d+ bytes\)/);
    assert.equal(DEFAULT_DETAIL_LIMIT > 500, true);
    done();
  });

  it('reports a cycle in the closure and refuses a task it does not have', () => {
    write(root, `${rel}/tasks.md`, TASKS.replace('- [x] 1.1 write scripts/lib/writer.mjs and verify the crash fixture recovers\n  - id: T-A\n  - depends-on: none', '- [x] 1.1 write scripts/lib/writer.mjs and verify the crash fixture recovers\n  - id: T-A\n  - depends-on: T-C'));
    const packet = build({ taskId: 'T-C' });
    const cycle = packet.diagnostics.find((d) => d.code === 'cycle');
    assert.match(cycle.message, /the prerequisite closure runs through a cycle/);
    assert.equal(cycle.severity, 'error');
    assert.throws(() => build({ taskId: 'T-Z' }), (e) => e.code === 'no-such-task');
    done();
  });

  it('lives only in scratch, and is regenerated rather than trusted', () => {
    const packet = build({ taskId: 'T-A' });
    const path = persistPacket(root, 'demo', packet);
    assert.ok(path.startsWith(join(root, '.my-flow', 'context')));
    assert.ok(existsSync(join(packetDir(root, 'demo'))));
    assert.equal(existsSync(join(dir(), 'context')), false, 'nothing derived is written into the committed intent');
    assert.equal(readPersisted(root, 'demo', packet.inputsDigest).inputsDigest, packet.inputsDigest);
    assert.equal(readPersisted(root, 'demo', 'f'.repeat(64)), null);
    done();
  });
});

describe('what a repeat packet reports as changed', () => {
  let root;
  const rel = 'changes/demo';
  const dir = () => join(root, 'changes', 'demo');

  beforeEach(() => {
    root = makeTmp('context-since');
    gitInit(root);
    write(root, 'scripts/lib/writer.mjs', 'export const write = () => {};\n');
    write(root, 'test/writer.test.mjs', '// the named check\n');
    write(root, 'test/e2e.test.mjs', '// the other named check\n');
    write(root, `${rel}/proposal.md`, PROPOSAL);
    write(root, `${rel}/design.md`, DESIGN);
    write(root, `${rel}/acceptance.md`, ACCEPTANCE);
    write(root, `${rel}/tasks.md`, TASKS);
    withIntentLock(root, (token) => createManifest(root, dir(), 'demo', { stage: 'execute' }, token));
  });
  const done = () => cleanup(root);
  const build = (over = {}) => buildPacket(root, { dir: dir(), rel, slug: 'demo', ...over });

  it('compares the packet inputs, not the clock', () => {
    const first = build({ taskId: 'T-A' });
    persistPacket(root, 'demo', first);
    const old = new Date(Date.now() - 3600_000);
    utimesSync(join(root, rel, 'design.md'), old, old);
    const again = build({ taskId: 'T-A' });
    assert.equal(again.inputsDigest, first.inputsDigest, 'a touched file is not a changed input');
    assert.equal(diffPackets(readPersisted(root, 'demo', first.inputsDigest), again).unchanged, true);
    done();
  });

  it('names the block, the locator and the finding that moved', () => {
    const first = build({ taskId: 'T-A' });
    persistPacket(root, 'demo', first);
    write(root, `${rel}/design.md`, DESIGN.replace('then rename.', 'then rename, and fsync the directory.'));
    write(root, 'test/writer.test.mjs', '// the named check, rewritten\n');
    withIntentLock(root, (token) => {
      const planned = recordFinding(root, { dir: dir(), rel, finding: { id: 'F-1', cause: 'the rename is not atomic here', tasks: ['T-A'], attempt: { approach: 'one', outcome: 'failed' } } }, token);
      runTransaction(root, { purpose: 'finding', steps: planned.steps }, token);
    });
    const diff = diffPackets(readPersisted(root, 'demo', first.inputsDigest), build({ taskId: 'T-A' }));
    assert.equal(diff.known, true);
    assert.equal(diff.unchanged, false);
    const kinds = diff.changed.map((c) => `${c.kind}:${c.id}`);
    assert.ok(kinds.includes('block:design:D-01'), kinds.join(' '));
    assert.ok(kinds.includes('locator:test/writer.test.mjs'));
    assert.ok(kinds.includes('finding:F-1'));
    assert.ok(kinds.some((k) => k.startsWith('contract:')), 'the contract digest moved with the design');
    assert.deepEqual(diff.findings.map((f) => f.id), ['F-1'], 'a repeat always carries the open findings');
    done();
  });

  it('says a closure changed when the task graph did', () => {
    const first = build({ taskId: 'T-C' });
    persistPacket(root, 'demo', first);
    write(root, `${rel}/tasks.md`, TASKS.replace('  - id: T-C\n  - depends-on: T-B', '  - id: T-C\n  - depends-on: none'));
    const diff = diffPackets(readPersisted(root, 'demo', first.inputsDigest), build({ taskId: 'T-C' }));
    assert.ok(diff.changed.some((c) => c.kind === 'closure'));
    done();
  });

  it('refuses a --since digest it has never persisted, instead of answering as if nothing changed', () => {
    // AC-10 asks for a stale digest to be refused. Silently returning a full packet would read as
    // "nothing has changed since then" when the truth is "I have never seen that version".
    const first = build({ taskId: 'T-A' });
    persistPacket(root, 'demo', first);
    const stale = runSpec(root, ['context', 'demo', '--task', 'T-A', '--since', '0'.repeat(64)]);
    assert.equal(stale.status, 1);
    assert.match(stale.stderr, /no task packet for T-A has inputs digest 0{64}/);
    assert.equal(/Since the previous packet/.test(stale.stdout), false);

    const short = runSpec(root, ['context', 'demo', '--task', 'T-A', '--since', 'abc']);
    assert.equal(short.status, 1);
    assert.match(short.stderr, /at least 12 hex characters/);

    const ok = runSpecJson(root, ['context', 'demo', '--task', 'T-A', '--since', first.inputsDigest]);
    assert.equal(ok.status, 0);
    assert.equal(ok.json.diff.unchanged, true);
    done();
  });

  it('never answers a --since from another lane, however short the digest is', () => {
    const task = build({ taskId: 'T-A' });
    persistPacket(root, 'demo', task);
    const final = build({});
    persistPacket(root, 'demo', final);

    const cross = runSpec(root, ['context', 'demo', '--since', task.inputsDigest]);
    assert.equal(cross.status, 1, "a task packet is not a previous version of the final verifier's packet");
    assert.match(cross.stderr, /no final packet for the whole change/);

    assert.equal(readPersisted(root, 'demo', task.inputsDigest, { mode: 'final', taskId: null }), null);
    assert.equal(readPersisted(root, 'demo', task.inputsDigest, { mode: 'task', taskId: 'T-A' }).inputsDigest, task.inputsDigest);
    assert.throws(() => readPersisted(root, 'demo', 'abcd'), (e) => e.code === 'bad-since');
    done();
  });
  it('says so plainly when it has never seen the previous packet', () => {
    const diff = diffPackets(null, build({ taskId: 'T-A' }));
    assert.equal(diff.known, false);
    assert.equal(diff.unchanged, false);
    assert.deepEqual(diff.changed, []);
    done();
  });

  it('is driven from the CLI, in Markdown and in JSON, and exits non-zero on a structural error', () => {
    const md = runSpec(root, ['context', 'demo', '--task', 'T-C']);
    assert.equal(md.status, 0);
    assert.match(md.stdout, /# Context packet — demo \(T-C\)/);
    assert.match(md.stdout, /## Acceptance criteria \(complete\)/);
    assert.match(md.stdout, /- AC-03 \(optional\)/);

    const first = runSpecJson(root, ['context', 'demo', '--task', 'T-A']);
    assert.equal(first.status, 0);
    assert.match(first.json.path, /^\.my-flow\/context\/demo\//);
    assert.equal(first.json.diff.known, false);
    const repeat = runSpecJson(root, ['context', 'demo', '--task', 'T-A', '--since', first.json.packet.inputsDigest]);
    assert.equal(repeat.json.diff.unchanged, true);
    assert.match(repeat.stdout, /"unchanged": true/);

    write(root, `${rel}/tasks.md`, TASKS.replace('  - depends-on: T-B\n  - accepts: AC-02', '  - depends-on: T-NOPE\n  - accepts: AC-02'));
    const broken = runSpecJson(root, ['context', 'demo', '--task', 'T-C']);
    assert.equal(broken.status, 1);
    assert.ok(broken.json.packet.diagnostics.some((d) => d.code === 'unknown-dependency'));
    done();
  });

  it('renders the same packet a reader can act on without opening the change', () => {
    const text = renderPacket(build({}));
    assert.match(text, /## Constraints/);
    assert.match(text, /### Do-Not-Touch/);
    assert.match(text, /## Source locators/);
    assert.match(text, /## Open findings\n\n- none/);
    assert.match(text, /Scratch, not an authoritative summary/);
    assert.equal(readFileSync(join(root, rel, 'design.md'), 'utf8').includes('Stage beside the destination'), true);
    done();
  });
});
