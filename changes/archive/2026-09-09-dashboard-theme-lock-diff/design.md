## Context

The dashboard shipped in `2026-09-09-web-dashboard` and was refined by the scrollbar change. It is
a single Node process (`scripts/dashboard.mjs`, 599 lines) serving four static assets from `web/`
and a small JSON API, plus a Server-Sent Events stream. This change adds three independent
features to that surface. The evidence below is what constrains each one.

**Server shape.** `startServer` (`scripts/dashboard.mjs:178`) closes over `root`, `clients`,
`watchers` and `timers`, and returns `{ url, port, host, root, server, close, watchers }`. Routing
is a flat `if` ladder in `handle` (`scripts/dashboard.mjs:339-364`): the same-origin guard runs
first (`:341-342`), then `/api/*` routes, then `handleStatic`. `/api/health` (`:346`) currently
returns `{ ok, pid, host, port, root, started, version }`. `close()` (`:398-424`) clears timers,
closes watchers, ends SSE clients and removes the state file; anything long-lived a new feature
adds would have to be torn down there.

**Read and write guards.** `resolveClientPath` (`:84-89`) rejects non-strings, NUL bytes and
absolute paths, then requires containment under `root`. `readable` (`:90`) applies `READ_RE`
(`:79`), which admits only `specs/**.md`, `changes/**.md` and `.my-flow/(ask|verify|interviews)/**.md`.
`writable` (`:91-96`) admits `specs/**.md` and `changes/<active>/**.md`. `handleFilePost`
(`:291-317`) checks in this order: content type, body size, JSON parse, path resolution, `.md`
suffix, `writable`, existence, content type of `data.content`, mtime, then writes. That order is
the D7 guard order the spec pins, and the lock has to find a place inside it.

**State file.** `readState` from `scripts/lib/intent.mjs:145` parses
`.my-flow/state/current-change.json` and returns `null` on any failure (fail open). `setState`
(`:152`) writes `{ change, stage, updated }`. `statusReport` (`:309`) already surfaces
`current.stage` per change row, so the client can see the stage today; what it cannot see is a
refusal.

**Watchers.** `WATCH_DIRS` (`:28`) is `['specs', 'changes', '.my-flow']`. `queue` (`:198-210`)
drops the dashboard's own state file and debounces 150 ms. Nothing outside those three directories
is watched, which matters for the diff page: a change to `web/` or `scripts/` produces no event.

**Client shape.** `web/app.mjs` exports the pure helpers `parseRoute` (`:12`), `fileRoute` (`:22`),
`shouldRefetch` (`:25`), `isOwnEcho` (`:44`) and `progressHtml` (`:49`), then `boot()` (`:55`)
which holds `state`, the page functions, `pageFile`/`wireEditor` (`:183`/`:209`), `render` (`:278`),
`onChange` (`:304`) and `connect` (`:326`). The bottom line (`:348`) calls `boot()` only when a
`#view` element exists, so `node --test` can import the module and exercise the helpers with no
DOM. `pageFile` renders Save and Reload only when `body.writable` is true (`:192-193`), which is
exactly the hook the lock needs. `connect` re-renders on every `hello` (`:336`), including
reconnects.

**Stylesheet.** `web/app.css:3-25` defines the light tokens on `:root`; `:26-38` overrides six of
them inside `@media (prefers-color-scheme: dark)`. Two further rules key off the same media query:
`.nav-list a.active` (`:100`) and `body::-webkit-scrollbar-thumb` (`:186-188`). Any theme override
has to beat all three.

**Tests.** `test/dashboard.test.mjs` builds a fixture (`:75-92`), starts a server on port 0
(`up`, `:95-117`), and has `rawPost` (`:120`) and `openEvents` (`:133`) for the awkward cases. The
offline test (`:455`) greps every file in `web/` for `http(s)://`. `test/helpers.mjs` already has
`hasGit()` (`:69`) and `gitInit()` (`:73`), unused so far. Baseline: `npm test` reports
**70 passed, 0 failed**.

**Collision, found while reading.** `test/dashboard.test.mjs:90` writes the fixture state file with
`stage: 'execute'`. Three existing tests then post successful saves (`:404` own-origin save,
`:423`/`:429` mtime tests, `:441`/`:447` line-ending tests). Introducing the lock without touching
the fixture turns all three red. The fixture's stage must move to a non-`execute` value.

