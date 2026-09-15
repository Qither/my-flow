/**
 * Listbox reducer (web/ui.mjs): every keyboard, type-ahead and pointer decision as a pure
 * function over plain objects, plus the import-without-a-DOM guarantee.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../scripts/dashboard.mjs';
import { anchorFor, changeRoute, diagnosticsHtml, parseRoute, readinessTone, referenceViewHtml, routeKey, shouldFocusHeading, shouldRefetch, splitTaskTitle, taskRowHtml, tasksPanelHtml } from '../web/app.mjs';
import { TYPEAHEAD_MS, listboxInit, listboxNext } from '../web/ui.mjs';
import { cleanup, makeTmp } from './helpers.mjs';

test('route: #/styleguide is its own page and never refetches on a change event', () => {
  assert.deepEqual(parseRoute('#/styleguide'), { page: 'styleguide' });
  assert.deepEqual(parseRoute('#/styleguide/extra'), { page: 'styleguide' });
  assert.equal(shouldRefetch({ page: 'styleguide' }, ['changes/x/tasks.md']), false);
  assert.equal(shouldRefetch({ page: 'styleguide' }, ['.my-flow/state/current-change.json']), false);
  assert.equal(shouldRefetch({ page: 'changes', name: null }, ['changes/x/tasks.md']), true, 'other routes are unchanged');
});

test('static: /ui.mjs is served as JavaScript by the existing extension map', async (t) => {
  const root = makeTmp('ui-asset');
  const h = await startServer({ root, port: 0 });
  t.after(async () => {
    await h.close();
    cleanup(root);
  });
  const r = await fetch(h.url + 'ui.mjs');
  assert.equal(r.status, 200);
  assert.match(r.headers.get('content-type'), /^text\/javascript/);
  assert.match(await r.text(), /export function mountListbox/);
});

const THEME = [{ value: 'system', label: 'Auto (system)' }, { value: 'light', label: 'Light' }, { value: 'dark', label: 'Dark' }];
const key = (k, time = 0) => ({ type: 'key', key: k, time });
const run = (state, ...evs) => evs.reduce((s, ev) => listboxNext(s, ev), state);
const strip = ({ changed, handled, ...s }) => s;

test('import: the module loads in Node with no document and exports the three names', async () => {
  assert.equal(typeof document, 'undefined');
  const m = await import('../web/ui.mjs');
  for (const name of ['TYPEAHEAD_MS', 'listboxInit', 'listboxNext']) assert.equal(name in m, true, name);
  assert.equal(m.TYPEAHEAD_MS, 500);
});

test('init: closed, active at the value', () => {
  const s = listboxInit(THEME, 'light');
  assert.deepEqual(s, { options: THEME, value: 'light', open: false, active: 1, search: '', searchAt: 0 });
  assert.equal(listboxInit(THEME, 'nope').active, 0, 'unknown value falls back to the first option');
});

test('keys while closed: ArrowDown / ArrowUp / Enter / Space open at the value, Home and End at the ends', () => {
  const s = listboxInit(THEME, 'light');
  for (const k of ['ArrowDown', 'ArrowUp', 'Enter', ' ']) {
    const r = listboxNext(s, key(k));
    assert.deepEqual([r.open, r.active, r.changed, r.handled], [true, 1, false, true], k);
  }
  assert.equal(listboxNext(s, key('Home')).active, 0);
  assert.equal(listboxNext(s, key('End')).active, 2);
  assert.equal(s.open, false, 'input state is not mutated');
});

test('ArrowDown clamps at the last option, ArrowUp at the first (no wrap)', () => {
  const s = listboxNext(listboxInit(THEME, 'system'), key('ArrowDown'));
  const down = run(s, key('ArrowDown'), key('ArrowDown'), key('ArrowDown'));
  assert.equal(down.active, 2);
  const up = run(down, key('ArrowUp'), key('ArrowUp'), key('ArrowUp'));
  assert.equal(up.active, 0);
  assert.equal(run(s, key('End')).active, 2);
  assert.equal(run(s, key('End'), key('Home')).active, 0);
});

test('Enter commits the active option and closes; Enter on the current value reports no change', () => {
  const s = run(listboxInit(THEME, 'system'), key('ArrowDown'), key('ArrowDown'));
  const r = listboxNext(s, key('Enter'));
  assert.deepEqual([r.value, r.open, r.changed, r.handled, r.active], ['light', false, true, true, 1]);
  const same = run(listboxInit(THEME, 'system'), key('ArrowDown'), key('Enter'));
  assert.deepEqual([same.value, same.open, same.changed], ['system', false, false]);
});

test('Escape closes without committing; Tab and Space commit', () => {
  const moved = run(listboxInit(THEME, 'system'), key('ArrowDown'), key('ArrowDown'));
  const esc = listboxNext(moved, key('Escape'));
  assert.deepEqual([esc.value, esc.open, esc.changed, esc.handled], ['system', false, false, true]);
  const tab = listboxNext(moved, key('Tab'));
  assert.deepEqual([tab.value, tab.open, tab.changed], ['light', false, true]);
  const space = run(listboxInit(THEME, 'system'), key(' '), key('ArrowDown'), key('ArrowDown'), key(' '));
  assert.deepEqual([space.value, space.open, space.changed], ['dark', false, true]);
});

test('type-ahead: a letter from closed opens on the match; a prefix then Enter commits it', () => {
  const d = listboxNext(listboxInit(THEME, 'system'), key('d', 100));
  assert.deepEqual([d.open, d.active, d.search, d.searchAt, d.handled], [true, 2, 'd', 100, true]);
  const l = run(listboxInit(THEME, 'system'), key('l', 100), key('Enter'));
  assert.deepEqual([l.value, l.open, l.changed], ['light', false, true]);
  const li = run(listboxInit(THEME, 'system'), key('L', 100), key('i', 200));
  assert.deepEqual([li.active, li.search], [1, 'Li'], 'case-insensitive prefix');
  const none = run(listboxInit(THEME, 'light'), key('z', 100));
  assert.equal(none.active, 1, 'no match keeps the active option');
});

test('type-ahead: a repeated initial cycles between the options sharing it, wrapping', () => {
  const opts = [...THEME, { value: 'sepia', label: 'Sepia' }, { value: 'solar', label: 'Solar' }];
  const s1 = listboxNext(listboxInit(opts, 'light'), key('s', 100));
  assert.equal(s1.active, 3, 'first "s" after Light is Sepia');
  const s2 = listboxNext(s1, key('s', 200));
  assert.equal(s2.active, 4, 'second "s" moves on to Solar');
  const s3 = listboxNext(s2, key('s', 300));
  assert.equal(s3.active, 3, 'third "s" wraps back to Sepia');
  assert.equal(s3.search, 'sss');
});

test('type-ahead: a buffer older than TYPEAHEAD_MS restarts', () => {
  const s = run(listboxInit(THEME, 'system'), key('l', 100), key('d', 100 + TYPEAHEAD_MS));
  assert.deepEqual([s.search, s.active], ['d', 2]);
  const kept = run(listboxInit(THEME, 'system'), key('l', 100), key('i', 100 + TYPEAHEAD_MS - 1));
  assert.deepEqual([kept.search, kept.active], ['li', 1]);
});

test('toggle, open, close, pick and point', () => {
  const s = listboxInit(THEME, 'dark');
  const o = listboxNext(s, { type: 'toggle' });
  assert.deepEqual([o.open, o.active, o.handled], [true, 2, true]);
  assert.equal(listboxNext(o, { type: 'toggle' }).open, false);
  assert.equal(listboxNext(s, { type: 'open' }).open, true);
  assert.equal(listboxNext(o, { type: 'close' }).open, false);
  const p = listboxNext(o, { type: 'point', index: 0 });
  assert.deepEqual([p.active, p.open, p.changed], [0, true, false]);
  const picked = listboxNext(o, { type: 'pick', index: 1 });
  assert.deepEqual([picked.value, picked.open, picked.changed, picked.active], ['light', false, true, 1]);
  assert.equal(listboxNext(o, { type: 'pick', index: 9 }).handled, false, 'out of range is ignored');
});

test('unhandled: an unknown key returns an equal state with handled false; Tab while closed is not handled', () => {
  const s = listboxInit(THEME, 'light');
  const r = listboxNext(s, key('F5'));
  assert.deepEqual(strip(r), s);
  assert.equal(r.handled, false);
  const tab = listboxNext(s, key('Tab'));
  assert.deepEqual([tab.handled, tab.open], [false, false]);
  const openUnknown = listboxNext(listboxNext(s, key('ArrowDown')), key('PageDown'));
  assert.deepEqual([openUnknown.handled, openUnknown.open], [false, true]);
  assert.equal(listboxNext(s, { type: 'nope' }).handled, false);
});

// ---------------------------------------------------------------- linked task rows (T-06, AC-01/AC-02)
const task = (over = {}) => ({
  id: 'T-01',
  number: '1.1',
  title: 'Parse stable task fields and verify the graph parsing fixtures',
  checked: false,
  kind: 'work',
  blocked: null,
  readiness: 'ready',
  reasons: ['no prerequisites'],
  line: 1,
  endLine: 3,
  path: 'changes/demo/tasks.md',
  notes: [],
  outgoing: [],
  incoming: [],
  ...over,
});

test('task row: the title splits into an action and an observable result', () => {
  assert.deepEqual(splitTaskTitle('Parse stable task fields and verify the graph parsing fixtures'), {
    action: 'Parse stable task fields',
    result: 'the graph parsing fixtures',
  });
  assert.deepEqual(splitTaskTitle('Do a thing and verifies it works'), { action: 'Do a thing', result: 'it works' });
  assert.deepEqual(splitTaskTitle('Cleanup of own diff only, then re-verify'), { action: 'Cleanup of own diff only, then re-verify', result: '' });
  assert.deepEqual(splitTaskTitle(''), { action: '', result: '' });
  assert.deepEqual(splitTaskTitle(undefined), { action: '', result: '' });
});

test('task row: readiness uses the existing tag tones and nothing else', () => {
  assert.deepEqual(
    ['complete', 'ready', 'waiting', 'unknown', 'blocked', 'invalid'].map(readinessTone),
    ['lime', 'lime', 'plain', 'plain', 'warn', 'warn']
  );
});

test('task row: a concise v2 row shows action and result without opening the details', () => {
  const html = taskRowHtml(task());
  const head = html.slice(0, html.indexOf('<details'));
  assert.match(head, /class="task-action">Parse stable task fields</);
  assert.match(html, /class="task-result">verify: the graph parsing fixtures</);
  assert.match(head, /&#9744;/, 'an open box');
  assert.match(head, /class="tag lime">ready</);
  assert.equal(/test\//.test(head), false, 'no technical check text is in the row itself');
  assert.match(html, /id="task-T-01"/);
  assert.match(html, /<summary>T-01<\/summary>/);
});

test('task row: every reference is a labelled link that names its target', () => {
  const html = taskRowHtml(
    task({
      outgoing: [
        { type: 'task', id: 'T-30', field: 'depends-on', resolved: true, label: 'Add shared I/O coordination' },
        { type: 'acceptance', id: 'AC-01', field: 'accepts', resolved: true, label: 'Readable task entry' },
        { type: 'design', id: 'D-01', field: 'design', resolved: true, label: 'Keep Markdown authoritative' },
      ],
      incoming: [{ type: 'task', from: 'T-02', field: 'depends-on', label: 'Resolve typed references' }],
    })
  );
  assert.match(html, /<span class="ref-label">needs<\/span><a href="#task-T-30">T-30 — Add shared I\/O coordination<\/a>/);
  assert.match(html, /<span class="ref-label">accepts<\/span><a href="#ac-AC-01">AC-01 — Readable task entry<\/a>/);
  assert.match(html, /<span class="ref-label">design<\/span><a href="#d-D-01">D-01 — Keep Markdown authoritative<\/a>/);
  assert.match(html, /<span class="ref-label">needed by<\/span><a href="#task-T-02">T-02 — Resolve typed references<\/a>/);
  assert.equal(anchorFor('acceptance', 'AC-02'), 'ac-AC-02');
  assert.equal(anchorFor('design', 'D-02'), 'd-D-02');
  assert.equal(anchorFor('task', 'T-02'), 'task-T-02');
});

test('task row: an unresolved reference is named, never rendered as a working link', () => {
  const html = taskRowHtml(task({ readiness: 'invalid', reasons: ['a typed reference does not resolve'], outgoing: [{ type: 'task', id: 'T-GONE', field: 'depends-on', resolved: false, label: null }] }));
  assert.match(html, /<span class="tag warn">T-GONE does not resolve<\/span>/);
  assert.equal(/href="#task-T-GONE"/.test(html), false);
  assert.match(html, /class="tag warn">invalid</);
});

test('task row: a long legacy task keeps its prose notes and says its relations are unknown', () => {
  const html = taskRowHtml(
    task({
      id: null,
      number: '2.7',
      checked: true,
      readiness: 'unknown',
      reasons: ['legacy task without a stable id'],
      title: 'Rework the historical importer so that every previously recorded batch is replayed in order and verify the replay suite passes twice in a row',
      notes: ['this note explains a historical decision that must survive the upgrade'],
    })
  );
  assert.match(html, /id="task-2\.7"/);
  assert.match(html, /<summary>no stable id<\/summary>/);
  assert.match(html, /&#9745;/, 'a ticked box');
  assert.match(html, /class="task-action">Rework the historical importer/);
  assert.match(html, /class="task-result">verify: the replay suite passes twice in a row/);
  assert.match(html, /<span class="ref-label">note<\/span>this note explains a historical decision/);
  assert.match(html, /<p class="muted">no declared references<\/p>/);
});

test('task row: a blocked task shows its blocker, and absent evidence adds nothing', () => {
  const html = taskRowHtml(task({ readiness: 'blocked', reasons: ['blocked: the host profile is unauthenticated'], blocked: 'the host profile is unauthenticated' }));
  assert.match(html, /<div class="warnings"><div>blocked: the host profile is unauthenticated<\/div><\/div>/);
  assert.equal(/evidence/.test(html), false, 'a task with no evidence field claims no evidence');
});

test('task row: content is escaped, never injected', () => {
  const html = taskRowHtml(task({ title: '<img src=x onerror=alert(1)> and verify <b>nothing</b>', notes: ['<script>alert(1)</script>'] }));
  assert.equal(/<img|<script|<b>/.test(html), false);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
});

test('task panel: tasks, acceptance and design decisions carry the anchors the rows link to', () => {
  const html = tasksPanelHtml({
    schemaVersion: 2,
    counts: { total: 1, done: 0 },
    tasks: [task({ outgoing: [{ type: 'acceptance', id: 'AC-01', field: 'accepts', resolved: true, label: 'Readable task entry' }] })],
    acceptance: [{ id: 'AC-01', title: 'Readable task entry', required: true, evidenceModes: ['automated', 'manual'], checks: 'test/intent-graph.test.mjs', incoming: [] }],
    design: [{ id: 'D-01', title: 'Keep Markdown authoritative', incoming: [] }],
  });
  assert.match(html, /<h3>Tasks <span class="meta">0\/1 ticked, schema v2<\/span><\/h3>/);
  assert.match(html, /id="ac-AC-01"/);
  assert.match(html, /id="d-D-01"/);
  assert.match(html, /automated, manual/);
  assert.match(html, /checks: test\/intent-graph\.test\.mjs/, 'the technical check lives in the acceptance block, not the task row');
  assert.equal(tasksPanelHtml(null), '', 'no projection renders nothing rather than an error');
});

test('task panel: an optional criterion and a missing evidence mode both say so', () => {
  const html = tasksPanelHtml({
    schemaVersion: 1,
    counts: { total: 0, done: 0 },
    tasks: [],
    acceptance: [{ id: 'AC-09', title: 'Nice to have', required: false, evidenceModes: null, checks: null, incoming: [] }],
    design: [],
  });
  assert.match(html, /no evidence mode declared, optional/);
  assert.match(html, /<p class="empty">no tasks yet<\/p>/);
});

// ---------------------------------------------------------------- stable routes (T-07, AC-02/AC-03)
const UUID = '2f1c8b5a-3d4e-4f6a-9b0c-1d2e3f4a5b6c';

test('route: #/change/<uuid> and its typed forms parse into identity, type and id', () => {
  assert.deepEqual(parseRoute(`#/change/${UUID}`), { page: 'change', ref: UUID, type: null, id: null, sub: null });
  assert.deepEqual(parseRoute(`#/change/${UUID}/task/T-01`), { page: 'change', ref: UUID, type: 'task', id: 'T-01', sub: null });
  assert.deepEqual(parseRoute(`#/change/${UUID}/acceptance/AC-01`), { page: 'change', ref: UUID, type: 'acceptance', id: 'AC-01', sub: null });
  assert.deepEqual(parseRoute(`#/change/${UUID}/design/D-01`), { page: 'change', ref: UUID, type: 'design', id: 'D-01', sub: null });
  assert.deepEqual(parseRoute(`#/change/${UUID}/evidence/V-2`), { page: 'change', ref: UUID, type: 'evidence', id: 'V-2', sub: null });
  assert.deepEqual(parseRoute(`#/change/${UUID}/evidence/V-2/acceptance/AC-01`), {
    page: 'change',
    ref: UUID,
    type: 'evidence',
    id: 'V-2',
    sub: { type: 'acceptance', id: 'AC-01' },
  });
  assert.deepEqual(parseRoute('#/change/a-slug'), { page: 'change', ref: 'a-slug', type: null, id: null, sub: null });
});

test('route: an unknown type, a missing id and a stray subroute are refused, not guessed', () => {
  assert.deepEqual(parseRoute(`#/change/${UUID}/nonsense/X-1`), { page: 'invalid', reason: '"nonsense" is not one of task, acceptance, design, evidence' });
  assert.equal(parseRoute(`#/change/${UUID}/task`).page, 'invalid');
  assert.equal(parseRoute(`#/change/${UUID}/task/T-01/acceptance/AC-01`).page, 'invalid');
  assert.equal(parseRoute(`#/change/${UUID}/evidence/V-1/design/D-1`).page, 'invalid');
  assert.deepEqual(parseRoute('#/change'), { page: 'changes', name: null });
});

test('route: malformed percent encoding and traversal never reach a resolver', () => {
  const bad = parseRoute('#/change/%E0%A4%A');
  assert.equal(bad.page, 'invalid');
  assert.match(bad.reason, /malformed percent encoding/);
  assert.equal(parseRoute('#/file/%E0%A4%A').page, 'invalid', 'the old routes are protected by the same guard');
  // traversal decodes to a plain segment and is refused by the server, never by rendering HTML
  assert.deepEqual(parseRoute('#/change/..%2F..%2Fetc'), { page: 'change', ref: '../../etc', type: null, id: null, sub: null });
  assert.equal(shouldRefetch({ page: 'invalid' }, ['changes/x/tasks.md']), false);
  assert.equal(shouldRefetch({ page: 'change', ref: UUID }, ['changes/x/tasks.md']), true);
  assert.equal(shouldRefetch({ page: 'change', ref: UUID }, ['README.md']), false);
});

test('route: changeRoute builds exactly the form parseRoute reads back', () => {
  for (const [ref, type, id, sub] of [
    [UUID, null, null, null],
    [UUID, 'task', 'T-01', null],
    ['a slug/with odd chars', 'acceptance', 'AC-1', null],
    [UUID, 'evidence', 'V-3', { type: 'acceptance', id: 'AC-02' }],
  ]) {
    const parsed = parseRoute(changeRoute(ref, type, id, sub));
    assert.equal(parsed.page, 'change');
    assert.equal(parsed.ref, ref);
    assert.equal(parsed.type, type);
    assert.equal(parsed.id, id);
    assert.deepEqual(parsed.sub, sub);
  }
});

test('task row: given a change identity, every reference becomes a stable cross-change route', () => {
  const html = taskRowHtml(
    task({ outgoing: [{ type: 'acceptance', id: 'AC-01', field: 'accepts', resolved: true, label: 'Readable task entry' }] }),
    UUID
  );
  assert.match(html, new RegExp(`href="#/change/${UUID}/acceptance/AC-01"`));
  assert.equal(/href="#ac-AC-01"/.test(html), false);
});

test('reference view: the item, its source and everything that points at it', () => {
  const html = referenceViewHtml({
    schemaVersion: 2,
    identity: { id: UUID, slug: 'demo', kind: 'change', stage: 'execute' },
    location: { location: 'active', rel: 'changes/demo', dirName: 'demo' },
    type: 'task',
    item: task({
      incoming: [
        { type: 'task', from: 'T-02', field: 'depends-on', label: 'Resolve typed references' },
        { type: 'task', from: 'T-03', field: 'depends-on', label: 'Add change identities' },
      ],
    }),
    diagnostics: [],
    invalid: false,
  });
  assert.match(html, /<h1>T-01<\/h1>/);
  assert.match(html, /<h3>Referenced by<\/h3>/);
  assert.match(html, new RegExp(`<span class="ref-label">needed by</span><a href="#/change/${UUID}/task/T-02">T-02 — Resolve typed references</a>`));
  assert.match(html, new RegExp(`href="#/change/${UUID}/task/T-03"`));
  assert.match(html, /changes\/demo\/tasks\.md:1/);
  assert.match(html, /href="#\/file\/changes%2Fdemo%2Ftasks\.md"/);
});

test('reference view: an acceptance criterion names its modes and its reverse references', () => {
  const html = referenceViewHtml({
    schemaVersion: 2,
    identity: { id: UUID, slug: 'demo', kind: 'change', stage: 'execute' },
    location: { location: 'archive', rel: 'changes/archive/2026-03-03-demo', dirName: '2026-03-03-demo' },
    type: 'acceptance',
    item: { id: 'AC-01', title: 'Readable task entry', required: true, evidenceModes: ['automated'], checks: 'test/x.test.mjs', requirements: 'cap / Req', line: 3, path: 'changes/archive/2026-03-03-demo/acceptance.md', incoming: [{ type: 'task', from: 'T-01', field: 'accepts', label: 'Parse fields' }] },
    diagnostics: [],
    invalid: false,
  });
  assert.match(html, /<h3>AC-01 — Readable task entry<\/h3>/);
  assert.match(html, /automated, required/);
  assert.match(html, /checks: test\/x\.test\.mjs/);
  assert.match(html, /<span class="ref-label">referenced by<\/span>/);
  assert.match(html, /<span class="tag">archived<\/span>/, 'an archived change says so in its trail');
});

test('reference view: diagnostics are shown with their code and source, escaped', () => {
  const html = diagnosticsHtml([
    { code: 'unknown-dependency', message: 'task T-02 depends on T-GONE, which no task declares', severity: 'error', path: 'changes/demo/tasks.md', line: 7 },
    { code: 'x', message: '<script>alert(1)</script>', severity: 'notice' },
  ]);
  assert.match(html, /error: unknown-dependency: task T-02 depends on T-GONE.*\(changes\/demo\/tasks\.md:7\)/);
  assert.equal(/<script/.test(html), false);
  assert.equal(diagnosticsHtml([]), '');
  assert.equal(diagnosticsHtml(undefined), '');
});

// ---------------------------------------------------------------- accessible refresh (T-08)
test('route key: one stable key per destination, different for every typed reference', () => {
  const k = (h) => routeKey(parseRoute(h));
  assert.equal(k(`#/change/${UUID}`), `change:${UUID}:::`);
  assert.notEqual(k(`#/change/${UUID}/task/T-01`), k(`#/change/${UUID}/task/T-02`));
  assert.notEqual(k(`#/change/${UUID}/task/T-01`), k(`#/change/${UUID}/acceptance/T-01`));
  assert.notEqual(k(`#/change/${UUID}/evidence/V-1`), k(`#/change/${UUID}/evidence/V-1/acceptance/AC-01`));
  assert.equal(k('#/changes/demo'), 'changes:demo');
  assert.equal(k('#/file/a.md'), 'file:a.md');
  assert.equal(routeKey(null), '');
});

test('focus: navigation moves focus to the new heading, a live refresh never does', () => {
  const a = routeKey(parseRoute(`#/change/${UUID}/task/T-01`));
  const b = routeKey(parseRoute(`#/change/${UUID}/task/T-02`));
  assert.equal(shouldFocusHeading(a, b), true, 'a different destination takes focus');
  assert.equal(shouldFocusHeading(a, a), false, 'the same destination repainted by SSE does not');
  assert.equal(shouldFocusHeading(undefined, a), true, 'the first render takes focus');
});

test('refresh: a change route reacts to task, target and archive writes, and to nothing else', () => {
  const route = parseRoute(`#/change/${UUID}/task/T-01`);
  assert.equal(shouldRefetch(route, ['changes/demo/tasks.md']), true, 'a task edit');
  assert.equal(shouldRefetch(route, ['changes/demo/acceptance.md']), true, 'a target edit');
  assert.equal(shouldRefetch(route, ['changes/archive/2026-04-04-demo/tasks.md']), true, 'the archive move');
  assert.equal(shouldRefetch(route, ['specs/cap/spec.md']), true);
  assert.equal(shouldRefetch(route, ['.my-flow/state/current-change.json']), true);
  assert.equal(shouldRefetch(route, ['README.md', 'package.json']), false);
});

test('refresh: coarse watcher and polling directories reach the affected routes only', () => {
  for (const page of ['changes', 'change', 'specs', 'archive']) {
    assert.equal(shouldRefetch({ page }, ['changes']), true, page);
  }
  assert.equal(shouldRefetch({ page: 'scratch' }, ['.my-flow']), true);
  const file = { page: 'file', path: 'changes/demo/tasks.md' };
  for (const parent of ['changes', 'changes/demo', 'changes/demo/']) {
    assert.equal(shouldRefetch(file, [parent]), true, parent);
  }
  assert.equal(shouldRefetch(file, ['changes/other']), false);
  assert.equal(shouldRefetch(file, ['change']), false, 'directory names match at path boundaries');
  assert.equal(shouldRefetch(file, ['.my-flow/state']), true, 'editing permissions are refreshed');
  assert.equal(shouldRefetch({ page: 'styleguide' }, ['changes']), false);
});
