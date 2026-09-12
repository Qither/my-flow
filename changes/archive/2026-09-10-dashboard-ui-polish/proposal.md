## Why

Seven rough edges showed up while using the dashboard after `dashboard-scrollbar` and
`dashboard-theme-lock-diff` landed. All of them are in the browser page (`web/`), and two of
them are plain bugs:

1. **Diff scrollbars are not the dashboard's own.** The scrollbar rules in `web/app.css`
   (bottom block: `body`, `.editor textarea`, `.sidebar`, `pre`) do not cover the diff page:
   `.patch` has `overflow-x: auto` and therefore shows the browser's default rounded grey bar
   next to the styled ones.
2. **The diff page is boxed to 1100 px.** `.content { max-width: 1100px }` applies to every
   route, so on a wide window the patch pane wastes most of the screen and scrolls long lines
   needlessly. The diff page should use as much width as the window offers.
3. **The theme control is three buttons.** The user wants a dropdown component instead of the
   Auto / Light / Dark button row (`web/index.html` `.theme`, `web/app.mjs` `applyTheme`).
4. **The task progress bar never moves.** `progressHtml()` in `web/app.mjs` renders
   `<span class="bar"><span class="fill" style="width:N%">`. `.bar` is a flex item (so it is
   laid out), but `.fill` is an inline `<span>` inside a block: its `width` and `height: 100%`
   are ignored, so the bar stays empty while only the `done/total` text changes.
5. **The diff page does not say which file is being worked on right now.** During `execute`
   an agent edits files continuously; the tree shows the same list for every file with no hint
   of recency, and reaching a file means clicking through the tree. The page should mark the
   most recently modified file and offer keyboard shortcuts to jump between files and to that
   file.
6. **Dark mode: the status letter disappears on the selected and hovered row.** `.tag.st`
   keeps `background: var(--paper-2)` (dark) while `li.file.selected` and the generic
   `a:hover` set `color: var(--lime-ink)` (black), so the letter is black on near-black.
7. **Selected and hovered rows are not vertically aligned.** `li.file` uses
   `align-items: baseline`, the hover background is painted by the generic `a:hover` on the
   anchor only (not the row), and the tag has its own line box, so the highlight, the text
   and the status tag do not sit centred against the row background.

## What Changes

- **Scrollbars (1)**: add the diff page's scroll areas (`.patch`, and the file pane if it
  scrolls) to the existing scrollbar rules with the "inner area" width and colours, in the
  WebKit block and in the `@supports not selector(::-webkit-scrollbar)` fallback.
- **Width (2)**: the diff route uses the full content width instead of the 1100 px cap;
  other routes keep their cap. The mechanism (a class on `.content` set by the router, or a
  route-specific rule) is the planner's choice.
- **Theme dropdown (3)**: replace the three-button group with one dropdown listing
  `Auto (system)`, `Light`, `Dark`; a native `<select>` styled in the paper / ink language is
  the expected implementation (no dependency, keyboard accessible). Behaviour is unchanged:
  same `localStorage` key, same `data-theme` attribute, same pre-paint script, same handling
  when storage is denied. The spec requirement `Theme selection independent of the operating
  system` still holds word for word; only the control's form changes.
- **Progress bar (4)**: make `.bar .fill` a block-level box (CSS fix) so the fill width
  renders and follows `done/total` on every refetch.
- **Current file and shortcuts (5)**: `GET /api/diff` gains a per-file modification time
  (`mtimeMs`, `null` for a deleted file); the page marks the file with the newest `mtimeMs`
  as the latest-modified file in the tree and the flat list (visibly, and with a title), and
  binds keyboard shortcuts on the diff page: next file, previous file, and jump to the
  latest-modified file. The shortcuts are listed on the page itself, next to the view toggle.
  Shortcuts must not fire while typing in an input, select or textarea and must not use
  modifier combinations the browser already owns.
- **Dark-mode contrast (6)**: on a selected or hovered row the status tag gets an explicit
  background and colour pair that stays readable in both themes.
- **Row alignment (7)**: the row (`li.file`) is the hover and selection target, painted as
  one box with `align-items: center`, consistent padding, and the tag and text sharing the
  same vertical centre; the anchor no longer takes the generic `a:hover` background.
- **Docs**: the theme sentence in the eight `README*.md` files, `src/skills/dashboard.md`
  and its generated outputs says "dropdown" instead of "buttons", and the diff sentence
  mentions the latest-modified marker and the shortcuts.