**Git.** The repository is a real work tree (`git rev-parse --is-inside-work-tree` prints `true`,
git 2.45.1.windows.1), and `web/`, `changes/`, `specs/`, `scripts/dashboard.mjs`,
`scripts/lib/intent.mjs`, `src/skills/dashboard.md`, `test/dashboard.test.mjs` and
`test/markdown.test.mjs` are all **untracked**. `git diff` against the index therefore shows almost
nothing of this change, so task verification cannot lean on it. `scripts/ask.mjs:53` is the existing
precedent for running git: `spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 15000,
maxBuffer: 16 * 1024 * 1024, windowsHide: true })`.

## Goals / Non-Goals

**Goals:**

- A three-state theme control (`system` / `light` / `dark`) that is applied before the first paint,
  persists across reloads, and overrides the operating system's scheme in both directions.
- A server-side refusal of every browser save while the recorded stage is `execute`, reported to the
  page clearly enough that the user knows why Save is gone and when it will return.
- A read-only diff view of the working tree against `HEAD`, covering staged, unstaged and untracked
  files, with a file tree or flat list on the left and a coloured unified patch on the right.
- Git detection that degrades: without git the feature disappears instead of breaking the server.
- No new dependency, no bundler, no external resource, and no change to the four existing pages.

**Non-Goals:** those in `proposal.md` (no git writes, no diff base but `HEAD`, no side-by-side or
syntax-highlighted patches, no lock outside `execute`, no themes beyond light and dark, no change
to the flow, hooks, agents or CLI). Additionally, out of scope here:

- Watching directories outside `specs/`, `changes/` and `.my-flow/`. The diff page therefore does
  not auto-update when source files change; it gets an explicit Refresh button instead (see Risks).
- Rename detection inside a patch beyond what `git diff -M` reports for the pair of paths.
- Collapsing single-child directory chains in the tree.
- Persisting which directories are expanded across a reload.

## Decisions

**Principles.** (1) The dashboard is a *view*: it may run git, but only in read-only invocations
that cannot touch the index or the work tree. (2) A new failure mode must not be able to take down
routes that already work. (3) The existing guard order in `handleFilePost` is a published contract;
the lock joins it rather than reorders it. (4) Pure helpers stay exported and DOM-free so they are
testable without a browser. (5) Surgical diffs: no token renaming, no restructuring of code the
change does not need.

**Decision drivers.** (a) *Read-only safety*: no git invocation may write to `.git/`, and no new
route may widen the file-read surface beyond what the existing allow-list intends. (b) *Windows
first*: this project is developed on Windows; path separators, `spawnSync` behaviour and git's
CRLF warnings on stderr all have to be handled. (c) *Zero dependencies*: every parser is
hand-written, and everything the browser needs is served from `web/`.

---

### D1. Git runs as one `spawnSync` per request

*Viable options.* (i) `spawnSync('git', ...)` per request, following `scripts/ask.mjs:53`.
(ii) A long-lived `git` process the server talks to. (iii) `spawnCli` from `scripts/lib/spawn.mjs`.

**Chosen: (i).** Three to four short git calls per diff request, each with
`{ cwd: root, encoding: 'utf8', timeout: GIT_TIMEOUT_MS, maxBuffer: GIT_MAX_BUFFER, windowsHide: true }`,
where `GIT_TIMEOUT_MS = 5000` and `GIT_MAX_BUFFER = 8 * 1024 * 1024`.

*Rejected (ii)*: git offers no persistent protocol for `diff`; a resident process would need
lifecycle management inside `close()` (`scripts/dashboard.mjs:398`) and would buy nothing on a
single-user loopback server. *Rejected (iii)*: `spawnCli` exists because Node cannot spawn `.cmd`
shims without a shell; git on Windows is a real `git.exe`, and `ask.mjs` already calls `spawnSync`
directly for its `--diff` mode. Reusing `spawnCli` would add a `where.exe` lookup per call for no
benefit.

*Consequence, accepted.* `spawnSync` blocks the event loop for the duration of the call. The
server is single-user and loopback-only, the timeout caps the block at 5 s, and the existing
handlers already block on synchronous filesystem walks (`newestMtime`, `statusReport`,
`readdirSync`). Documented in Risks.

*Stderr.* Git writes CRLF warnings to stderr on this platform even on success (observed:
`warning: in the working copy of 'keep.md', LF will be replaced by CRLF ...`). Only the exit status
and stdout are used; stderr is read only to build an error message when the status is non-zero.

