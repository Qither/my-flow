/**
 * Verification targets (contract C-03). Covers AC-06 (a report belongs to exact inputs, and
 * changed inputs require new verification) and AC-08 (bookkeeping — a ticked box, an evidence
 * link, a relocation — never invalidates an otherwise unchanged target).
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { after, beforeEach, describe, it } from 'node:test';
import { acceptanceTarget, affectedTasks, amendmentState, applyAmendment, applyHold, beginAttempt, canonicalJson, cancelAmendment, cancelAttempt, captureTarget, compareTargets, currentContractDigest, digestOf, escalationFor, evaluateResult, evidenceStatus, implementationInventory, isGitRoot, proposeAmendment, qualifiedOrigin, recordAttempt, recordFinding, recordReview, removeHold, reopenTasks, resolveFinding, sha256Hex, withoutViaMarkers } from '../scripts/lib/evidence.mjs';
import { runTransaction, withIntentLock } from '../scripts/lib/intent-io.mjs';
import { parseAcceptanceMarkdown, parseDesignMarkdown, parseTasksMarkdown } from '../scripts/lib/intent-graph.mjs';
import { createManifest, readManifest } from '../scripts/lib/intent-state.mjs';
import { cleanup, gitInit, makeTmp, readText, runSpec, runSpecJson, write } from './helpers.mjs';

const git = (dir, ...args) => {
  const r = spawnSync('git', args, { cwd: dir, encoding: 'utf8', windowsHide: true, timeout: 20000 });
  assert.equal(r.status, 0, `git ${args.join(' ')}: ${r.stderr}`);
  return r.stdout;
};
const commit = (dir, message = 'work') => git(dir, '-c', 'user.email=t@e', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--no-verify', '-m', message);

/** A change with a complete v2 contract, in a Git repository with one committed source file. */
function project(prefix) {
  const root = makeTmp(prefix);
  gitInit(root);
  write(root, 'src/app.mjs', 'export const answer = 42;\n');
  write(root, 'src/util.mjs', 'export const id = (x) => x;\n');
  write(root, 'changes/demo/proposal.md', '## Why\n\nBecause.\n');
  write(root, 'changes/demo/design.md', '## Context\n\nFixture.\n\n### D-01 — A decision\n\nBody.\n');
  write(root, 'changes/demo/acceptance.md', '### AC-01 — One\n\n- evidence-mode: automated\n- checks: test/x.test.mjs\n');
  write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n');
  write(root, 'specs/cap/spec.md', '# cap\n\n## Requirements\n\n### Requirement: Existing\n<!-- via: 2026-01-01-old -->\n\nIt exists.\n');
  withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', {}, token));
  git(root, 'add', '-A');
  commit(root, 'fixture');
  return root;
}
const capture = (root, inputs = {}) => captureTarget(root, { dir: join(root, 'changes', 'demo'), rel: 'changes/demo', inputs });
const paths = (target) => target.implementation.records.map((r) => r.path);

describe('canonical JSON and digests', () => {
  it('sorts object keys and keeps array order, because array order is meaning', () => {
    assert.equal(canonicalJson({ b: 1, a: 2 }), '{"a":2,"b":1}');
    assert.equal(digestOf({ a: 1, b: 2 }), digestOf({ b: 2, a: 1 }));
    assert.notEqual(digestOf(['a', 'b']), digestOf(['b', 'a']));
    assert.equal(canonicalJson({ a: undefined, b: 1 }), '{"b":1}');
    assert.equal(canonicalJson(null), 'null');
  });
});

