/**
 * Dashboard UI widgets (design D7 of dashboard-design-parity). The listbox decisions live in
 * `listboxNext`, a pure function over plain objects that node:test exercises without a DOM;
 * nothing in this module runs at import time.
 */

export const TYPEAHEAD_MS = 500;

const indexOf = (options, value) => Math.max(0, options.findIndex((o) => o.value === value));
const lower = (s) => String(s ?? '').toLowerCase();

/** Initial state for a listbox over `options` ([{ value, label }]) with `value` selected. */
export const listboxInit = (options, value) => ({
  options,
  value,
  open: false,
  active: indexOf(options, value),
  search: '',
  searchAt: 0,
});

const OPENERS = new Set(['ArrowDown', 'ArrowUp', 'Enter', ' ', 'Home', 'End']);
const isPrintable = (key) => typeof key === 'string' && key.length === 1 && key !== ' ';

/** Type-ahead (APG select-only combobox): a repeated initial cycles, a longer buffer matches a prefix. */
function typeahead(state, key, time) {
  const fresh = !(time - state.searchAt < TYPEAHEAD_MS) || !state.search;
  const search = fresh ? key : state.search + key;
  const labels = state.options.map((o) => lower(o.label));
  let active = state.active;
  if (search.length > 1 && [...search].every((c) => c === search[0])) {
    const n = labels.length;
    for (let step = 1; step <= n; step += 1) {
      const i = (state.active + step) % n;
      if (labels[i].startsWith(lower(search[0]))) { active = i; break; }
    }
  } else {
    const i = labels.findIndex((l) => l.startsWith(lower(search)));
    if (i >= 0) active = i;
  }
  return { ...state, open: true, active, search, searchAt: time };
}

const commit = (state, index) => {
  const opt = state.options[index] ?? state.options[state.active];
  const value = opt ? opt.value : state.value;
  return { ...state, value, active: indexOf(state.options, value), open: false, search: '', changed: value !== state.value, handled: true };
};
const opened = (state, active = indexOf(state.options, state.value)) => ({ ...state, open: true, active, search: '', changed: false, handled: true });
const closed = (state) => ({ ...state, open: false, search: '', changed: false, handled: true });
const unchanged = (state) => ({ ...state, changed: false, handled: false });

/**
 * state: { options, value, open, active, search, searchAt }
 * ev: { type: 'key', key, time } | { type: 'toggle' } | { type: 'open' } | { type: 'close' }
 *   | { type: 'pick', index } | { type: 'point', index }
 * Returns the next state plus `changed` (value committed to a new value) and `handled` (false
 * only for a key the table does not cover, and for Tab while closed). Never mutates `state`.
 */
export function listboxNext(state, ev) {
  const last = state.options.length - 1;
  switch (ev.type) {
    case 'toggle': return state.open ? closed(state) : opened(state);
    case 'open': return state.open ? { ...state, changed: false, handled: true } : opened(state);
    case 'close': return closed(state);
    case 'pick': return ev.index >= 0 && ev.index <= last ? commit(state, ev.index) : unchanged(state);
    case 'point': return ev.index >= 0 && ev.index <= last ? { ...state, active: ev.index, changed: false, handled: true } : unchanged(state);
    case 'key': break;
    default: return unchanged(state);
  }
  const { key, time = 0 } = ev;
  if (!state.open) {
    if (key === 'Home') return opened(state, 0);
    if (key === 'End') return opened(state, last);
    if (OPENERS.has(key)) return opened(state);
    if (isPrintable(key)) return { ...typeahead(state, key, time), changed: false, handled: true };
    return unchanged(state);
  }
  switch (key) {
    case 'ArrowDown': return { ...state, active: Math.min(state.active + 1, last), changed: false, handled: true };
    case 'ArrowUp': return { ...state, active: Math.max(state.active - 1, 0), changed: false, handled: true };
    case 'Home': return { ...state, active: 0, changed: false, handled: true };
    case 'End': return { ...state, active: last, changed: false, handled: true };
    case 'Enter':
    case ' ':
    case 'Tab': return commit(state, state.active);
    case 'Escape': return closed(state);
    default:
      if (isPrintable(key)) return { ...typeahead(state, key, time), changed: false, handled: true };
      return unchanged(state);
  }
}