*Line endings.* This repository has `core.autocrlf=true`, and `git diff HEAD --numstat` returns
sane per-line counts under it (measured: `28 5 README.md`, `4 1 scripts/cli.mjs`), so the
normalisation does not turn an edited file into a whole-file rewrite. No `-c core.autocrlf=false`
override is needed, and the diff the page shows is the diff the terminal shows.

### D2. Git detection happens once at start and is not re-tested per request

*Viable options.* (i) Detect once in `startServer`, cache in a closure variable `gitOk`.
(ii) Detect per request. (iii) Detect once, then flip the cached value when a later call fails.

**Chosen: (i).** `startServer` runs `git rev-parse --is-inside-work-tree` once and sets
`gitOk = status === 0 && stdout.trim() === 'true'`. `/api/health` gains `git: gitOk`; the `hello`
SSE event gains `git: gitOk` as well, so a client learns it without a second fetch. When `gitOk` is
false, `/api/diff` and `/api/diff/file` answer `404 { ok:false, error:'no-git', message }`.

*Rejected (ii)*: a process spawn on every health poll, purely to decide whether one nav entry is
visible. *Rejected (iii)*: a value that flips would make the `Diff` sidebar entry appear and vanish
between renders. A git call that fails *after* a successful detection is a per-request problem and
is reported as one: `500 { ok:false, error:'git-failed', message }` carrying the first line of
git's stderr, matching the existing convention that 500 means "this request went wrong" while the
server stays up.

### D3. The file list comes from `git diff HEAD` plus `git ls-files --others`, not from `git status`

*Viable options.* (i) `git status --porcelain=v1 -z` and decode the two-character `XY` code.
(ii) `git diff HEAD --name-status` for tracked changes plus `git ls-files --others` for untracked.

**Chosen: (ii).** The settled diff base is *working tree versus `HEAD`, including untracked files*,
and `git diff HEAD` computes exactly that for tracked paths. Three calls:

```
git diff <base> --name-status -z -M --   ->  "M\0keep.md\0"  and  "R100\0sub/ren.md\0sub/renamed.md\0"
git diff <base> --numstat    -z -M --   ->  "1\t1\tkeep.md\0" ; renames "0\t0\t\0old\0new\0" ; binary "-\t-\tbin.dat\0"
git ls-files --others --exclude-standard -z  ->  "bin.dat\0untracked.md\0"
```

All three formats were verified empirically against git 2.45.1 in a throwaway repository, including
the rename and binary shapes shown above.

*Rejected (i)*: the `XY` code describes index-versus-HEAD and worktree-versus-index separately, so
deriving a single HEAD-relative verdict means hand-writing a truth table (`AM` is added, `MD` is
deleted, `MM` is modified, `R ` is renamed, `??` is untracked). That table is the bug-prone part of
the feature, and `git diff HEAD` already answers the question directly.

**Unborn `HEAD`.** In a repository with no commit, `git diff HEAD` fails. `startServer` also runs
`git rev-parse --verify HEAD`; when it fails, `base` becomes the well-known empty-tree object
`4b825dc642cb6eb9a060e54bf8d69288fbee4904`, against which every tracked file reads as added. The
response reports which base was used.

**Status letters.** `M` modified, `A` added, `D` deleted, `R` renamed, `C` copied, `T` type change,
`U` unmerged (all straight from `--name-status`, with the similarity digits stripped from `R100`),
and `?` for untracked. Paths are always root-relative and `/`-separated, exactly as git prints them.

### D4. The diff never shows `.my-flow/`, and `/api/diff/file` may only be asked for a path the list holds

**`.my-flow/` is excluded by the server, not by `.gitignore`.** `diffList` drops every path
beginning `.my-flow/` from both the tracked list and the untracked list, unconditionally. This is a
property of the design rather than of this repository's configuration: `.my-flow/` is disposable
scratch that no adopting project is obliged to ignore, and in a project that tracks it or simply
has no rule for it, `git ls-files --others` would list the state file, every `ask/` transcript and
every `interviews/` transcript. Those are precisely the files `READ_RE`
(`scripts/dashboard.mjs:79`) admits only as rendered markdown under `.my-flow/(ask|verify|interviews)/`,
and the state file it admits not at all. Surfacing them as raw patches would quietly widen the read
surface for anyone who adopts my-flow without the matching ignore rule, so the server refuses to
depend on that rule existing.

