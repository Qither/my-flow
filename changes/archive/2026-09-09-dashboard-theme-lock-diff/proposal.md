## Why

Three gaps showed up while using the dashboard after the first two changes:

1. The page follows the operating system's colour scheme only. There is no way to pick light
   or dark on the page itself, so checking both themes or working against the OS setting
   means changing system preferences.
2. Editing is allowed at every stage. The proposal's own rule is that browser edits belong to
   the gaps between stages, while no agent is writing; during `execute` an agent is writing
   `tasks.md` and source files continuously, and a browser save in that window is exactly the
   concurrent-write case the mtime guard was never meant to resolve.
3. There is no way to see what a change actually did to the repository. `tasks.md` shows
   progress, but reviewing the work means leaving the dashboard for a terminal. A diff view of
   the working tree against `HEAD`, with a file tree to pick files from, closes that loop; git
   is the natural source, and projects without git simply do not get the page.

## What Changes

- **Theme toggle.** A three-state control in the sidebar: `system` (default, current
  behaviour), `light`, `dark`. The choice is stored in `localStorage` and applied on load
  before the first paint by setting `data-theme` on `<html>`; the stylesheet gains explicit
  `[data-theme="light"]` / `[data-theme="dark"]` token blocks so the toggle wins over
  `prefers-color-scheme`, and the scrollbar rules follow the same switch.
- **Edit lock during `execute`.** When `.my-flow/state/current-change.json` records stage
  `execute`, the server refuses every `POST /api/file` with `423 locked` and a message naming
  the change, `GET /api/file` reports `writable: false` with a `lockReason`, and the page hides
  Save and shows the reason instead. The lock lifts as soon as the stage changes (the state
  file is already watched, so no reload is needed). Every other stage behaves as today.
- **Diff page.** A new `Diff` entry in the sidebar and route `#/diff`. The server runs `git`
  once per request (`git status --porcelain=v1 -z` for the file list including untracked
  files, `git diff HEAD -- <path>` for one file's patch, and a synthetic "all added" patch for
  untracked files) with the project root as the working directory, and exposes
  `GET /api/diff` (file list with status letters and per-file line counts) and
  `GET /api/diff/file?path=<rel>` (the unified patch). The page shows the changed files on the
  left as a **tree** (directories collapsible) or a **flat list**, switchable with a control
  whose choice persists in `localStorage`, and the selected file's patch on the right rendered
  as coloured added / removed / context lines with line numbers, all in the existing paper /
  ink / lime language. Binary and very large files are listed but not rendered.
- **Git detection.** On start the server checks `git rev-parse --is-inside-work-tree` from the
  project root once and exposes the result in `/api/health` as `git: true | false`. Without
  git (or when the root is not inside a work tree) the `Diff` sidebar entry is not shown, the
  route renders a one-line explanation, and `/api/diff*` answer `404 no-git`.
- **Docs.** The dashboard section of the eight READMEs and the `dashboard` skill text mention
  the theme toggle, the execute lock and the diff page.

## Non-Goals

- No staging, committing, reverting, or any git write from the dashboard: the diff page is
  read-only.
- No diff base other than `HEAD` in this change (no ref picker, no commit history, no
  per-change commit detection). The definition of "this change's modifications" is the
  uncommitted working tree.
- No side-by-side diff, no syntax highlighting inside patches, no word-level highlighting,
  no rendering of binary or files over the size cap.
- No lock outside stage `execute`, no per-file or per-user locks, no lock override button;
  the way to edit during `execute` is to finish or stop the run.
- No theme beyond light and dark; no colour customisation.
- No change to the four-stage flow, the hooks, the agents, the CLI subcommands, or the
  `spec.mjs` library.
- No new dependencies, no bundler, no external resources: git is invoked as an external
  process only if present, and its absence disables the feature rather than failing the
  server.

## Decision Boundaries

**Settled by the user (2026-09-09)**
- Diff base: working tree versus `HEAD`, covering staged, unstaged and untracked files.
- Lock scope: when the current stage is `execute`, the whole dashboard is read-only (every
  save refused, every file reported non-writable). Other stages unchanged.

**The agent may decide alone**
- The exact git invocations and how untracked files are turned into a patch; the size cap
  for rendering a patch and the timeout for a git call; the shape of `/api/diff` JSON.
- The tree and flat-list rendering, the toggle control's look, how selection and expansion
  state behave on refetch, and the `localStorage` keys.
- How the theme toggle is drawn and where the pre-paint script lives (inline in
  `index.html` is acceptable, as long as no external resource is loaded).
- Which existing tests to extend and which new test file to add.

**Needs the user**: nothing further.

## Capabilities

### New Capabilities
none

### Modified Capabilities
- `dashboard`: ADDED requirements for the theme toggle, the execute lock and the diff page
  with git detection; MODIFIED `Guarded save endpoint` so the lock is part of the guard's
  contract.

## Impact

- **Modified**: `scripts/dashboard.mjs` (git detection, lock check, diff routes),
  `web/index.html` (sidebar entries, theme control, pre-paint script), `web/app.mjs`
  (theme, lock handling, diff page, tree/list), `web/app.css` (theme blocks, diff and tree
  styles), `test/dashboard.test.mjs` (lock, diff, git-absent tests; may gain a git fixture
  helper), the eight `README*.md`, `src/skills/dashboard.md` and its three generated outputs
  via `npm run build`.
- **Do-Not-Touch**: `scripts/spec.mjs`, `scripts/lib/intent.mjs`, `scripts/cli.mjs`,
  `scripts/build.mjs`, `hooks/`, `agents/`, `src/agents/`, `src/core/`, `templates/`,
  `claude/`, `codex/agents/`, `codex/AGENTS.block.md`, `codex/hooks.template.json`, every
  other skill under `src/skills/` and its outputs, `manifest.json`, `package.json`
  dependencies, `web/md.mjs`, `test/spec.test.mjs`, `test/completion-guard.test.mjs`,
  `test/markdown.test.mjs`.
- **Rebuild / Re-run after change**: `npm run build` after editing `src/skills/dashboard.md`,
  then `npm run check`; `npm test` (existing 70 plus the new tests); an end-to-end run with
  headless Chrome against this repository covering the theme toggle in both directions, the
  lock while the stage is `execute`, and the diff page with the tree and list views, recorded
  under `.my-flow/verify/`; a run against a directory without git showing the feature absent.

## Success Criteria

1. Tests (`npm test`) cover: a save during stage `execute` is refused with 423 and the file
   is byte-identical; `GET /api/file` reports `writable: false` with a reason during
   `execute` and `writable: true` after the stage changes; `/api/diff` on a temp git fixture
   lists a modified, an added (untracked) and a deleted file with the right status letters and
   `/api/diff/file` returns a unified patch for each; the same routes answer `404 no-git` and
   health reports `git: false` on a fixture without a repository; the pre-existing suites still
   pass unchanged.
2. Headless-Chrome evidence under `.my-flow/verify/`: the theme toggle switches the page to
   dark and to light regardless of the emulated OS scheme and survives a reload; during
   `execute` the editor shows no Save button and states the reason, and it returns after the
   stage is set to `done` without a reload; the diff page lists this repository's changed files
   in tree and in list form and renders a selected file's patch with added and removed lines
   coloured.
3. `grep -rE "https?://" web/` stays empty and `package.json` still has no dependencies;
   `npm run check` reports up to date after the skill text change.
4. All eight READMEs describe the three features in their dashboard section.
