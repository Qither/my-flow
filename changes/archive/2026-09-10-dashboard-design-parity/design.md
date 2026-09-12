## Context

The dashboard is one server (`scripts/dashboard.mjs`) and four static assets under `web/`:
`index.html` (shell, inline theme script at line 8, native `<select id="theme-select">` at
lines 27-33), `app.css` (283 lines; tokens at 3-25, dark twins at 28-52, controls at 132-147,
scrollbars at 253-282), `app.mjs` (576 lines; pure helpers exported at 12-140, `boot()` builds
every page as template-literal HTML) and `md.mjs` (the markdown renderer, untouched by this
change). Static files are served by `handleStatic` (`scripts/dashboard.mjs:479-491`): any file
under `web/` whose extension is in `CONTENT_TYPES` (`scripts/dashboard.mjs:40-46`) is served
with `cache-control: no-cache`, so a new `web/ui.mjs` is served as
`text/javascript; charset=utf-8` with no server change.

The stylesheet already carries the qiujm-web tokens (`--paper`, `--ink`, `--lime`,
`--shadow-color`, `--control-border: 2px`, `--control-shadow: 3px`, `--panel-border: 3px`,
`--panel-shadow: 6px`, `--t: 120ms`; `web/app.css:5-22`) and applies the grammar to nav tiles
(`app.css:103-117`) and buttons (`app.css:132-147`). It stops there: `.tag` and `.bar` and
`.conn-dot` use 1 px borders (`app.css:155,160,119`), the theme control is a native `<select>`
with a pseudo-element caret (`app.css:201-214`), task boxes are text glyphs emitted by
`md.mjs:97` and styled only as monospace (`app.css:172`), the directory toggle is a 1 px button
(`app.css:224`), the four inner scroll regions have `width` and `height` but only three have a
corner rule (`app.css:260-278`), `body` has no horizontal bar, and `table` never scrolls at all
(`app.css:75`). Nothing exists for blockquote, dl, figure, kbd, mark, abbr, details, sup, sub,
fieldset, legend, checkbox, radio, switch or text input.

Two emitted classes have no rule today: `open` from `class="task ${done ? 'done' : 'open'}"`
(`web/md.mjs:97`; only `.md li.task.done` exists at `app.css:171`) and `flat` from
`class="diff-tree flat"` (`web/app.mjs:438`; no `.flat` selector anywhere). The class-coverage
test this change adds will fail on exactly those two until they get rules, which is the intended
proof that the test bites.

The diff page's keyboard guard (`web/app.mjs:481`) skips `INPUT`, `SELECT`, `TEXTAREA` and
content-editable targets. The new trigger is a `<button role="combobox">`, so the guard must
also skip a `role="combobox"` target or `j` / `k` / `.` on the focused theme control would move
the diff selection, breaking the scenario "pressing the same keys while focus is in the theme
control ... changes no selection" (`specs/dashboard/spec.md:444-452`).

Tests run under `node --test` with no DOM (`package.json` `test` script lists six files
explicitly; a new test file must be added to that list). `test/diff.test.mjs:11` already imports
pure helpers from `web/app.mjs`, proving the module imports cleanly in Node because `boot()` is
gated at `web/app.mjs:576`. The no-network scan (`test/dashboard.test.mjs:519-524`) iterates
`readdirSync(web)`, so it covers `ui.mjs` automatically; the content-type loop at line 526 lists
paths explicitly and does not cover `/ui.mjs`. The proposal reserves edits to the existing server
tests for the user, so the new assertions go in new test files.

The reference design (`H:\CustomProject\social\qiujm-web`) contributes geometry and states
only: `DESIGN.md:36-48` (one control grammar, 2/3 controls, 3/6 panels, hover lime, open ink,
120 ms), `globals.css:533-575` (`.header-control` rest / hover / open / focus-visible),
`globals.css:630-647` (`.header-select-menu`: 2 px border, 3 px shadow, focused item lime with
ink border), `globals.css:715-748` (`.button` hover moves by the shadow), `globals.css:892-902`
(`.tag`: 2 px border, mono, lime or paper), `ui/select.tsx:188-199` (item: 2 px transparent
border that turns to the border colour on focus, check indicator absolutely positioned right,
disabled opacity 0.5), `ui/checkbox.tsx:19` (16 px, 2 px outline, checked = lime with a check),
`ui/switch.tsx:18-26` (48 x 24 track, 16 px thumb, checked = lime; qiujm-web rounds it, this
change keeps square corners per the proposal), `ui/input.tsx:11` and `ui/textarea.tsx:10`
(2 px border, secondary background, no shadow, focus ring offset 2, disabled 0.5). magick.css
(scratchpad copy, 750 lines) contributes its reset (lines 14-18), forms (362-540), tables
(547-576), blockquote with footer and cite (588-630), `pre:has(code)` and line numbers
(638-674), dl (293-300) and figure (327-349); its fonts, Google Fonts import (line 11), header
and footer decorations and sidenotes are dropped.

## Goals / Non-Goals

**Goals:**

- Every element the dashboard renders follows one control grammar in both palettes, with no
  user-agent default visible.
- The theme control is a keyboard- and screen-reader-complete custom listbox whose decisions
  live in a pure, DOM-free function.
- Every scrolling region shows themed bars in both axes with painted corners and a standard
  property fallback.
- The stylesheet covers the magick.css element set and a form-control kit, proven visible by a
  `#/styleguide` route.
- Automated guards keep the design honest: class coverage in both directions, dark-rule twins,
  no network references, content type of the new asset, listbox state tests.