**The per-file route trusts only the list.** `/api/diff/file` recomputes the file list (one
`git diff --name-status` call plus `ls-files`, with the same exclusion applied) and rejects any
`path` not in it with `400 { ok:false, error:'not-in-diff', message }`. Only then does it produce a
patch. Because the exclusion happens inside `diffList`, a request for `.my-flow/state/current-change.json`
is rejected by that same check rather than by a second, separately maintained rule.

*Rejected alternative*: reuse `resolveClientPath` plus containment. That would let the route read
any file in the repository as raw text, a far wider read surface than `READ_RE` grants elsewhere.
The untracked branch additionally re-checks the path through `resolveClientPath` before any read,
as defence in depth.

### D5. Untracked files get a patch synthesised in JavaScript

*Viable options.* (i) `git diff --no-index -- <null device> <path>`. (ii) `git add --intent-to-add`
then a normal diff. (iii) Read the file and build the unified patch by hand.

**Chosen: (iii).** For an untracked path the server reads the file, and emits

```
diff --git a/<path> b/<path>
new file mode 100644
--- /dev/null
+++ b/<path>
@@ -0,0 +1,<n> @@
+<line 1>
...
```

with `\ No newline at end of file` appended when the file does not end in a newline. Binary is
detected by a NUL byte in the first 8192 bytes.

**The untracked read is gated by `lstatSync`, before any read.** `git ls-files --others` lists
symbolic links like any other untracked entry, and `readFileSync` follows them; `resolveClientPath`
(`scripts/dashboard.mjs:84`) is purely lexical, using `resolve` and never `realpathSync`, so a link
under the root pointing anywhere on the machine passes containment. The untracked branch therefore
calls `lstatSync(abs)` first and proceeds only when `isFile()` is true. A symlink, a directory
entry, a socket or a device is listed with its status letter and returned as
`{ patch: null, skipped: 'not-a-regular-file' }`, rendered by the page the same way a binary file
is. This is the one place in the change where a path from git reaches the filesystem, so the gate
belongs here rather than in a shared helper.

*Rejected (i)*: the null device is spelled `/dev/null` on POSIX and `NUL` on Windows, `--no-index`
exits 1 on any difference, and the combination is more platform-specific behaviour than the fifteen
lines it replaces. *Rejected (ii)*: `--intent-to-add` writes the index. The proposal's first
non-goal is that the diff page performs no git write, and a dashboard that mutates the index behind
the user's back during a run is exactly the surprise this change is trying to remove.

### D6. Size and binary caps

`MAX_PATCH_BYTES = 512 * 1024`. A patch longer than that is not returned; the response carries
`truncated: true` and `patch: null`, and the page says so. Binary files (numstat `-`/`-` for
tracked, a NUL byte for untracked) carry `binary: true` and `patch: null`. If `spawnSync` reports
`ENOBUFS` because git exceeded `GIT_MAX_BUFFER`, the response is treated as truncated rather than
as an error. Listing is never suppressed: a binary or oversized file still appears in the tree.

### D7. The lock is computed per request and sits between `writable` and the existence check

A helper reads the state file on every request, so the lock lifts the moment `spec stage` rewrites
it, with no server restart and no client reload:

```js
function lockOf(root) {
  const s = readState(root);                       // intent.mjs:145, fail-open
  if (!s || s.stage !== 'execute') return null;
  return { change: s.change ?? null, stage: 'execute',
           message: `the dashboard is read-only while "${s.change ?? 'the current change'}" is at stage execute; an agent is writing` };
}
```

`POST /api/file` gains one line after the `writable(root, r.rel)` check
(`scripts/dashboard.mjs:304`) and before the existence check (`:305`):

```
423 { ok: false, error: 'locked', change, stage: 'execute', message }
```

*Why there.* Everything before that point judges the *request* (bad path, non-markdown target, a
target outside `specs/` and active changes) and its verdict must not change with the stage,
otherwise a client bug would masquerade as a lock during a run. Everything after it discloses
*filesystem state*: whether the file exists (`:305`), its modification time and, on a 409, its full
on-disk content (`:310`). A lock that fired after the mtime check would hand back file content on a
request it is refusing. Placing it immediately after the static writability verdict keeps both
properties.

*Rejected alternative*: make `writable()` itself stage-aware. It is a pure path predicate used by
both `handleFileGet` and `handleFilePost`; folding time-varying state into it would make the read
path's `writable` flag and the write path's refusal impossible to reason about separately.