/**
 * Wire a listbox (`.listbox` root with a `.listbox-trigger` button, a `.listbox-menu` list
 * and `[role="option"]` items) to the reducer. Focus stays on the trigger; the active option
 * is announced through aria-activedescendant. Returns { get, set, destroy }; `set` never calls
 * onChange. Event rules and the reason for each are in design D7.
 */
export function mountListbox(root, { onChange = () => {} } = {}) {
  const doc = root.ownerDocument;
  const trigger = root.querySelector('.listbox-trigger');
  const menu = root.querySelector('.listbox-menu');
  const valueEl = root.querySelector('.listbox-value');
  const items = [...menu.querySelectorAll('[role="option"]')];
  const options = items.map((li) => ({ value: li.dataset.value, label: li.textContent.trim() }));
  let state = listboxInit(options, root.dataset.value ?? options[0]?.value);

  const paint = () => {
    menu.hidden = !state.open;
    trigger.setAttribute('aria-expanded', String(state.open));
    const activeItem = state.open ? items[state.active] : null;
    if (activeItem) trigger.setAttribute('aria-activedescendant', activeItem.id);
    else trigger.removeAttribute('aria-activedescendant'); // a stale descendant on a closed box is read as focused by some screen readers
    items.forEach((li, i) => {
      li.setAttribute('aria-selected', String(li.dataset.value === state.value));
      if (state.open && i === state.active) li.dataset.active = 'true';
      else delete li.dataset.active;
    });
    const current = options.find((o) => o.value === state.value);
    if (valueEl && current) valueEl.textContent = current.label;
    root.dataset.value = state.value;
    if (activeItem && typeof activeItem.scrollIntoView === 'function') activeItem.scrollIntoView({ block: 'nearest' });
  };
  const dispatch = (ev) => {
    const next = listboxNext(state, ev);
    const { changed, handled, ...rest } = next;
    state = rest;
    paint();
    if (changed) onChange(state.value);
    return { changed, handled };
  };
  const indexOfTarget = (ev) => items.indexOf(ev.target.closest ? ev.target.closest('[role="option"]') : null);

  // A <button> synthesises click on Enter (keydown) and Space (keyup); without preventDefault
  // the reducer would commit and close and the synthesised click would reopen. Tab keeps its
  // default so focus moves on after the commit.
  const onKeydown = (ev) => { const r = dispatch({ type: 'key', key: ev.key, time: ev.timeStamp }); if (r.handled && ev.key !== 'Tab') ev.preventDefault(); };
  const onClick = () => dispatch({ type: 'toggle' }); // the only pointer toggle path
  // Options are non-focusable; a pointerdown on one would move focus to body, fire focusout and
  // hide the menu before the click that commits could land. Keep focus on the trigger.
  const onMenuPointerdown = (ev) => ev.preventDefault();
  const onMenuPointermove = (ev) => { const i = indexOfTarget(ev); if (i >= 0 && i !== state.active) dispatch({ type: 'point', index: i }); };
  const onMenuClick = (ev) => { const i = indexOfTarget(ev); if (i >= 0) dispatch({ type: 'pick', index: i }); };
  const onFocusout = (ev) => { if (state.open && !root.contains(ev.relatedTarget)) dispatch({ type: 'close' }); };
  const onDocPointerdown = (ev) => { if (state.open && !root.contains(ev.target)) dispatch({ type: 'close' }); };

  trigger.addEventListener('keydown', onKeydown);
  trigger.addEventListener('click', onClick);
  menu.addEventListener('pointerdown', onMenuPointerdown);
  menu.addEventListener('pointermove', onMenuPointermove);
  menu.addEventListener('click', onMenuClick);
  root.addEventListener('focusout', onFocusout);
  doc.addEventListener('pointerdown', onDocPointerdown);
  paint();

  return {
    get: () => state.value,
    set(value) {
      state = { ...state, value, active: Math.max(0, options.findIndex((o) => o.value === value)), open: false, search: '' };
      paint();
    },
    destroy() {
      trigger.removeEventListener('keydown', onKeydown);
      trigger.removeEventListener('click', onClick);
      menu.removeEventListener('pointerdown', onMenuPointerdown);
      menu.removeEventListener('pointermove', onMenuPointermove);
      menu.removeEventListener('click', onMenuClick);
      root.removeEventListener('focusout', onFocusout);
      doc.removeEventListener('pointerdown', onDocPointerdown);
    },
  };
}