**Non-Goals:** (binding, from `proposal.md`)

- No CDN, `http(s)://` reference, web font, font file, framework or npm dependency.
- No change to `web/md.mjs`, `scripts/dashboard.mjs`, `test/dashboard.test.mjs`,
  `test/diff.test.mjs` or `test/markdown.test.mjs`. Blockquotes and images keep degrading to
  text.
- No copy of qiujm-web page components, no hard-coded paper-on-ink header colours in dark mode,
  no pixel-identical typography.

## Decisions

### PLAN-DR

**Principles**

1. Tokens before rules, rules before twins. Every colour that differs in dark mode enters the
   stylesheet as a token in the two existing dark blocks (`app.css:28-52`), and component rules
   consume tokens, so the number of per-component dark twins stays small and a test can prove
   the twins are identical.
2. CSS reaches everything it can; JavaScript is for the listbox only. The task box, the tree
   toggle, the tables, the markdown elements and the whole form kit are stylesheet work over
   markup that already exists or that the styleguide writes by hand.
3. Pure function first, DOM wiring second. `web/ui.mjs` exports the listbox reducer as a pure
   function that `node --test` calls with plain objects, exactly as `diffNav` (`app.mjs:114`)
   and `parseUnifiedDiff` (`app.mjs:48`) are tested today; the mount function only reads events
   and writes attributes.
4. Every new class is a test obligation. The coverage test extracts class names from the four
   emitting files and checks both directions against `app.css`, so a forgotten rule or an
   orphan rule fails `npm test`.
5. Surgical diffs in the three touched sources; the styleguide is the only new page, `ui.mjs`
   the only new asset, and no server or renderer line moves.

**Decision Drivers**

1. The acceptance bar is a screenshot in both palettes (`proposal.md:135-136`). Every state must
   be capturable without a pointer, which forces the state-marker classes (D8) and the dual
   declaration test (D3).
2. `web/md.mjs` is frozen, so every markdown element must be styled over the markup the renderer
   already emits (task glyph span, bare `<table>`), which forces the CSS-only task box (D5) and
   the block-scrolling table (D6).
3. Tests have no DOM (`node --test`, `package.json:13`), which forces the reducer split (D7) and
   the text-level extraction of class names (D10).

**Viable Options for the change as a whole**

- **A (chosen): one change, one executor, four files touched plus two new test files.** The
  reset, tokens and grammar are one stylesheet edit; the listbox is one module; the styleguide
  needs everything else finished to be complete.
- **B: split into "CSS parity" and "listbox + styleguide".** Rejected: the styleguide is the
  verification surface for the CSS work, and the listbox styling is the control grammar applied
  to a menu; both halves would edit the same `app.css` regions in sequence.

### D1. Token additions (`web/app.css:3-25`)

Add to `:root`, with dark twins in both dark blocks where the value differs:

| Token | Light | Dark | Used by |
|---|---|---|---|
| `--pressed-bg` / `--pressed-fg` | `var(--ink)` / `var(--paper)` | `var(--lime)` / `var(--lime-ink)` | pressed buttons, open trigger, active nav tile, selected diff row |
| `--outline-w` / `--outline-off` | `2px` / `3px` | same | every `:focus-visible` |
| `--disabled` | `0.5` | same | every `:disabled`, `[aria-disabled="true"]` |
| `--sb-page` / `--sb-inner` / `--sb-code` | `20px` / `16px` / `10px` | same | scrollbar sizes (replaces literals at `app.css:253,263,275`) |
| `--check` | `16px` | same | checkbox, radio, task box |
| `--switch-w` / `--switch-h` | `48px` / `24px` | same | switch track (`ui/switch.tsx:18`) |
| `--menu-pad` | `4px` | same | listbox viewport padding (`ui/select.tsx:150`, `p-1`) |
| `--add-bg` / `--del-bg` | current literals at `app.css:243,245` | same | patch rows, so the two oklch literals become tokens |

`--pressed-*` replaces the only per-component dark twin that exists today (`app.css:116-117`,
nav active turns lime in dark): after this change `.nav-list a.active`,
`button:is(:active, .sg-active)`, `.listbox-trigger[aria-expanded="true"]` and
`.diff-tree li.file.selected` all read the pair, and the twin lives once in the token blocks.
Alternative: keep per-component twins. Rejected because each new pressed surface would add two
more blocks and the twin test (D3) would have to compare a growing list.

### D2. Reset (after magick.css:14-18, adapted)

Placed right after the token blocks, before `body`:

```
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; height: 100%; }
button, input, select, textarea { font: inherit; color: inherit; margin: 0; border-radius: 0; appearance: none; -webkit-appearance: none; }
button, [role="button"], [role="combobox"], [role="option"], summary, label:has(input) { cursor: pointer; }
:focus:not(:focus-visible) { outline: none; }
summary { list-style: none; }  summary::-webkit-details-marker { display: none; }
fieldset { min-width: 0; margin: 0; }  legend { padding: 0; }
img, svg { max-width: 100%; height: auto; }
abbr[title] { text-decoration: none; }
```

magick.css zeroes every margin and padding (`* { margin: 0; padding: 0 }`); that is not adopted
because the dashboard relies on user-agent list and heading margins (`app.css:79-80,166`).
`:focus:not(:focus-visible)` removes the ring only for pointer focus; keyboard focus always gets
the outline from D4. Alternative `:focus { outline: none }` rejected: it would hide keyboard
focus on any element the grammar forgot. `label:has(input)` needs `:has()` support (Firefox
121+, December 2023; Chromium 105+, Safari 15.4+); on an older engine the selector list is
still valid and only that pointer cursor is lost, which is accepted, and the two kit labels
that matter (`.switch`, `.check`) also carry `cursor: pointer` by class so the switch and
checkbox labels show the pointer everywhere.