`GET /api/file` reports `writable: writable(root, rel) && !lock` and adds
`lockReason: <string> | null`. `lockReason` is non-null only when the file *would* be writable
were the lock absent, so an archived file is reported read-only without falsely claiming a lock.
`403` remains the answer for a genuinely non-writable target even during `execute`; the lock never
upgrades a 403 to a 423.

**Client.** `pageFile` already keys Save and Reload off `body.writable`
(`web/app.mjs:192-193`), so no button-hiding code is needed: it gains a `<div class="notice">`
carrying `lockReason` when that field is set. `shouldRefetch` already refetches a `file` route on
`.my-flow/state/current-change.json` for paths under `changes/` (`web/app.mjs:37`); that condition
is widened to every file route so a spec file's editor also unlocks itself.

**Fixture.** `test/dashboard.test.mjs:90` moves from `stage: 'execute'` to `stage: 'mf-plan'`. The
CLI-parity test still passes because `statusReport` reads the same file the CLI does; only the
`stage` string in the row changes, and no assertion pins it. The new lock test sets `execute`
itself.

### D8. Theme: two duplicated token blocks, not a token rename

*Viable options.* (i) Rename every token to `--x-light` / `--x-dark` on `:root` and have two tiny
rules assign them. (ii) Duplicate the six dark values in a media block and an attribute block.
(iii) Emit the dark block from JavaScript.

**Chosen: (ii).** `:root` keeps its light tokens untouched (`web/app.css:3-25`). The existing dark
media block becomes selector-guarded, and an attribute block is added:

```css
@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { /* dark tokens */ } }
:root[data-theme="dark"] { color-scheme: dark; /* the same dark tokens */ }
:root[data-theme="light"] { color-scheme: light; }
```

Specificity works out without depending on rule order: `:root:not([data-theme="light"])` and
`:root[data-theme="dark"]` are both `(0,1,1)` and beat the plain `:root` light block `(0,0,1)`, and
the two never disagree, because the only state in which both match is `data-theme="dark"` under an
OS dark scheme, where they carry identical values. The four cases:

| `data-theme` | OS scheme | media block | attribute block | result |
|---|---|---|---|---|
| absent | light | no | no | light |
| absent | dark | yes | no | dark |
| `light` | dark | no (`:not` excludes) | no | light |
| `dark` | light | no | yes | dark |

The two other dark-keyed rules are given the same treatment: `.nav-list a.active`
(`web/app.css:100`) and `body::-webkit-scrollbar-thumb` (`web/app.css:186-188`) each gain a
`:root:not([data-theme="light"])` guard on the media version and a `:root[data-theme="dark"]`
twin.

*Rejected (i)*: it is the DRY answer, but it rewrites all twenty-two token declarations for a
change that adds a toggle, and the scrollbar change proved how sensitive these blocks are.
*Rejected (iii)*: injecting CSS from a module script guarantees a flash of the wrong theme.

### D9. Theme is applied by an inline pre-paint script in `index.html`

`web/app.mjs` is loaded as `<script type="module">` (`web/index.html:32`), which is deferred; a
theme applied from it would repaint after the page is already visible. A classic inline script in
`<head>`, before the stylesheet link, runs synchronously:

```html
<script>try{var t=localStorage.getItem('my-flow.theme');if(t==='light'||t==='dark')document.documentElement.setAttribute('data-theme',t);}catch(e){}</script>
```

The `try`/`catch` covers private-mode and disabled-storage browsers. No external resource is
referenced, so the offline grep (`test/dashboard.test.mjs:455`) stays clean.

**Every storage access is guarded, not just the read.** `localStorage.setItem` and `removeItem`
throw as readily as `getItem` when storage is denied or the quota is exhausted, and an unguarded
throw inside the click handler would abort the handler *before* it touched `data-theme`, leaving
the control dead in exactly the browsers the pre-paint script was careful about. The handler
therefore applies the theme to the document first and persists it second, with the persistence
wrapped in its own `try`/`catch`. The choice then works for the current page and is simply not
remembered across a reload, which is what the "Storage being unavailable is not an error" scenario
requires. The same guard covers the `diffView` toggle in D11.

The control itself is static markup in `index.html` (a `role="group"` with three buttons carrying
`data-theme-choice`), so it exists before `boot()` and does not depend on the router. `boot()` wires
the clicks and reflects the current choice with `aria-pressed`. Two pure helpers are exported for
tests:

