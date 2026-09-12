# PLAN-DR

## Principles

1. **The sample is the reference, not an inspiration.** Widths, colours and the 4 px black
   border are copied verbatim from `../my-flow-sample/src/styles/globals.css:290-372`; where the
   dashboard genuinely differs (no `html.dark` class, `pre` sits on paper rather than on a dark
   code block) the transposition is stated and justified, never improvised.
2. **One contiguous addition, nothing above it moves.** The change is a styling change; every
   existing declaration in `web/app.css` stays byte-identical, so the diff is a single appended
   block and `git diff --stat` shows one file with insertions only.
3. **Zero dependency, zero network.** No `@import`, no font, no image, no URL of any kind: the
   offline test at `test/dashboard.test.mjs:293-300` greps every file under `web/` for
   `https?://` and must stay green.

## Decision Drivers

1. **Visual parity with the sample** (proposal, Why): flat, square, black-bordered bars in the
   page's own palette. A rounded translucent default bar anywhere on the page is the failure
   this change exists to remove.
2. **Only `web/app.css` may change** (proposal, Non-Goals and Impact): no new scrollable
   region, no HTML class, no JavaScript. This eliminates every option that needs a hook in
   `web/index.html` or `web/app.mjs`.
3. **Both engines stay correct** (proposal, What Changes): Chromium gets the `::-webkit-scrollbar`
   pseudo-elements, Firefox gets `scrollbar-color` / `scrollbar-width`, and neither can
   override the other.

## Viable Options

- **A (chosen). WebKit pseudo-elements plus an `@supports not selector(::-webkit-scrollbar)`
  fallback, exactly as the sample does.** Reproduces the sample pixel for pixel in Chromium
  (per-part control: separate track, thumb and corner, and the 4 px `border-left` on the track
  that only a pseudo-element can express), while Firefox still gets themed bars from the
  standard properties. It is the only option that delivers success criterion 1.
- **B. Standard `scrollbar-color` / `scrollbar-width` only.** *Rejected.* `scrollbar-width`
  offers `auto | thin | none`, so 20 px / 16 px / 10 px are simply not expressible, and
  `scrollbar-color` takes two colours with no per-part border, so the 4 px black track border
  and the transparent `pre` corner are unreachable. It would produce a themed but visibly
  different scrollbar, failing the "reads as one design" goal.
- **C. A `.scrollbar` / `.code` utility class as the sample uses.** *Rejected.* The sample's
  classes are applied in its markup; reusing them here means editing `web/index.html`
  (`web/index.html:12` `.sidebar`, `:28` `.content`) and `web/app.mjs`, which the proposal's
  Non-Goals forbid outright. The dashboard's element and class selectors already identify every
  scroll container, so the indirection buys nothing.

## Context

`web/app.css` is the dashboard's whole stylesheet: `:root` design tokens at `web/app.css:3-23`,
a dark override at `:24-34`, base elements, then layout, panels, lists, markdown and the editor,
ending at `.highlight` (`web/app.css:174`). It already declares `color-scheme: light dark`
(`web/app.css:4`), so today the browser paints its own default bars, light-grey and rounded in
light mode and the UA's dark default in dark mode. Nothing in the file mentions a scrollbar.

The scroll containers that actually exist today are:

- the page itself. `html, body { margin: 0; height: 100% }` (`web/app.css:37`) with
  `.shell { min-height: 100% }` (`:65`), so a tall page overflows to the viewport scrollbar.
- `.editor textarea` (`web/app.css:157-169`): `min-height: 60vh` and `resize: vertical`, so it
  scrolls vertically as soon as the file is longer than the box. It is the dashboard's main
  reading surface for a long `tasks.md`.
- `pre` (`web/app.css:48-53`): `overflow-x: auto`, so it scrolls **horizontally** only.
- `.sidebar` (`web/app.css:66-77`): `height: 100vh` and `position: sticky` but **no** `overflow`
  declaration, so it does not scroll today; overflowing nav items would spill visibly.

The sample block being transposed is `../my-flow-sample/src/styles/globals.css:290-372`:
`--sb-track-color` / `--sb-thumb-color` on `body, .scrollbar` (`:290-294`) with the dark pair on
`html.dark body, html.dark .scrollbar` (`:296-300`); `body::-webkit-scrollbar { width: 20px }`
(`:306-308`); `.scrollbar::-webkit-scrollbar { width: 16px }` (`:302-304`); the shared track and
thumb backgrounds (`:314-326`); `body::-webkit-scrollbar-track { border-left: 4px solid #000 }`
(`:319-321`); `html.dark body::-webkit-scrollbar-thumb { border-left: 4px solid #000 }`
(`:328-330`); the `.code` rules at 10 px with a transparent track, a white thumb and a
transparent corner (`:332-349`); and the `@supports not selector(::-webkit-scrollbar)` fallback
(`:363-372`).