### D3. Dark rules stay in twins, and a test proves it

The convention at `app.css:26-27` ("declared twice on purpose ... keep both in sync") becomes a
test in `test/styles.test.mjs`, with this exact normalisation:

1. Strip comments. Walk the file and locate every block whose prelude, whitespace-collapsed
   and trimmed, is exactly `@media (prefers-color-scheme: dark)`; take its body by brace
   counting. The `max-width` media blocks (`app.css:177,218,220`) and the `@supports` block
   (`app.css:279`) have other preludes and are skipped.
2. Inside each such body, split into rules `selector { declarations }` by brace counting.
   For each rule: selector = collapse whitespace to single spaces, strip a leading
   `:root:not([data-theme="light"])`, trim; declarations = split on `;`, trim each, drop empty
   entries and any starting with `color-scheme`, sort. Collect `selector -> declarations`
   into multiset A (a selector may appear more than once; keep every occurrence).
3. Over the top-level rules of the file (outside any `@` block), take every rule whose
   collapsed selector starts with `:root[data-theme="dark"]`; strip that prefix, trim,
   normalise declarations the same way; collect into multiset B.
4. Assert A equals B as multisets, reporting the first selector present in one and not the
   other, or present in both with different declarations.

Anchors in today's file that the test must pair: `app.css:29-39` with `41-52` (the token
blocks, where `color-scheme: dark` at line 42 is the ignored declaration), `116` with `117`
(nav active; removed by D1 and replaced by the token pair), and `257` with `259` (body
scrollbar thumb border). The file passes as it stands. Alternative: a build step generating the
attribute block from the media block. Rejected: the project has no build for `web/` and the
proposal forbids a bundler.

### D4. Control grammar

| Level | Border | Shadow | Rest surface | Hover | Pressed / open | Focus-visible | Disabled | Motion |
|---|---|---|---|---|---|---|---|---|
| Control (button, nav tile, trigger, input, textarea, tag, task box, toggle) | `--control-border` 2 px | `--control-shadow` 3 px (inputs, tags, task box: none, after `ui/input.tsx:11`, `globals.css:892`) | paper (primary: lime; neutral: paper-2) | lime / lime-ink, shadow kept | `translate(3px,3px)`, shadow none, `--pressed-bg` / `--pressed-fg` | `outline: var(--outline-w) solid var(--ink); outline-offset: var(--outline-off)` | `opacity: var(--disabled)`, no hover, `cursor: default` | `transform, box-shadow, background, color` at `--t` |
| Panel (`.panel`, listbox menu, `details[open]`, fieldset) | `--panel-border` 3 px (menu: 2 px, `globals.css:633`) | `--panel-shadow` 6 px (menu: 3 px, `globals.css:635`) | paper | none | none | none | none | none |
| Flat (`.dir-toggle`, breadcrumb link, listbox option) | 2 px transparent | none | inherit | lime, border stays transparent (option: border ink, `ui/select.tsx:188`) | pressed pair | outline as control | opacity | colours at `--t` |

Button variants, all on `button, .btn` (`app.mjs:323,333,334,455`): default (paper),
`.primary` (lime, existing), `.neutral` (paper-2, `ui/button.tsx:17`), `.reverse` (no shadow at
rest; hover translates by minus 3 px and gains the shadow, `ui/button.tsx:22`), `.icon` (32 x 32,
padding 0, `ui/button.tsx:28`). Dashboard control height is 30 px (`padding: 4px 12px`) on the
8 px rhythm rather than qiujm-web's 40 px, allowed by `proposal.md:75-76`.

Existing class map (every selector in `app.css` today and what it becomes):

| Class / element | Today | After |
|---|---|---|
| `.nav-list a` (103-117) | control, active twin | control; active reads `--pressed-*`; twin removed |
| `button`, `.btn` (132-147) | control | control with variants; `:is(:hover, .sg-hover)` etc. (D8) |
| `.theme select`, `.select-wrap` (201-214) | native select | removed; markup replaced by `.listbox` (D7) |
| `.panel` (124-131) | 3/6 panel | unchanged geometry; `h2/h3:first-child` kept |
| `.card` (152) | 2 px border, no shadow | 2 px border, 3 px shadow (control weight) |
| `.tag` and `.lime` `.warn` `.st` `.latest` (155-157,234-235) | 1 px border | 2 px border, `font: 700 0.72em/1.4 var(--mono)`, `padding: 1px 6px` (`globals.css:892-898`) |
| `.md a.via` (173) | 1 px tag-like | same as `.tag` |
| `.bar`, `.fill` (160-161) | 1 px, 6 px tall | 2 px border, 10 px tall, fill lime |
| `.conn-dot` (119) | 1 px, 8 px | 2 px, 10 px |
| `.warnings`, `.notice`, `.notice.ok`, `.notice.lock` (162,192-196) | 2 px border | 2 px border plus 3 px shadow in `--shadow-color`; `.notice.lock` paper-2 |
| `.editor textarea` (178-190) | 2 px border | 2 px border, paper-2 background, no shadow, focus outline (`ui/textarea.tsx:10`) |
| `pre`, `code` (66-74) | 2 px border | unchanged plus `pre .line-number` (magick.css:660-674) |
| `table`, `th`, `td`, `hr` (75-78) | 2 px | unchanged plus block scrolling (D6) |
| `.md .box`, `.md li.task.open/.done` (170-172) | glyph | drawn box (D5); `.open` gains its rule |
| `.diff-tree .dir-toggle` (224-226) | 1 px button | flat control; caret glyph kept; `[aria-expanded="true"]` unchanged surface; opts out of the pressed translate with `.diff-tree .dir-toggle:is(:active, .sg-active) { transform: none; }` declared after the grammar block, because a toggle that has no shadow must not jump 3 px on click |
| `.diff-tree li.file`, `.selected` (227-235) | lime hover and selected | hover lime; selected reads `--pressed-*`; `.st`/`.latest` inversions rewritten against the pair |
| `.diff-tree.flat` | no rule | `.diff-tree.flat li.file { padding-left: 4px }` (gains its rule) |
| `.patch`, `.row`, `.no`, `.txt`, `.hunk`, `.add`, `.del`, `.ctx`, `.meta` (238-248) | 2 px border | unchanged plus tokens for the two literals and both-axis scrollbars |
| `.crumbs` (194) | mono muted | unchanged, separator `/` kept in markup |
| `.highlight` (195) | 3 px lime outline | unchanged |
| `.shell .sidebar .content .brand* .conn .cards .card-head .name .meta .progress .row-actions .file-list ul.req .empty .muted .mono .editor .preview .md .theme .theme-label .diff .diff-left .diff-right .diff-tree .patch-head .wide .active` | layout | unchanged |