```js
export const THEME_KEY = 'my-flow.theme';
export const normalizeTheme = (v) => (v === 'light' || v === 'dark' ? v : 'system');
export const themeAttr = (choice) => (choice === 'system' ? null : choice); // null = remove the attribute
```

### D10. Diff API shapes

```jsonc
// GET /api/diff
{
  "git": true,
  "base": "HEAD",                 // or "empty-tree" in a repository with no commit
  "head": "9c9d473...",           // null when unborn
  "files": [
    { "path": "web/app.css", "status": "M", "oldPath": null,
      "added": 41, "deleted": 6, "binary": false, "untracked": false },
    { "path": "sub/renamed.md", "status": "R", "oldPath": "sub/ren.md",
      "added": 0, "deleted": 0, "binary": false, "untracked": false },
    { "path": "test/diff.test.mjs", "status": "?", "oldPath": null,
      "added": null, "deleted": null, "binary": false, "untracked": true }
  ]
}

// GET /api/diff/file?path=web/app.css
{ "path": "web/app.css", "status": "M", "oldPath": null,
  "binary": false, "truncated": false, "skipped": null,
  "patch": "diff --git a/web/app.css b/web/app.css\n--- a/web/app.css\n+++ b/web/app.css\n@@ -3,6 +3,7 @@\n ...\n" }

// GET /api/diff/file for an untracked symlink or other non-regular file (D5)
{ "path": "link-to-elsewhere", "status": "?", "oldPath": null,
  "binary": false, "truncated": false, "skipped": "not-a-regular-file", "patch": null }

// either route, without git
{ "ok": false, "error": "no-git", "message": "this project root is not inside a git work tree" }

// GET /api/diff/file with a path the diff does not list
{ "ok": false, "error": "not-in-diff", "message": "package-lock.json is not among the changed files" }

// POST /api/file during stage execute
{ "ok": false, "error": "locked", "change": "dashboard-theme-lock-diff", "stage": "execute",
  "message": "the dashboard is read-only while \"dashboard-theme-lock-diff\" is at stage execute; an agent is writing" }
```

`added` and `deleted` are `null` for untracked files (git reports no counts for them; the client
shows the synthesised line count instead) and `null` for binary files.

### D11. Diff page: route, data structures and rendering

**Route.** `parseRoute` gains `#/diff` -> `{ page: 'diff', path: null }` and
`#/diff/<encodeURIComponent(path)>` -> `{ page: 'diff', path }`, matching how `file` already joins
`rest` (`web/app.mjs:15`). Because the selected file lives in the URL, selection survives a refetch
by construction; no extra state is needed.

**Two pure exported helpers, both DOM-free and unit-tested:**

```js
// buildTree(['a/b.md', 'a/c.md', 'd.md'])
// -> { name: '', path: '', dirs: [ { name: 'a', path: 'a', dirs: [], files: [<a/b.md>, <a/c.md>] } ], files: [<d.md>] }
export function buildTree(files)          // files are the /api/diff entries; dirs sorted, then files

// parseUnifiedDiff(patchText)
// -> { header: ['diff --git ...', 'index ...'],
//      hunks: [ { header: '@@ -3,6 +3,7 @@', lines: [ { kind, oldNo, newNo, text }, ... ] } ] }
export function parseUnifiedDiff(text)    // kind: 'ctx' | 'add' | 'del' | 'meta'
```

`meta` covers `\ No newline at end of file`. Every rendered line is escaped with `escapeHtml`
imported from `web/md.mjs` (already imported as `esc` at `web/app.mjs:8`); `md.mjs` itself is not
edited.

**Layout.** A two-pane grid mirroring `.editor` (`web/app.css:159-160`), collapsing to one column
under 1000 px. Left: the tree, or a flat list when the toggle says so, each row a link to
`#/diff/<path>` with the status letter as a `.tag` and the `+n / -n` counts. Right: the patch as
`div` rows in a grid of three columns (old number, new number, text), classed `add` / `del` / `ctx`
/ `hunk`. Rows are `div`s rather than table rows deliberately: the global `th, td` rule
(`web/app.css:61`) puts a 2 px border on every cell, which is wrong for a patch.

**View toggle.** `localStorage['my-flow.diffView']`, `'tree'` (default) or `'list'`.

**Directory expansion.** All directories start expanded. Collapsed directories are held in
`state.diffClosed`, a `Set` of directory paths on the in-memory state, re-applied after each
render. Not persisted, per the non-goals.

