## Why

The dashboard stylesheet (`web/app.css`) already carries the paper / ink / lime tokens and
the hard-shadow geometry of `H:\CustomProject\social\qiujm-web`, but it stops at the pieces
the first dashboard change needed. Several controls still show browser defaults: the theme
`<select>` opens the native popup instead of the qiujm-web select menu, task boxes are text
glyphs, the file-tree toggles and inline tags carry ad-hoc borders, horizontal scrollbars in
tables, code and the patch view fall back to the platform look, and markdown or future pages
that emit blockquotes, definition lists, figures, `kbd`, `mark`, `details` or form controls get
no styling at all. magick.css (wintermute-cell) shows how a single classless file can cover
every one of those elements; its ideas are the model, its fonts and its Google Fonts import
are not. The goal is one control grammar on every page, with no default styling leaking through
and every component matching the equivalent qiujm-web component in geometry, color and state,
without importing qiujm-web's React, Radix or Tailwind stack.

## What Changes

- **Rendered components to parity.** Every element the dashboard renders today is restyled to
  the qiujm-web grammar (2px controls with 3px hard shadow, 3px panels with 6px shadow, square
  corners, 120 ms direct transitions, hover lime, pressed/open ink, focus-visible offset
  outline, disabled reduced opacity): nav tiles, button variants (default, primary, neutral,
  reverse, icon), textarea and text input, tags (plain, lime, warn, status, latest), cards,
  panels, notices, progress bar, tables, code blocks, task boxes, file tree and its toggles,
  breadcrumbs, and the patch view.
- **Custom select.** The theme control becomes a vanilla-JS listbox widget (trigger button plus
  popover listbox, arrow / home / end / type-ahead / escape keyboard handling, ARIA
  `combobox` + `listbox` roles) that reproduces the qiujm-web `header-select-menu` look: bordered
  paper menu with hard shadow, lime focused item, check indicator, trigger turns ink while open.
  The state logic lives in a pure function so it can be unit-tested without a DOM. The widget
  keeps the existing theme behavior: values `system | light | dark`, stored choice, applied
  before first paint, usable when local storage is denied.
- **Scrollbars, every kind.** Page, sidebar, textarea, diff tree, patch and `pre` scrollbars
  already exist; this change adds the horizontal bars (tables, code, patch), the listbox
  viewport, `::-webkit-scrollbar-corner` everywhere a corner can appear, the standard
  `scrollbar-color` / `scrollbar-width` fallback for each, and keeps every rule following the
  `data-theme` switch.
- **Markdown elements borrowed from magick.css**, adapted to the tokens: blockquote with
  footer / cite, definition lists, figure and figcaption, `kbd`, `mark`, `abbr`, `details` /
  `summary`, `sup` / `sub`, code line numbers, fieldset / legend / label. CSS only; the
  renderer is not taught these constructs (see Non-Goals).
- **Form-control kit.** Ready CSS, plus the minimal JS a control needs, for controls qiujm-web
  has and the dashboard does not use yet: checkbox, switch, radio, text input, select trigger,
  with hover, checked, focus-visible and disabled states. Shipped as classes with no current
  caller other than the styleguide.
- **Styleguide route.** A `#/styleguide` page in the dashboard that renders every component and
  state side by side (light and dark via the existing theme control) so parity can be checked
  visually in one place. Reachable from the sidebar.