## Non-Goals

- No change to the diff base, the git invocations beyond adding `mtimeMs`, the size cap, or
  any git write.
- No new file watcher and no polling loop on the server: which file is "latest" is computed
  when `/api/diff` is fetched (on every `change` event affecting the page, and on Refresh).
- No custom dropdown widget: a native `<select>` is enough; no dependency, no external
  resource.
- No change to the other pages' width, the sidebar width, or the layout below 1000 px.
- No syntax highlighting, side-by-side diff, or word-level diff.
- No new theme values; no colour tokens beyond what the two fixes need.
- No change to `scripts/spec.mjs`, `scripts/lib/`, hooks, agents, templates, or the CLI.

## Decision Boundaries

**Settled by the user (2026-09-10)**
- The theme control becomes a dropdown.
- The diff page adapts to the available width instead of a fixed width.
- The diff page shows the file currently being modified and offers a shortcut to jump to it.

**The agent may decide alone**
- The exact keys for next / previous / jump-to-latest (for example `j` / `k` / `.`), and how
  they are shown on the page.
- How the diff route drops the width cap (router-set class versus route-specific selector).
- The exact `<select>` styling, and whether the dropdown shows the current value as text or
  as an icon.
- Whether the latest-modified marker is a symbol, a tag, or a colour, as long as it is
  readable in both themes and has a `title`.
- Whether the file pane gets its own scroll area and sticky position on the diff page.

**Needs the user**: nothing further.

## Capabilities

### New Capabilities
none

### Modified Capabilities
- `dashboard`: MODIFIED `Diff view of the working tree` (per-file `mtimeMs`, latest-modified
  marker, keyboard shortcuts). `Theme selection independent of the operating system` is not
  tied to buttons in its wording, so no delta is expected for it unless the planner finds
  otherwise.

## Impact

- **Modified**: `web/app.css`, `web/app.mjs`, `web/index.html`, `scripts/dashboard.mjs`
  (`diffList` adds `mtimeMs`), `test/diff.test.mjs` (mtime in the list; any new pure helper),
  the eight `README*.md`, `src/skills/dashboard.md` and its generated outputs via
  `npm run build` (`skills/dashboard/SKILL.md`, the codex copies).
- **Do-Not-Touch**: `scripts/spec.mjs`, `scripts/lib/`, `scripts/cli.mjs`,
  `scripts/build.mjs`, `hooks/`, `agents/`, `src/agents/`, `src/core/`, `templates/`,
  `claude/`, `codex/` except generated skill outputs, every other skill under `src/skills/`,
  `manifest.json`, `package.json`, `web/md.mjs`, `test/spec.test.mjs`,
  `test/completion-guard.test.mjs`, `test/markdown.test.mjs`.
- **Rebuild / Re-run after change**: `npm run build` after editing `src/skills/dashboard.md`,
  then `npm run check`; `npm test`; a headless-Chrome run against this repository (as in
  `.my-flow/verify/dashboard-theme-lock-diff-e2e-*.md`) with screenshots under
  `.my-flow/verify/` covering both themes; `grep -rE "https?://" web/` must stay empty.

## Success Criteria

1. Screenshots in light and dark mode show the diff page with the dashboard's flat square
   scrollbar on the patch pane (no default grey bar), and the patch pane filling the window
   width on a 1600 px wide viewport while the Changes page keeps its 1100 px cap.
2. The sidebar shows one dropdown with Auto / Light / Dark; choosing Light under an emulated
   dark OS scheme renders the light palette, choosing Dark under light renders dark, the
   choice survives a reload with no flash, and Auto clears it; with storage throwing, the
   dropdown still switches the page. (Same checks as the archived theme evidence.)
3. On the Changes page a change with `n/m` tasks shows a lime fill of `n/m` of the bar width
   (measured via the element's computed width), and ticking one task in `tasks.md` moves the
   fill without a reload.
4. `/api/diff` entries carry `mtimeMs` (a number for an existing file, `null` for a deleted
   one), covered by a test; the page marks the file with the newest `mtimeMs`, the shortcuts
   move the selection to the next / previous file and to the latest-modified file, and typing
   in the editor's textarea never triggers them.
5. In dark mode, screenshots of a hovered row and of the selected row show the status letter
   readable, and the row's text and status tag centred vertically in the highlighted box.
6. `npm test` passes, `npm run check` reports up to date, `grep -rE "https?://" web/` is
   empty, and `git status --short` lists only the files under **Modified**.