**Live update.** `shouldRefetch` returns `true` for the `diff` page on any path, because a diff can
change when anything changes. That only covers the three watched directories, so the page also
carries an explicit **Refresh** button. See Risks.

**Sidebar entry.** `index.html` gains `<li id="nav-diff" hidden><a href="#/diff" data-nav="diff">Diff</a></li>`.
`boot()` clears `hidden` when the `hello` event reports `git: true`. Without git the entry stays
hidden and `#/diff` renders a one-line explanation instead of an error.

### D12. Tests: one new file, plus the lock beside the existing guard tests

The lock tests belong next to the other `POST /api/file` guard tests in
`test/dashboard.test.mjs` (which already has the fixture, `up`, and `post`); they add roughly sixty
lines to a 468-line file. Everything else goes into a new `test/diff.test.mjs`: the git fixture,
the diff routes, the no-git fixture, and the pure client helpers introduced by this change. Adding
~300 lines to `dashboard.test.mjs` instead would push it past 750, well beyond
`test/spec.test.mjs` (540), the current largest suite. `package.json` gains
`test/diff.test.mjs` in the `test` script and nothing else.

| # | Case | Where | Fresh evidence |
|---|---|---|---|
| T1 | Save during `execute` is refused 423 with `error:'locked'` and the change name; the file is byte-identical | `dashboard.test.mjs` | `readFileSync` before and after are equal |
| T2 | `GET /api/file` during `execute` reports `writable:false` and a non-null `lockReason` | `dashboard.test.mjs` | field assertions |
| T3 | Rewriting the state file to `mf-plan` restores `writable:true`, `lockReason:null`, and a 200 save | `dashboard.test.mjs` | same server instance, no restart |
| T4 | A non-writable target (archive, `.my-flow/ask/`, `.txt`) still answers 403, not 423, during `execute` | `dashboard.test.mjs` | status assertions |
| T5 | The lock fires before the mtime check: a stale mtime during `execute` gives 423, not 409, and no content is echoed | `dashboard.test.mjs` | `assert.equal(r.json.content, undefined)` |
| T6 | With git: `/api/diff` lists a modified `M`, an untracked `?` and a deleted `D` file with the right counts | `diff.test.mjs` | `gitInit` fixture, committed then mutated |
| T7 | `/api/diff/file` returns a unified patch for each of the three, with `+`/`-` lines present | `diff.test.mjs` | patch text assertions |
| T8 | A binary untracked file is listed with `binary:true` and no patch | `diff.test.mjs` | NUL-byte fixture |
| T9 | `/api/diff/file?path=<not in the list>` answers 400 `not-in-diff`, including for a real file such as `package.json` and for `.my-flow/state/current-change.json` | `diff.test.mjs` | status and error assertions |
| T9b | No entry under `.my-flow/` appears in `/api/diff`, even when the fixture has no `.gitignore` at all | `diff.test.mjs` | fixture writes `.my-flow/state/current-change.json` and `.my-flow/ask/x.md`, then asserts no listed path starts with `.my-flow/` |
| T9c | An untracked symlink is listed but returns `patch:null` with `skipped:'not-a-regular-file'`, and its target is never read | `diff.test.mjs` | skipped on platforms where `symlinkSync` throws EPERM, with the reason reported |
| T10 | Without git: `/api/health` reports `git:false`, both diff routes answer 404 `no-git`, and the four existing pages still work | `diff.test.mjs` | plain `makeTmp` fixture, no `gitInit`; see the guard below |
| T11 | `parseUnifiedDiff` splits hunks, classifies add/del/ctx/meta, and numbers both sides | `diff.test.mjs` | import from `web/app.mjs`, no DOM |
| T12 | `buildTree` nests directories, sorts dirs before files, and keeps root-level files at the root | `diff.test.mjs` | pure assertions |
| T13 | `normalizeTheme` maps anything but `light`/`dark` to `system`; `themeAttr('system')` is `null` | `diff.test.mjs` | pure assertions |
| T14 | `parseRoute('#/diff')` and `parseRoute('#/diff/<enc>')`; `shouldRefetch` on the diff page is true for any path and the file page reacts to the state file for `specs/` too | `diff.test.mjs` | pure assertions |

Every git-dependent test is guarded by `hasGit()` from `test/helpers.mjs:69` and reports the skip
through `t.skip(...)` so a machine without git shows the skip rather than a silent pass.

