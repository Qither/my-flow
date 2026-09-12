# PLAN-DR

## Principles

1. **Fix the cause named in the proposal, not its symptom.** Each of the seven items is traced
   to the declaration or the line that produces it before anything is written; where the reading
   in `proposal.md` turns out to be incomplete, this design says so (D11) rather than patching
   around it.
2. **CSS first, JavaScript only where CSS cannot reach.** Five of the seven items are pure
   stylesheet fixes. `web/app.mjs` changes only for the three things the stylesheet genuinely
   cannot do: the `<select>` wiring, the per-file modification time, and the keyboard handler.
3. **Pure helpers stay exported and DOM-free.** Everything the keyboard navigation decides
   (which file is next, previous, latest, and which directories must reopen) is computed by
   exported functions that `node --test` calls with plain arrays, exactly as `buildTree`
   (`web/app.mjs:75`) and `parseUnifiedDiff` (`web/app.mjs:48`) already are. The DOM handler is
   left with nothing but reading a key and setting a hash.
4. **Surgical diffs, no new palette.** No colour token is added or renamed. Every contrast fix
   is expressed with tokens that already exist, and the two theme-invariant ones (`--lime`,
   `--lime-ink`) are used deliberately because they are the same value in both palettes.
5. **Zero dependency, zero network.** No `<select>` replacement widget, no icon font, no
   `url()`, no data URI. The dropdown indicator is a Unicode glyph in a pseudo-element, the same
   device the directory toggle already uses (`web/app.css:210`).

## Decision Drivers

1. **Readability in both palettes is the acceptance bar.** Success criteria 1 and 5 are
   screenshots, not assertions. Any option that is only demonstrably correct in one theme is
   rejected, which is why the two contrast fixes are written against tokens whose values are
   pinned in both blocks rather than left to inheritance (D11).
2. **`web/` is entirely untracked, so `git diff` proves nothing about it.** `git status --short`
   collapses the whole directory to one `?? web/` line, so every verification in this change
   either compares against a scratchpad snapshot taken before the first edit, or asserts a fact
   the running page reports (a computed style, a measured width, a DOM count). This driver shapes
   task 1.1 and most of the `and verify` clauses.
3. **A keyboard shortcut must never steal a keystroke the user meant for a control.** Success
   criterion 4 requires that typing in the editor's textarea never fires a shortcut, and the
   theme `<select>` this change introduces is focusable from the diff page, so the guard has to
   cover form controls generally, not just the textarea (D9).

## Viable Options

The change as a whole was considered in two shapes:

- **A (chosen). One change touching `web/`, `scripts/dashboard.mjs`, `test/diff.test.mjs` and
  the docs.** The seven items share two files and one verification pass; splitting them would
  mean two headless-Chrome runs over the same screens. The two items that are not pure CSS
  (`mtimeMs` and the shortcuts) are the same feature seen from the two ends of the wire, so they
  cannot be split from each other anyway.
- **B. Two changes: the four cosmetic fixes first, then the current-file feature.** *Rejected.*
  The cosmetic fixes and the marker land in the same rows of the same list
  (`web/app.css:212-216`), so the second change would immediately reopen the first change's
  lines; and the row-alignment fix (D11) is what makes the marker legible in the first place.

Per-decision options are recorded inside each decision below. D4, D7 and D12 are recorded with
their alternatives explicitly invalidated rather than weighed, because the code leaves one
correct answer.

## Context

The dashboard is a Node server (`scripts/dashboard.mjs`) plus four static assets in `web/`. This
change touches the browser page and one server function. The evidence below is what constrains
each item; every one of the proposal's seven diagnoses was checked against the file.

**Item 1, diff scrollbars: confirmed.** The scrollbar block is `web/app.css:231-255`. Its inner
area group names exactly `.editor textarea` and `.sidebar` (`web/app.css:241-247`), the code
group names `pre` (`:248-251`), and the Firefox fallback repeats the same three selectors plus
`pre` inside `@supports not selector(::-webkit-scrollbar)` (`:252-255`). `.patch` declares
`overflow-x: auto` (`web/app.css:219`) and appears in none of them, so a wide patch line paints
Chromium's own bar. `.diff-left` (`web/app.css:205`) declares no `overflow` at all today, so it
does not scroll and has no bar to style yet.

**Item 2, the 1100 px cap: confirmed.** `.content { flex: 1 1 auto; padding: 20px 28px 60px;
max-width: 1100px; min-width: 0 }` (`web/app.css:97`) is the only width rule, and `#view` carries
that class for every route (`web/index.html:35`). The diff grid inside it is
`minmax(220px, 1fr) 2fr` (`web/app.css:203`), collapsing to one column below 1000 px
(`web/app.css:204`).

**Item 3, the theme control: confirmed.** `web/index.html:25-29` is a `role="group"` holding
three buttons carrying `data-theme-choice`. `web/app.css:197-200` styles them and their
`aria-pressed="true"` state. `applyTheme` (`web/app.mjs:154-162`) sets or removes `data-theme` on
the document root and then writes `aria-pressed` on every `[data-theme-choice]`; the three click
listeners are bound at `web/app.mjs:164-171`. The pre-paint script is `web/index.html:8` and the
pure helpers are `THEME_KEY`, `normalizeTheme` and `themeAttr` at `web/app.mjs:106-109`, covered
by the test at `test/diff.test.mjs:195`.

**Item 4, the progress bar: confirmed, and the proposal's reading is exact.** `progressHtml`
(`web/app.mjs:114-117`) emits `<span class="progress"><span class="bar"><span class="fill"
style="width:N%">`. `.progress` is `display: flex` (`web/app.css:158`), so `.bar` is a flex item
and is blockified: its `flex: 1 1 auto` and `height: 6px` (`web/app.css:159`) take effect. But
`.bar` establishes an ordinary block container, so its child `.fill` stays an inline box, and an
inline box ignores both `width` and `height: 100%` (`web/app.css:160`). The bar therefore paints
`--paper-2` at every ratio while only the `done/total` text moves. Nothing else is wrong with the
element: the inline `style="width:N%"` and the `transition: width` are both already correct and
start working the moment the box becomes block-level.