- **Reset.** A small explicit reset (after magick.css's "Simple CSS Reset") so no user-agent
  default survives for the elements the page styles: `appearance: none` on form controls,
  `border-radius: 0`, inherited fonts on controls, no default `summary` marker, no default
  focus ring where the outline replaces it.

## Non-Goals

- No CDN, no `http://` or `https://` reference of any kind in served files, no web fonts,
  no font files; the system font stacks stay as they are.
- No framework: no React, Radix, Tailwind, class-variance-authority, or any npm dependency.
  `package.json` keeps zero `dependencies`.
- No change to the markdown renderer (`web/md.mjs`) or to the "Markdown rendering subset"
  requirement; blockquote, images and other unsupported constructs keep degrading to text.
- No change to the dashboard server (`scripts/dashboard.mjs`), its API, its static-file
  rules or its security guards. New assets are plain files under `web/`.
- No copying of qiujm-web page components (site header, hero, project cards, footer); only
  control-level and element-level parity.
- No literal copy of qiujm-web's hard-coded paper-on-ink header colors in dark mode; the
  dashboard's flipping tokens win (decided in the interview).
- No pixel-identical typography; parity is geometry, color, spacing and interaction state.

## Decision Boundaries

The agent decides alone:
- Class names, selector structure, token names added to `:root`, and the file split under
  `web/` (for example a `web/ui.mjs` for the listbox and form-control JS).
- Whether the styleguide page is a nav entry or a footer link in the sidebar, and its layout.
- Exact spacing values, as long as they come from the qiujm-web tokens (8 px control rhythm,
  10 to 14 px panel padding, 2/3 px control border and shadow, 3/6 px panel border and shadow).
- Which magick.css rules are adapted and which are dropped as irrelevant to a dashboard
  (sidenotes, header decorations, footer navigation).
- How the pure listbox state function is shaped and tested.

Needs the user:
- Anything that would change a requirement in `specs/dashboard/spec.md` beyond the two
  deltas this proposal names (theme control implementation, styleguide route).
- Any new dependency, any network reference, any font file.
- Any edit to `web/md.mjs`, `scripts/dashboard.mjs`, or the existing server tests.
- Dropping a component group from the four the interview approved.
- Ticking the final box: the user's screenshot review of the styleguide in light and dark
  against qiujm-web is part of the acceptance.

## Capabilities

### New Capabilities
none

### Modified Capabilities
- `dashboard`: MODIFIED "Theme selection independent of the operating system" (the control is a
  custom listbox with keyboard and ARIA support, same three values and storage behavior);
  ADDED "Styleguide route" (a `#/styleguide` page renders every component and state, offline,
  in both themes); ADDED "Design grammar and scrollbars" (every rendered control follows the
  one control grammar and every scrolling region has themed vertical and horizontal bars).

## Impact

- `web/app.css`: grows substantially (reset, tokens, components, scrollbars, markdown
  elements, styleguide layout).
- `web/index.html`: theme control markup replaced by the listbox trigger; styleguide link.
- `web/app.mjs`: styleguide route, listbox wiring for the theme control, task-box markup if
  the glyph becomes a styled box.
- New `web/ui.mjs` (or similar): listbox state function and DOM wiring, form-control helpers.
- `test/`: new tests for class coverage (every class emitted by `app.mjs`, `md.mjs`,
  `index.html` and `ui.mjs` has a rule in `app.css`), no-network scan including the new file,
  content-type for the new asset, and listbox state logic.
- `specs/dashboard/spec.md` via delta spec under `changes/dashboard-design-parity/specs/`.
- Do-Not-Touch: `scripts/dashboard.mjs`, `web/md.mjs`, `specs/` (only through the delta),
  everything outside `web/`, `test/`, `changes/dashboard-design-parity/`.
- Rebuild / Re-run: none for the served files (the server reads each asset from disk per
  request with `cache-control: no-cache`; a browser reload is enough). `npm test` after each
  task. `node scripts/spec.mjs validate dashboard-design-parity` after the delta spec.

## Success Criteria

- Opening `#/styleguide` shows every component and state listed under What Changes, in light
  and dark, with no browser-default control, marker, focus ring or scrollbar visible.
- The theme control opens a bordered, hard-shadowed menu with a lime focused item and a check
  mark, the trigger turns ink while open, arrow keys / Home / End / Escape / type-ahead work,
  and the chosen theme still survives a reload with no flash and still works when local
  storage is denied.
- Every scrolling region (page, sidebar, textarea, diff tree, patch, code, tables, listbox)
  shows the themed bar in both axes where it scrolls, in both themes, and the Firefox
  fallback carries the same colors.
- `npm test` is green, including: no `http://` / `https://` in any served file, zero
  `dependencies` in `package.json`, every emitted class has a rule, listbox state tests, and
  the new asset served with the right content type.
- `node scripts/spec.mjs validate dashboard-design-parity` reports no errors.
- The user has reviewed styleguide screenshots in light and dark against qiujm-web and
  accepted the parity; only then is the last task ticked.