**T10 must not assert itself into a false pass.** `makeTmp` builds under the operating system's
temp directory, and nothing guarantees that directory is outside a work tree: a developer whose
`TMPDIR` points into a checkout, or a Windows profile living inside one, would give the "no git"
fixture a perfectly good repository. The test therefore does not assume; it starts the server,
reads `git` from `/api/health`, and when that value is `true` calls `t.skip` with a message naming
the fixture root, because the precondition it needs does not hold on this machine. Only when the
value is `false` does it go on to assert the 404s and the four working pages. Asserting
`git === false` directly would turn a mis-sited temp directory into a red test that looks like a
bug in the detection code, and asserting nothing would let a real regression pass unnoticed.

## Risks / Trade-offs

- **`spawnSync` blocks the event loop.** A diff request holds the server for the duration of up to
  four git calls. Mitigated by the 5 s timeout and by the fact that the server is single-user and
  loopback-only; the existing handlers already block on synchronous directory walks. Accepted
  rather than rewritten, because an async rewrite would touch the whole handler ladder.
- **The diff page does not auto-update for files outside the watched directories.** `WATCH_DIRS`
  (`scripts/dashboard.mjs:28`) covers `specs/`, `changes/` and `.my-flow/` only, and widening it to
  the repository root would mean watching `.git/` and `node_modules/`. The page therefore gets a
  Refresh button, and the limitation is stated in the README bullet. Editing a change's `tasks.md`
  *does* refresh the diff, which is the common case during a run.
- **Rename detection depends on the pathspec.** `git diff HEAD -M -- <old> <new>` reports the
  rename (verified); asking for the new path alone reports an add. The per-file route therefore
  always passes both paths when `oldPath` is set.
- **Duplicated dark tokens.** Six declarations exist in two places, so a future palette edit must
  touch both. The alternative renamed every token; the duplication is the smaller diff and is
  flagged with a comment in the stylesheet.
- **The lock is advisory for anything but the browser.** An agent, an editor or the CLI can still
  write during `execute`; the lock only closes the dashboard's own write path, which is what the
  concurrent-write problem in `proposal.md` actually is.
- **`readState` fails open.** A corrupt or unreadable state file means no lock rather than a
  permanent one. That matches `intent.mjs:145` and keeps a broken file from bricking editing, at
  the cost of a save slipping through during a run whose state file is damaged.
- **Existing fixture change.** Moving the fixture stage off `execute` is a test-only edit, but it
  is the kind of edit that hides a regression if done carelessly. The task list runs the full suite
  immediately before and after the lock lands so the 70-to-70 baseline is visible on both sides.

## Do-Not-Touch

`scripts/spec.mjs`, `scripts/lib/intent.mjs`, `scripts/cli.mjs`, `scripts/build.mjs`, `hooks/`,
`agents/`, `src/agents/`, `src/core/`, `templates/`, `claude/`, `codex/agents/`,
`codex/AGENTS.block.md`, `codex/hooks.template.json`, every other skill under `src/skills/` and its
generated outputs, `manifest.json`, `web/md.mjs`, `test/spec.test.mjs`,
`test/completion-guard.test.mjs`, `test/markdown.test.mjs`.

`package.json` may be modified in exactly one place: adding `test/diff.test.mjs` to the `test`
script. Its `dependencies` (absent) and every other field stay as they are.

## Rebuild / Re-run After Change

1. `npm run build` after editing `src/skills/dashboard.md`, which regenerates
   `skills/dashboard/SKILL.md`, `codex/skills/my-flow-dashboard/SKILL.md` and the plugin copy.
2. `npm run check` afterwards; it must report the generated outputs as up to date.
3. `npm test`: the 70 pre-existing tests still pass, plus every new test in
   `test/dashboard.test.mjs` and `test/diff.test.mjs`.
4. `grep -rE "https?://" web/` stays empty, and `package.json` still declares no `dependencies`.
5. A headless-Chrome end-to-end run against this repository, recorded with screenshots under
   `.my-flow/verify/`, covering: the theme toggle in both directions against an emulated opposite
   OS scheme; persistence across a reload; the editor during stage `execute` showing no Save button
   and stating the reason, then regaining Save after the stage changes without a reload; the diff
   page in tree and in list form with a patch rendered.
6. A second run against a temporary directory that is not a git work tree, showing `git:false` in
   `/api/health` and no `Diff` entry in the sidebar.
7. `node scripts/spec.mjs validate dashboard-theme-lock-diff` reports no errors.