**Item 5, the current file: confirmed as absent.** `diffList` (`scripts/dashboard.mjs:148-195`)
builds each entry from `git diff --name-status -z -M` (`:158-166`), fills counts from `--numstat`
(`:168-181`), then appends untracked entries from `ls-files --others` (`:183-193`). No entry
carries a time. `changeDetail` already has the house pattern for one, `mtimeMs: st?.mtimeMs ??
null` (`scripts/dashboard.mjs:239`). The untracked loop already calls `lstatSync(abs)` inside a
`try` for its `isFile()` check (`:188`), and `lstatSync` is already imported (`:16`).
`WATCH_DIRS` is `['specs', 'changes', '.my-flow']` (`scripts/dashboard.mjs:28`), so an edit to a
source file produces no `change` event and the diff page still depends on its Refresh button;
`shouldRefetch` returns `true` for the diff route on any event (`web/app.mjs:41`).

**Item 6, the dark-mode status letter: confirmed, with one refinement.** `.tag` sets
`background: var(--paper-2)` and no `color` (`web/app.css:154`), so the letter's colour is
inherited. In dark mode `--paper-2` is `oklch(21% 0.025 165)`, near-black (`web/app.css:44`,
repeated at `:31`). Two ancestors set a black colour on it: `li.file.selected { background:
var(--lime); color: var(--lime-ink) }` (`web/app.css:214`), and the generic `a:hover { background:
var(--lime); color: var(--lime-ink) }` (`web/app.css:65`), which applies because `fileRow`
(`web/app.mjs:400`) nests `<span class="tag st">` *inside* the anchor. `--lime-ink` is
`oklch(0% 0 0)` (`web/app.css:10`) and is **not** redeclared in either dark block
(`web/app.css:28-40`, `:41-52`), so it is pure black in both themes: black on near-black. The
refinement to the proposal's wording is that the hover case is not a second bug but the same rule
reached through a different ancestor, so both are fixed by the same declaration (D11). `--lime`
is likewise theme-invariant, `oklch(88% 0.22 125)` (`web/app.css:9`), which is what makes the
inverted pair chosen in D11 safe in both palettes.

**Item 7, row alignment: confirmed.** `.diff-tree li.file { display: flex; gap: 8px;
align-items: baseline; padding: 1px 4px }` (`web/app.css:212`). The row's two flex items are the
anchor and the `<span class="meta">` (`web/app.mjs:400-401`). Only the anchor is painted on hover
(the generic `a:hover`, `web/app.css:65`), so the highlight stops before the counts; the
selection rule paints the whole `li` (`:214`), so hover and selection have visibly different
shapes. `align-items: baseline` aligns the anchor's first baseline with the meta's, and the
status tag inside the anchor carries its own border and padding (`web/app.css:154`), so it sits
off-centre against the row box.

**Tests.** `test/diff.test.mjs` holds the git fixture (`:22-38`): `keep.md` modified, `gone.md`
deleted, `same.md` unchanged, `fresh.md` untracked, `blob.bin` untracked binary, plus scratch
files under `.my-flow/`. `up()` (`:40-51`) starts a server on port 0 and returns `getJson`. The
list assertions are at `:53-73`, the symlink case at `:123-143`, and the pure-helper tests at
`:184-210`. `test/dashboard.test.mjs:519` reads every file in `web/` and asserts none contains
`http(s)://`. Baseline measured for this design: `npm test` reports **86 passed, 0 failed**.

**Git.** The repository is a work tree, but `git status --short` lists `?? web/`,
`?? test/diff.test.mjs`, `?? scripts/dashboard.mjs`, `?? src/skills/dashboard.md`, `?? skills/`,
`?? codex/skills/my-flow-dashboard/`, `?? specs/` and `?? changes/` as untracked; only the eight
`README*.md` files and a few scripts are tracked and modified. So `git diff` will show this
change's README edits and nothing else, and every other verification needs a snapshot or a
runtime measurement (driver 2).

## Goals / Non-Goals

**Goals:**

- The diff page uses the whole window width and paints the dashboard's own scrollbars on every
  surface that scrolls, in both themes.
- The theme control is one native `<select>` with the same three values, the same storage key,
  the same pre-paint behaviour and the same tolerance of a denied `localStorage`.
- The task progress bar shows a lime fill proportional to `done/total` and follows a tick without
  a reload.
- `GET /api/diff` reports a per-file modification time; the page marks the newest one and offers
  three keyboard shortcuts, listed on the page, that never fire while a form control has focus.
- In both themes the status letter stays readable on a hovered and on a selected row, and the
  row is one horizontally aligned, vertically centred highlighted box.

**Non-Goals:** all of the proposal's, unchanged. Additionally, decided here and out of scope:

- No new watcher and no watched directory: the diff page still does not auto-refresh for edits
  outside `specs/`, `changes/` and `.my-flow/` (`scripts/dashboard.mjs:28`), and the
  latest-modified marker therefore only moves when the page refetches. The page already says so
  (`web/app.mjs:425`).
- No persistence of the selected file, the scroll position, or the expanded directories across a
  reload.
- No shortcut on any page but the diff page, and no shortcut that scrolls or collapses.
- No change to `progressHtml`'s markup or to `pct()`; item 4 is fixed in the stylesheet alone.
- No sorting of the file list by modification time. The order stays git's byte order
  (`web/app.mjs:92`); only the marker is new.

## Decisions

### D1. The progress bar fill becomes a block box: `.bar .fill { display: block }`

*Viable options.* (i) Add `display: block` to the existing `.bar .fill` rule. (ii) Make `.bar` a
flex container and let the fill be a flex item with `flex: 0 0 auto`. (iii) Change
`progressHtml` to emit a `<div>` instead of a `<span>`.

**Chosen: (i).** `web/app.css:160` becomes
`.bar .fill { display: block; height: 100%; background: var(--lime); transition: width var(--t); }`.
One declaration, in the rule that already exists, and both `width` and `height: 100%` start
applying at once because a block-level child of a definite-height block container resolves
`height: 100%` against it.

*Rejected (ii)*: it works, but it adds a second layout mode to a 6 px box and would need
`min-width: 0` reasoning for the fill; more moving parts for the same pixel.
*Rejected (iii)*: `progressHtml` sits inside `.card-head`, a flex row (`web/app.css:152`), and
inside `rowHtml`'s template; swapping the element for a `<div>` changes an exported function the
Changes page and the change-detail page both depend on, to fix a problem that is entirely in the
stylesheet. Principle 2.

