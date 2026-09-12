## Why

my-flow's whole record of intent is markdown on disk: `specs/<capability>/spec.md`,
`changes/<name>/{proposal,design,tasks}.md`, delta specs, `changes/archive/`, and the scratch
under `.my-flow/` (ask replies, verify reports, interview transcripts). Today the only ways to
see that record are `spec status` in a terminal or opening files one by one. There is no place
to watch a change move through `interview -> mf-plan -> execute -> mf-verify`, see task boxes
tick in real time, spot stale or overlapping changes at a glance, or tweak a proposal between
stages without leaving the flow.

spec-workflow-mcp (Pimzino) shows the value of a local web dashboard for exactly this kind of
spec-driven loop. my-flow wants the same visibility over its own intent layer, without adopting
that project's approval machinery or its build toolchain.

## What Changes

Add a local web dashboard, started from the my-flow CLI, that reads the intent layer of one
project and shows it live in a browser.

- **Server**: a new `scripts/dashboard.mjs` (wired into `scripts/cli.mjs`) serving on
  loopback using only Node 20 built-ins (`node:http`, `node:fs`). It watches `specs/`,
  `changes/` and `.my-flow/` with `fs.watch` and pushes change events to the browser (SSE or
  WebSocket, planner's choice) so pages update without reload.
- **Status data**: the `status` / `validate` logic of `scripts/spec.mjs` is refactored into a
  shared module under `scripts/lib/` so the CLI and the dashboard produce identical results
  (progress, artifact state, stale, overlap, state-file warnings).
- **Pages** (all four are in scope for v1):
  1. **Changes overview + single change page**: every active change with stage (from
     `.my-flow/state/current-change.json`), task progress bar, artifact state
     (missing / empty / ok), stale and overlap warnings; the change page shows and edits
     `proposal.md`, `design.md`, `tasks.md` and the delta specs.
  2. **Specs page**: `specs/<capability>/spec.md` rendered as requirements and scenarios; the
     `<!-- via: ... -->` markers link back to the originating archived change. Editable.
  3. **Archive page**: read-only list of `changes/archive/` entries, distinguishing archived
     from abandoned.
  4. **Scratch page**: read-only view of `.my-flow/ask/`, `.my-flow/verify/`,
     `.my-flow/interviews/`.
- **Editing**: markdown files under `specs/` and `changes/` (active changes only) can be
  edited in a plain textarea and saved back. Saves are guarded by an mtime check: if the file
  changed on disk since it was loaded, the save is refused and the user is shown the newer
  content. Line-ending style of the existing file is preserved.
- **Rendering**: a self-written minimal markdown renderer covering only what the my-flow
  templates use (headings, paragraphs, bullet and numbered lists, task checkboxes, bold /
  inline code, fenced code blocks, tables, HTML comments hidden). No CDN, fully offline.
- **Skill**: a thin `/my-flow:dashboard` skill (`start | stop | status`) built from
  `src/skills/dashboard.md` through the existing build pipeline, so Claude Code and Codex can
  launch the server in the background, print its URL, and stop it later. It runs the CLI and
  relays output; it holds no logic of its own.
- **Docs**: a dashboard section in all eight README language versions.

## Non-Goals

- No approval workflow. There is no approve / reject state, no comment threads, and the
  agent skills (`mf-plan`, `execute`, `mf-verify`) do not read anything from the dashboard.
  Human sign-off stays in the terminal via `AskUserQuestion`.
- No concurrent-edit handling beyond the mtime guard. Editing is intended between stages,
  while no agent is writing; there is no live merge, no operational transform, no locking.
- No editing of `changes/archive/` or `.my-flow/`; those pages are read-only.
- No rich editor (no CodeMirror / Monaco), no syntax highlighting, no diff view.
- No full markdown compliance. Constructs outside the template subset render as plain text.
- No runtime npm dependencies, no bundler, no frontend framework, no TypeScript build step.
- No external network access from the page: no CDN scripts, fonts or stylesheets.
- No remote / multi-user access: the server binds to loopback only, no auth, no HTTPS.
- No VS Code extension or MCP server counterpart.
- No steering documents, implementation logs, or templates UI (spec-workflow-mcp features
  with no my-flow equivalent).
- No changes to the four-stage flow, the hooks, the agents, or the existing skills' behavior.

## Decision Boundaries

**The agent may decide alone**
- How `scripts/spec.mjs` is split into a shared library under `scripts/lib/` and a thin CLI,
  provided every existing test in `test/spec.test.mjs` keeps passing unchanged and the CLI's
  text and JSON output stay byte-identical.
- SSE versus WebSocket for push, the shape of the JSON API, file-watch debouncing, the
  markdown renderer's internals, and the layout of the new test files.

**Settled by the user at plan review (2026-09-09); `execute` follows these as given**
- Launch surface: `my-flow dashboard` CLI subcommand (`--port N`, `--root dir`; default
  `127.0.0.1:4321`) **plus** a thin `/my-flow:dashboard` skill (Claude and Codex surfaces via
  `src/skills/dashboard.md` and `manifest.json`) that can **start** the server in the
  background, print its URL, and **stop** it at any time. The server therefore records its
  pid and port in `.my-flow/state/dashboard.json` so a later invocation can find and stop it.
- Visual design: follow the system light / dark preference (`prefers-color-scheme`), one
  stylesheet, no images and no font files, left navigation with content on the right, thin
  progress bars with a numeric label. Styling takes its cues from `../my-flow-sample`
  (`DESIGN.md`, `src/styles/globals.css`): warm paper background, near-black green ink,
  lime accent, square corners, 2 to 3 px borders with hard offset shadows, monospace for
  metadata, 120 ms transitions, no gradients or soft card stacks.
- Save-guard rules as proposed: writes allowed only to `*.md` under `specs/` and under
  active `changes/<name>/`; `changes/archive/` and `.my-flow/` are never writable; every
  path must resolve inside the project root; an mtime mismatch refuses the save and returns
  the current on-disk content, and the user chooses between reloading and forcing the
  overwrite.

## Capabilities

### New Capabilities
- `dashboard`: the local web dashboard server, its JSON API, push updates, the guarded save
  endpoint, and the markdown subset it renders.

### Modified Capabilities
- `spec-helper`: status and validate logic becomes a shared library consumed by both the CLI
  and the dashboard. Observable CLI behavior is unchanged; the delta spec records the
  library-level contract that the dashboard depends on.

## Impact

- **New files**: `scripts/dashboard.mjs`, `scripts/lib/<status module>.mjs`, a static
  frontend directory (HTML, CSS, JS) served by the dashboard, `src/skills/dashboard.md`
  (source of the `/my-flow:dashboard` skill), `test/dashboard.test.mjs`,
  `specs/dashboard/spec.md` via the delta.
- **Modified files**: `scripts/spec.mjs` (thin CLI over the library), `scripts/cli.mjs` (new
  subcommand and help text), `manifest.json` (new skill entry), `package.json` (test
  script, no dependencies), the eight `README*.md` files, and the generated outputs of
  `scripts/build.mjs` for the new skill only (`skills/dashboard/`,
  `codex/skills/my-flow-dashboard/`, `.claude-plugin/plugin.json`).
- **Do-Not-Touch**: `hooks/`, `agents/`, `src/agents/`, `src/core/`, `templates/`,
  `claude/`, `codex/agents/`, `codex/AGENTS.block.md`, `codex/hooks.template.json`, every
  existing skill under `src/skills/` and its generated outputs, and `scripts/build.mjs`
  itself. Generated files are only ever changed by running the build, never by hand.
- **Rebuild / Re-run after change**: `npm run build` after editing `src/skills/dashboard.md`
  or `manifest.json`, then `npm run check` (must report up to date), `npm test` (existing
  suites plus the new dashboard suite), and an end-to-end run of `my-flow dashboard` against
  `../my-flow-sample` or this repository, including start and stop through the skill path.
- **Working agreement**: the principle "my-flow adds no runtime" gains one explicit
  exception: an optional, zero-dependency, loopback-only dashboard process that the flow never
  depends on. `claude/CLAUDE.block.md` is in Do-Not-Touch for this change; the wording update,
  if wanted, is a separate docs change.

## Success Criteria

1. **Automated tests pass** (`npm test`): the dashboard's status endpoint returns exactly what
   `spec status --json` prints for the same fixture project; a save with a stale mtime is
   refused with the newer content returned; a save outside the allow-list or with `..` in
   the path is rejected; the markdown renderer produces fixed expected HTML for the
   template subset; all pre-existing tests in `test/spec.test.mjs` and
   `test/completion-guard.test.mjs` still pass.
2. **Real-project end-to-end**: with the dashboard running against `../my-flow-sample` or
   this repository, ticking a task box in `tasks.md` from the terminal updates the browser
   within one second without a reload; saving `proposal.md` from the browser leaves the file
   on disk with the edited content and its original line endings. Evidence is a script
   transcript or screenshots recorded under `.my-flow/verify/`.
3. **Offline and zero-dependency**: `package.json` has no `dependencies`; no served file
   references an `http://` or `https://` script, stylesheet or font; the pages are fully
   usable with the network disabled.
4. **Docs in sync**: all eight README language versions carry a dashboard section describing
   the launch command, the four pages, editing, and the loopback-only constraint;
   `npm run check` passes.