describe('the implementation inventory', () => {
  let root;
  beforeEach(() => {
    root = project('ev-impl');
  });
  after(() => cleanup(root));

  it('covers tracked, staged, unstaged, untracked and deleted files, and nothing from the intent layer', () => {
    write(root, 'src/staged.mjs', 'staged\n');
    git(root, 'add', 'src/staged.mjs');
    writeFileSync(join(root, 'src', 'app.mjs'), 'export const answer = 43;\n'); // unstaged edit
    write(root, 'src/untracked.mjs', 'untracked\n');
    rmSync(join(root, 'src', 'util.mjs'));

    const inv = implementationInventory(root);
    const byPath = new Map(inv.records.map((r) => [r.path, r]));
    assert.ok(byPath.has('src/staged.mjs'), 'a staged addition is in the target');
    assert.ok(byPath.has('src/untracked.mjs'), 'a non-ignored untracked file is in the target');
    assert.equal(byPath.get('src/util.mjs').type, 'deleted', 'a deleted tracked file is explicit, never absent');
    assert.equal(byPath.get('src/util.mjs').hash, null);
    assert.equal(byPath.get('src/app.mjs').hash, sha256Hex('export const answer = 43;\n'), 'working-tree bytes, not the staged ones');
    for (const p of inv.records.map((r) => r.path)) {
      assert.equal(/^(\.git|\.my-flow|changes|specs|docs\/changes)\//.test(p), false, `${p} belongs to the acceptance target`);
    }
    assert.deepEqual([...inv.records].map((r) => r.path), [...inv.records].map((r) => r.path).sort(), 'records are sorted by code point');
    assert.equal(inv.git.dirty, true);
    assert.match(inv.git.head, /^[0-9a-f]{40}$/);
  });

  it('does not implicitly verify an ignored file, and includes one that is declared', () => {
    write(root, '.gitignore', 'secrets/\n');
    write(root, 'secrets/build.env', 'KEY=value\n');
    git(root, 'add', '.gitignore');
    commit(root, 'ignore');

    assert.equal(paths({ implementation: implementationInventory(root) }).includes('secrets/build.env'), false);
    const declared = implementationInventory(root, { declaredInputs: [{ kind: 'path', path: 'secrets/build.env' }] });
    const record = declared.records.find((r) => r.path === 'secrets/build.env');
    assert.ok(record, 'a declared ignored input is captured');
    assert.equal(record.declared, true);
    assert.deepEqual(declared.declared, ['secrets/build.env']);
  });

  it('refuses a declared input that does not exist', () => {
    assert.throws(
      () => implementationInventory(root, { declaredInputs: [{ kind: 'path', path: 'secrets/absent.env' }] }),
      (e) => e.code === 'missing-declared-input'
    );
  });

  it('refuses an undeclared submodule instead of silently omitting it', () => {
    const other = makeTmp('ev-sub');
    try {
      gitInit(other);
      write(other, 'lib.mjs', 'export const x = 1;\n');
      git(other, 'add', '-A');
      commit(other, 'sub');
      const r = spawnSync('git', ['-c', 'protocol.file.allow=always', 'submodule', 'add', '--quiet', other.replace(/\\/g, '/'), 'vendor/lib'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 30000 });
      if (r.status !== 0) return; // some Git builds refuse local submodules outright; nothing to assert
      commit(root, 'add submodule');
      assert.throws(() => implementationInventory(root), (e) => e.code === 'unsupported-input' && /vendor\/lib/.test(e.message));
      const ok = implementationInventory(root, { declaredInputs: [{ kind: 'repository', path: 'vendor/lib' }] });
      assert.equal(ok.records.some((x) => x.path === 'vendor/lib'), false, 'a declared submodule is its own snapshot, not a file record');
    } finally {
      cleanup(other);
    }
  });

  it('refuses a non-Git root unless an explicit inventory is approved', () => {
    const plain = makeTmp('ev-plain');
    try {
      write(plain, 'src/a.mjs', 'a\n');
      assert.equal(isGitRoot(plain), false);
      assert.throws(() => implementationInventory(plain), (e) => e.code === 'unsupported-input');
      const inv = implementationInventory(plain, { allowNonGit: true });
      assert.deepEqual(inv.records.map((r) => r.path), ['src/a.mjs']);
      assert.equal(inv.git, null);
    } finally {
      cleanup(plain);
    }
  });

  it('refuses unresolved merge conflicts', () => {
    write(root, 'src/app.mjs', 'main\n');
    git(root, 'add', '-A');
    commit(root, 'main side');
    git(root, 'checkout', '-q', '-b', 'other', 'HEAD~1');
    write(root, 'src/app.mjs', 'other\n');
    git(root, 'add', '-A');
    commit(root, 'other side');
    const merge = spawnSync('git', ['merge', '--no-commit', 'main'], { cwd: root, encoding: 'utf8', windowsHide: true, timeout: 20000 });
    if (merge.status === 0) return; // no conflict produced on this Git; nothing to assert
    assert.throws(() => implementationInventory(root), (e) => e.code === 'unresolved-conflict');
  });
});

describe('the acceptance target', () => {
  let root;
  beforeEach(() => {
    root = project('ev-accept');
  });
  after(() => cleanup(root));

  const target = () => acceptanceTarget(root, join(root, 'changes', 'demo'), 'changes/demo');

  it('captures every contract document and a semantic record of every task', () => {
    const t = target();
    for (const f of ['proposal.md', 'design.md', 'acceptance.md', 'change.json']) {
      assert.ok(`changes/demo/${f}` in t.documents, `${f} is part of the contract`);
    }
    assert.equal('changes/demo/tasks.md' in t.documents, false, 'tasks.md is represented by its semantic record, not its raw text');
    assert.deepEqual(t.tasks, [{ id: 'T-01', number: '1.1', title: 'do it and verify it', kind: 'work', dependsOn: [], accepts: ['AC-01'], design: ['D-01'] }]);
    assert.equal(t.identity.slug, 'demo');
    assert.equal('stage' in t.identity, false, 'lifecycle stage is not part of what a report claims');
    assert.equal('revision' in t.identity, false);
  });

  it('ignores only the generated via marker when comparing requirement text', () => {
    assert.equal(withoutViaMarkers('### Requirement: X\n<!-- via: 2026-01-01-old -->\n\nBody.\n'), '### Requirement: X\n\nBody.\n');
    assert.equal(withoutViaMarkers('<!-- an ordinary comment -->\nBody.\n'), '<!-- an ordinary comment -->\nBody.\n', 'an ordinary comment is contract text');
  });

  it('refuses a declared supporting contract file that does not exist', () => {
    assert.throws(
      () => acceptanceTarget(root, join(root, 'changes', 'demo'), 'changes/demo', { supportingContractPaths: ['docs/contract.md'] }),
      (e) => e.code === 'missing-contract-input'
    );
  });
});

describe('what may and may not invalidate a target (AC-08)', () => {
  let root;
  let before_;
  beforeEach(() => {
    root = project('ev-drift');
    before_ = capture(root);
  });
  after(() => cleanup(root));

  const stillClean = (why) => {
    const r = compareTargets(before_, capture(root));
    assert.deepEqual(r.drift, [], why);
    assert.equal(r.clean, true);
  };
  const drifted = (kind, path) => {
    const r = compareTargets(before_, capture(root));
    assert.equal(r.clean, false);
    assert.ok(r.drift.some((d) => d.kind === kind && (path === undefined || d.path === path)), `expected ${kind} ${path ?? ''}, got ${JSON.stringify(r.drift)}`);
  };

  it('is unchanged by ticking a box', () => {
    write(root, 'changes/demo/tasks.md', '- [x] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n');
    stillClean('a ticked box is bookkeeping, not a changed promise');
  });

  it('is unchanged by adding an evidence link or a blocker annotation', () => {
    write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n  - evidence: V-1\n  - blocked: waiting for a host\n');
    stillClean('evidence and blocked annotations are bookkeeping');
  });

  it('is unchanged by a lifecycle stage change or a new verification head', () => {
    const dir = join(root, 'changes', 'demo');
    const m = readManifest(dir);
    writeFileSync(join(dir, 'change.json'), JSON.stringify({ ...m, stage: 'execute', revision: 9, updated: new Date().toISOString(), verification: { highWater: 3, head: { sequence: 3, state: 'open' } } }, null, 2) + '\n');
    stillClean('lifecycle and verification metadata are not part of the claim');
  });

  it('is unchanged by writing a report, a log or scratch output', () => {
    write(root, '.my-flow/verify/demo-report.md', '# report\n\n### Verdict: PASS\n');
    write(root, 'changes/demo/verify/V-1/report.md', '# attempt\n');
    stillClean('an attempt output is never an input to itself');
  });

  it('is invalidated by a changed task title, check, dependency or kind', () => {
    for (const [replacement, why] of [
      ['- [ ] 1.1 do it and verify it differently\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n', 'a changed check'],
      ['- [ ] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: T-99\n  - accepts: AC-01\n  - design: D-01\n', 'a changed dependency'],
      ['- [ ] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n  - kind: closeout\n', 'a changed kind'],
    ]) {
      write(root, 'changes/demo/tasks.md', replacement);
      const r = compareTargets(before_, capture(root));
      assert.equal(r.clean, false, why);
      assert.ok(r.drift.some((d) => d.kind === 'task-contract-changed' || d.kind === 'contract-changed'), why);
    }
  });

  it('is invalidated by a source edit, a new file, a deletion and a mode change', () => {
    writeFileSync(join(root, 'src', 'app.mjs'), 'export const answer = 43;\n');
    drifted('source-changed', 'src/app.mjs');
    before_ = capture(root);
    write(root, 'src/new.mjs', 'new\n');
    drifted('source-added', 'src/new.mjs');
    before_ = capture(root);
    rmSync(join(root, 'src', 'new.mjs'));
    drifted('source-removed', 'src/new.mjs');
  });

  it('is invalidated by a changed constraint document', () => {
    write(root, 'changes/demo/design.md', '## Context\n\nFixture, reworded.\n\n### D-01 — A decision\n\nBody.\n');
    drifted('contract-changed', 'changes/demo/design.md');
  });

  it('is invalidated by a changed acceptance criterion', () => {
    write(root, 'changes/demo/acceptance.md', '### AC-01 — One\n\n- evidence-mode: manual\n- checks: read it by hand\n');
    drifted('contract-changed', 'changes/demo/acceptance.md');
  });

  it('treats a CRLF rewrite of the contract as no change, and a real byte change in source as one', () => {
    write(root, 'changes/demo/proposal.md', '## Why\r\n\r\nBecause.\r\n');
    stillClean('contract text is compared LF-normalized');
    writeFileSync(join(root, 'src', 'util.mjs'), 'export const id = (x) => x;\r\n');
    drifted('source-changed', 'src/util.mjs');
  });

  it('records a required environment fact and notices when it changes', () => {
    const withEnv = capture(root, { requiredEnvironment: ['node'] });
    assert.equal(withEnv.environment.node, process.version);
    assert.deepEqual(withEnv.unknownRequired, []);
    const pretend = { ...withEnv, environment: { ...withEnv.environment, node: 'v0.0.0' } };
    assert.ok(compareTargets(withEnv, pretend).drift.some((d) => d.kind === 'environment-changed' && d.path === 'node'));
  });

  it('reports a required environment fact it could not read as unknown, never as a value', () => {
    const t = capture(root, { declaredTools: [{ name: 'nonexistent-tool', command: 'definitely-not-a-real-binary-xyz' }], requiredEnvironment: ['nonexistent-tool'] });
    assert.equal(t.environment.tools['nonexistent-tool'], 'unknown');
    assert.deepEqual(t.unknownRequired, ['nonexistent-tool']);
  });
});

describe('symlinks and case collisions', () => {
  let root;
  beforeEach(() => {
    root = project('ev-links');
  });
  after(() => cleanup(root));

  const trySymlink = (target, linkPath) => {
    try {
      symlinkSync(target, join(root, linkPath));
      return true;
    } catch {
      return false; // Windows without developer mode; the rule is still enforced, just not observable here
    }
  };

  it('hashes a link by its target text, not by the bytes it points at', () => {
    if (!trySymlink('app.mjs', 'src/alias.mjs')) return;
    const inv = implementationInventory(root);
    const link = inv.records.find((r) => r.path === 'src/alias.mjs');
    assert.ok(link, 'the link is in the target');
    assert.equal(link.type, 'symlink');
    assert.equal(link.hash, sha256Hex('app.mjs'));
    assert.notEqual(link.hash, inv.records.find((r) => r.path === 'src/app.mjs').hash);
  });

  it('refuses a link that leaves the repository', () => {
    const outside = makeTmp('ev-outside');
    try {
      write(outside, 'secret.txt', 'not ours\n');
      if (!trySymlink(join(outside, 'secret.txt'), 'src/escape.mjs')) return;
      assert.throws(() => implementationInventory(root), (e) => e.code === 'link-escapes-root' && /src\/escape\.mjs/.test(e.message));
    } finally {
      cleanup(outside);
    }
  });

  it('refuses two records that differ only in case', () => {
    write(root, 'src/Case.mjs', 'one\n');
    git(root, 'add', '-A');
    commit(root, 'case one');
    // a second spelling recorded in the index; on Windows the two are one file, and the pair lies
    const r = spawnSync('git', ['update-index', '--add', '--cacheinfo', '100644', git(root, 'hash-object', '-w', join(root, 'src', 'Case.mjs')).trim(), 'src/case.mjs'], {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 20000,
    });
    if (r.status !== 0) return;
    assert.throws(() => implementationInventory(root), (e) => e.code === 'case-collision');
  });
});

// ---------------------------------------------------------------- immutable attempts (T-10, AC-05/06/08)
const REQUIRED = [{ id: 'AC-01', modes: ['automated'] }];
const goodOrigin = { kind: 'native-agent', actorId: 'verifier-1', writerActorId: 'writer-1', sourceRef: 'agent:my-flow:verifier#run-7' };
const passResult = (over = {}) => ({
  verdict: 'PASS',
  criteria: [{ id: 'AC-01', status: 'VERIFIED', modes: ['automated'], evidenceRefs: ['commands[0]'] }],
  commands: [{ command: 'node --test test/x.test.mjs', exitCode: 0, summary: '1 passing', logHash: null }],
  origin: goodOrigin,
  ...over,
});
const report = (verdict = 'PASS') => `# Verification report\n\n### Verdict: ${verdict}\n\nEverything named in the acceptance map was run.\n`;
const lock = (root, fn) => withIntentLock(root, fn);
const begin = (root, opts = {}) => lock(root, (token) => beginAttempt(root, { dir: join(root, 'changes', 'demo'), rel: 'changes/demo', inputs: {}, requiredCriteria: REQUIRED, ...opts }, token));
const record = (root, sequence, result, reportText = report(result.verdict), artifacts = []) =>
  lock(root, (token) => recordAttempt(root, { dir: join(root, 'changes', 'demo'), rel: 'changes/demo', sequence, result, reportText, artifacts, requiredCriteria: REQUIRED }, token));
const status = (root) => evidenceStatus(root, { dir: join(root, 'changes', 'demo'), rel: 'changes/demo' });
const head = (root) => readManifest(join(root, 'changes', 'demo')).verification.head;

describe('opening an attempt', () => {
  let root;
  beforeEach(() => {
    root = project('ev-begin');
  });
  after(() => cleanup(root));

  it('reserves the durable high-water mark before the directory exists, then opens it', () => {
    const r = begin(root);
    assert.equal(r.sequence, 1);
    const m = readManifest(join(root, 'changes', 'demo'));
    assert.equal(m.verification.highWater, 1);
    assert.equal(m.verification.head.state, 'open');
    assert.equal(m.verification.head.requestDigest, r.requestDigest);
    assert.ok(existsSync(join(r.dir, 'request.json')));
    assert.ok(existsSync(join(r.dir, 'target.json')));
    assert.ok(existsSync(join(r.dir, 'contract')));
    assert.equal(r.request.requiredCriteria[0].id, 'AC-01');
    assert.match(r.request.implementationDigest, /^[0-9a-f]{64}$/);
  });

  it('never reuses or lowers a sequence, and never derives it from a timestamp', () => {
    record(root, begin(root).sequence, passResult());
    const second = begin(root);
    assert.equal(second.sequence, 2);
    assert.equal(readManifest(join(root, 'changes', 'demo')).verification.highWater, 2);
    record(root, 2, passResult());
    assert.equal(begin(root).sequence, 3);
  });

  it('refuses to start when a required environment input cannot be read', () => {
    assert.throws(
      () => begin(root, { inputs: { declaredTools: [{ name: 'ghost', command: 'definitely-not-a-real-binary-xyz' }], requiredEnvironment: ['ghost'] } }),
      (e) => e.code === 'unknown-required-environment'
    );
    assert.equal(readManifest(join(root, 'changes', 'demo')).verification.highWater, 0, 'a refusal reserves nothing');
  });

  it('refuses an input scope that is not the reviewed one', () => {
    write(root, 'changes/demo/verification-inputs.json', JSON.stringify({ supportingContractPaths: ['docs/contract.md'] }, null, 2) + '\n');
    write(root, 'docs/contract.md', '# contract\n');
    assert.throws(() => begin(root, { inputs: {} }), (e) => e.code === 'input-scope-mismatch');
    const ok = begin(root, { inputs: { supportingContractPaths: ['docs/contract.md'] } });
    assert.equal(ok.sequence, 1);
  });

  it('requires a stable identity', () => {
    const legacy = makeTmp('ev-legacy');
    try {
      gitInit(legacy);
      write(legacy, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n');
      assert.throws(
        () => withIntentLock(legacy, (token) => beginAttempt(legacy, { dir: join(legacy, 'changes', 'demo'), rel: 'changes/demo', inputs: {}, requiredCriteria: [] }, token)),
        (e) => e.code === 'no-identity'
      );
    } finally {
      cleanup(legacy);
    }
  });
});

describe('coverage: what a PASS must actually have', () => {
  let root;
  beforeEach(() => {
    root = project('ev-cover');
    begin(root);
  });
  after(() => cleanup(root));

  const refuses = (result, code, reportText) => assert.throws(() => record(root, 1, result, reportText ?? report(result.verdict)), (e) => e.code === code, `expected ${code}`);

  it('refuses a PASS that omits a required criterion', () => {
    refuses(passResult({ criteria: [] }), 'verdict-mismatch');
    assert.deepEqual(evaluateResult({ criteria: [] }, REQUIRED).problems, ['required criterion AC-01 is not in the result']);
  });

  it('refuses a PASS whose required criterion is PARTIAL or MISSING', () => {
    for (const st of ['PARTIAL', 'MISSING']) {
      const e = evaluateResult({ criteria: [{ id: 'AC-01', status: st, modes: ['automated'], evidenceRefs: ['x'] }] }, REQUIRED);
      assert.equal(e.verdict, 'INCOMPLETE');
      assert.match(e.problems[0], new RegExp(`is ${st}`));
    }
    refuses(passResult({ criteria: [{ id: 'AC-01', status: 'PARTIAL', modes: ['automated'], evidenceRefs: ['x'] }] }), 'verdict-mismatch');
  });

  it('calls contradicted behaviour FAIL, not INCOMPLETE', () => {
    const e = evaluateResult({ criteria: [{ id: 'AC-01', status: 'CONTRADICTED', modes: ['automated'], evidenceRefs: ['x'] }] }, REQUIRED);
    assert.equal(e.verdict, 'FAIL');
  });

  it('refuses static-only evidence for a criterion that also declares a live mode', () => {
    const required = [{ id: 'AC-01', modes: ['static', 'live'] }];
    const e = evaluateResult({ criteria: [{ id: 'AC-01', status: 'VERIFIED', modes: ['static'], evidenceRefs: ['x'] }] }, required);
    assert.equal(e.verdict, 'INCOMPLETE');
    assert.match(e.problems[0], /evidence mode\(s\) live that this attempt did not cover/);
  });

  it('refuses a VERIFIED criterion that names no evidence', () => {
    const e = evaluateResult({ criteria: [{ id: 'AC-01', status: 'VERIFIED', modes: ['automated'], evidenceRefs: [] }] }, REQUIRED);
    assert.equal(e.verdict, 'INCOMPLETE');
    assert.match(e.problems[0], /names no evidence/);
  });

  it('refuses a report header that disagrees with the result', () => {
    refuses(passResult(), 'report-verdict-mismatch', report('INCOMPLETE'));
    refuses(passResult(), 'report-verdict-mismatch', '# report with no verdict line\n');
  });

  it('refuses a PASS whose verifier is the writer, or whose provenance is missing', () => {
    refuses(passResult({ origin: { ...goodOrigin, actorId: 'same', writerActorId: 'same' } }), 'unqualified-origin');
    refuses(passResult({ origin: { ...goodOrigin, sourceRef: null } }), 'unqualified-origin');
    refuses(passResult({ origin: { ...goodOrigin, kind: 'imported' } }), 'unqualified-origin');
    refuses(passResult({ origin: null }), 'unqualified-origin');
    assert.deepEqual(qualifiedOrigin(goodOrigin), { qualified: true, reasons: [] });
  });

  it('records a FAIL or an INCOMPLETE without demanding independent provenance', () => {
    const r = record(root, 1, { verdict: 'FAIL', criteria: [{ id: 'AC-01', status: 'CONTRADICTED', modes: ['automated'], evidenceRefs: ['x'] }], commands: [], origin: null }, report('FAIL'));
    assert.equal(r.verdict, 'FAIL');
    assert.equal(r.qualified, false);
    assert.ok(r.originProblems.length, 'the reason it is unqualified is recorded, not hidden');
  });

  for (const [coverage, verdict, accepted] of [
    ['VERIFIED', 'PASS', true], ['VERIFIED', 'INCOMPLETE', true], ['VERIFIED', 'FAIL', true],
    ['PARTIAL', 'PASS', false], ['PARTIAL', 'INCOMPLETE', true], ['PARTIAL', 'FAIL', true],
    ['CONTRADICTED', 'PASS', false], ['CONTRADICTED', 'INCOMPLETE', false], ['CONTRADICTED', 'FAIL', true],
  ]) {
    it(`${accepted ? 'preserves' : 'refuses'} overall verdict ${verdict} with required AC ${coverage}`, () => {
      const result = passResult({ verdict, criteria: [
        { id: 'AC-01', status: coverage, modes: ['automated'], evidenceRefs: ['commands[0]'] },
        { id: 'Do-Not-Touch', status: verdict === 'INCOMPLETE' ? 'PARTIAL' : verdict === 'FAIL' ? 'CONTRADICTED' : 'VERIFIED', modes: ['static'], evidenceRefs: ['design-constraint-check'] },
      ] });
      const text = report(verdict) + '\nThe overall verdict also accounts for the mandatory design constraint.\n';
      if (!accepted) {
        refuses(result, 'verdict-mismatch', text);
        assert.equal(head(root).state, 'open', 'a refused verdict does not close the attempt');
        return;
      }
      const stored = record(root, 1, result, text);
      assert.equal(stored.verdict, verdict);
      assert.deepEqual(stored.criteria, result.criteria, 'neither acceptance coverage nor the design observation is softened');
      assert.equal(head(root).verdict, verdict);
      assert.equal(readFileSync(join(root, 'changes/demo/verify/V-1/report.md'), 'utf8'), text);
      if (verdict !== 'PASS') {
        assert.equal(status(root).eligible, false);
        assert.match(status(root).reasons.join('; '), new RegExp(`V-1 is ${verdict}`));
      }
      assert.throws(() => record(root, 1, passResult()), (e) => e.code === 'attempt-closed');
    });
  }

  it('refuses unknown overall verdict values', () => {
    for (const verdict of ['MAYBE', 'constructor', null]) refuses(passResult({ verdict }), 'verdict-mismatch');
  });

  it('keeps optional observations outside the declared required coverage', () => {
    const result = passResult({ criteria: [...passResult().criteria,
      { id: 'optional-observation', status: 'PARTIAL', modes: ['static'], evidenceRefs: ['optional-note'] },
    ] });
    assert.equal(evaluateResult(result, REQUIRED).verdict, 'PASS');
    assert.equal(record(root, 1, result).verdict, 'PASS');
  });
});

describe('recording is immutable, and the head is authoritative', () => {
  let root;
  beforeEach(() => {
    root = project('ev-record');
  });
  after(() => cleanup(root));

  it('writes the verbatim report and a matching result, and closes the head once', () => {
    const { sequence, dir } = begin(root);
    const text = report('PASS');
    const r = record(root, sequence, passResult(), text);
    assert.equal(readFileSync(join(dir, 'report.md'), 'utf8').replace(/\r\n/g, '\n'), text, 'the report is stored verbatim');
    assert.equal(r.reportHash, sha256Hex(text));
    const h = head(root);
    assert.equal(h.state, 'closed');
    assert.equal(h.verdict, 'PASS');
    assert.equal(h.resultDigest, digestOf(JSON.parse(readFileSync(join(dir, 'result.json'), 'utf8'))));
    assert.equal(status(root).eligible, true);
  });

  it('refuses a second result for the same attempt', () => {
    const { sequence } = begin(root);
    record(root, sequence, passResult());
    assert.throws(() => record(root, sequence, passResult()), (e) => e.code === 'attempt-closed');
  });

  it('refuses to record against a sequence that is not the head', () => {
    begin(root);
    assert.throws(() => record(root, 7, passResult()), (e) => e.code === 'head-mismatch');
  });

  it('copies artifacts inside the attempt and never records their source path', () => {
    const { sequence, dir } = begin(root);
    write(root, 'scratch-log.txt', 'the full command log\n');
    const r = record(root, sequence, passResult(), report('PASS'), [{ sourcePath: 'scratch-log.txt', relativePath: 'logs/run.txt' }]);
    assert.deepEqual(r.artifacts.map((a) => a.relativePath), ['logs/run.txt']);
    assert.equal(r.artifacts[0].hash, sha256Hex('the full command log\n'));
    assert.equal('sourcePath' in r.artifacts[0], false, 'the original location is never served');
    assert.equal(readFileSync(join(dir, 'artifacts', 'logs', 'run.txt'), 'utf8'), 'the full command log\n');
  });

  it('refuses an artifact destination that escapes the attempt', () => {
    const { sequence } = begin(root);
    write(root, 'scratch-log.txt', 'x\n');
    for (const bad of ['../escape.txt', '/abs.txt', 'a/../../b.txt', '']) {
      assert.throws(() => record(root, sequence, passResult(), report('PASS'), [{ sourcePath: 'scratch-log.txt', relativePath: bad }]), (e) => e.code === 'bad-artifact-path', bad);
    }
  });
});

describe('interrupted attempts and missing directories', () => {
  let root;
  beforeEach(() => {
    root = project('ev-interrupt');
  });
  after(() => cleanup(root));

  /** An eligible PASS at V-1, so every later failure can be checked against it. */
  const passAtOne = () => {
    record(root, begin(root).sequence, passResult());
    assert.equal(status(root).eligible, true);
  };

  it('a reserved head with no directory blocks the older PASS, and only cancel can close it', () => {
    passAtOne();
    // simulate a crash between the reservation and the directory publication
    const dir = join(root, 'changes', 'demo');
    const m = readManifest(dir);
    writeFileSync(join(dir, 'change.json'), JSON.stringify({ ...m, verification: { highWater: 2, head: { sequence: 2, state: 'reserved', requestDigest: null, resultDigest: null, verdict: null, started: new Date().toISOString(), finished: null } } }, null, 2) + '\n');

    const s = status(root);
    assert.equal(s.eligible, false);
    assert.match(s.reasons.join('; '), /V-2 is reserved/);
    assert.match(s.reasons.join('; '), /result\.json is absent/);
    assert.throws(() => record(root, 2, passResult()), (e) => e.code === 'missing-attempt');

    const cancelled = lock(root, (token) => cancelAttempt(root, { dir, rel: 'changes/demo', sequence: 2, reason: 'the session was interrupted' }, token));
    assert.equal(cancelled.verdict, 'INCOMPLETE');
    assert.equal(head(root).state, 'closed');
    assert.equal(readManifest(dir).verification.highWater, 2, 'cancel never lowers the high-water mark');
    const after_ = status(root);
    assert.equal(after_.eligible, false, 'the old PASS is not restored by cancelling the newer attempt');
    assert.match(after_.reasons.join('; '), /V-2 is INCOMPLETE/);
  });

  it('an open head blocks the older PASS until it is recorded or cancelled', () => {
    passAtOne();
    begin(root);
    const s = status(root);
    assert.equal(s.eligible, false);
    assert.match(s.reasons.join('; '), /V-2 is open/);
  });

  it('removing the whole newest attempt directory never falls back to the older PASS', () => {
    passAtOne();
    const second = begin(root);
    record(root, second.sequence, passResult());
    assert.equal(status(root).eligible, true);
    rmSync(second.dir, { recursive: true, force: true });
    const s = status(root);
    assert.equal(s.eligible, false);
    assert.match(s.reasons.join('; '), /V-2\/result\.json is absent/);
    assert.equal(/V-1/.test(s.reasons.join('; ')), false, 'the older attempt is never scanned for a verdict');
  });

  it('a corrupted result, a tampered report and a mismatched digest all block', () => {
    const { sequence, dir } = begin(root);
    record(root, sequence, passResult());
    assert.equal(status(root).eligible, true);

    writeFileSync(join(dir, 'report.md'), '### Verdict: PASS\n\nreworded after the fact\n');
    assert.match(status(root).reasons.join('; '), /does not match its recorded hash/);

    writeFileSync(join(dir, 'result.json'), '{ not json');
    assert.match(status(root).reasons.join('; '), /not readable JSON/);
  });

  it('missing verification metadata and a head beyond the high-water mark are corruption', () => {
    const dir = join(root, 'changes', 'demo');
    const m = readManifest(dir);
    writeFileSync(join(dir, 'change.json'), JSON.stringify({ ...m, verification: undefined }, null, 2) + '\n');
    const missing = status(root);
    assert.equal(missing.corrupt, true);
    assert.equal(missing.eligible, false);
    assert.match(missing.reasons[0], /never repaired by scanning for an older PASS/);

    writeFileSync(join(dir, 'change.json'), JSON.stringify({ ...m, verification: { highWater: 1, head: { sequence: 5, state: 'closed', verdict: 'PASS' } } }, null, 2) + '\n');
    const beyond = status(root);
    assert.equal(beyond.corrupt, true);
    assert.match(beyond.reasons[0], /beyond the high-water mark/);
  });

  it('diagnoses an older attempt whose directory is gone without changing the verdict', () => {
    const first = begin(root);
    record(root, first.sequence, passResult());
    const second = begin(root);
    record(root, second.sequence, passResult());
    rmSync(first.dir, { recursive: true, force: true });
    const s = status(root);
    assert.deepEqual(s.missingOlder, ['V-1']);
    assert.equal(s.eligible, true, 'the head is what decides, and the head is intact');
  });

  it('lets the closeout checkbox stay open while an attempt runs', () => {
    write(root, 'changes/demo/tasks.md', '- [ ] 1.1 do it and verify it\n  - id: T-01\n  - depends-on: none\n  - accepts: AC-01\n  - design: D-01\n- [ ] 1.2 close out and verify the gate\n  - id: T-02\n  - depends-on: T-01\n  - kind: closeout\n');
    const { sequence } = begin(root);
    const r = record(root, sequence, passResult());
    assert.equal(r.verdict, 'PASS', 'an open closeout box does not block the attempt itself');
    assert.equal(status(root).eligible, true);
  });
});

// ---------------------------------------------------------------- amendments (T-19, AC-04/AC-05)
describe('holding and releasing tasks', () => {
  const TASKS = [
    '- [x] 1.1 first and verify a',
    '  - id: T-A',
    '  - depends-on: none',
    '  - evidence: V-1',
    '- [ ] 1.2 second and verify b',
    '  - id: T-B',
    '  - depends-on: T-A',
    '  - blocked: waiting for a decision',
    '- [x] 1.3 independent and verify c',
    '  - id: T-C',
    '  - depends-on: none',
    '',
  ].join('\n');

  it('reopens an affected ticked box and appends the hold to an existing blocker', () => {
    const held = applyHold(TASKS, new Set(['T-A', 'T-B']), 'A-1');
    const parsed = parseTasksMarkdown(held);
    const byId = new Map(parsed.tasks.map((t) => [t.id, t]));
    assert.deepEqual(parsed.diagnostics, [], 'the result is still a valid ledger');
    assert.equal(byId.get('T-A').checked, false, 'a held task is reopened');
    assert.equal(byId.get('T-A').blocked, 'amendment A-1 pending');
    assert.equal(byId.get('T-B').blocked, 'waiting for a decision; amendment A-1 pending', 'an earlier blocker is kept');
    assert.equal(byId.get('T-C').checked, true, 'an unaffected task is untouched');
  });

  it('is idempotent, and releases only its own hold', () => {
    const once = applyHold(TASKS, new Set(['T-A', 'T-B']), 'A-1');
    assert.equal(applyHold(once, new Set(['T-A', 'T-B']), 'A-1'), once);
    const released = removeHold(once, 'A-1');
    const byId = new Map(parseTasksMarkdown(released).tasks.map((t) => [t.id, t]));
    assert.equal(byId.get('T-B').blocked, 'waiting for a decision', 'the earlier blocker survives');
    assert.equal(byId.get('T-A').blocked, null, 'a blocker that was only the hold is removed entirely');
    assert.equal(byId.get('T-A').checked, false, 'releasing a hold never re-ticks a box');
  });

  it('drops the evidence links of the tasks it reopens, and only those', () => {
    const reopened = reopenTasks(TASKS, new Set(['T-A']));
    const byId = new Map(parseTasksMarkdown(reopened).tasks.map((t) => [t.id, t]));
    assert.equal(byId.get('T-A').checked, false);
    assert.equal(byId.get('T-A').evidence, null, 'evidence for a contract that changed is not evidence');
    assert.equal(byId.get('T-C').checked, true);
  });
});

describe('the affected set', () => {
  const intentOf = (text) => ({ tasks: parseTasksMarkdown(text), acceptance: parseAcceptanceMarkdown(''), design: parseDesignMarkdown('') });
  const CHAIN = ['- [ ] 1.1 a and verify it', '  - id: T-A', '  - depends-on: none', '- [ ] 1.2 b and verify it', '  - id: T-B', '  - depends-on: T-A', '- [ ] 1.3 c and verify it', '  - id: T-C', '  - depends-on: T-B', '- [ ] 1.4 d and verify it', '  - id: T-D', '  - depends-on: none', ''].join('\n');

  it('includes every descendant of a changed task, and nothing independent', () => {
    const affected = affectedTasks(intentOf(CHAIN), ['T-A']);
    assert.deepEqual([...affected].sort(), ['T-A', 'T-B', 'T-C']);
    assert.equal(affected.has('T-D'), false);
  });

  it('includes descendants under the candidate dependencies as well as the current ones', () => {
    const candidate = CHAIN.replace('  - id: T-D\n  - depends-on: none', '  - id: T-D\n  - depends-on: T-A');
    const affected = affectedTasks(intentOf(CHAIN), ['T-A'], candidate);
    assert.deepEqual([...affected].sort(), ['T-A', 'T-B', 'T-C', 'T-D'], 'a dependency the candidate adds counts too');
  });
});

describe('the amendment lifecycle', () => {
  let root;
  const rel = 'changes/demo';
  const where = () => ({ dir: join(root, 'changes', 'demo'), rel });
  const CONTRACT_TASKS = [
    '- [x] 1.1 build the thing and verify the unit suite passes',
    '  - id: T-A',
    '  - depends-on: none',
    '  - accepts: AC-01',
    '  - evidence: V-1',
    '- [ ] 1.2 depend on it and verify the integration suite passes',
    '  - id: T-B',
    '  - depends-on: T-A',
    '  - accepts: AC-01',
    '- [ ] 1.3 do something independent and verify it separately',
    '  - id: T-C',
    '  - depends-on: none',
    '  - accepts: AC-02',
    '',
  ].join('\n');
  const ACCEPTANCE = ['### AC-01 — The thing works', '', '- evidence-mode: automated', '- checks: test/unit.test.mjs', '', '### AC-02 — The other thing works', '', '- evidence-mode: automated', '- checks: test/other.test.mjs', ''].join('\n');

  beforeEach(() => {
    root = makeTmp('amend');
    gitInit(root);
    write(root, 'src/app.mjs', 'export const answer = 42;\n');
    write(root, `${rel}/proposal.md`, '## Why\n\nBecause.\n');
    write(root, `${rel}/design.md`, '### D-01 — A decision\n\nBody.\n');
    write(root, `${rel}/acceptance.md`, ACCEPTANCE);
    write(root, `${rel}/tasks.md`, CONTRACT_TASKS);
    withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', { stage: 'execute' }, token));
  });
  const done = () => cleanup(root);

  const propose = (candidate) =>
    withIntentLock(root, (token) => {
      const planned = proposeAmendment(root, { ...where(), candidate }, token);
      runTransaction(root, { purpose: 'propose', steps: planned.steps }, token);
      return planned.record;
    });
  const apply = (id) =>
    withIntentLock(root, (token) => {
      const planned = applyAmendment(root, { ...where(), id }, token);
      runTransaction(root, { purpose: 'apply', steps: planned.steps }, token);
      return planned;
    });
  const cancel = (id) =>
    withIntentLock(root, (token) => {
      const planned = cancelAmendment(root, { ...where(), id, reason: 'not needed after all' }, token);
      runTransaction(root, { purpose: 'cancel', steps: planned.steps }, token);
      return planned;
    });
  const review = (r) => withIntentLock(root, (token) => recordReview(root, { ...where(), review: r }, token));
  const tasks = () => new Map(parseTasksMarkdown(readText(join(root, rel, 'tasks.md'))).tasks.map((t) => [t.id, t]));
  const digest = () => currentContractDigest(root, join(root, 'changes', 'demo'), rel);

  const EQUIVALENT = () => ({
    id: 'A-1',
    type: 'equivalent-check',
    cause: 'the named unit suite was split in two; the guarantee is unchanged',
    findingId: 'F-1',
    changed: { acceptance: ['AC-01'] },
    files: { [`${rel}/acceptance.md`]: ACCEPTANCE.replace('- checks: test/unit.test.mjs', '- checks: test/unit-a.test.mjs and test/unit-b.test.mjs') },
  });

  it('holds the affected tasks and leaves the approved contract and the rest of the plan alone', () => {
    const before = digest();
    const record = propose(EQUIVALENT());
    assert.deepEqual(record.affected, ['T-A', 'T-B'], 'the criterion is referenced by T-A, and T-B depends on it');
    assert.equal(digest(), before, 'the canonical contract text is unchanged while a candidate is staged');
    const t = tasks();
    assert.equal(t.get('T-A').checked, false);
    assert.equal(t.get('T-A').blocked, 'amendment A-1 pending');
    assert.equal(t.get('T-B').blocked, 'amendment A-1 pending');
    assert.equal(t.get('T-C').blocked, null, 'an unaffected task may still be worked on');
    assert.match(readText(join(root, rel, 'acceptance.md')), /checks: test\/unit\.test\.mjs/, 'the live criterion still says what it said');
    assert.match(readText(join(root, rel, 'amendments', 'A-1', 'candidate', 'acceptance.md')), /unit-a/);
    assert.match(readText(join(root, rel, 'amendments', 'A-1', 'old', 'acceptance.md')), /test\/unit\.test\.mjs/);
    done();
  });

  it('refuses a second pending amendment, a stale candidate and a file outside the change', () => {
    propose(EQUIVALENT());
    assert.throws(() => propose({ ...EQUIVALENT(), id: 'A-2' }), (e) => e.code === 'amendment-pending');
    cancel('A-1');
    assert.throws(() => propose({ ...EQUIVALENT(), id: 'A-3', oldDigest: 'f'.repeat(64) }), (e) => e.code === 'stale-candidate');
    assert.throws(() => propose({ ...EQUIVALENT(), id: 'A-4', files: { 'specs/cap/spec.md': 'x' } }), (e) => e.code === 'bad-amendment');
    done();
  });

  it('refuses to apply without the authority its type requires', () => {
    propose(EQUIVALENT());
    assert.throws(() => apply('A-1'), (e) => e.code === 'unauthorised-amendment' && /independent critic review/.test(e.message));
    // a review by the writer is not an independent review
    review({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'same', writerActorId: 'same', amendment: 'A-1', contractDigest: digest(), sourceRef: 'agent:critic#1' });
    assert.throws(() => apply('A-1'), (e) => e.code === 'unauthorised-amendment');
    done();
  });

  it('applies a reviewed candidate, reopens the affected tasks and drops their evidence', () => {
    propose(EQUIVALENT());
    review({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'critic-1', writerActorId: 'writer-1', amendment: 'A-1', contractDigest: digest(), sourceRef: 'agent:critic#1' });
    const before = digest();
    const r = apply('A-1');
    assert.deepEqual(r.affected, ['T-A', 'T-B']);
    assert.notEqual(digest(), before, 'the approved contract is now the candidate');
    assert.match(readText(join(root, rel, 'acceptance.md')), /unit-a/);
    const t = tasks();
    assert.equal(t.get('T-A').checked, false, 'work verified against the old contract is not complete under the new one');
    assert.equal(t.get('T-A').evidence, null);
    assert.equal(t.get('T-A').blocked, null, 'the hold is released');
    assert.equal(t.get('T-C').checked, false);
    assert.equal(amendmentState(join(root, 'changes', 'demo')).pending, null);
    assert.equal(amendmentState(join(root, 'changes', 'demo')).all[0].state, 'applied');
    done();
  });

  it('refuses to apply a candidate whose base moved while it was pending', () => {
    propose(EQUIVALENT());
    review({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'critic-1', writerActorId: 'writer-1', amendment: 'A-1', contractDigest: digest(), sourceRef: 'agent:critic#1' });
    write(root, `${rel}/design.md`, '### D-01 — A decision\n\nSomebody reworded this.\n');
    assert.throws(() => apply('A-1'), (e) => e.code === 'contract-drift');
    done();
  });

  it('cancels without restoring a reopened box and without changing the contract', () => {
    const before = digest();
    propose(EQUIVALENT());
    cancel('A-1');
    assert.equal(digest(), before);
    const t = tasks();
    assert.equal(t.get('T-A').checked, false, 'a reopened box stays open until the work is verified again');
    assert.equal(t.get('T-A').blocked, null);
    assert.equal(amendmentState(join(root, 'changes', 'demo')).all[0].state, 'cancelled');
    assert.throws(() => apply('A-1'), (e) => e.code === 'amendment-closed');
    done();
  });

  it('accepts a locator correction on recorded executor authority alone', () => {
    propose({
      id: 'A-1',
      type: 'locator',
      cause: 'the module moved; no guarantee or check changed',
      changed: { design: ['D-01'] },
      authority: { kind: 'executor-locator', actorId: 'executor-1' },
      files: { [`${rel}/design.md`]: '### D-01 — A decision\n\nBody, now pointing at src/app.mjs.\n' },
    });
    const r = apply('A-1');
    assert.match(readText(join(root, rel, 'design.md')), /src\/app\.mjs/);
    assert.deepEqual(r.affected, [], 'no task references D-01, so nothing was held');
    done();
  });

  it('needs both user scope authority and an independent review for a scope change', () => {
    const scope = { id: 'A-1', type: 'scope', cause: 'the guarantee itself is narrowed', changed: { acceptance: ['AC-02'] }, files: { [`${rel}/acceptance.md`]: ACCEPTANCE.replace('- evidence-mode: automated\n- checks: test/other.test.mjs', '- evidence-mode: manual\n- checks: read it by hand') } };
    propose(scope);
    assert.throws(() => apply('A-1'), (e) => /user scope authority/.test(e.message) && /independent review/.test(e.message));
    done();
  });

  it('blocks a verification attempt while an amendment is pending', () => {
    propose(EQUIVALENT());
    assert.throws(
      () => withIntentLock(root, (token) => beginAttempt(root, { ...where(), inputs: {}, requiredCriteria: [] }, token)),
      (e) => e.code === 'amendment-pending'
    );
    done();
  });

  it('keeps reviews immutable and names a reviewer who is also the writer', () => {
    const r = review({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'a', writerActorId: 'b', contractDigest: digest(), sourceRef: 'x' });
    assert.equal(r.independent, true);
    assert.throws(() => review({ id: 'R-1', role: 'critic', verdict: 'OKAY', actorId: 'a', writerActorId: 'b', contractDigest: digest() }), (e) => e.code === 'review-exists');
    const same = review({ id: 'R-2', role: 'critic', verdict: 'OKAY', actorId: 'a', writerActorId: 'a', contractDigest: digest() });
    assert.equal(same.independent, false);
    assert.throws(() => review({ id: 'R-3', role: 'nobody', verdict: 'OKAY', contractDigest: digest() }), (e) => e.code === 'bad-review');
    assert.throws(() => review({ id: 'R-4', role: 'critic', verdict: 'OKAY', contractDigest: 'short' }), (e) => e.code === 'bad-review');
    done();
  });
});

// ---------------------------------------------------------------- repeated root causes (T-20, AC-04/AC-10)
describe('findings route a repeated cause to design review', () => {
  let root;
  const rel = 'changes/demo';
  const where = () => ({ dir: join(root, 'changes', 'demo'), rel });
  const TASKS = [
    '- [ ] 1.1 make the writer atomic and verify the crash fixture recovers',
    '  - id: T-A',
    '  - depends-on: none',
    '  - accepts: AC-01',
    '- [ ] 1.2 depend on the writer and verify the integration fixture',
    '  - id: T-B',
    '  - depends-on: T-A',
    '  - accepts: AC-01',
    '- [ ] 1.3 do something unrelated and verify it separately',
    '  - id: T-C',
    '  - depends-on: none',
    '  - accepts: AC-02',
    '  - blocked: waiting for a fixture',
    '',
  ].join('\n');

  beforeEach(() => {
    root = makeTmp('finding');
    gitInit(root);
    write(root, `${rel}/proposal.md`, '## Why\n\nBecause.\n');
    write(root, `${rel}/tasks.md`, TASKS);
    write(root, `${rel}/acceptance.md`, '### AC-01 — One\n\n- evidence-mode: automated\n- checks: a check\n\n### AC-02 — Two\n\n- evidence-mode: automated\n- checks: another\n');
    write(root, `${rel}/design.md`, '### D-01 — A decision\n\nBody.\n');
    withIntentLock(root, (token) => createManifest(root, join(root, 'changes', 'demo'), 'demo', { stage: 'execute' }, token));
  });
  const done = () => cleanup(root);

  const record = (finding) =>
    withIntentLock(root, (token) => {
      const planned = recordFinding(root, { ...where(), finding }, token);
      runTransaction(root, { purpose: 'finding', steps: planned.steps }, token);
      return planned;
    });
  const resolve_ = (id, reviewId, remedy) =>
    withIntentLock(root, (token) => {
      const planned = resolveFinding(root, { ...where(), id, reviewId, remedy }, token);
      runTransaction(root, { purpose: 'resolve', steps: planned.steps }, token);
      return planned;
    });
  const review = (r) => withIntentLock(root, (token) => recordReview(root, { ...where(), review: r }, token));
  const tasks = () => new Map(parseTasksMarkdown(readText(join(root, rel, 'tasks.md'))).tasks.map((t) => [t.id, t]));

  it('does not escalate on one failure, nor on a second attempt at the same approach', () => {
    const first = record({ id: 'F-1', cause: 'the writer is not atomic on this filesystem', tasks: ['T-A'], attempt: { approach: 'retry the rename', outcome: 'failed' } });
    assert.equal(first.escalation.required, false);
    assert.match(first.escalation.reason, /a design review is due at two/);
    const second = record({ id: 'F-1', cause: 'the writer is not atomic on this filesystem', attempt: { approach: 'Retry the rename', outcome: 'failed' } });
    assert.equal(second.escalation.required, false, 'the same approach twice is one approach');
    assert.equal(second.escalation.distinct, 1);
    assert.equal(tasks().get('T-A').blocked, null, 'nothing is held yet');
    done();
  });

  it('escalates to design review after two materially different failures, and holds only its own tasks', () => {
    record({ id: 'F-1', cause: 'the writer is not atomic on this filesystem', tasks: ['T-A'], attempt: { approach: 'retry the rename', outcome: 'failed' } });
    const r = record({ id: 'F-1', cause: 'the writer is not atomic on this filesystem', attempt: { approach: 'write through a temporary file and fsync', outcome: 'failed' } });
    assert.equal(r.escalation.required, true);
    assert.equal(r.escalation.lane, 'design');
    assert.match(r.escalation.reason, /an architect or planner selects the remedy inside scope/);

    const t = tasks();
    assert.equal(t.get('T-A').blocked, 'F-1 needs design review before another attempt');
    assert.equal(t.get('T-B').blocked, null, 'a dependent task is not held by a finding; only the tasks the cause defeated are');
    assert.equal(t.get('T-C').blocked, 'waiting for a fixture', 'an unrelated blocker is untouched');
    assert.deepEqual(parseTasksMarkdown(readText(join(root, rel, 'tasks.md'))).diagnostics, [], 'the ledger is still valid');
    done();
  });

  it('never reopens a ticked box: a repeated failure is not an invalidated contract', () => {
    write(root, `${rel}/tasks.md`, TASKS.replace('- [ ] 1.1', '- [x] 1.1'));
    record({ id: 'F-1', cause: 'c', tasks: ['T-A'], attempt: { approach: 'one', outcome: 'failed' } });
    record({ id: 'F-1', cause: 'c', attempt: { approach: 'two', outcome: 'failed' } });
    assert.equal(tasks().get('T-A').checked, true, 'verified work stays verified; only the next attempt waits');
    done();
  });

  it('returns a trust-boundary remedy to full review instead of a design review', () => {
    record({ id: 'F-2', cause: 'the check can be satisfied without the guarantee', tasks: ['T-A'], trustBoundaryChanged: true, attempt: { approach: 'one', outcome: 'failed' } });
    const r = record({ id: 'F-2', cause: 'x', attempt: { approach: 'two', outcome: 'failed' } });
    assert.equal(r.escalation.lane, 'high');
    assert.match(r.escalation.reason, /planner, architect, critic/);
    assert.equal(tasks().get('T-A').blocked, 'F-2 needs full design review before another attempt');
    done();
  });

  it('resolves only through a recorded design review, and releases just its own note', () => {
    record({ id: 'F-1', cause: 'c', tasks: ['T-A', 'T-C'], attempt: { approach: 'one', outcome: 'failed' } });
    record({ id: 'F-1', cause: 'c', attempt: { approach: 'two', outcome: 'failed' } });
    assert.throws(() => resolve_('F-1', 'R-9'), (e) => e.code === 'no-such-review');
    review({ id: 'R-1', role: 'verifier', verdict: 'PASS', actorId: 'v', writerActorId: 'w', contractDigest: 'a'.repeat(64) });
    assert.throws(() => resolve_('F-1', 'R-1'), (e) => e.code === 'bad-review-role');
    review({ id: 'R-2', role: 'architect', verdict: 'CLEAR', actorId: 'arch', writerActorId: 'writer', contractDigest: 'a'.repeat(64) });
    const r = resolve_('F-1', 'R-2', 'serialize the writer behind the repository lock');
    assert.equal(r.record.resolvedBy, 'R-2');
    assert.equal(escalationFor(r.record).required, false);
    const t = tasks();
    assert.equal(t.get('T-A').blocked, null);
    assert.equal(t.get('T-C').blocked, 'waiting for a fixture', 'the unrelated blocker survives the release');
    done();
  });

  it('refuses a finding with no cause, no id or an attempt with no approach', () => {
    assert.throws(() => record({ id: 'F-1' }), (e) => e.code === 'bad-finding');
    assert.throws(() => record({ id: 'nope', cause: 'c' }), (e) => e.code === 'bad-finding');
    assert.throws(() => record({ id: 'F-1', cause: 'c', attempt: { outcome: 'failed' } }), (e) => e.code === 'bad-finding');
    done();
  });

  it('is reported through the CLI with a non-zero exit while another attempt must wait', () => {
    const file = join(root, 'finding.json');
    writeFileSync(file, JSON.stringify({ id: 'F-1', cause: 'the writer is not atomic', tasks: ['T-A'], attempt: { approach: 'one', outcome: 'failed' } }, null, 2));
    assert.equal(runSpec(root, ['finding', 'record', 'demo', '--file', file]).status, 0);
    writeFileSync(file, JSON.stringify({ id: 'F-1', cause: 'the writer is not atomic', attempt: { approach: 'two', outcome: 'failed' } }, null, 2));
    const second = runSpecJson(root, ['finding', 'record', 'demo', '--file', file]);
    assert.equal(second.status, 1, 'a script cannot miss that the next attempt waits for a reviewer');
    assert.equal(second.json.escalation.lane, 'design');
    const status = runSpecJson(root, ['finding', 'status', 'demo']);
    assert.equal(status.json.findings[0].escalation.required, true);
    done();
  });
});