### D5. Task box is drawn in CSS over the existing glyph span

`md.mjs:97` emits `<span class="box" aria-hidden="true">&#9744;</span>` inside
`li.task.open|done`. Rule: `.md .box { display: inline-block; width: var(--check); height:
var(--check); border: var(--control-border) solid var(--border); background: var(--paper);
vertical-align: -3px; font-size: 0; color: transparent; }` hides the glyph and draws the square;
`.md li.task.done .box { background: var(--lime); }` and `.md li.task.done .box::after {
content: "\2713"; font-size: 11px; line-height: 12px; color: var(--lime-ink); display: block;
text-align: center; }` draws the check. `.md li.task.open .box` gets an explicit rule (paper
background) so the `open` class has a selector. The golden strings in
`test/markdown.test.mjs:12-13` are unchanged. Alternative: emit `<input type="checkbox"
disabled>` from `md.mjs`. Rejected: Do-Not-Touch.

### D6. Tables scroll as blocks

`md.mjs:137` emits a bare `<table>`; no wrapper can be added. Rule: `table { display: block;
width: max-content; max-width: 100%; overflow-x: auto; padding: 1px; border-collapse:
collapse; }`. A block table shrinks to its content and scrolls horizontally when wider than
`.content` or `.preview`. The `padding: 1px` matters: with `border-collapse`, half of the 2 px
outer cell border lies outside the anonymous table box, and `overflow-x: auto` would clip that
1 px on every side; the padding gives it room. The styleguide's narrow and wide tables are the
visual check (all four outer edges 2 px). Alternative: scroll the `.md` container. Rejected: the whole preview would scroll
instead of the table. Alternative: wrapper in the renderer. Rejected: Do-Not-Touch.

### D7. The listbox: DOM contract, pure state function, wiring

**Markup** (replaces `index.html:27-33`; the styleguide emits the same shape):

```
<div class="listbox" id="theme-listbox" data-value="system">
  <button type="button" class="listbox-trigger" id="theme-trigger" role="combobox"
          aria-haspopup="listbox" aria-expanded="false" aria-controls="theme-menu"
          aria-labelledby="theme-label theme-trigger" title="follow or override the system colour scheme">
    <span class="listbox-value">Auto (system)</span><span class="listbox-caret" aria-hidden="true">&#9662;</span>
  </button>
  <ul class="listbox-menu" id="theme-menu" role="listbox" aria-labelledby="theme-label" hidden>
    <li class="listbox-option" role="option" id="theme-opt-system" data-value="system" aria-selected="true">Auto (system)</li>
    <li class="listbox-option" role="option" id="theme-opt-light"  data-value="light">Light</li>
    <li class="listbox-option" role="option" id="theme-opt-dark"   data-value="dark">Dark</li>
  </ul>
</div>
```

The label at `index.html:26` becomes `<span class="theme-label" id="theme-label">Theme</span>`
(a `<label for>` cannot target a button). Focus stays on the trigger; the focused option is
`aria-activedescendant="theme-opt-light"` on the trigger and `data-active="true"` on the option
(the styling hook). This is the WAI-ARIA APG "select-only combobox" pattern. Alternative: roving
`tabindex` with focus moving into the list. Rejected: focus leaving the trigger makes the
`focusout` close rule and the diff-page keyboard guard both harder, and it is not how the
Radix select the reference uses behaves.

**Pure state** in `web/ui.mjs`:

```
export const TYPEAHEAD_MS = 500;
/** state: { options: [{ value, label }], value, open, active, search, searchAt }
 *  ev:    { type: 'key', key, time } | { type: 'toggle' } | { type: 'open' } | { type: 'close' }
 *       | { type: 'pick', index } | { type: 'point', index }
 *  returns the next state plus `changed` (true when `value` was committed to a new value) and
 *  `handled` (false only for a key the table below does not list, and for Tab while closed). */
export function listboxNext(state, ev)
export const listboxInit = (options, value) => ({ options, value, open: false, active: indexOf(value), search: '', searchAt: 0 })
```

