/**
 * Usage records (contract C-07, design D-07). Covers AC-11: what a host reported is attributed to
 * the change, stage, attempt and actor that produced it — including work that failed — and every
 * measurement the source did not make stays an unknown instead of becoming a zero or a total.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { beforeEach, describe, it } from 'node:test';
import { compareUsage, effortMs, importUsage, listUsage, normalizeUsage, renderUsage, usageReport, wallTimeMs } from '../scripts/lib/usage.mjs';
import { runTransaction, withIntentLock } from '../scripts/lib/intent-io.mjs';
import { createManifest } from '../scripts/lib/intent-state.mjs';
import { cleanup, gitInit, makeTmp, runSpec, runSpecJson, write } from './helpers.mjs';

const event = (over = {}) => ({
  eventId: 'e-1',
  source: 'claude-code',
  actorId: 'writer-1',
  stage: 'execute',
  attemptId: 'V-1',
  outcome: 'succeeded',
  accountingScope: 'self',
  started: '2026-01-01T10:00:00.000Z',
  finished: '2026-01-01T10:10:00.000Z',
  inputTokens: 1000,
  outputTokens: 200,
  cachedInputTokens: 400,
  reasoningTokens: null,
  ...over,
});

describe('normalizing one reported event', () => {
  it('keeps every field the source did not report as null, never zero', () => {
    const r = normalizeUsage({ eventId: 'e-1', source: 'codex' });
    assert.equal(r.inputTokens, null);
    assert.equal(r.outputTokens, null);
    assert.equal(r.reasoningTokens, null);
    assert.equal(r.accountingScope, null);
    assert.equal(r.outcome, 'unknown');
    assert.equal(r.started, null);
  });

  it('refuses a payload it cannot attribute or cannot trust', () => {
    assert.throws(() => normalizeUsage({ source: 'x' }), (e) => e.code === 'bad-usage');
    assert.throws(() => normalizeUsage({ eventId: 'e-1' }), (e) => e.code === 'bad-usage');
    assert.throws(() => normalizeUsage(event({ inputTokens: -1 })), (e) => e.code === 'bad-usage');
    assert.throws(() => normalizeUsage(event({ inputTokens: 1.5 })), (e) => e.code === 'bad-usage');
    assert.throws(() => normalizeUsage(event({ accountingScope: 'partial' })), (e) => e.code === 'bad-usage');
    assert.throws(() => normalizeUsage(event({ outcome: 'mostly fine' })), (e) => e.code === 'bad-usage');
    assert.throws(() => normalizeUsage(event({ started: 'yesterday' })), (e) => e.code === 'bad-usage');
    assert.throws(() => normalizeUsage(event({ finished: '2026-01-01T09:00:00.000Z' })), (e) => e.code === 'bad-usage');
  });

  it('treats cached input as a subset of input, and refuses a payload where it is not', () => {
    assert.equal(normalizeUsage(event()).cachedInputTokens, 400);
    assert.throws(() => normalizeUsage(event({ cachedInputTokens: 2000 })), (e) => e.code === 'bad-usage' && /subset of inputTokens/.test(e.message));
    assert.equal(normalizeUsage(event({ inputTokens: null, cachedInputTokens: 400 })).cachedInputTokens, 400, 'a cached count with no input count is still what the source said');
  });
});

describe('wall time and effort', () => {
  const span = (id, from, to) => ({ eventId: id, started: from, finished: to });
  it('unions overlapping intervals for wall time and sums them for effort', () => {
    const records = [span('a', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z'), span('b', '2026-01-01T10:05:00Z', '2026-01-01T10:15:00Z')];
    assert.equal(wallTimeMs(records).ms, 15 * 60_000, 'two actors working at once take fifteen minutes, not twenty');
    assert.equal(effortMs(records).ms, 20 * 60_000, 'but they cost twenty minutes of effort');
  });

  it('adds disjoint intervals and leaves the gap out', () => {
    const records = [span('a', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z'), span('b', '2026-01-01T11:00:00Z', '2026-01-01T11:05:00Z')];
    assert.equal(wallTimeMs(records).ms, 15 * 60_000);
  });

  it('calls a union with a missing interval a lower bound, and no interval at all unknown', () => {
    const r = wallTimeMs([span('a', '2026-01-01T10:00:00Z', '2026-01-01T10:10:00Z'), { eventId: 'b', started: null, finished: null }]);
    assert.equal(r.lowerBound, true);
    assert.equal(r.missing, 1);
    assert.equal(wallTimeMs([{ eventId: 'b', started: null, finished: null }]).ms, null);
  });
});

describe('the usage report', () => {
  let root;
  const rel = 'changes/demo';
  const dir = () => join(root, 'changes', 'demo');

  beforeEach(() => {
    root = makeTmp('usage');
    gitInit(root);
    write(root, `${rel}/proposal.md`, '## Why\n\nBecause.\n');
    write(root, `${rel}/design.md`, '### D-01 — A decision\n\nBody.\n');
    write(root, `${rel}/acceptance.md`, '### AC-01 — One\n\n- evidence-mode: automated\n- checks: a check\n');
    write(root, `${rel}/tasks.md`, '- [ ] 1.1 do it and verify it\n  - id: T-A\n  - depends-on: none\n  - accepts: AC-01\n');
    withIntentLock(root, (token) => createManifest(root, dir(), 'demo', { stage: 'execute' }, token));
  });
  const done = () => cleanup(root);

  const add = (payload) =>
    withIntentLock(root, (token) => {
      const planned = importUsage(root, { dir: dir(), rel, payload }, token);
      if (planned.steps.length) runTransaction(root, { purpose: 'usage', steps: planned.steps }, token);
      return planned;
    });
  const report = () => usageReport(dir());

  it('imports a record once, and never counts a replayed event twice', () => {
    assert.equal(add(event()).duplicate, false);
    const again = add(event({ inputTokens: 999_999 }));
    assert.equal(again.duplicate, true);
    assert.deepEqual(again.steps, [], 'the record on disk is immutable and is not overwritten');
    assert.equal(listUsage(dir()).length, 1);
    assert.equal(report().scopes.self.tokens.inputTokens.value, 1000);
    done();
  });

  it('never lets two different event ids land on one file', () => {
    add(event({ eventId: 'run:1' }));
    add(event({ eventId: 'run-1' }));
    assert.equal(listUsage(dir()).length, 2, 'a colon and a hyphen are different events, and both are counted');
    assert.equal(report().events, 2);
    done();
  });

  it('stamps the change identity on the record it stores', () => {
    add(event());
    assert.equal(listUsage(dir())[0].changeId.length, 36);
    done();
  });

  it('reports an unknown total as unknown rather than as the part it could add', () => {
    add(event({ eventId: 'e-1', inputTokens: 1000 }));
    add(event({ eventId: 'e-2', inputTokens: null, outputTokens: 50, cachedInputTokens: null }));
    const r = report();
    assert.equal(r.scopes.self.tokens.inputTokens.value, null, 'one missing measurement makes the total unknown');
    assert.equal(r.scopes.self.tokens.inputTokens.known, 1);
    assert.equal(r.scopes.self.tokens.inputTokens.unknown, 1);
    assert.equal(r.scopes.self.tokens.inputTokens.partial, 1000, 'the part that was measured is reported as a part, under its own name');
    assert.equal(r.scopes.self.tokens.outputTokens.value, 250);
    assert.ok(r.notes.some((n) => /inputTokens is unknown for 1 of 2/.test(n)));
    done();
  });

  it('keeps inclusive parents and self-scoped children in separate totals', () => {
    add(event({ eventId: 'child-1', actorId: 'sub-1', parentActorId: 'writer-1', accountingScope: 'self', inputTokens: 100, outputTokens: 10, cachedInputTokens: null }));
    add(event({ eventId: 'parent-1', actorId: 'writer-1', accountingScope: 'inclusive', inputTokens: 500, outputTokens: 60, cachedInputTokens: null }));
    const r = report();
    assert.equal(r.scopes.self.tokens.inputTokens.value, 100, 'only the self-scoped child is in the self total');
    assert.equal(r.scopes.inclusive.tokens.inputTokens.value, 500);
    assert.equal(r.scopes.self.events + r.scopes.inclusive.events, 2);
    assert.ok(r.notes.some((n) => /never added together/.test(n)));
    done();
  });

  it('leaves a record whose scope the source never stated out of both totals, and says so', () => {
    add(event({ eventId: 'e-1', accountingScope: 'self', inputTokens: 100, cachedInputTokens: null }));
    add(event({ eventId: 'e-2', accountingScope: null, inputTokens: 5000, cachedInputTokens: null }));
    const r = report();
    assert.equal(r.scopes.self.tokens.inputTokens.value, 100);
    assert.equal(r.scopes.unscoped.events, 1);
    assert.equal(r.scopes.unscoped.tokens.inputTokens.value, 5000);
    assert.ok(r.notes.some((n) => /do not state an accounting scope; they are listed separately and are in no total/.test(n)));
    done();
  });

  it('counts failed and abandoned work like any other, attributed where it happened', () => {
    add(event({ eventId: 'e-1', outcome: 'failed', actorId: 'writer-1', attemptId: 'V-1', inputTokens: 300, outputTokens: 30, cachedInputTokens: null }));
    add(event({ eventId: 'e-2', outcome: 'abandoned', actorId: 'sub-1', attemptId: 'V-1', stage: 'mf-verify', inputTokens: 100, outputTokens: 5, cachedInputTokens: null }));
    const r = report();
    assert.deepEqual(r.byOutcome, { failed: 1, abandoned: 1 });
    assert.equal(r.scopes.self.tokens.inputTokens.value, 400, 'work that did not succeed still cost what it cost');
    assert.equal(r.byActor['writer-1'].events, 1);
    assert.equal(r.byActor['sub-1'].events, 1);
    assert.equal(r.byStage['mf-verify'].events, 1);
    assert.equal(r.byAttempt['V-1'].events, 2);
    done();
  });

  it('names the cached-input subset rule instead of silently applying it', () => {
    add(event());
    const r = report();
    assert.equal(r.scopes.self.tokens.cachedInputTokens.value, 400);
    assert.equal(r.scopes.self.tokens.inputTokens.value, 1000, 'cached tokens are inside the input total, not beside it');
    assert.ok(r.notes.some((n) => /never added to it/.test(n)));
    done();
  });

  it('counts an unreadable record nowhere, and says that it did', () => {
    add(event());
    write(root, `${rel}/usage/broken.json`, '{ not json');
    const r = report();
    assert.deepEqual(r.unreadable, ['broken']);
    assert.equal(r.events, 1);
    assert.ok(r.notes.some((n) => /could not be read and are counted nowhere/.test(n)));
    done();
  });

  it('renders every unknown as an unknown', () => {
    add(event({ eventId: 'e-1', inputTokens: null, cachedInputTokens: null }));
    const text = renderUsage(report(), 'demo');
    assert.match(text, /inputTokens: unknown \(0 of 1 record\(s\) reported it\)/);
    assert.match(text, /outputTokens: 200/);
    assert.equal(/\$|price|cost estimate/i.test(text), false, 'no price is ever derived from a token count');
    done();
  });

  it('is driven from the CLI, and refuses a payload it cannot attribute', () => {
    const file = join(root, 'e.json');
    writeFileSync(file, JSON.stringify(event()));
    assert.equal(runSpec(root, ['usage', 'import', 'demo', '--file', file]).status, 0);
    const second = runSpec(root, ['usage', 'import', 'demo', '--file', file]);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /already imported; a replayed event is never counted twice/);

    writeFileSync(file, JSON.stringify({ eventId: 'e-2' }));
    const bad = runSpec(root, ['usage', 'import', 'demo', '--file', file]);
    assert.notEqual(bad.status, 0);
    assert.match(bad.stderr, /names the source that reported it/);

    const r = runSpecJson(root, ['usage', 'demo']);
    assert.equal(r.status, 0);
    assert.equal(r.json.events, 1);
    assert.equal(r.json.scopes.self.tokens.inputTokens.value, 1000);
    done();
  });

  it('exports a comparison that names its sample and its gaps, and claims no saving', () => {
    const file = join(root, 'e.json');
    writeFileSync(file, JSON.stringify(event()));
    assert.equal(runSpec(root, ['usage', 'import', 'demo', '--file', file]).status, 0);
    const r = runSpecJson(root, ['usage', 'demo', '--compare', 'demo', '--risk', 'medium']);
    assert.equal(r.status, 0);
    assert.equal(r.json.comparison.riskClass, 'medium');
    assert.deepEqual(r.json.comparison.sample.baselines, [{ slug: 'demo', events: 1 }]);
    assert.equal(r.json.comparison.comparable, true);
    assert.match(r.stdout, /makes no saving or pricing claim/);
    assert.equal(/\d+\s*%/.test(r.stdout), false, 'no percentage is ever printed');
    done();
  });
});

describe('comparing changes', () => {
  const measured = { events: 3, scopes: { self: { tokens: { inputTokens: { value: 100 }, outputTokens: { value: 10 } } } } };
  const unmeasured = { events: 2, scopes: { self: { tokens: { inputTokens: { value: null }, outputTokens: { value: 10 } } } } };

  it('names its sample and its risk class, and never states a saving', () => {
    const r = compareUsage(measured, [{ slug: 'older', report: measured }], { riskClass: 'medium' });
    assert.equal(r.comparable, true);
    assert.equal(r.riskClass, 'medium');
    assert.deepEqual(r.sample.baselines, [{ slug: 'older', events: 3 }]);
    assert.equal(Object.keys(r).some((k) => /saving|percent|ratio|price/i.test(k)), false);
    assert.match(r.note, /makes no saving or pricing claim/);
  });

  it('lists what is absent instead of comparing around it', () => {
    const r = compareUsage(unmeasured, [{ slug: 'older', report: unmeasured }], {});
    assert.equal(r.comparable, false);
    assert.ok(r.absent.includes('the subject has unknown token totals'));
    assert.ok(r.absent.includes('older has unknown token totals'));
    assert.ok(r.absent.includes('no risk class was stated for the sample'));
    assert.ok(compareUsage(measured, [], { riskClass: 'low' }).absent.includes('no comparable change was named'));
  });
});