### D2. The diff route drops the width cap through a `wide` class the router sets on `#view`

*Viable options.* (i) `render()` toggles a class on `#view`; `.content.wide { max-width: none }`.
(ii) A `:has()` selector: `.content:has(.diff) { max-width: none }`. (iii) Move `max-width` off
`.content` onto each page's own wrapper.

**Chosen: (i).** In the stylesheet, directly after `.content` (`web/app.css:97`):

```
.content.wide { max-width: none; }
```

and in `render()` (`web/app.mjs:448-473`), `view.classList.toggle('wide', route.page === 'diff')`
placed **after** the supersede check at `:468` and immediately **before**
`view.innerHTML = html` at `:469`.

The placement is the decision, not an afterthought. The obvious site, next to the `data-nav` loop
at `:450`, is wrong twice over: it runs before the `await`, so the *outgoing* page is repainted at
the new width for the whole duration of the fetch, which on the diff route is two round trips
(`/api/diff`, then `/api/diff/file`); and it runs unconditionally, so a render that is later
superseded still leaves its width behind. Setting the class in the same synchronous block that
assigns the HTML means the class and the markup it describes land in one frame, and a superseded
render returns at `:468` without having touched the width at all. `toggle` with an explicit second
argument also removes the class on every other route, so the Changes page keeps its cap with no
extra bookkeeping.

*Rejected (ii)*: `:has()` makes the container's width depend on a class deep inside the page that
a future edit could rename silently, and it moves a routing fact into a content selector.
*Rejected (iii)*: it touches all four other pages to change one, against Principle 4.

### D3. The file pane becomes sticky with its own scroll area, and reverts below 1000 px

*Viable options.* (i) Sticky pane with `max-height` and `overflow: auto`. (ii) Leave the pane in
the page flow as today.

**Chosen: (i).** Once the page is as wide as the window (D2) the patch is the tall element, and
the keyboard shortcuts (D9) are useless if the row they select has scrolled out of sight. In the
diff block (`web/app.css:203-217`):

```
/* the existing rule at web/app.css:205, with four declarations appended */
.diff-left { border: var(--control-border) solid var(--border); background: var(--paper); padding: 8px 10px; font-family: var(--mono); font-size: 0.85em;
             position: sticky; top: 16px; max-height: calc(100vh - 32px); overflow: auto; }
/* a NEW media block, after the rule above, not the one at web/app.css:204 */
@media (max-width: 1000px) { .diff-left { position: static; max-height: none; overflow: visible; } }
```

`.diff` already declares `align-items: start` (`web/app.css:203`), which is what makes a sticky
grid item possible; without it the item would be stretched to the row height and never stick.

**The reset needs its own `@media` block, placed after the base rule.** The existing one-column
media block sits at `web/app.css:204`, *above* the `.diff-left` rule at `:205`. Putting the reset
inside that block would give it the same specificity as the base declarations and an earlier
position in the cascade, so `position: sticky`, `max-height` and `overflow` from `:205` would win
and the reset would be silently dead. The new block therefore goes after the base rule instead,
and the existing block at `:204` is left byte-identical. Below 1000 px the pane sits *above* the
patch, where a sticky, height-capped list would pin a scrollbox over the content instead of
letting the page scroll, so the reset has to actually apply.

Because the pane now scrolls it needs scrollbar rules; that is D4, and it is why this decision
and D4 are one unit.

*Rejected (ii)*: it leaves criterion 1's wide-window case looking worse rather than better, since
a full-width patch makes the vertical distance between the list and the patch's tail larger, and
it makes the shortcuts of D9 select rows the user cannot see.

### D4. `.patch` and `.diff-left` join the existing inner-area scrollbar group

*Alternatives explicitly invalidated.* The archived scrollbar design settled the mechanism
(WebKit pseudo-elements, with the standard-property fallback confined to
`@supports not selector(::-webkit-scrollbar)` because in Chromium a non-`auto` `scrollbar-color`
disables every `::-webkit-scrollbar` rule on that container, and because `scrollbar-color`
inherits). Nothing about a second scroll container reopens that; the only question is which of
the three existing groups these two surfaces join, and the proposal answers it: the inner-area
group, "with the 'inner area' width and colours". So:

```
.editor textarea::-webkit-scrollbar,
.sidebar::-webkit-scrollbar,
.diff-left::-webkit-scrollbar,
.patch::-webkit-scrollbar { width: 16px; height: 16px; }
```

with `.diff-left` and `.patch` added to the `-track` and `-thumb` selector lists at
`web/app.css:243-246`, a `-corner` rule for both alongside the textarea's at `:247`, and both
names added to the `body, .editor textarea, .sidebar` line inside `@supports`
(`web/app.css:253`).

`height: 16px` is new to this group and is the load-bearing half for `.patch`: `.patch` scrolls
horizontally (`web/app.css:219`), and a horizontal `::-webkit-scrollbar` takes its thickness from
`height`, not `width`. Adding it to the shared rule also nominally applies to `.editor textarea`
and `.sidebar`; neither scrolls horizontally today (the textarea wraps, the sidebar has no
`overflow`), so the declaration is inert there, and writing a separate `.patch::-webkit-scrollbar`
rule purely to avoid an inert declaration would duplicate the selector for no observable
difference. The corner rules matter because `.patch` can scroll on both axes once the pane is
capped in height, and an unstyled corner paints a UA-default patch beside two hand-styled bars,
which is exactly the artefact the scrollbar change removed.

### D5. The theme control becomes a native `<select>` with `appearance: none` and a CSS-drawn indicator

*Viable options.* (i) Native `<select>` with `appearance: none` and a `::after` glyph on a
wrapper. (ii) Native `<select>` left with `appearance: auto`, styled only in colour. (iii) A
custom listbox built from a button and a `<ul>`.

**Chosen: (i).** `web/index.html:25-29` becomes:

```html
<div class="theme">
  <label class="theme-label" for="theme-select">Theme</label>
  <span class="select-wrap">
    <select id="theme-select" title="follow or override the system colour scheme">
      <option value="system">Auto (system)</option>
      <option value="light">Light</option>
      <option value="dark">Dark</option>
    </select>
  </span>
</div>
```

and `web/app.css:197-200` becomes:

```
.theme { display: flex; flex-direction: column; gap: 4px; }
.theme-label { font-size: 0.75em; color: var(--ink-muted); }
.select-wrap { position: relative; display: block; }
.select-wrap::after { content: "\25BE"; position: absolute; right: 8px; top: 50%; transform: translateY(-50%); pointer-events: none; font-size: 0.8em; }
.select-wrap:hover::after { color: var(--lime-ink); }
.theme select {
  appearance: none; -webkit-appearance: none;
  font: inherit; font-weight: 600; font-size: 0.85em;
  width: 100%; padding: 3px 22px 3px 8px;
  border: var(--control-border) solid var(--border);
  box-shadow: 2px 2px 0 0 var(--shadow-color);
  background: var(--paper); color: var(--ink);
  cursor: pointer; border-radius: 0;
}
.theme select:hover { background: var(--lime); color: var(--lime-ink); }
.theme select:focus-visible { outline: 2px solid var(--ink); outline-offset: 3px; }
```

`appearance: none` rather than the native arrow, for the reason this project already accepted for
the scrollbars: the OS-drawn control is rounded, gradient-filled and grey, and one such widget in
a sidebar of square hard-shadowed boxes is precisely the mixed-design artefact the scrollbar
change existed to remove. `border-radius: 0` is written explicitly because some engines keep a
radius after `appearance: none`.

The indicator is `\25BE` (BLACK DOWN-POINTING SMALL TRIANGLE) in a pseudo-element on the wrapper,
not on the `<select>`: pseudo-elements on a `<select>` do not render in Blink. The same glyph and
the same technique are already in the file at `web/app.css:210` for the directory toggle, so it
needs no image, no font and no data URI, and the offline test (`test/dashboard.test.mjs:519`)
stays green by construction. `pointer-events: none` keeps clicks reaching the select.

The indicator's colour is inherited from `.theme`, so it follows `--ink` in both themes — except
while the control is hovered, which is why `.select-wrap:hover::after` exists. `.theme
select:hover` paints the box lime, but the glyph lives on the wrapper, outside the select, so it
would keep inheriting `--ink`: in dark mode that is near-white on lime, which is the same
disappearing-glyph failure as proposal item 6. Pinning it to `--lime-ink` on hover matches what
the select's own text does, and `--lime-ink` is theme-invariant (`web/app.css:10`), so the one
declaration covers both palettes.

The option list itself is drawn by the OS and is deliberately not styled: `color-scheme` on `:root`
(`web/app.css:4`) and on the two theme blocks (`:42`, `:53`) already makes the popup follow the
chosen palette, which is more than a hand-built listbox would get for free.

*Rejected (ii)*: keeps the grey rounded widget, i.e. does not deliver the visual half of the
proposal. *Rejected (iii)*: the proposal's Non-Goals forbid a custom dropdown widget outright,
and it would cost keyboard and screen-reader behaviour the native element already has.

### D6. `applyTheme` writes `select.value`; one `change` listener replaces the three click listeners

`THEME_KEY`, `normalizeTheme`, `themeAttr` (`web/app.mjs:106-109`), the `storage` wrapper
(`:131-153`) and the pre-paint script (`web/index.html:8`) are untouched, so the exported surface
the tests exercise (`test/diff.test.mjs:195`) and the no-flash behaviour are unchanged by
construction. Inside `applyTheme` (`web/app.mjs:154-162`), the `[data-theme-choice]` loop at
`:161` is replaced by:

```js
const sel = doc.getElementById('theme-select');
if (sel) sel.value = choice;
```

and the click-listener loop (`:164-171`) by a single:

```js
doc.getElementById('theme-select')?.addEventListener('change', (ev) => {
  const choice = normalizeTheme(ev.target.value);
  applyTheme(choice);            // the document first, persistence second
  if (choice === 'system') storage.remove(THEME_KEY);
  else storage.set(THEME_KEY, choice);
});
```

The order stays "document first, persistence second", which is what makes success criterion 2's
storage-denied case work: `storage.set` swallows the exception (`web/app.mjs:145-147`) after the
page has already switched. Setting `sel.value` inside `applyTheme` covers the initial call at
`:163`, so a stored `dark` selects the right option on load; an unrecognised stored value
normalises to `system`, which is a real option, so `select.value` can never be left blank.

### D7. `mtimeMs` comes from `lstatSync` inside `diffList`, and is `null` when the stat fails

*Alternative explicitly invalidated.* `statSync` would follow symbolic links, and the spec
requires that an entry which is a link is never followed (`specs/dashboard/spec.md`, scenario
"A symbolic link is listed but never followed"; enforced at `scripts/dashboard.mjs:214`).
`lstatSync` is therefore the only correct call, and it is already imported
(`scripts/dashboard.mjs:16`) and already used for exactly this purpose in the untracked loop
(`:188`). There is no second viable option.

A module-level helper next to `sniffBinary`:

```js
/** The entry's own modification time; null when it cannot be stated (deleted), never following a link. */
function mtimeOf(root, path) {
  try {
    return lstatSync(join(root, path)).mtimeMs;
  } catch {
    return null;
  }
}
```

Tracked entries take `mtimeMs: mtimeOf(root, path)` in the object literal at
`scripts/dashboard.mjs:163`. For a rename the time is the *new* path's, because `path` is the new
path and `oldPath` no longer exists. For status `D` the file is gone, `lstatSync` throws `ENOENT`
and the field is `null`, which is exactly what the API is specified to return. Untracked entries
reuse the stat the loop already takes (`:186-190`), which becomes:

```js
let binary = false;
let mtimeMs = null;
try {
  const st = lstatSync(abs);
  mtimeMs = st.mtimeMs;
  if (st.isFile()) binary = sniffBinary(abs);
} catch {
  /* listed but unreadable: still listed, with no time */
}
```

so an untracked symlink is listed with the link's own time and the target is still never read.
No extra syscall is added for untracked files; tracked files cost one `lstat` each, on a list
that is already the product of two `git diff` invocations.

`diffPatch` is not touched: the time is a property of the listing, and the file endpoint already
refuses anything the listing does not contain (`scripts/dashboard.mjs:513-514`).

**Tests** (`test/diff.test.mjs`, adding `lstatSync` to the `node:fs` import at `:7`):