Key table (`ev.key`): closed + `ArrowDown | ArrowUp | Enter | ' ' | Home | End` opens with
`active` = index of `value` (`Home` 0, `End` last); open + `ArrowDown` / `ArrowUp` clamp at
the ends (no wrap, `ui/select.tsx` via Radix does not wrap); `Home` / `End` jump; `Enter`, `' '`
and `Tab` commit `active` and close; `Escape` closes without commit; a printable single
character (`key.length === 1`, not space) appends to `search` when `time - searchAt <
TYPEAHEAD_MS`, else restarts it; if the buffer is one character repeated, the match cycles
through labels starting with that character from `active + 1` wrapping, otherwise the first
label starting with the buffer (case-insensitive) becomes `active`; when closed a printable
character also opens. `toggle` flips `open` (opening sets `active` to the value's index);
`close` closes without commit; `pick` commits `index` and closes; `point` sets `active`
(pointer hover). Every branch returns a new object; the function never touches globals.

**Wiring** `export function mountListbox(root, { onChange })`: reads options from
`[role="option"]` children and returns `{ set(value), get(), destroy() }`. Event rules, each
with the reason it exists:

- Trigger `keydown`: feeds `{ type: 'key', key, time: ev.timeStamp }` to the reducer and calls
  `ev.preventDefault()` when the result's `handled` is true and `key` is not `Tab`. A `<button>`
  synthesises `click` on `Enter` (at keydown) and `Space` (at keyup); without the
  `preventDefault`, `Enter` would commit and close through the reducer and the synthesised
  click would immediately reopen. `Tab` keeps its default so focus moves on after the commit.
- Trigger `click`: `{ type: 'toggle' }`. This is the only toggle path for pointers; no
  `pointerdown` or `mousedown` on the trigger toggles.
- Menu `pointerdown`: `ev.preventDefault()` and nothing else. Options are non-focusable `<li>`,
  so a pointerdown on one would move focus to `body`, fire `focusout` with a null
  `relatedTarget`, hide the menu, and the `click` that commits would never land on a visible
  option. Preventing the default keeps focus on the trigger.
- Option `pointermove`: `{ type: 'point', index }`. Option `click`: `{ type: 'pick', index }`.
- `root` `focusout`: `{ type: 'close' }` only when `ev.relatedTarget` is null or outside
  `root` (`!root.contains(ev.relatedTarget)`).
- `root.ownerDocument` `pointerdown` (registered once, removed by `destroy()`): `{ type:
  'close' }` only when `!root.contains(ev.target)`.

After every reducer call the mount writes: `hidden` on the menu; `aria-expanded` on the
trigger; `aria-activedescendant` on the trigger set to the active option id while open and
**removed** while closed (a stale descendant on a closed combobox is announced by some screen
readers as a focused item); `aria-selected` on every option (`"true"` on the value, `"false"`
elsewhere) and `data-active` on the active option only; `.listbox-value` text and `data-value`
on `root`; scrolls the active option into view with `block: 'nearest'`; calls
`onChange(value)` only when the reducer reported `changed`. `set(value)` updates the reducer
state and the attributes without calling `onChange`. Nothing in `ui.mjs` runs at import time,
so `import('./web/ui.mjs')` in Node succeeds with no `document`.

**app.mjs changes**: `import { mountListbox } from './ui.mjs'`. Order at start-up matters:
today `applyTheme(normalizeTheme(storage.get(THEME_KEY)))` runs at `app.mjs:187` and the
listener is attached at `app.mjs:188` afterwards; with the listbox that order would leave the
trigger reading "Auto (system)" while the document is already dark. So the mount comes first,
then the apply: `state.themeBox = mountListbox($('theme-listbox'), { onChange: onThemeChange })`
followed by `applyTheme(normalizeTheme(storage.get(THEME_KEY)))`, where `applyTheme`
(`app.mjs:177-186`) replaces `sel.value = choice` with `state.themeBox?.set(choice)`, and
`onThemeChange` is a new `const` holding the body of the old `change` listener
(`app.mjs:189-192`: apply the document first, then store or remove `THEME_KEY`). The name is
not `onChange` because `boot()` already declares `const onChange` for the live-update handler
at `app.mjs:529`, and a second `const onChange` in the same function scope is a SyntaxError. The guard at `app.mjs:481` adds `|| (t && t.getAttribute &&
t.getAttribute('role') === 'combobox')`. The inline script at `index.html:8` is untouched, so
the choice is still applied before first paint; the storage wrapper at `app.mjs:154-176` is
untouched, so a throwing `localStorage` still leaves the control working.

**Styling** (`globals.css:630-647`, `ui/select.tsx:138,188-199`): `.listbox { position:
relative }`; `.listbox-trigger` is a control with `width: 100%`, text left, caret right, open
state `[aria-expanded="true"]` = pressed pair with translate and no shadow; `.listbox-menu {
position: absolute; left: 0; right: 0; top: calc(100% + 6px); z-index: 10; margin: 0; padding:
var(--menu-pad); list-style: none; background: var(--paper); border: var(--control-border) solid
var(--border); box-shadow: var(--control-shadow) var(--control-shadow) 0 0 var(--shadow-color);
max-height: 240px; overflow-y: auto; }` and, explicitly, `.listbox-menu[hidden] { display:
none; }`. No rule ever sets `display` on `.listbox-menu`: an author `display` would beat the
user-agent `[hidden] { display: none }` rule and the menu would never hide (the same mechanism
`#nav-diff` relies on at `index.html:23` and `app.mjs:561`); the explicit `[hidden]` rule makes
the intent survive a future `display: flex` on the menu. `.listbox-option { padding: 4px 28px 4px 8px; border:
2px solid transparent; position: relative; }`; `[data-active="true"] { background: var(--lime);
color: var(--lime-ink); border-color: var(--border); }`; `[aria-selected="true"]::after {
content: "\2713"; position: absolute; right: 8px; }`; `[aria-disabled="true"] { opacity:
var(--disabled); }`. In the styleguide, `.sg-static .listbox-menu { position: static; }` shows
the open menu inline.

### D8. Styleguide route and state markers

`parseRoute` (`app.mjs:12-22`) gains `if (page === 'styleguide') return { page };` before the
fallback; `shouldRefetch` (`app.mjs:26-45`) gains `case 'styleguide': return false;` so a change
event never re-renders it; `render()` (`app.mjs:503-509`) dispatches `pageStyleguide()`, a
synchronous function returning static HTML and needing no `api()` call; after `view.innerHTML`
is set, `wireStyleguide()` mounts the live demo listbox with `mountListbox` and a no-op
`onChange`, and stores the returned `destroy` as `state.unmountStyleguide`. Because the mount
registers a `pointerdown` listener on the document (D7), `render()` calls
`state.unmountStyleguide?.()` and sets it to `null` right next to `state.unbindDiffKeys?.()`
(`app.mjs:517-518`), so leaving the route removes the listener the same way the diff keys are
removed. The link is a small muted `<a href="#/styleguide" data-nav="styleguide"
class="sg-link">Styleguide</a>` placed in the sidebar between the theme control and the
connection line (`index.html:34-35`), not a nav tile: it is a developer surface, and the
`data-nav` attribute keeps the existing active toggle (`app.mjs:497`) working.

Page structure: `<div class="sg">` with one `<section class="sg-section">` per group, each an
`<h2>` and a `<div class="sg-row">` of `<div class="sg-item">` cells, each cell one component
instance and a `<span class="sg-cap">` caption naming the state. Groups, in order: tokens
(`.sg-swatch` per token), text and links, buttons (5 variants x rest / hover / pressed /
focus / disabled), nav tile (rest, hover, active), tags (plain, lime, warn, st, latest, via),
card, panel, notices (plain, ok, lock), warnings, progress bar (0 / 50 / 100), table (one
wider than the row), code block (with and without line numbers), task list (open and done),
file tree (open and closed directory, selected file, latest marker, flat list), breadcrumbs,
patch (hunk, add, del, ctx, meta rows), listbox (live; static open with active and selected
items; disabled), form kit (checkbox unchecked / checked / disabled, radio group, switch off /
on / disabled, text input rest / focus / disabled / placeholder, textarea, select trigger),
markdown elements (blockquote with footer and cite, dl, figure and figcaption, kbd, mark, abbr,
details open and closed, sup and sub, fieldset with legend and labels), scroll demos (a
`.sg-scroll` box that scrolls both axes).

States a screenshot cannot trigger get marker classes: `.sg-hover`, `.sg-active`, `.sg-focus`.
Every state rule in `app.css` is written once with `:is()`, for example
`button:is(:hover, .sg-hover):not(:disabled)`, `button:is(:active, .sg-active):not(:disabled)`,
`:is(button, a, .listbox-trigger, input, textarea, summary):is(:focus-visible, .sg-focus)`. Real
attribute states (`disabled`, `checked`, `open`, `aria-expanded`, `aria-selected`,
`data-active`) are shown with the real attribute. Alternative: synthesise hover from JS.
Rejected: `:hover` cannot be forced from script, so it would need a duplicate class anyway.

### D9. Scrollbar matrix

Regions and rules. "WebKit" means the `::-webkit-scrollbar*` pseudo-elements; "standard" means
`scrollbar-color` / `scrollbar-width` inside `@supports not selector(::-webkit-scrollbar)`
(kept as at `app.css:279-282`, because Chromium 121+ honours `scrollbar-color` and would let it
override the pseudo-elements if it were unguarded). Colours are `--sb-track-color` /
`--sb-thumb-color`, which already flip in both dark blocks (`app.css:37-38,50-51`), so the theme
axis costs no new twin; the one literal dark rule (body thumb border, `app.css:256-259`) keeps
its twin and gains `:horizontal` variants inside the same two blocks.

| Region | Size | Vertical | Horizontal | Corner | Standard fallback |
|---|---|---|---|---|---|
| `body` (page) | `--sb-page` | track with 4 px black left border (existing) | track with 4 px black top border (new, `body::-webkit-scrollbar-track:horizontal`) | track colour | `auto`, both colours |
| `.sidebar`, `.editor textarea`, `.diff-left`, `.patch` | `--sb-inner` | existing | existing size, rules extended to `:horizontal` where the track differs | `::-webkit-scrollbar-corner` for all four (today `.sidebar` has none) | `auto` |
| `table` (D6) | `--sb-inner` | n/a | new | n/a | `auto` |
| `pre` | `--sb-code` | transparent track (existing) | existing | transparent (existing) | `thin`, thumb over transparent |
| `.listbox-menu` | `--sb-code` | new, transparent track | n/a | n/a | `thin` |
| `.sg-scroll` (styleguide) | `--sb-inner` | new | new | new | `auto` |

### D10. Test design under `node:test` without a DOM

Three new files: `test/ui.test.mjs` and `test/styles.test.mjs` are added to the `test` script
in `package.json`; `test/styles.lib.mjs` is a helper module imported by the second and by
one-off `node -e` checks, never listed in the script.

**`test/ui.test.mjs`** imports `listboxInit`, `listboxNext`, `TYPEAHEAD_MS` from `../web/ui.mjs`
and `parseRoute`, `shouldRefetch` from `../web/app.mjs`. Cases: closed + `ArrowDown` opens
with `active` = value index; `ArrowDown` x2 then x1 clamps at the last; `Home` / `End`;
`Enter` commits and closes with `changed: true`; `Enter` on the current value gives
`changed: false`; `Escape` leaves `value`; `Tab` commits; `' '` opens then commits; `d` from
closed opens and focuses Dark; `l` then `Enter` commits Light; `s`, `s` cycles when two labels
share the initial (a fixture with `Sepia`); a buffer older than `TYPEAHEAD_MS` restarts; `pick`
and `point`; unknown key returns an equal state; `parseRoute('#/styleguide')` is
`{ page: 'styleguide' }` and `shouldRefetch({ page: 'styleguide' }, ['changes/x/tasks.md'])`
is false. It also starts a server with `startServer` (as `test/diff.test.mjs:10` does) and
asserts `GET /ui.mjs` answers 200 with `text/javascript`, and that `import('../web/ui.mjs')`
resolved with no `document` defined.

**`test/styles.lib.mjs`** holds the pure helpers, and **`test/styles.test.mjs`** imports them
and reads the five files as text. The split exists so that a `node -e` script can import a
helper and run it over a scratchpad copy without also executing the suite and printing TAP.
Exports: `emittedClasses(text)`, `cssClasses(css)`, `darkTwinMismatch(css)` (the D3
comparison; returns the first selector present in one multiset and not the other, or present
in both with different declarations, as `{ selector, media, attr }`, or `null` when the
multisets are equal) and `orphanClasses(css, emittedSet)` (the CSS classes not in the set,
sorted). `emittedClasses(text)` scans for
`class="` and reads to the closing quote at template depth 0, tracking `${` / `}` nesting (a
quote inside an expression does not end the attribute). Depth-0 segments split on whitespace
into names. Inside an expression, a string literal counts as class names only when the
non-space character immediately before its opening quote is `?` or `:` (the two branches of a
conditional); a literal after `===`, `!==`, `==`, `(`, `,` or anything else is a comparison
operand or an argument and is ignored, and bare identifiers are ignored. This rule is what
keeps the forward assertion free of false positives: with "every literal" the extractor would
collect `done` from `app.mjs:207` (harmless, `.done` exists) and `abandoned` from
`app.mjs:284`, and `.abandoned` has no rule. The cited patterns, all unit fixtures in the test:
`class="tag${v === 'done' ? '' : ' warn'}"` (`app.mjs:207`) yields `tag warn`;
`class="tag${e.kind === 'abandoned' ? ' warn' : ' lime'}"` (`app.mjs:284`) yields `tag warn
lime` and not `abandoned`; `class="tag${body.writable ? ' lime' : ''}"` (`app.mjs:322`) yields
`tag lime`; `class="file${f.path === path ? ' selected' : ''}"` (`app.mjs:428`) yields `file
selected`; `class="dir${closed ? ' closed' : ''}"` (`app.mjs:432`) yields `dir closed`;
`class="task ${done ? 'done' : 'open'}"` (`md.mjs:97`) yields `task done open`;
`class="row ${l.kind}"` (`app.mjs:413`) yields `row` and the identifier is covered by a
supplement list `['add', 'del', 'ctx', 'meta']` cited to `app.mjs:66-69`;
``class="language-${...}"`` (`md.mjs:119`) is dropped by an ignore-prefix list
`['language-']`. A second regex collects `classList.(add|toggle)('name'`
(`app.mjs:497,520,525`). The extractor is unit-tested in the same file against these literal
strings before it is applied to the real sources. `cssClasses(css)` first strips `/* ... */`
comments and quoted strings, then collects every `\.([A-Za-z_][\w-]*)`; the comment at
`app.css:2` contains `globals.css`, so without the strip the word `css` would be collected as a
class, which is the unit fixture for the strip. Assertions in `test/styles.test.mjs`: (1) every
emitted name has `\.name(?![\w-])` in `app.css`; (2) `orphanClasses` over the union of the
four emitters is empty, with an allowlist that starts empty; (3) `darkTwinMismatch(app.css)`
is `null`; (4) no file returned by `readdirSync('web')` matches `https?://`, and, once
`ui.mjs` exists, `ui.mjs` is among the names returned; (5) `package.json` has no
`dependencies` key. Sequencing so that no failing or skipped test is ever committed: task 1.2
writes the helpers and their unit cases only, and proves the two-missing-classes result
(`open`, `flat`) with a one-off `node -e` script that imports `emittedClasses` and
`cssClasses` from `test/styles.lib.mjs`; task 1.3 adds the two rules and assertions (1), (3),
(4) without the `ui.mjs` clause and (5) in the same edit; the `ui.mjs` clause of (4) is added
in task 5.1, the task that creates the file; assertion (2) is enabled in the task that finishes
the styleguide, because until then the form kit has no emitter.

### D11. Markdown elements from magick.css, adapted

All CSS only, scoped to element selectors so hand-written styleguide markup and any future
renderer output pick them up: `blockquote` (2 px left border ink, paper-2, padding 8px 12px,
`magick.css:588-594`), `blockquote footer` (right-aligned, muted, not floated),
`blockquote footer cite` (italic), `dl` / `dt` (bold) / `dd` (indent 16 px, `magick.css:293-300`),
`figure` (control border, paper, centered) / `figcaption` (muted, mono, `magick.css:327-349`),
`kbd` (2 px border, 3 px shadow, mono, paper-2), `mark` (lime / lime-ink), `abbr[title]` (dotted
underline), `details` (panel geometry at control weight) / `summary` (control surface, hover
lime, `details[open] > summary` pressed pair), `sup` / `sub` (`font-size: 0.75em; line-height:
0`), `pre .line-number` and `pre .line-number span` (`magick.css:660-674`, border-right
ink-muted), `fieldset` (2 px border, padding 8px 12px) / `legend` (bold, padding 0 6px) /
`label` (inline-flex, gap 8px). Dropped: sidenotes, header and footer decorations, `h3::before`
glyph, form grid, fonts and the `@import` at `magick.css:11`.

### D12. Form-control kit

`input[type="checkbox"]`, `input[type="radio"]` (`--check` square, 2 px border, checked = lime
with `::after` check or dot, focus outline, disabled opacity; `ui/checkbox.tsx:19`), wrapped in
`<label class="check">` (inline-flex, gap 8 px, `cursor: pointer` by class, see D2);
`.switch` = `<label class="switch"><input type="checkbox" role="switch"><span
class="switch-track"><span class="switch-thumb"></span></span></label>`, track `--switch-w` x
`--switch-h` with 2 px border, thumb 16 px paper with 2 px border translated by 24 px when
checked (`ui/switch.tsx:18-26`, square corners); `input[type="text"], input[type="search"],
input[type="url"], input[type="number"], input[type="password"], textarea` (2 px border,
paper-2, `padding: 4px 8px`, placeholder muted, focus outline, disabled opacity;
`ui/input.tsx:11`); `.select-trigger` is an alias class for `.listbox-trigger` styling used on
a plain `<button>` so a future page can adopt the trigger look before it has a listbox. No JS
beyond the listbox: native checkboxes, radios and switches keep their own state.

## Risks / Trade-offs

- `display: block` on `<table>` changes the table's outer box; `th`/`td` borders still collapse
  because `border-collapse` applies to the inner table box. Mitigation: the styleguide shows a
  narrow and a wide table; the markdown golden tests do not look at layout.
- The `:is(pseudo, .sg-*)` selectors raise specificity uniformly (the pseudo and the class both
  weigh 0,1,0), so no existing override order changes. Risk: a future rule written as a bare
  `:hover` would miss the styleguide; mitigated by the reverse coverage test flagging any
  `.sg-*` class the styleguide stops emitting, and by a comment at the top of the grammar block.
- Hiding the task glyph with `font-size: 0` and drawing the check in `::after` relies on the
  span being inline-block with fixed size; a screen reader already ignores it
  (`aria-hidden="true"`, `md.mjs:97`).
- Removing the native `<select>` removes the platform's built-in type-ahead and touch popup; the
  reducer reproduces type-ahead and the menu is finger-sized (30 px rows). Accepted by the
  interview.
- The reverse coverage assertion makes `app.css` and the styleguide co-dependent: adding a
  class rule without a styleguide example fails `npm test`. That is the intended discipline; the
  allowlist in `test/styles.test.mjs` is the escape hatch, empty at hand-over.
- Chromium versions that support both `scrollbar-color` and the pseudo-elements are protected by
  the `@supports not selector(...)` guard; a Firefox build reading the fallback gets colours but
  not the 4 px track border, which is the existing trade-off (`app.css:250-252`).

## Do-Not-Touch

- `scripts/dashboard.mjs` and everything under `scripts/` (server, API, static rules,
  `CONTENT_TYPES`, security guards): the new asset is served by the existing extension map.
- `web/md.mjs`: no renderer change; blockquote and images keep degrading to text.
- `test/dashboard.test.mjs`, `test/diff.test.mjs`, `test/markdown.test.mjs`,
  `test/spec.test.mjs`, `test/completion-guard.test.mjs`, `test/models.test.mjs`,
  `test/helpers.mjs`: existing tests are the regression bar, not the workbench; new assertions
  live in `test/ui.test.mjs` and `test/styles.test.mjs`, with helpers in `test/styles.lib.mjs`.
- `specs/`: only through `changes/dashboard-design-parity/specs/dashboard/spec.md` and archive.
- `package.json` `dependencies`: none may appear; only the `test` script line changes.
- Everything outside `web/`, `test/`, `package.json` and `changes/dashboard-design-parity/`.
- The inline theme script at `web/index.html:8` and the storage wrapper at `web/app.mjs:154-176`:
  they are the first-paint and denied-storage guarantees.

## Rebuild / Re-run After Change

- No build: the server reads each asset from disk per request with `cache-control: no-cache`
  (`scripts/dashboard.mjs:479-491`), so `web/ui.mjs` is served the moment the file exists and
  a browser reload shows every edit. A dashboard is already running against this root on port
  4321 (`.my-flow/state/dashboard.json`, pid 31596 at planning time); `dashboard start` would
  report a busy port (`specs/dashboard/spec.md:45-47`). Either use the running instance and
  reload the browser, or run `node scripts/cli.mjs dashboard stop` and then `start`; never
  start a second one on another port for verification, because the same-origin guard and the
  stored theme are per origin.
- `npm test` after every task (the `test` script must list `test/ui.test.mjs` and
  `test/styles.test.mjs` once they exist).
- `node scripts/spec.mjs validate dashboard-design-parity` after any edit under
  `changes/dashboard-design-parity/`.
- Screenshot review: start the dashboard against this repository, open
  `http://127.0.0.1:4321/#/styleguide`, capture light and dark, compare with the qiujm-web
  header controls and select menu; this is the user's acceptance step.