## Goals / Non-Goals

**Goals:**

- The page, the editor textarea and code blocks show flat, square, palette-coloured scrollbars
  at the sample's widths in both colour schemes, in Chromium.
- Firefox, which has no `::-webkit-scrollbar`, still gets thumb and track in the same two
  colours through the standard properties.
- One appended block in `web/app.css`; every other line of the file, and every other file in the
  repository, untouched.

**Non-Goals:**

- No `overflow` is added to `.sidebar` or to any other element: no new scroll container is
  created (proposal, Non-Goals).
- No scrollbar styling for tables, `.content`, `.editor .preview` or anything inside the
  rendered markdown other than `pre`.
- No `html.dark` class, no theme toggle, no JavaScript; dark mode is selected only by
  `@media (prefers-color-scheme: dark)`, because `web/index.html` carries no theme class
  (`web/index.html:2`, `:10`).
- No new palette tokens beyond the two scrollbar custom properties.

## Decisions

**D1. Two custom properties on `:root`, named as in the sample.** `--sb-track-color` and
`--sb-thumb-color` are added to the existing `:root` block (`web/app.css:3-23`) with the light
pair `#ffffff` / `#000000` (`globals.css:290-294`), and re-declared in the existing
`@media (prefers-color-scheme: dark)` block (`web/app.css:24-34`) with `#1f1f1f` / `#e6e6e6`
(`globals.css:296-300`). Literal hex, not `oklch`, so the values are verifiably identical to the
sample's. The names are kept verbatim so a reader can diff the two stylesheets side by side.
These are the only two declarations added outside the appended block, and they go inside the
blocks that already exist rather than creating new `:root` rules.

*Accepted deviation.* The sample picked `#ffffff` and `#1f1f1f` against its own pure-white and
near-black grounds, while the dashboard's grounds are the warm cream `oklch(97.8% 0.018 95)`
(`web/app.css:5`) and the cool near-black `oklch(17% 0.025 165)` (`web/app.css:26`). The track
therefore sits a shade cooler than the page it borders in both schemes. The proposal's Decision
Boundaries say the colours are taken verbatim from the sample, so the literals are kept rather
than retuned to the dashboard palette; the mismatch is recorded here and judged by screenshot in
task 3.1, not designed around.

**D2. Page scrollbar: `body`, 20 px, 4 px black track border.**

```
body::-webkit-scrollbar { width: 20px; }
body::-webkit-scrollbar-track { background: var(--sb-track-color); border-left: 4px solid #000; }
body::-webkit-scrollbar-thumb { background: var(--sb-thumb-color); }
```

`body` and not `html`: in Blink the viewport's scrollbar takes its style from `body` first, and
falls back to `html` only when `body` supplies none, which is what the sample relies on
(`globals.css:306`). Styling `html` as well would leave two sources for the same bar with `body`
winning, so the `html` rules would be silently dead weight; `html` is deliberately left alone.
Only `width` is set, not `height`: the page never
scrolls horizontally (`.content` is `max-width: 1100px; min-width: 0`, `web/app.css:78`).

**D3. Dark-mode thumb border.** Inside `@media (prefers-color-scheme: dark)`, in the appended
block: `body::-webkit-scrollbar-thumb { border-left: 4px solid #000; }`, transposing
`html.dark body::-webkit-scrollbar-thumb` (`globals.css:328-330`). In dark mode the thumb is
near-white against a `#1f1f1f` track, and the black border is what keeps the bar reading as a
hard-edged object rather than a floating light stripe.

**D4. Inner scroll areas: `.editor textarea` and `.sidebar`, 16 px, no border.**