- extend the list test at `:53-73` with `assert.equal(typeof by['keep.md'].mtimeMs, 'number')`,
  `assert.ok(by['keep.md'].mtimeMs > 0)`, `assert.equal(by['gone.md'].mtimeMs, null)` for the
  deleted file, and `assert.equal(typeof by['fresh.md'].mtimeMs, 'number')` for the untracked one;
- one new test, `diff: mtimeMs is the file's own lstat time and moves when the file is rewritten`:
  fetch `/api/diff`, assert `by['keep.md'].mtimeMs === lstatSync(join(root, 'keep.md')).mtimeMs`
  exactly, then rewrite `keep.md` with new content, fetch again, and assert the new value equals
  the new `lstatSync` value and is `>=` the first (`>=`, not `>`: a filesystem timestamp can have
  coarse resolution, and equality on a fast machine is not a bug);
- extend the symlink test at `:123-143` with
  `assert.equal(list.json.files.find((f) => f.path === 'link.md').mtimeMs, lstatSync(join(root, 'link.md')).mtimeMs)`,
  which is the link's own time by definition of `lstat` and therefore shows the link was not
  followed for the time either.

### D8. Three pure helpers carry all the navigation logic

*Viable options.* (i) Three exported pure functions with the DOM handler reduced to reading a key
and setting a hash. (ii) One function that takes the DOM list and returns an element.

**Chosen: (i).** Added to the pure-helper section of `web/app.mjs`, after `buildTree` (`:75-100`):

```js
/** Diff tree -> the entries in the order the page renders them: each node's directories first, then its files. */
export function flattenTree(node) {
  return [...node.dirs.flatMap(flattenTree), ...node.files];
}

/** 'a/b/c.md' -> ['a', 'a/b']; the directories that must be open for that row to be visible. */
export function ancestorDirs(path) {
  const parts = String(path ?? '').split('/').slice(0, -1);
  return parts.map((_, i) => parts.slice(0, i + 1).join('/'));
}

/** Keyboard targets over the rendered order: { next, prev, latest }, wrapping at both ends. */
export function diffNav(files, current) {
  const paths = files.map((f) => f.path);
  let latest = null;
  for (const f of files) if (typeof f.mtimeMs === 'number' && (latest === null || f.mtimeMs > latest.mtimeMs)) latest = f;
  const out = { next: null, prev: null, latest: latest ? latest.path : null };
  if (!paths.length) return out;
  const i = paths.indexOf(current);
  if (i === -1) return { ...out, next: paths[0], prev: paths.at(-1) };
  return { ...out, next: paths[(i + 1) % paths.length], prev: paths[(i - 1 + paths.length) % paths.length] };
}
```

`flattenTree` must reproduce the render order exactly, and it does: `pageDiff` renders
`tree.dirs.map(dirHtml)` before `tree.files.map(fileRow)` (`web/app.mjs:407`), and `dirHtml`
renders `d.dirs.map(dirHtml)` before `d.files.map(fileRow)` (`:404`). If the two ever diverge,
`j` would jump somewhere the eye does not expect, so the ordering is asserted in the tests below
against a fixture whose expected order is written out by hand.

`diffNav` **wraps** rather than clamping: with three shortcuts and no other way to move, stopping
at the last file would strand the user, and `.` already provides a non-wrapping jump. Ties on
`mtimeMs` resolve to the first entry in the given order, because the comparison is strictly `>`;
that makes the marker deterministic when two files were written in the same millisecond, which is
common when an agent writes a batch. Entries whose `mtimeMs` is `null` (deleted files) are never
the latest; when every entry is `null`, `latest` is `null` and `.` does nothing.

*Rejected (ii)*: it would need a DOM in the tests, which Principle 3 and the module's own
structure (`web/app.mjs:523` boots only when `#view` exists) exist to avoid.

**Test cases** for a new `client: diff keyboard navigation helpers` in `test/diff.test.mjs`,
importing `ancestorDirs, diffNav, flattenTree`:

1. `flattenTree(buildTree([]))` is `[]`.
2. `flattenTree(buildTree(...))` over `['web/app.mjs', 'README.md', 'web/app.css',
   'test/x/deep.mjs', 'a.md']` returns exactly
   `['test/x/deep.mjs', 'web/app.css', 'web/app.mjs', 'README.md', 'a.md']`, i.e. every directory
   subtree before the root's own files, matching `web/app.mjs:404,407`.
3. `diffNav([], null)` is `{ next: null, prev: null, latest: null }`.
4. `diffNav(files, null)` gives the first path as `next` and the last as `prev`.
5. `diffNav(files, 'not/in/the/list.md')` gives the same as case 4.
6. from a middle entry, `next` and `prev` are its neighbours.
7. from the last entry `next` is the first; from the first entry `prev` is the last.
8. a one-entry list returns that path for both `next` and `prev`.
9. `latest` is the path with the greatest `mtimeMs`, with a `null`-`mtimeMs` entry present in the
   list.
10. every `mtimeMs` `null` gives `latest: null`.
11. two entries sharing the greatest `mtimeMs` give the earlier one in list order.
12. `ancestorDirs('a/b/c.md')` is `['a', 'a/b']`; `ancestorDirs('root.md')` is `[]`;
    `ancestorDirs(null)` is `[]`.

### D9. One `keydown` listener, bound while the diff route is live, removed on every route change

Keys, taken from the proposal's own example because they are the reading-order convention users
already have from pagers and code-review tools:

| key | action |
|---|---|
| `j` | next file in the rendered order |
| `k` | previous file |
| `.` | the latest-modified file |

**The rendered order travels back as an out-parameter, and is committed only once the render
wins.** `render()` (`web/app.mjs:448-473`) allows two renders to be in flight at once and settles
the race with `if (rendering !== job) return;` at `:468`; a slow first render finishing after a
fast second one is normal on the diff route, which makes two round trips. If `pageDiff` assigned
`state.diffOrder` itself, the loser would overwrite the winner's list and `j` would navigate
against a page nobody is looking at. So `pageDiff` takes a second argument and writes into it,
and `render()` commits after the supersede check:

```js
const pageDiff = async (path, out) => {
  if (!state.git) {
    out.order = [];
    return '<h1>Diff</h1><p class="empty">this project root is not inside a git work tree, so there is no diff to show</p>';
  }
  const { ok, body } = await api('/api/diff');
  if (!ok) {
    out.order = [];
    return `<h1>Diff</h1>${fail(body)}`;
  }
  // ... unchanged, then, before `left` is built:
  const tree = buildTree(body.files);
  const ordered = view === 'tree' ? flattenTree(tree) : body.files;
  out.order = ordered;
  const latest = diffNav(ordered, null).latest;
```

Both early returns set `out.order = []` deliberately: without git (`web/app.mjs:395`) and after a
failed fetch (`:397`) there is no list on the page, so a shortcut must do nothing rather than
navigate against whatever the previous successful render left behind. `latest` is computed here,
before `left` is assembled at `:407`, because `fileRow` (`:399`) closes over it.

`wireDiff` (`web/app.mjs:428-444`) then binds one listener on the document and stores its
remover:

```js
const onKey = (ev) => {
  if (ev.ctrlKey || ev.altKey || ev.metaKey || ev.isComposing) return;
  if (state.route.page !== 'diff') return;
  const t = ev.target;
  const tag = t && t.tagName ? t.tagName : '';
  if (tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' || (t && t.isContentEditable)) return;
  const nav = diffNav(state.diffOrder ?? [], state.route.path);
  const target = ev.key === 'j' ? nav.next : ev.key === 'k' ? nav.prev : ev.key === '.' ? nav.latest : null;
  if (!target) return;
  ev.preventDefault();
  for (const d of ancestorDirs(target)) state.diffClosed.delete(d);
  win.location.hash = `#/diff/${encodeURIComponent(target)}`;
};
doc.addEventListener('keydown', onKey);
state.unbindDiffKeys = () => doc.removeEventListener('keydown', onKey);
```

**The route guard is the price of keeping the listener live across the fetch.** Moving the unbind
to the commit site means the listener survives the whole render that follows navigating *away*
from the diff page, and `render()` has already set `state.route` to the new route at `:449`.
Without `if (state.route.page !== 'diff') return;`, a `j` pressed in that window would call
`diffNav(order, undefined)`, which by design falls back to the first path (D8), and set the hash
straight back to `#/diff/...` — dragging the user onto a page they just left. The delta spec says
the shortcuts are removed when the view is left, so this is a contract violation, not a rough
edge. The guard sits immediately after the modifier check, before any work, so the listener is
inert on every route but its own even while it is still attached.

**Unbind and rebind happen at the same site**, in the synchronous block after the supersede check
at `web/app.mjs:468`, alongside the order commit and the `wide` toggle from D2:

```js
const out = {};                             // declared before the job IIFE at :453
const job = (async () => {
  // ... unchanged, except the diff branch at :460:
  if (route.page === 'diff') return pageDiff(route.path, out);
})();
rendering = job;
const html = await job;
if (rendering !== job) return;              // :468, unchanged
state.unbindDiffKeys?.();
state.unbindDiffKeys = null;
state.diffOrder = out.order ?? [];
view.classList.toggle('wide', route.page === 'diff');
view.innerHTML = html;                      // :469, unchanged
if (route.page === 'file') wireEditor();
if (route.page === 'diff') wireDiff();      // rebinds, and only here
```

Unbinding at the top of `render()`, next to `state.paintEditor = null` at `:452`, was the obvious
site and is wrong: it happens before the `await`, so every refetch of the diff page would leave
the shortcuts dead for the whole `/api/diff` plus `/api/diff/file` round trip, which is exactly
the window in which an impatient user presses `j` again. It also unbinds on a render that is
later superseded, so a losing render would silently disarm the winner. Doing both at the commit
site keeps the listener alive across the fetch and swaps it in one frame with the markup and the
order it belongs to.

That is the whole lifecycle: bound only by `wireDiff`, which runs only for the diff route
(`web/app.mjs:471`); replaced rather than stacked, because the unbind immediately precedes the
rebind; and removed when any other route commits, because that route's commit unbinds and never
rebinds.

Keeping the listener live across the fetch has a deliberate consequence worth stating: `render()`
updates `state.route` at `:449`, before the `await`, while `state.diffOrder` is committed only
after it, so a keystroke arriving mid-fetch reads the *new* current path against the *previous*
list. That is correct rather than merely tolerable, because the new path came out of that same
list, so two quick presses of `j` advance two files instead of one being swallowed. It is also
why `diffNav` must return sensible values for a path it does not find (D8): the one case where
the two disagree is a list that shrank under the user, and there `diffNav` falls back to the
first and last entries rather than to nothing.

The `SELECT` guard is not theoretical: the theme dropdown from D5 lives in the sidebar and is
focusable from the diff page, so without it `j` would fire while the user is choosing a theme
with the keyboard. It is also the only form control that can hold focus on the diff route today:
the editor's textarea belongs to the `file` route, whose commit unbinds the listener outright, so
success criterion 4's "typing in the editor never fires a shortcut" is guaranteed by the
lifecycle and the `INPUT` and `TEXTAREA` names are defence in depth for whatever the diff page
grows next. `isComposing` protects an IME. No modifier
combination is claimed, so nothing the browser owns is intercepted; `preventDefault` is called
only once a shortcut has actually matched, so `.` still types normally everywhere else.

Navigation goes through the hash (`win.location.hash = '#/diff/<encoded path>'`), the same URL
`fileRow` already links to (`web/app.mjs:400`), so `hashchange` (`:517`) drives the normal render
and the browser's Back button walks the visited files. Reopening the target's ancestor
directories before the hash change means `j` never selects a row hidden inside a collapsed
directory. After the render, `render()` brings the selected row into view for the diff route:

```js
if (route.page === 'diff') doc.querySelector('.diff-left li.file.selected')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
```

placed with the `wireDiff()` call at `:471`, inside the same post-supersede block. `block:
'nearest'` is a no-op when the row is
already visible, so it cannot fight the user's own scrolling.

**The legend** goes in the existing `.row-actions` of the diff page (`web/app.mjs:424-425`),
immediately after the Tree / Flat list and Refresh buttons and before the file-count text, using
only elements that already have styling:

```html
<span class="meta"><span class="tag">j</span> next <span class="tag">k</span> previous <span class="tag">.</span> latest</span>
```

