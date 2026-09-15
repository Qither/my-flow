/**
 * Linked intent parsing (contract C-01): stable task ids beside the legacy checkbox grammar,
 * typed reference fields, acceptance criteria and design decision ids. Covers AC-01 (a readable
 * task entry whose details live behind labelled fields) and AC-03 (actionable diagnostics that
 * name their source and target).
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { buildTaskGraph, parseAcceptanceMarkdown, parseDesignMarkdown, parseTasksMarkdown, readChangeIntent, reverseIndex, scanLines } from '../scripts/lib/intent-graph.mjs';
import { ROOT, cleanup, makeTmp, write } from './helpers.mjs';

const V2 = `# Demo

## 1. First

- [x] 1.1 Parse stable task fields and verify the graph fixtures
  - id: T-01
  - depends-on: none
  - accepts: AC-01, AC-03
  - design: D-01
  - evidence: V-2
- [ ] 1.2 Resolve typed references and verify the edge cases
  - id: T-02
  - depends-on: T-01
  - accepts: AC-02
  - design: D-01, D-02
`;

const codes = (d) => d.map((x) => x.code).sort();
const byCode = (d, code) => d.filter((x) => x.code === code);

describe('parseTasksMarkdown: the readable task entry', () => {
  it('keeps the legacy grammar and reads every allowed field', () => {
    const { schemaVersion, tasks, diagnostics } = parseTasksMarkdown(V2);
    assert.equal(schemaVersion, 2);
    assert.deepEqual(diagnostics, []);
    assert.equal(tasks.length, 2);

    const [one, two] = tasks;
    assert.equal(one.id, 'T-01');
    assert.equal(one.number, '1.1');
    assert.equal(one.checked, true);
    assert.equal(one.title, 'Parse stable task fields and verify the graph fixtures');
    assert.deepEqual(one.dependsOn, [], 'an explicit "none" is an empty list, not unknown');
    assert.deepEqual(one.accepts, ['AC-01', 'AC-03']);
    assert.deepEqual(one.design, ['D-01']);
    assert.deepEqual(one.evidence, ['V-2']);
    assert.equal(one.kind, 'work', 'kind defaults to work');
    assert.equal(one.blocked, null);

    assert.equal(two.checked, false);
    assert.deepEqual(two.dependsOn, ['T-01']);
    assert.deepEqual(two.design, ['D-01', 'D-02']);
    assert.equal(two.evidence, null, 'an absent field stays unknown, never an empty list');
  });

  it('preserves the source span of every task', () => {
    const { tasks } = parseTasksMarkdown(V2);
    assert.equal(tasks[0].line, 5);
    assert.equal(tasks[0].endLine, 10);
    assert.equal(tasks[1].line, 11);
    assert.equal(tasks[1].endLine, 15);
    const lines = V2.split('\n');
    assert.match(lines[tasks[0].line - 1], /^- \[x\] 1\.1 /);
  });

  it('keeps ids across renumbering and title edits', () => {
    const renumbered = V2.replace('- [x] 1.1 Parse stable task fields and verify the graph fixtures', '- [x] 7.4 Parse fields (reworded) and verify the graph fixtures');
    const before_ = parseTasksMarkdown(V2).tasks[0];
    const after_ = parseTasksMarkdown(renumbered).tasks[0];
    assert.equal(before_.id, after_.id);
    assert.notEqual(before_.number, after_.number);
    assert.notEqual(before_.title, after_.title);
  });

  it('recognizes both [x] and [X]', () => {
    const { tasks } = parseTasksMarkdown('- [X] 1.1 done and verify it\n  - id: T-A\n');
    assert.equal(tasks[0].checked, true);
    assert.equal(tasks[0].id, 'T-A');
  });

  it('accepts the closeout kind and rejects an unknown one', () => {
    const ok = parseTasksMarkdown('- [ ] 9.1 close out and verify the gate\n  - id: T-Z\n  - kind: closeout\n');
    assert.equal(ok.tasks[0].kind, 'closeout');
    assert.deepEqual(ok.diagnostics, []);
    const bad = parseTasksMarkdown('- [ ] 9.1 close out and verify the gate\n  - id: T-Z\n  - kind: optional\n');
    assert.deepEqual(codes(bad.diagnostics), ['bad-kind']);
    assert.equal(bad.tasks[0].kind, 'work');
  });

  it('reads a blocker and keeps it in tasks.md, the only ledger', () => {
    const { tasks, diagnostics } = parseTasksMarkdown('- [ ] 1.1 do it and verify it\n  - id: T-A\n  - blocked: the host profile is unauthenticated\n');
    assert.equal(tasks[0].blocked, 'the host profile is unauthenticated');
    assert.deepEqual(diagnostics, []);
    const empty = parseTasksMarkdown('- [ ] 1.1 do it and verify it\n  - id: T-A\n  - blocked:\n');
    assert.deepEqual(codes(empty.diagnostics), ['empty-field']);
  });
});

describe('parseTasksMarkdown: what a field may never attach to', () => {
  it('never reads a fenced example', () => {
    const text = ['# Demo', '', 'Example:', '', '```markdown', '- [ ] 1.1 example and verify it', '  - id: T-EXAMPLE', '```', '', '- [ ] 1.1 real and verify it', '  - id: T-REAL', ''].join('\n');
    const { tasks, diagnostics } = parseTasksMarkdown(text);
    assert.deepEqual(tasks.map((t) => t.id), ['T-REAL']);
    assert.deepEqual(diagnostics, []);
  });

  it('never reads an HTML comment, on one line or several', () => {
    const text = ['<!-- - [ ] 1.1 commented and verify it -->', '<!--', '- [ ] 1.2 also commented and verify it', '  - id: T-HIDDEN', '-->', '- [ ] 1.3 real and verify it', '  - id: T-REAL', ''].join('\n');
    const { tasks, diagnostics } = parseTasksMarkdown(text);
    assert.deepEqual(tasks.map((t) => t.id), ['T-REAL']);
    assert.deepEqual(diagnostics, []);
  });

  it('reports orphan metadata instead of attaching it to a distant task', () => {
    const text = ['- [ ] 1.1 first and verify it', '  - id: T-A', '', '## A heading', '', '  - id: T-B', ''].join('\n');
    const { tasks, diagnostics } = parseTasksMarkdown(text);
    assert.deepEqual(tasks.map((t) => t.id), ['T-A']);
    const orphans = byCode(diagnostics, 'orphan-metadata');
    assert.equal(orphans.length, 1);
    assert.equal(orphans[0].line, 6);
    assert.match(orphans[0].message, /has no task above it/);
  });

  it('does not carry a field across a blank line', () => {
    const text = ['- [ ] 1.1 first and verify it', '  - id: T-A', '', '  - depends-on: T-A', ''].join('\n');
    const { tasks, diagnostics } = parseTasksMarkdown(text);
    assert.equal(tasks[0].dependsOn, null);
    assert.deepEqual(codes(diagnostics), ['orphan-metadata']);
  });
});

describe('parseTasksMarkdown: actionable structural diagnostics (AC-03)', () => {
  it('names the field and line of an unknown or repeated field', () => {
    const text = ['- [ ] 1.1 first and verify it', '  - id: T-A', '  - owner: someone', '  - id: T-B', ''].join('\n');
    const { tasks, diagnostics } = parseTasksMarkdown(text, { path: 'changes/x/tasks.md' });
    assert.equal(tasks[0].id, 'T-A', 'the first value stands; the repeat is reported, not applied');
    const unknown = byCode(diagnostics, 'unknown-field')[0];
    assert.equal(unknown.line, 3);
    assert.equal(unknown.field, 'owner');
    assert.equal(unknown.path, 'changes/x/tasks.md');
    assert.match(unknown.message, /allowed: id, depends-on/);
    const dup = byCode(diagnostics, 'duplicate-field')[0];
    assert.equal(dup.line, 4);
    assert.match(dup.message, /T-A repeats the field "id"/);
  });

  it('names both tasks that claim one id', () => {
    const text = ['- [ ] 1.1 first and verify it', '  - id: T-A', '- [ ] 1.2 second and verify it', '  - id: T-A', ''].join('\n');
    const { diagnostics } = parseTasksMarkdown(text);
    const dup = byCode(diagnostics, 'duplicate-id')[0];
    assert.equal(dup.id, 'T-A');
    assert.match(dup.message, /task 1\.1 and task 1\.2/);
  });

  it('refuses ids of the wrong shape and keeps the rest of the list', () => {
    const text = ['- [ ] 1.1 first and verify it', '  - id: task-one', '  - accepts: AC-01, nope, AC-02', ''].join('\n');
    const { tasks, diagnostics } = parseTasksMarkdown(text);
    assert.equal(tasks[0].id, null);
    assert.deepEqual(tasks[0].accepts, ['AC-01', 'AC-02']);
    const bad = byCode(diagnostics, 'bad-id');
    assert.equal(bad.length, 2);
    assert.match(bad[0].message, /must look like T-01/);
    assert.match(bad[1].message, /"nope" is not a valid acceptance id/);
  });

  it('distinguishes an empty list from an explicit none', () => {
    const { tasks, diagnostics } = parseTasksMarkdown('- [ ] 1.1 x and verify it\n  - id: T-A\n  - depends-on:\n');
    assert.equal(tasks[0].dependsOn, null);
    assert.match(byCode(diagnostics, 'empty-field')[0].message, /write "none"/);
  });

  it('warns when a task does not say how it is verified', () => {
    const { diagnostics } = parseTasksMarkdown('- [ ] 1.1 just do something\n  - id: T-A\n');
    const w = byCode(diagnostics, 'no-verification')[0];
    assert.equal(w.severity, 'warning');
    assert.equal(w.line, 1);
  });
});

describe('parseTasksMarkdown: legacy documents keep working', () => {
  it('parses a legacy tasks.md as schema 1 with unknown relations and prose notes intact', () => {
    const legacy = ['# Legacy', '', '- [x] 1.1 Do the first thing and verify the suite passes', '  - this note explains a historical decision', '  - and this one continues it', '- [ ] 1.2 Do the second thing and verify it manually', ''].join('\n');
    const { schemaVersion, tasks, diagnostics } = parseTasksMarkdown(legacy);
    assert.equal(schemaVersion, 1);
    assert.deepEqual(diagnostics, []);
    assert.equal(tasks.length, 2);
    assert.equal(tasks[0].id, null);
    assert.equal(tasks[0].dependsOn, null, 'numbering never implies a dependency');
    assert.deepEqual(tasks[0].notes.map((n) => n.text), ['this note explains a historical decision', 'and this one continues it']);
  });

  it('keeps legacy prose notes beside v2 fields on the same task', () => {
    const text = ['- [ ] 1.1 mixed and verify it', '  - id: T-A', '  - Historical context written as ordinary prose.', '  - depends-on: none', ''].join('\n');
    const { tasks, diagnostics } = parseTasksMarkdown(text);
    assert.deepEqual(diagnostics, []);
    assert.equal(tasks[0].id, 'T-A');
    assert.deepEqual(tasks[0].dependsOn, []);
    assert.deepEqual(tasks[0].notes.map((n) => n.text), ['Historical context written as ordinary prose.']);
  });
});

describe('scanLines', () => {
  it('marks fenced and commented regions and numbers lines from one', () => {
    const scanned = scanLines('a\n```\nb\n```\nc\n');
    assert.deepEqual(scanned.map((l) => [l.line, l.skip]), [
      [1, false],
      [2, true],
      [3, true],
      [4, true],
      [5, false],
      [6, false],
    ]);
  });
});

describe('parseAcceptanceMarkdown', () => {
  const AC = `# Acceptance

### AC-01 — Refuse unfinished work

An archive attempt lists unfinished tasks and leaves files unchanged.
- evidence-mode: automated
- required: true
- checks: test/spec.test.mjs — unfinished archive
- requirements: spec-helper / Safe archive publication
- tasks: T-01, T-02

### AC-02 — Optional nicety

- evidence-mode: manual, live
- required: false
- checks: read the fixture by hand
`;

  it('reads ids, titles, modes, required and checks as description text', () => {
    const { criteria, diagnostics } = parseAcceptanceMarkdown(AC);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(criteria.map((c) => c.id), ['AC-01', 'AC-02']);
    const [one, two] = criteria;
    assert.equal(one.title, 'Refuse unfinished work');
    assert.deepEqual(one.evidenceModes, ['automated']);
    assert.equal(one.required, true);
    assert.equal(one.checks, 'test/spec.test.mjs — unfinished archive');
    assert.equal(one.requirements, 'spec-helper / Safe archive publication');
    assert.deepEqual(one.tasks, ['T-01', 'T-02']);
    assert.deepEqual(two.evidenceModes, ['manual', 'live']);
    assert.equal(two.required, false);
  });

  it('reports an unknown mode, an unknown field, a duplicate id and a missing mode', () => {
    const bad = ['### AC-01 — One', '', '- evidence-mode: automated, telepathy', '- owner: me', '- checks: a check', '', '### AC-01 — Again', '', '- evidence-mode: manual', '- checks: another', '', '### AC-02 — No mode', '', '- checks: a third', ''].join('\n');
    const { diagnostics } = parseAcceptanceMarkdown(bad);
    assert.deepEqual(codes(diagnostics), ['bad-evidence-mode', 'duplicate-id', 'missing-evidence-mode', 'unknown-field']);
    assert.match(byCode(diagnostics, 'bad-evidence-mode')[0].message, /telepathy/);
    assert.equal(byCode(diagnostics, 'missing-evidence-mode')[0].id, 'AC-02');
  });

  it('keeps the source span of each criterion', () => {
    const { criteria } = parseAcceptanceMarkdown(AC);
    assert.equal(criteria[0].line, 3);
    assert.ok(criteria[0].endLine >= 9);
    assert.ok(criteria[1].line > criteria[0].endLine);
  });
});

describe('parseDesignMarkdown', () => {
  it('reads stable decision ids with their titles and spans', () => {
    const text = ['## Decisions', '', '### D-01 — Keep Markdown authoritative', '', 'Body.', '', '### D-02 — Resolve typed links by identity', '', 'More body.', ''].join('\n');
    const { decisions, diagnostics } = parseDesignMarkdown(text);
    assert.deepEqual(diagnostics, []);
    assert.deepEqual(decisions.map((d) => d.id), ['D-01', 'D-02']);
    assert.equal(decisions[0].title, 'Keep Markdown authoritative');
    assert.equal(decisions[0].line, 3);
    assert.equal(decisions[0].endLine, 6);
  });

  it('reports a repeated decision id', () => {
    const { diagnostics } = parseDesignMarkdown('### D-01 — One\n\n### D-01 — Two\n');
    assert.deepEqual(codes(diagnostics), ['duplicate-id']);
  });
});

describe('readChangeIntent', () => {
  let root;
  before(() => {
    root = makeTmp('graph-read');
    write(root, 'changes/demo/tasks.md', V2);
    const criterion = (id) => `### ${id} — Criterion ${id}\n\n- evidence-mode: automated\n- checks: a check\n`;
    write(root, 'changes/demo/acceptance.md', ['AC-01', 'AC-02', 'AC-03'].map(criterion).join('\n'));
    write(root, 'changes/demo/design.md', '### D-01 — A decision\n\nBody.\n\n### D-02 — Another decision\n\nBody.\n');
    write(root, 'changes/legacy/tasks.md', '- [ ] 1.1 legacy work and verify it\n');
  });
  after(() => cleanup(root));

  it('parses all three documents of a v2 change', () => {
    const intent = readChangeIntent(root, 'demo');
    assert.equal(intent.exists, true);
    assert.equal(intent.schemaVersion, 2);
    assert.deepEqual(intent.tasks.tasks.map((t) => t.id), ['T-01', 'T-02']);
    assert.deepEqual(intent.acceptance.criteria.map((c) => c.id), ['AC-01', 'AC-02', 'AC-03']);
    assert.deepEqual(intent.design.decisions.map((d) => d.id), ['D-01', 'D-02']);
    assert.deepEqual(intent.diagnostics, []);
    assert.equal(intent.tasks.tasks[0].path, 'changes/demo/tasks.md');
  });

  it('reads a legacy change as schema 1 without inventing acceptance', () => {
    const intent = readChangeIntent(root, 'legacy');
    assert.equal(intent.schemaVersion, 1);
    assert.deepEqual(intent.acceptance.criteria, []);
    assert.deepEqual(intent.diagnostics, []);
  });

  it('reports a change with no tasks.md as absent rather than throwing', () => {
    const intent = readChangeIntent(root, 'nope');
    assert.equal(intent.exists, false);
    assert.deepEqual(intent.tasks.tasks, []);
  });
});

describe('buildTaskGraph: typed references and reverse links (AC-02)', () => {
  const AC = `### AC-01 — One

- evidence-mode: automated
- checks: a check
`;
  const DESIGN = '### D-01 — A decision\n\nBody.\n';
  const graphOf = (tasksText, opts) =>
    buildTaskGraph(
      {
        tasks: parseTasksMarkdown(tasksText),
        acceptance: parseAcceptanceMarkdown(AC),
        design: parseDesignMarkdown(DESIGN),
      },
      opts
    );

  const FORK = [
    '- [x] 1.1 root and verify it',
    '  - id: T-A',
    '  - depends-on: none',
    '  - accepts: AC-01',
    '  - design: D-01',
    '- [ ] 1.2 left and verify it',
    '  - id: T-B',
    '  - depends-on: T-A',
    '- [ ] 1.3 right and verify it',
    '  - id: T-C',
    '  - depends-on: T-A',
    '- [ ] 1.4 join and verify it',
    '  - id: T-D',
    '  - depends-on: T-B, T-C',
    '',
  ].join('\n');

  it('builds forward links, reverse links and readiness for a fork and join', () => {
    const g = graphOf(FORK);
    assert.deepEqual(g.diagnostics, []);
    assert.deepEqual([...g.nodes.keys()], ['T-A', 'T-B', 'T-C', 'T-D']);
    assert.deepEqual(g.nodes.get('T-A').dependents, ['T-B', 'T-C'], 'reverse links come from the declared prerequisites');
    assert.deepEqual(g.nodes.get('T-D').dependents, []);
    assert.equal(g.nodes.get('T-A').readiness, 'complete');
    assert.equal(g.nodes.get('T-B').readiness, 'ready');
    assert.equal(g.nodes.get('T-C').readiness, 'ready');
    assert.equal(g.nodes.get('T-D').readiness, 'waiting');
    assert.match(g.nodes.get('T-D').reasons[0], /waiting for T-B, T-C/);
  });

  it('indexes every typed reference in reverse', () => {
    const back = reverseIndex(graphOf(FORK));
    assert.deepEqual(back.get('acceptance:AC-01'), [{ from: 'T-A', field: 'accepts' }]);
    assert.deepEqual(back.get('design:D-01'), [{ from: 'T-A', field: 'design' }]);
    assert.deepEqual(back.get('task:T-A'), [
      { from: 'T-B', field: 'depends-on' },
      { from: 'T-C', field: 'depends-on' },
    ]);
  });

  it('leaves an undeclared dependency unknown instead of inferring one from numbering', () => {
    const g = graphOf('- [ ] 9.9 later work and verify it\n  - id: T-LATE\n');
    assert.equal(g.nodes.get('T-LATE').readiness, 'unknown');
    assert.match(g.nodes.get('T-LATE').reasons[0], /unknown, not none/);
  });

  it('does not make an independent completed task an error because an earlier task is open', () => {
    const text = ['- [ ] 1.1 first and verify it', '  - id: T-A', '  - depends-on: none', '- [x] 1.2 independent and verify it', '  - id: T-B', '  - depends-on: none', ''].join('\n');
    const g = graphOf(text);
    assert.deepEqual(g.diagnostics, []);
    assert.equal(g.nodes.get('T-A').readiness, 'ready');
    assert.equal(g.nodes.get('T-B').readiness, 'complete');
  });

  it('reports a reference that does not resolve and marks only that task invalid', () => {
    const text = ['- [ ] 1.1 fine and verify it', '  - id: T-A', '  - depends-on: none', '- [ ] 1.2 broken and verify it', '  - id: T-B', '  - depends-on: T-MISSING', '  - accepts: AC-99', '  - design: D-99', ''].join('\n');
    const g = graphOf(text);
    assert.deepEqual(codes(g.diagnostics), ['unknown-acceptance', 'unknown-dependency', 'unknown-design']);
    assert.equal(byCode(g.diagnostics, 'unknown-dependency')[0].ref, 'T-MISSING');
    assert.equal(byCode(g.diagnostics, 'unknown-dependency')[0].task, 'T-B');
    assert.equal(g.nodes.get('T-B').readiness, 'invalid');
    assert.equal(g.nodes.get('T-A').readiness, 'ready');
    assert.deepEqual(
      g.nodes.get('T-B').refs.map((r) => [r.type, r.id, r.resolved]),
      [
        ['task', 'T-MISSING', false],
        ['acceptance', 'AC-99', false],
        ['design', 'D-99', false],
      ]
    );
  });
});

describe('buildTaskGraph: cycles and blocked precedence (AC-03)', () => {
  const graphOf = (tasksText, opts) =>
    buildTaskGraph({ tasks: parseTasksMarkdown(tasksText), acceptance: parseAcceptanceMarkdown(''), design: parseDesignMarkdown('') }, opts);

  it('reports a task that depends on itself', () => {
    const g = graphOf('- [ ] 1.1 loop and verify it\n  - id: T-A\n  - depends-on: T-A\n');
    const c = byCode(g.diagnostics, 'dependency-cycle');
    assert.equal(c.length, 1);
    assert.deepEqual(c[0].cycle, ['T-A']);
    assert.equal(g.nodes.get('T-A').readiness, 'invalid');
  });

  it('reports a multi-node cycle once, naming every member', () => {
    const text = ['- [ ] 1.1 a and verify it', '  - id: T-A', '  - depends-on: T-C', '- [ ] 1.2 b and verify it', '  - id: T-B', '  - depends-on: T-A', '- [ ] 1.3 c and verify it', '  - id: T-C', '  - depends-on: T-B', ''].join('\n');
    const g = graphOf(text);
    const c = byCode(g.diagnostics, 'dependency-cycle');
    assert.equal(c.length, 1);
    assert.deepEqual([...c[0].cycle].sort(), ['T-A', 'T-B', 'T-C']);
    assert.match(c[0].message, /->/);
    for (const id of ['T-A', 'T-B', 'T-C']) assert.equal(g.nodes.get(id).readiness, 'invalid');
  });

  it('keeps a blocked task blocked even when its box is ticked, and says so', () => {
    const g = graphOf('- [x] 1.1 held and verify it\n  - id: T-A\n  - depends-on: none\n  - blocked: the host is unauthenticated\n');
    assert.equal(g.nodes.get('T-A').readiness, 'blocked');
    assert.match(g.nodes.get('T-A').reasons[0], /the host is unauthenticated/);
    assert.deepEqual(codes(g.diagnostics), ['checked-but-blocked']);
  });

  it('reports a ticked task whose prerequisite is unfinished without changing any box', () => {
    const text = ['- [ ] 1.1 first and verify it', '  - id: T-A', '  - depends-on: none', '- [x] 1.2 second and verify it', '  - id: T-B', '  - depends-on: T-A', ''].join('\n');
    const g = graphOf(text);
    const d = byCode(g.diagnostics, 'checked-with-unfinished-prerequisite')[0];
    assert.equal(d.task, 'T-B');
    assert.deepEqual(d.unfinished, ['T-A']);
    assert.equal(g.nodes.get('T-B').readiness, 'complete', 'the derived graph reports; it never unticks');
    assert.equal(g.nodes.get('T-B').task.checked, true);
  });

  it('holds a task for a pending amendment ahead of its ticked box', () => {
    const g = graphOf('- [x] 1.1 held and verify it\n  - id: T-A\n  - depends-on: none\n', { holds: new Map([['T-A', 'A-1']]) });
    assert.equal(g.nodes.get('T-A').readiness, 'blocked');
    assert.match(g.nodes.get('T-A').reasons[0], /held by amendment A-1/);
  });

  it('keeps legacy tasks readable with unknown relations', () => {
    const g = graphOf('- [x] 1.1 legacy done and verify it\n- [ ] 1.2 legacy open and verify it\n');
    assert.equal(g.nodes.size, 0);
    assert.deepEqual(g.legacy.map((n) => n.readiness), ['complete', 'unknown']);
    assert.deepEqual(g.diagnostics, []);
  });
});

describe('readChangeIntent: the graph is derived on every call', () => {
  let root;
  before(() => {
    root = makeTmp('graph-fresh');
    write(root, 'changes/demo/tasks.md', '- [ ] 1.1 first and verify it\n  - id: T-A\n  - depends-on: none\n');
    write(root, 'changes/demo/acceptance.md', '');
    write(root, 'changes/demo/design.md', '');
  });
  after(() => cleanup(root));

  it('sees a task added after the previous call', () => {
    assert.equal(readChangeIntent(root, 'demo').graph.nodes.size, 1);
    write(root, 'changes/demo/tasks.md', '- [ ] 1.1 first and verify it\n  - id: T-A\n  - depends-on: none\n- [ ] 1.2 second and verify it\n  - id: T-B\n  - depends-on: T-A\n');
    const second = readChangeIntent(root, 'demo');
    assert.equal(second.graph.nodes.size, 2);
    assert.deepEqual(second.graph.nodes.get('T-A').dependents, ['T-B']);
  });

  it('derives a graph for this repository own plan whose only diagnostics are the recorded relaxations', () => {
    const intent = readChangeIntent(ROOT, 'linked-evidence-workflow');
    if (!intent.exists) return; // the suite also runs from a packaged copy without changes/
    assert.ok(intent.graph.nodes.size >= 25);
    // The user authorised implementation to run ahead of explicitly held prerequisites.
    // Report any remaining ordering exception without freezing a task's temporary status;
    // nothing else about the current plan may be structurally wrong.
    const errors = intent.diagnostics.filter((d) => d.severity !== 'warning');
    for (const d of errors) assert.equal(d.code, 'checked-with-unfinished-prerequisite', d.message);

    // A task may only be ticked ahead of a prerequisite that is explicitly held, never ahead of
    // one that is merely unfinished: the exception has to be a decision someone wrote down.
    for (const d of errors) {
      const prerequisites = intent.graph.nodes.get(d.task).task.dependsOn ?? [];
      for (const id of prerequisites) {
        const node = intent.graph.nodes.get(id);
        if (!node || node.task.checked) continue;
        assert.ok(node.task.blocked, `${d.task} is ticked ahead of ${id}, which is not finished and not held`);
        assert.ok(node.task.blocked.trim().length > 40, `${id} is held without a reason anyone could act on`);
      }
    }
  });
});
