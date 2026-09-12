## Why

The dashboard's stylesheet (`web/app.css`) transposes the visual language of
`../my-flow-sample` (paper / ink / lime, square corners, hard offset shadows), but every
scrollbar on the page is still the browser default: rounded, translucent, and light-grey even
in dark mode. The sample styles its scrollbars deliberately
(`../my-flow-sample/src/styles/globals.css:288-372`): flat track and thumb in the page's own
black / white palette, a 4 px black left border on the page track, wide bars (20 px page,
16 px inner areas, 10 px in code blocks), and a `scrollbar-color` fallback for browsers that
do not support `::-webkit-scrollbar`. The dashboard's page scrollbar, the editor textarea,
code blocks and the sidebar should look the same, or the page reads as two different designs
side by side.

## What Changes

Only `web/app.css` changes:

- Page scrollbar (`body`): 20 px wide, flat track and thumb with a 4 px black left border on
  the track, in the sample's colours: light theme white track / black thumb, dark theme
  `#1f1f1f` track / `#e6e6e6` thumb with a 4 px black left border on the thumb.
- Inner scroll areas (the editor `textarea`, the `.sidebar`, and any other element the
  planner identifies as scrollable): 16 px wide, same track / thumb colours, no border.
- Code blocks (`pre`): 10 px wide, transparent track, thumb in the page's ink colour (the
  sample uses a white thumb over its dark code background; the dashboard's `pre` sits on the
  paper background, so the thumb follows the theme's thumb colour instead), transparent corner.
- Dark mode selected by `@media (prefers-color-scheme: dark)`, because the dashboard has no
  `html.dark` class; the two colour pairs live in two custom properties on `:root`.
- Fallback for browsers without `::-webkit-scrollbar` (Firefox): `scrollbar-color` and
  `scrollbar-width` inside `@supports not selector(::-webkit-scrollbar)`, mirroring the sample.

## Non-Goals

- No change to `web/app.mjs`, `web/md.mjs`, `web/index.html`, the server, the tests, the
  skill, the READMEs, or any file outside `web/app.css`.
- No new layout, no new scrollable regions, no JavaScript-driven scrollbars.
- No new colour tokens beyond the two scrollbar custom properties; the rest of the palette is
  untouched.
- No attempt to style scrollbars inside the rendered markdown preview beyond what `pre`
  already gets; tables keep the default overflow behaviour they have today.

## Decision Boundaries

**The agent may decide alone**: the exact selector list for "inner scroll areas", whether
the `textarea` uses the 16 px inner width or the 10 px code width, the naming of the two
custom properties, and where in `app.css` the block lives.

**Needs the user**: nothing. The widths and colours are taken verbatim from the sample.

## Capabilities

### New Capabilities
none

### Modified Capabilities
none: pure styling, no observable behaviour covered by a spec changes.

## Impact

- **Modified**: `web/app.css` only.
- **Do-Not-Touch**: everything else, in particular `web/app.mjs`, `web/md.mjs`,
  `web/index.html`, `scripts/`, `test/`, `src/`, `skills/`, `codex/`, `hooks/`, `agents/`,
  `templates/`, `README*.md`, `manifest.json`, `package.json`.
- **Rebuild / Re-run after change**: `npm test` (the offline test greps every file under
  `web/` for `http://` or `https://`, so the new CSS must not reference any URL), and a visual
  check of the page in light and dark mode with a scrollable page and an open editor,
  recorded as screenshots under `.my-flow/verify/`.

## Success Criteria

1. Screenshots of the dashboard in light and dark mode, with the page tall enough to scroll
   and the editor open on a long file, show the page scrollbar, the textarea scrollbar and a
   code-block scrollbar with the sample's widths and colours (flat, square, black-bordered
   page track; no default rounded grey bars).
2. `npm test` passes (70 tests) and `grep -rE "https?://" web/` is empty.
3. `git status --short` lists `web/app.css` as the only modified source file for this change.