`.tag` is a bordered mono box on `--paper-2` (`web/app.css:154`) that inherits its colour, so
inside `.meta` it reads as a muted key cap in both themes, and no new rule is needed.

### D10. The latest-modified marker is a `.tag.latest` glyph with an ink/paper pair

*Viable options.* (i) A `.tag` variant carrying `●` with a `title`. (ii) The word `latest`
in a tag. (iii) A colour change on the row.

**Chosen: (i).** `fileRow` (`web/app.mjs:399-401`) gains, between the status tag and the file
name and only for the marked entry:

```js
`${f.path === latest ? `<span class="tag latest" title="most recently modified, ${esc(when(f.mtimeMs))}">●</span>` : ''}`
```

`when` (`web/app.mjs:112`) already renders an epoch millisecond value as `YYYY-MM-DD HH:MM` and
is in module scope, so `fileRow` can call it. The `title` is what the proposal requires and is
what a pointer and most screen readers surface.

Its CSS, added to the diff block after `.diff-tree .tag.st` (`web/app.css:216`):

```
.diff-tree .tag.latest { min-width: 1.6em; text-align: center; background: var(--ink); color: var(--paper); border-color: var(--border); }
```

Inverted video against the row: in light mode near-black on cream, in dark mode near-white on
near-black, both maximal contrast, because `--ink` and `--paper` are redefined as a pair in both
theme blocks (`web/app.css:5-7`, `:30-32`, `:43-45`). On a highlighted row it is overridden by
D11 so it stays readable against lime.

*Rejected (ii)*: six mono characters at 0.85em in a pane that starts at 220 px, next to a status
tag, a file name and a `+n -n` count, on a row that does not wrap (`web/app.css:212`) would
squeeze the name. *Rejected (iii)*: a colour alone carries no `title`, cannot be read by a screen
reader, and would collide with the selection colour on the very row the user is most likely on.

### D11. The row is the highlight target; the tags get explicit pairs on hover and selection

`web/app.css:212-216` becomes:

```
.diff-tree li.file { display: flex; gap: 8px; align-items: center; padding: 2px 4px; }
.diff-tree li.file a { text-decoration: none; flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere; display: flex; align-items: center; gap: 6px; }
.diff-tree li.file a:hover { background: none; color: inherit; }
.diff-tree li.file:hover, .diff-tree li.file.selected { background: var(--lime); color: var(--lime-ink); }
.diff-tree li.file:hover .meta, .diff-tree li.file.selected .meta { color: var(--lime-ink); }
.diff-tree li.file:hover .tag.st, .diff-tree li.file.selected .tag.st { background: var(--lime-ink); color: var(--lime); border-color: var(--lime-ink); }
.diff-tree li.file:hover .tag.latest, .diff-tree li.file.selected .tag.latest { background: var(--paper); color: var(--ink); border-color: var(--border); }
.diff-tree .tag.st { min-width: 1.6em; text-align: center; }
```

Six things happen here, each answering one clause of proposal items 6 and 7:

1. **`align-items: center` on the row and on the anchor.** The row's items are the anchor and the
   meta; the anchor's items are the tags and the file name. Both become flex rows centred on the
   cross axis, so the tag boxes, the name and the counts share one vertical centre instead of a
   baseline that the tags' padding and border push around. `padding: 2px 4px` instead of
   `1px 4px` gives the highlighted box a little breathing room now that it is the visible object.
2. **The row paints the highlight, for hover and for selection, from one declaration.** Adding
   `li.file:hover` next to `li.file.selected` makes the two states the same shape, which item 7
   asks for.
3. **`li.file a:hover { background: none; color: inherit }` neutralises the generic `a:hover`**
   (`web/app.css:65`). Specificity is (0,3,2) against (0,1,1), so it wins without an
   `!important`. `color: inherit` matters as much as the background: it is what stops the anchor
   from re-imposing `--lime-ink` on a row that is not highlighted.
4. **`.tag.st` inverts to `--lime` on `--lime-ink`.** Both tokens are declared once on `:root`
   (`web/app.css:9-10`) and are absent from both dark blocks (`:28-40`, `:41-52`), so the pair is
   `oklch(88% 0.22 125)` on `oklch(0% 0 0)` in *both* themes: a bright lime letter on black, on a
   lime row. This is the whole fix for item 6, and it is one rule rather than two because the
   hover and selection cases now share a selector list (point 2). `border-color` follows the
   background so the tag reads as a solid chip rather than a bordered hole.
5. **`.tag.latest` inverts the other way**, to `--ink` on `--paper`, so the marker stays legible
   against the lime row while remaining visibly a different object from the status tag.
6. **`flex: 1 1 auto; min-width: 0; overflow-wrap: anywhere` on the anchor** lets a long path
   shrink inside the pane rather than push the counts out of the row, which matters more now that
   the pane has a fixed height (D3).

The existing `.diff-tree li.file.selected .meta` rule (`web/app.css:215`) is folded into the new
selector list rather than left standing, so there is one place where the highlighted row's
colours are defined.

### D12. Docs change one sentence each, and `npm run build` regenerates two files

*Alternative explicitly invalidated.* `skills/dashboard/SKILL.md` and
`codex/skills/my-flow-dashboard/SKILL.md` are generated from `src/skills/dashboard.md` by
`scripts/build.mjs:75-95`; `npm run check` runs the same generator with `--check` and exits 1 when
an output is stale. Editing a generated file by hand is therefore not an option, only a way to
fail the gate.

`src/skills/dashboard.md:46-47` (the Theme bullet) becomes "the theme dropdown in the sidebar
overrides the system colour scheme; the choice is kept in the browser", and its Diff bullet
(`:51-56`) gains one sentence: "The most recently modified file is marked, and `j` / `k` move
between files while `.` jumps to that file." `npm run build` then rewrites exactly
`skills/dashboard/SKILL.md` and `codex/skills/my-flow-dashboard/SKILL.md`, and nothing else.

The eight READMEs all carry the same two bullets at line 217 and line 219. English
(`README.md:217`) becomes "the theme dropdown in the sidebar overrides the system colour scheme;
the choice is kept in the browser", and `README.md:219` gains the same added sentence. The seven
translations change the same two lines in their own language, keeping the literal control values
`Auto / Light / Dark` and the key names `j`, `k`, `.` untranslated as the surrounding text already
keeps `HEAD` and `Refresh`:

| file | phrase at line 217 to replace |
|---|---|
| `README.de.md` | `Die Schaltflächen Auto / Light / Dark` becomes the dropdown |
| `README.es.md` | `los botones Auto / Light / Dark` becomes the dropdown |
| `README.fr.md` | `les boutons Auto / Light / Dark` becomes the dropdown |
| `README.ja.md` | `Auto / Light / Dark ボタン` becomes `ドロップダウン` |
| `README.ko.md` | `Auto / Light / Dark 버튼` becomes `드롭다운` |
| `README.zh-CN.md` | `Auto / Light / Dark 按钮` becomes `下拉框` |
| `README.zh-TW.md` | `Auto / Light / Dark 按鈕` becomes `下拉選單` |

## Risks / Trade-offs

- **`appearance: none` removes the platform's own dropdown affordance.** A user who recognises
  their operating system's select widget will not recognise this one. Accepted: it is the same
  trade the scrollbar change already made for this page, the wrapper's glyph restores the
  affordance, and the element underneath is still a real `<select>`, so keyboard and
  screen-reader behaviour are untouched. The option popup is still drawn by the operating system
  and follows `color-scheme`.
- **A sticky, height-capped file pane can hide content on a short window.** `calc(100vh - 32px)`
  is generous, but a very short viewport above 1000 px wide gets a small scrollbox. Accepted; the
  `@media` reset covers the narrow case, which is the common short one, and the pane scrolls
  rather than clipping.
- **`height: 16px` on the shared inner-area scrollbar rule is inert for two of its four
  selectors.** Recorded in D4 rather than avoided; the alternative duplicates a selector to
  suppress a declaration nobody can observe.
- **A document-level `keydown` listener is a global.** Its blast radius is bounded by being bound
  only on the diff route and removed by the next route's commit (D9), but a future page that adds
  an input to the diff route inherits the guard rather than a fresh bug, which is why the guard
  tests the target's tag name rather than naming the editor's textarea.
- **`j` and `k` are single letters with no modifier**, so they are unavailable to anything else
  on the diff page. There is nothing else on the diff page that consumes plain letters, and the
  form-control guard is what keeps that true when one is added.
- **The latest-modified marker is only as fresh as the last fetch.** The server does not watch
  `web/` or `scripts/` (`scripts/dashboard.mjs:28`), so while an agent edits source files the
  marker moves only on Refresh or on an event from `specs/`, `changes/` or `.my-flow/`. This is
  the proposal's own non-goal (no new watcher, no polling loop), and the page already says so
  (`web/app.mjs:425`). During `execute` the agent ticks `tasks.md` constantly, so in practice the
  page does refetch often; that is a happy accident, not a guarantee, and the design does not
  lean on it.
- **`mtimeMs` adds one `lstat` per tracked changed file.** On a list of a few hundred entries
  this is far below the two `git diff` invocations that produced it. No cache is added, because
  the endpoint is specified to recompute from disk per request.
- **Screenshots carry criteria 1 and 5 alone.** No unit test can assert a painted scrollbar or a
  readable letter, so task group 7 is the only evidence for them and must show the real states
  (hovered row, selected row, both themes), not an approximation.
- **`web/` is untracked, so a mistake there is invisible to `git diff`.** Mitigated by the
  snapshot in task 1.1 and by `diff -rq` against it in the final gate; this is the same device
  the archived scrollbar change used.

## Do-Not-Touch

`scripts/spec.mjs`, `scripts/lib/`, `scripts/cli.mjs`, `scripts/build.mjs`, `hooks/`, `agents/`,
`src/agents/`, `src/core/`, `templates/`, `claude/`, `manifest.json`, `package.json`,
`.claude-plugin/`, `web/md.mjs`, `test/spec.test.mjs`, `test/completion-guard.test.mjs`,
`test/markdown.test.mjs`, `test/dashboard.test.mjs`, `test/helpers.mjs`, every skill under
`src/skills/` other than `dashboard.md`, and everything under `codex/` and `skills/` except the
two files `npm run build` regenerates from `src/skills/dashboard.md`.

Inside the files that do change: in `scripts/dashboard.mjs`, only `diffList` and the one new
`mtimeOf` helper beside it; `diffPatch`, the route ladder, the guards, the watchers and the
static handler stay byte-identical. In `web/app.mjs`, `THEME_KEY`, `normalizeTheme`, `themeAttr`,
`parseRoute`, `shouldRefetch`, `parseUnifiedDiff`, `buildTree`, `isOwnEcho`, `progressHtml`,
`pct`, `when` and the whole editor path stay byte-identical. In `web/index.html`, only the
`.theme` block; the pre-paint script at line 8 must not move or change.

The tracked-but-modified files this change has no business in (`scripts/cli.mjs`,
`scripts/spec.mjs`, `manifest.json`, `package.json`, `.claude-plugin/plugin.json`) already carry
unrelated edits in the working tree; leave them exactly as found.

## Rebuild / Re-run After Change

- `npm run build` after editing `src/skills/dashboard.md`, which rewrites
  `skills/dashboard/SKILL.md` and `codex/skills/my-flow-dashboard/SKILL.md`; then `npm run check`,
  which must report the outputs up to date.
- `npm test` (baseline 86 passed, 0 failed; this change adds tests, so the count rises and must
  never fall).
- `grep -rE "https?://" web/` must print nothing, and `test/dashboard.test.mjs:519` asserts the
  same thing from inside the suite.
- No bundler and no cache: `web/*` is served as-is by `scripts/dashboard.mjs`, so a reload with
  the cache disabled is the only refresh. The dashboard server must be restarted after editing
  `scripts/dashboard.mjs`, because the module is loaded once when the server starts.
- A headless-Chrome run over the DevTools protocol against this repository, forcing each theme
  with `Emulation.setEmulatedMedia` and `features: [{ name: 'prefers-color-scheme', value:
  'light' | 'dark' }]`, launched without `--hide-scrollbars` and captured with
  `captureBeyondViewport` false, as
  `.my-flow/verify/dashboard-theme-lock-diff-e2e-2026-09-09T16-46.md` records; screenshots under
  `.my-flow/verify/dashboard-ui-polish-shots/` and a note at
  `.my-flow/verify/dashboard-ui-polish-e2e-<UTC time>.md`.
