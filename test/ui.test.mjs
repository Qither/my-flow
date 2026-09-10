/**
 * Listbox reducer (web/ui.mjs): every keyboard, type-ahead and pointer decision as a pure
 * function over plain objects, plus the import-without-a-DOM guarantee.
 */
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { startServer } from '../scripts/dashboard.mjs';
import { parseRoute, shouldRefetch } from '../web/app.mjs';
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