```
.editor textarea::-webkit-scrollbar,
.sidebar::-webkit-scrollbar { width: 16px; }
.editor textarea::-webkit-scrollbar-track,
.sidebar::-webkit-scrollbar-track { background: var(--sb-track-color); }
.editor textarea::-webkit-scrollbar-thumb,
.sidebar::-webkit-scrollbar-thumb { background: var(--sb-thumb-color); }
.editor textarea::-webkit-scrollbar-corner { background: var(--sb-track-color); }
```
The `-track` and `-thumb` backgrounds are the same two properties `body` uses, with no
`border-left` on either part, matching `.scrollbar` in the sample (`globals.css:302-304`,
`:314-326`). Written out in full here so the selector count in the finished stylesheet is
derivable from this design: D2 to D6 together spell out sixteen `::-webkit-scrollbar`
occurrences, counting the one inside the `@supports` condition.

The corner rule is an addition the sample does not need. `.editor textarea` is
`resize: vertical` (`web/app.css:167`), so Chromium reserves the square where the resize grip
sits at the bottom of the bar; left unstyled it paints as a UA-default patch immediately beside a
16 px hand-styled bar, which is exactly the mixed-design artefact this change removes. Painting it
with the track colour makes the bar read as one continuous strip.

*The textarea is 16 px, not 10 px.* It is a `min-height: 60vh` panel (`web/app.css:159`),
the same order of size as the page itself, so its bar is a primary navigation control for a long
`tasks.md`; a 10 px bar would be a smaller hit target than the page's 20 px one on a box almost
as tall. The 10 px width belongs to `pre`, where the bar is an incidental horizontal strip inside
a block of text. This is the choice the proposal's Decision Boundaries leave to the agent.

`.sidebar` is included because the proposal names it, and the rule is inert today: the sidebar
has no `overflow` (`web/app.css:66-77`) so it paints no scrollbar. Adding `overflow: auto` would
create a new scroll container, which the Non-Goals forbid. The rule costs three selectors and
makes the sidebar correct the day it does scroll.

**D5. Code blocks: `pre`, 10 px both axes, transparent track and corner.**

```
pre::-webkit-scrollbar { width: 10px; height: 10px; border: 0; }
pre::-webkit-scrollbar-track { background: transparent; }
pre::-webkit-scrollbar-thumb { background: var(--sb-thumb-color); }
pre::-webkit-scrollbar-corner { background: transparent; border: 0; }
```

`height` matters here and only here: `pre` is `overflow-x: auto` (`web/app.css:52`), so its bar
is horizontal, and a horizontal `::-webkit-scrollbar` takes its thickness from `height`. The
thumb is `var(--sb-thumb-color)`, not the sample's literal `white` (`globals.css:336-338`):
the sample's `.code` sits on a dark code background where white is the ink colour, while the
dashboard's `pre` sits on `--paper-2` (`web/app.css:49`), which is near-white in light mode. A
white thumb would be invisible there, so the thumb follows the theme exactly as the proposal
specifies. `border: 0` and the corner rule are carried over from `globals.css:340-349`; the
transparent track lets the `pre` background show through, so the bar reads as part of the block.
The sample's `!important` on those two declarations is dropped: nothing else in `web/app.css`
targets a scrollbar pseudo-element, so there is no rule for it to win against.
The sample's `.toc-scrollbar` and `.command-scrollbar` rules (`globals.css:310-312`, `:351-361`)
have no counterpart in the dashboard and are not transposed.

**D6. Firefox fallback, guarded by `@supports not selector(::-webkit-scrollbar)`.**

```
@supports not selector(::-webkit-scrollbar) {
  body, .editor textarea, .sidebar { scrollbar-color: var(--sb-thumb-color) var(--sb-track-color); scrollbar-width: auto; }
  pre { scrollbar-color: var(--sb-thumb-color) transparent; scrollbar-width: thin; }
}
```

The `scrollbar-color` half follows `globals.css:363-372`. `scrollbar-width` is an addition beyond
the sample, which sets colour only: `auto` / `thin` is the closest the standard property gets to
the 20/16 vs 10 px split, so `pre` at least stays visibly thinner than the page bar in Firefox.
The exact pixel widths remain unreachable there (option B above).

The guard must stay tight for a second reason beyond precedence: `scrollbar-color` is an
**inherited** property. A declaration on `body` outside the `@supports` block would reach every
descendant scroll container, so in Chromium it would not merely restyle the page bar, it would
switch the whole page to standard-property painting and disable every `::-webkit-scrollbar` rule
in this design at once, including `pre` and the textarea. That is the difference between one
wrong bar and no styled bars at all, and it is why the fallback is never hoisted out of the
`@supports` block "just for Firefox".

**D7. Placement: one appended block at the end of `web/app.css`, after `.highlight` (`:174`),
introduced by a `/* scrollbars */` comment naming the sample lines it transposes.** Cascade order
is irrelevant for these rules: no other rule in the file targets a scrollbar pseudo-element, so
nothing can conflict. Appending keeps every existing line at its current line number, which makes
the diff reviewable and matches Principle 2. The two custom properties are the deliberate
exception (D1), because they belong with the other tokens in the blocks that define the palette.

No `::-webkit-scrollbar-button` rule is written. Declaring any `::-webkit-scrollbar` rule makes
Chromium drop its own arrow buttons, which are visible at the ends of the page bar in the current
screenshots under `.my-flow/verify/web-dashboard-e2e-shots/`. Their disappearance is the expected
consequence of taking over the scrollbar, matches the sample, and is not a regression to fix; the
alternative would be hand-drawing four button states, which the proposal does not ask for.

## Risks / Trade-offs

- **Chrome 121+ supports `scrollbar-color`, and when both are set the standard properties win.**
  In Chromium, a scroll container with a non-`auto` `scrollbar-color` or `scrollbar-width` value has its
  `::-webkit-scrollbar` rules ignored for that container: the standard properties take precedence
  and the browser paints its own bar geometry. An unguarded fallback block would therefore silently
  destroy every width and border decided above, in the exact browser the design targets. This is
  precisely why the fallback lives inside `@supports not selector(::-webkit-scrollbar)`: Chromium
  *does* support that selector, so the condition is false and the block never applies there;
  Firefox does not, so the condition is true and the block is its only source of colour. The guard
  is load-bearing, not decorative, and removing it is a regression, not a simplification.
  `scrollbar-color` inherits, so the blast radius of an escape is the whole document rather than
  the one selector it was written on (D6).
- **The arrow buttons at the ends of the page bar disappear.** Styling `::-webkit-scrollbar` opts
  out of Chromium's own scrollbar rendering, buttons included. Expected and accepted (D7), and
  worth naming so a reviewer comparing against the current screenshots does not read it as damage.
- **`color-scheme: light dark` on `:root` (`web/app.css:4`) already tints the default bars.** In
  dark mode the current bars are the UA's dark default, which is why the gap looks smaller than it
  is. Once `::-webkit-scrollbar` is styled, the UA default is replaced wholesale, so both colour
  pairs must be complete: an unset token would paint a transparent or black bar rather than fall
  back to the old default. Both pairs are set in D1, and both are checked by screenshot.
- **The 4 px `border-left: 4px solid #000` eats into the 20 px track**, leaving a 16 px painted
  track. That is the sample's own arithmetic (`globals.css:306`, `:319-321`) and is reproduced
  rather than compensated.
- **Styling the scrollbar overrides the platform's own.** Users who rely on OS scrollbar settings
  lose them on this page. Accepted: the dashboard is a single-developer local tool, the bars are
  wider than the default rather than narrower, and contrast between thumb and track is maximal in
  both schemes.
- **`.sidebar` rules are dead code until the sidebar scrolls.** Accepted knowingly (D4); the
  alternative is adding `overflow`, which is a forbidden layout change.
- **Screenshots are the only proof.** No unit test can assert a painted scrollbar, so task 3.1
  carries the whole burden of evidence for success criterion 1 and must show real bars in both
  schemes, not an empty page.

## Do-Not-Touch

`web/app.mjs`, `web/md.mjs`, `web/index.html`, and everything outside `web/`: `scripts/`,
`test/`, `src/`, `skills/`, `codex/`, `hooks/`, `agents/`, `templates/`, `specs/`, `README*.md`,
`manifest.json`, `package.json`. No file under `web/` other than `web/app.css` may be modified,
and no file may be added there. Fixtures created for the screenshot task live under the
scratchpad directory or a temporary directory, never inside the repository.

## Rebuild / Re-run After Change

- `npm test` (70 tests). The offline test at `test/dashboard.test.mjs:293-300` reads every file
  under `web/` and asserts none contains `http://` or `https://`, so the new CSS must reference
  no URL; `grep -rE "https?://" web/` must print nothing.
- A visual check of the dashboard in light and dark mode with a page tall enough to scroll and
  the editor open on a long file, captured as screenshots and recorded in a note under
  `.my-flow/verify/`.
- No build step, no bundler, no cache: `web/app.css` is served as-is by `scripts/dashboard.mjs`,
  so a browser reload with cache disabled is the only refresh needed.
