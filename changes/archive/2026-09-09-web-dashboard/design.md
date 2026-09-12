# PLAN-DR

## Principles

1. **The library is the single definition, not a second one.** Status and validate must not
   exist twice. `scripts/spec.mjs` and `scripts/dashboard.mjs` call the same functions, and
   those functions return both the JSON object and the exact text the CLI prints, so
   byte-identity is structural rather than something a test has to keep re-proving.
2. **Built-ins only, and only the boring ones.** `node:http`, `node:fs`, `node:path`,
   `node:child_process`. No hand-rolled protocol implementation where a browser built-in
   already does the job.
3. **The dashboard reads a lot and writes almost nothing.** Every write goes through one
   guarded endpoint with an explicit allow-list. Read paths are broader than write paths, and
   both are bounded by the project root.
4. **The flow never depends on the dashboard.** Killing the server at any moment leaves
   `specs/`, `changes/` and `.my-flow/` exactly as the CLI left them. No skill, hook or agent
   reads dashboard state.
5. **Everything a task claims is observable from a command.** Parity is a deep-equal against
   the CLI's own JSON, offline is a grep over the served files, push is a stream read with a
   deadline.

## Decision Drivers

1. **Byte-identical CLI output** (proposal, Decision Boundaries): the refactor is invisible
   from outside `scripts/`, and `test/spec.test.mjs` passes unchanged.
2. **Zero dependencies, fully offline** (proposal, Non-Goals): no bundler, no CDN, no
   framework, no font files. This rules out anything that would normally arrive from npm.
3. **A single developer on localhost between stages** (proposal, Non-Goals): no auth, no
   concurrency beyond an mtime guard, no multi-user. Simplicity beats robustness wherever the
   two conflict.

## Viable Options

### A. How the dashboard gets status data

- **A1. Spawn `spec.mjs status --json` per request and parse stdout.** *Rejected.* It is a
  process launch per request and per push event, it inherits `process.exit` semantics
  (`scripts/spec.mjs:243`), and error handling degrades to exit codes and stderr scraping.
  Parity would be real but the latency cost lands on exactly the path that must feel live.
- **A2. Re-implement status inside the dashboard.** *Rejected outright.* Two definitions of
  stale, overlap and audit-nudge logic (`scripts/spec.mjs:141-164`, `:104-128`) drift within
  one release, and the proposal explicitly asks for a shared module.
- **A3 (chosen). Extract into `scripts/lib/intent.mjs`; both callers import it.** The
  library returns `{ json, text }` from one code path, so the CLI keeps printing exactly what
  it printed before and the dashboard serves the same object it would have printed.

### B. Push transport

- **B1. WebSocket.** *Rejected.* Node ships no WebSocket **server**; `node:http` gives only
  the `upgrade` event. RFC 6455 means writing the `Sec-WebSocket-Accept` SHA-1 handshake,
  frame parsing, client-mask unmasking, fragmentation and ping/pong by hand. That is a
  protocol implementation in a change whose payload is one-directional server-to-browser
  notifications.
- **B2 (chosen). Server-Sent Events.** `res.writeHead(200, {'content-type':'text/event-stream'})`
  plus `res.write('event: change\ndata: {...}\n\n')` is the entire server side. `EventSource`
  is a browser built-in with automatic reconnect and no library. Saves travel over `POST`, so
  the missing client-to-server channel costs nothing.
- **B3. Client polling `/api/status` every second.** *Rejected.* It re-reads and re-stats the
  whole tree once per second forever, and still misses the one-second target on the beat where
  the write lands just after a poll.

### C. Page architecture

- **C1. Server-rendered HTML per route, browser reloads on every watch event.** *Rejected.* A
  reload during an edit discards the textarea, which is precisely the case the change exists
  to serve. The proposal's editing story is incompatible with unconditional reloads.
- **C2 (chosen). One static shell plus a JSON API, rendered client-side with hash routes.**
  `web/index.html` + `web/app.css` + `web/app.mjs` + `web/md.mjs`, four files, no build step.
  A push event refetches only the affected data, and the client decides not to clobber a dirty
  textarea. It also makes the whole data layer testable with `fetch` and no browser.
- **C3. Client-side rendering with a micro-framework vendored into the repo.** *Rejected.*
  Vendoring a framework is a dependency wearing a different hat, and the four pages are lists
  and a textarea.

### D. Where the markdown renderer runs

- **D1. Render server-side, ship HTML.** *Rejected.* The editor needs the raw text anyway, so
  every file would cross the wire twice.
- **D2 (chosen). `web/md.mjs`, a DOM-free ES module.** The browser loads it with
  `<script type="module">`; `test/markdown.test.mjs` imports the same file directly under
  `node --test`. One implementation, unit-testable without a browser.

---

## Context

my-flow's intent layer is markdown on disk and its only reader today is `scripts/spec.mjs`
run in a terminal. That script parses `process.argv` at module top level
(`scripts/spec.mjs:27-38`), computes each subcommand inline, and ends every branch with
`process.exit` (`:186`, `:243`, `:377`, `:467`, `:508`, `:520`). Nothing in it can be called
twice in one process, and `overlapCache` at `scripts/spec.mjs:106` is a module-level cache
that would go stale inside a long-lived server. So the dashboard cannot reuse the file as it
stands; the status and validate logic has to move into a module with no argv, no
`process.exit`, and no cross-call state.

The output that must not change is produced by one helper, `out(obj, text)` at
`scripts/spec.mjs:51`, from two shapes: the status object `{ root, current, changes, warnings }`
with its text rendering (`scripts/spec.mjs:230-242`), and the validate object
`{ ok, results }` with its `FAIL`/`ok  ` block rendering (`scripts/spec.mjs:372-376`). Both are
covered by existing tests: `test/spec.test.mjs` has 31 tests, of the 46 in the whole suite,
driving the script as a child process through `runSpec` / `runSpecJson`
(`test/helpers.mjs:47-55`), and they must pass unchanged.

The build pipeline is single-source: `scripts/build.mjs:75-95` renders every entry of
`manifest.json`'s `skills` map from `src/skills/<name>.md` into `skills/<name>/SKILL.md` and
`codex/skills/my-flow-<name>/SKILL.md`, and `scripts/build.mjs:141-156` regenerates
`.claude-plugin/plugin.json` from the same map. `scripts/build.mjs:189-205` prunes generated
skill directories that the manifest no longer lists, so a new skill is a manifest entry plus a
source file and nothing else. `src/skills/spec.md` is the model for a skill that only runs a
script and relays its output.

State under `.my-flow/state/` follows one convention: a small JSON object written by
`setState` (`scripts/spec.mjs:165-170`) and read defensively by consumers that fail open
(`hooks/completion-guard.mjs:96-104`, `hooks/session-context.mjs:52-57`). `.my-flow/` is
git-ignored (`.gitignore:2`) and disposable. The dashboard's own state file joins that
directory under the same rules.

The visual language comes from `../my-flow-sample`: warm paper background and near-black green
ink (`src/styles/globals.css:30-33`), a high-chroma lime accent (`:36`), black borders in both
themes (`:37`), square nav controls with 2-3 px borders and 3-6 px hard offset shadows
(`:21-25`), a dark palette that keeps the same borders and swaps the shadow to muted lime
(`:86-99`), and, from `DESIGN.md`, 120 ms direct transitions, monospace for metadata and
system coordinates, and an explicit rejection of gradients and soft card stacks.

## Goals / Non-Goals

**Goals:**

- One shared library under `scripts/lib/` behind both `spec status|validate` and the
  dashboard, with the CLI's text and JSON byte-identical to today.
- A loopback HTTP server on `127.0.0.1:4321` by default, `--port` and `--root` overrides,
  serving four pages from hand-written HTML, CSS and ES modules with no network fetches.
- Live updates pushed over SSE within one second of a file changing under `specs/`,
  `changes/` or `.my-flow/`.
- Guarded editing of `*.md` under `specs/` and under active changes, with an mtime conflict
  check, root containment, and preserved line endings.
- `start | stop | status` from both `my-flow dashboard` and a thin `/my-flow:dashboard` skill,
  coordinated through `.my-flow/state/dashboard.json`.
- A dashboard section in all eight READMEs and a passing `npm run check`.

**Non-Goals:** as listed in `proposal.md` (no approval workflow, no concurrent-edit handling
beyond the mtime guard, no editing of archive or scratch, no rich editor, no full markdown
compliance, no dependencies, no external network, no remote access, no MCP or VS Code
counterpart, no change to the flow, hooks, agents or existing skills). Two additions this
design makes explicit:

- **No file creation from the browser.** The save endpoint refuses a path that does not
  already exist. The UI only ever opens files it listed, and requiring existence removes a
  whole class of "where did this file come from" questions from the guard.
- **No atomic write.** `writeFileSync` writes in place. A temp-file-plus-rename dance buys
  crash safety that a local single-user editor between stages does not need, and it would emit
  extra watch events.

## Decisions

### D1. `scripts/lib/intent.mjs` is the shared library; `spec.mjs` becomes its CLI

The library is pure: every function takes `root` explicitly, none reads `process.argv`, none
calls `process.exit`, and none keeps state between calls. The overlap index that is cached in a
module variable today (`scripts/spec.mjs:106`) becomes a value computed per call, which is what
makes the server correct after the first request.

Moved verbatim, behavior unchanged. Those that touch the filesystem take `root` as their first
argument instead of closing over the module constants: `read`, `listChanges`, `tasks`,
`artifactState`, `newestMtime`, `overlapIndex`, `auditNudges`, `validateSpecFile`,
`validateChange`, `validateDeltaAgainstMain`, `setState`. Those that are pure string or date
helpers keep their present signatures: `norm`, `today`, `overlapText`, `splitRequirements`,
`sectionBody`. `numOpt` keeps its `(flag, envVar, fallback)` shape but takes the parsed options
object as an extra argument rather than closing over `opts`, because `scripts/spec.mjs:229`
calls it with a null flag name to read `MY_FLOW_AUDIT_EVERY` with no CLI flag at all.

`readState(root)` is **new**, not moved. Today the state file is parsed inline in two places,
in the status branch (`scripts/spec.mjs:190-196`) and in `moveToArchive`
(`scripts/spec.mjs:477`), both wrapped in `try`/`catch` returning `null`. The library gets one
function with exactly that fail-open behavior and both call sites use it.

Two composite functions carry the output contract:

```js
statusReport(root, { name, staleDays, auditEvery }) -> { json, text }
validateReport(root, { name })                      -> { json, text, failed }
```

`json` is the object `out()` receives today and `text` is the string it prints today, built by
the same expressions moved unedited from `scripts/spec.mjs:200-242` and `:363-376`. `spec.mjs`
then reduces to argv parsing plus `out(r.json, r.text)` and the exit code, so there is exactly
one place where either shape is constructed.

When `staleDays` or `auditEvery` is `undefined`, `statusReport` resolves it through `numOpt`
itself, so `MY_FLOW_STALE_DAYS` and `MY_FLOW_AUDIT_EVERY` keep the exact precedence they have
today (flag, then environment variable, then default, with a non-numeric or non-positive value
falling back). The dashboard passes neither option and therefore inherits the same environment
behavior as the CLI rather than a second set of defaults.

No library function calls `process.exit` or throws for an absent project. A missing `changes/`
directory yields an empty change list (`scripts/spec.mjs:60`), and a named change with no
directory yields a `{ name, missing: true }` row (`:202`) or a validate result carrying a
"does not exist" error (`:288`). The caller decides what to do about it; the library never
terminates the process.

`archive`, `abandon`, `new` and `stage` stay in `scripts/spec.mjs`; they are not dashboard
concerns. They import their primitives (`splitRequirements`, `sectionBody`, `tasks`, `read`,
`listChanges`, `setState`) from the library, so no helper is defined twice.

`TEMPLATES` resolves from the library's own location
(`join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'templates', 'change')`), keeping
`artifactState`'s template comparison (`scripts/spec.mjs:77-79`) pointed at the same files.

### D2. `scripts/dashboard.mjs` exports a server and also runs as a CLI

```js
export async function startServer({ root, port = 4321, host = '127.0.0.1' })
  -> { url, port, server, close() }
```

`startServer` binds, writes the state file, starts the watchers, and resolves. Tests import it
and pass `port: 0` for an ephemeral port; the CLI calls it under `serve`. Static assets resolve
from the script's own directory (`join(HERE, '..', 'web')`), never from `process.cwd()`, so the
server works when Codex launches it through `{{MYFLOW_ROOT}}` from an unrelated working
directory.

**Root normalization.** Both `startServer` and every CLI subcommand normalize the root once, at
entry, with `realpathSync.native(resolve(rootArg))`, falling back to `resolve(rootArg)` when the
path does not exist yet. Without this, the root recorded in the state file, the root returned by
`/api/health`, and the root a later `stop` computes can be three spellings of one directory: a
`tmpdir()` on Windows is often an 8.3 short path, which is exactly why `test/helpers.mjs:17-20`
already calls `realpathSync.native`. One normalization at entry means the identity check in D3
compares like with like, and the containment test in D7 compares against the same prefix the
server was started with.

**`close()`** ends every open SSE stream, closes the watchers, calls `server.close()` and also
`server.closeAllConnections()`. Without the second call an idle keep-alive socket from a fetch
that already returned holds the server open, and `close()` never resolves; in a test run that
surfaces as a suite that hangs instead of a suite that fails.

Subcommands, dispatched from `scripts/cli.mjs` by adding `dashboard: 'dashboard.mjs'` to the
`scripts` map (`scripts/cli.mjs:18-25`) and one line to the help text (`:28-38`):

| Command | Behavior |
|---|---|
| `dashboard [start] [--port N] [--root dir] [--json]` | Detaches a `serve` child, waits for its state file, prints the URL |
| `dashboard start --foreground` | Runs the server in this process; Ctrl-C stops it |
| `dashboard serve [--port N] [--root dir]` | Internal: the actual server process, used by the detached start |
| `dashboard stop [--root dir] [--json]` | Reads the state file, verifies identity, terminates, removes the file |
| `dashboard status [--root dir] [--json]` | Reports running / not running / stale |

### D3. Detached start, and a stop that cannot kill a stranger

Start spawns with built-ins only:

```js
spawn(process.execPath, [HERE + '/dashboard.mjs', 'serve', '--root', root, '--port', String(port)],
      { detached: true, stdio: 'ignore', windowsHide: true }).unref()
```

`detached: true` gives a new process group on POSIX (`setsid`) and a new process group on
Windows; `stdio: 'ignore'` frees the parent from the child's pipes and `unref()` lets the
parent exit. The parent then polls for `.my-flow/state/dashboard.json` every 100 ms for up to
5 s, and reports failure if the file never appears or does not carry the child's pid.

Stop is deliberately paranoid about pid reuse, because a stale state file plus a recycled pid
means killing an unrelated process:

1. No state file, or one that will not parse: report "not running", exit 0.
2. Validate the recorded pid before it reaches any signalling call: `Number.isInteger(pid) &&
   pid > 0`. This is not a formality. `process.kill(0, ...)` signals the caller's **own process
   group**, so a state file holding `0`, a string, or `NaN` could otherwise make `stop` kill the
   terminal it was typed into. A pid that fails the check means a corrupt file: delete it and
   report a removed stale entry.
3. Probe liveness with `process.kill(pid, 0)` and read the error code, because the two failure
   modes are not the same:
   - `ESRCH`: no such process. The pid is gone, so delete the file and report a removed stale
     entry.
   - `EPERM`: the process exists but belongs to another user. It is alive, so continue to the
     identity check rather than treating it as absent.
   - No error: alive and ours to inspect.
4. The pid is alive: `GET http://127.0.0.1:<port>/api/health` with a 1 s timeout, and compare
   the returned `pid` and `root` against the state file. The two outcomes differ:
   - **The probe answers and disagrees** on pid or root: the recorded pid has been reused by an
     unrelated process. Delete the state file, report it as stale, and **send no signal**.
   - **The probe fails** (timeout, connection refused, unparseable body): this is not evidence
     of anything. A server busy on a long `newestMtime` walk looks identical to a dead one.
     Report that the dashboard did not answer, tell the user the recorded pid and port, and
     **keep the state file** so the next `stop` can try again. Deleting it here would strand a
     live server with no record of how to reach it.
   Root comparison is case-insensitive on `win32` and case-sensitive elsewhere, matching the
   platforms' own filesystem semantics; both sides are already normalized per D2.
5. Identity confirmed: `process.kill(pid, 'SIGTERM')`, poll liveness for up to 3 s, delete the
   state file, report stopped.

The server installs `SIGINT` and `SIGTERM` handlers that close the HTTP server, close the
watchers, remove the state file and exit 0. On Windows, Node maps `SIGTERM` to
`TerminateProcess`, which is not catchable, so the state file may survive a stop there; step 2
of the next `stop` or `status` reclaims it. That is why removal happens on the stopping side
too.

### D4. State file `.my-flow/state/dashboard.json`

```json
{
  "pid": 12345,
  "host": "127.0.0.1",
  "port": 4321,
  "url": "http://127.0.0.1:4321/",
  "root": "H:\\CommonProject\\workflow\\VibeCoding\\my-flow",
  "started": "2026-09-09T10:11:12.345Z"
}
```

Written after `listen` resolves, so the port recorded is the port actually bound (relevant for
`port: 0`). Written with `mkdirSync(dirname, { recursive: true })` and a trailing newline,
matching `setState` (`scripts/spec.mjs:166-168`). Read defensively everywhere: a missing,
truncated or unparseable file means "not running", never an exception. It is deliberately a
different file from `current-change.json` so nothing that reads the flow's state
(`hooks/completion-guard.mjs:96-104`) sees a new key.

### D5. JSON API

All responses are `application/json; charset=utf-8`. Errors are
`{ ok: false, error: "<code>", message: "<human text>" }` with a matching status code.

**Handler contract.** Every request handler runs inside one `try`/`catch` that returns `500`
with the standard error body and logs one line to stderr. This is not defensive decoration: the
dashboard walks a directory tree that another process is actively rewriting. `newestMtime`
(`scripts/spec.mjs:91-98`) calls `readdirSync` and then `statSync` on each entry, so a file
deleted between those two calls throws `ENOENT` from inside `statSync`. That race is routine
rather than exotic, because `spec archive` renames a whole change directory out from under any
in-flight request (`scripts/spec.mjs:474`). Without the wrapper the exception escapes the
request, Node's default handler destroys the socket, and the browser shows a dead page for a
condition that resolves itself on the next request.

| Method | Route | Response |
|---|---|---|
| GET | `/api/health` | `{ ok, pid, port, root, started, version }` |
| GET | `/api/status` | Exactly `statusReport(root).json`: `{ root, current, changes, warnings }` |
| GET | `/api/validate` | Exactly `validateReport(root).json`: `{ ok, results }` |
| GET | `/api/changes/<name>` | `{ name, files: [{ path, kind, exists, mtimeMs, size }], row }` where `kind` is `proposal` / `design` / `tasks` / `delta`, `path` is root-relative with `/` separators, and `row` is that change's entry from the status payload |
| GET | `/api/specs` | `{ capabilities: [{ name, path, mtimeMs, requirements: [{ name, via }] }] }`, `via` being the `<!-- via: ... -->` marker text or `null` |
| GET | `/api/archive` | `{ entries: [{ dir, date, change, kind: "archived" \| "abandoned", reason, mtimeMs, capabilities: [...] }] }` |
| GET | `/api/scratch` | `{ ask: [], verify: [], interviews: [] }`, each an array of `{ path, name, mtimeMs, size }` newest first |
| GET | `/api/file?path=<rel>` | `{ path, content, mtimeMs, eol: "lf" \| "crlf", writable }` |
| POST | `/api/file` | Body `{ path, content, mtimeMs, force? }`. See D7 |
| GET | `/api/events` | SSE stream. See D6 |

`/api/status` and `/api/validate` are the parity surface: they serialize the library's `json`
value with no additions, wrapping, or key reordering, which is what makes the deep-equal
assertion against `spec status --json` meaningful.

### D5a. Same-origin guard

Binding to loopback keeps other machines out. It does not keep other *pages* out: any site the
user visits while the dashboard is running can issue cross-origin requests to
`http://127.0.0.1:4321`. A `POST` with `content-type: text/plain` is a CORS **simple request**,
so the browser sends it without a preflight, and the attacking page never needs to read the
response to have already caused the write. A dashboard whose whole purpose is writing to
`specs/` and `changes/` cannot rely on the response being unreadable. Four checks, applied
before any handler runs:

1. **Host.** The `Host` header must be `127.0.0.1:<port>` or `localhost:<port>` for the port
   actually bound. Anything else, including a DNS-rebinding host that resolves to `127.0.0.1`,
   is `403 bad-host`.
2. **Origin.** If an `Origin` header is present it must equal the server's own origin. A
   same-origin `fetch` from the dashboard's own page sends either no `Origin` or the matching
   one; a cross-site page always sends its own. Mismatch is `403 bad-origin`.
3. **Content type.** `POST /api/file` requires `content-type: application/json`, which is not a
   CORS simple type and therefore forces a preflight the guard can reject. A `text/plain` or
   form-encoded body is `415 bad-content-type`, before the body is even read.
4. **Body size.** The request body is capped at 5 MB, counted as it streams; the connection is
   destroyed with `413 body-too-large` on overflow. The largest file in an intent layer is a
   spec, and this is three orders of magnitude above one.

The server sends no `Access-Control-Allow-Origin` header at all, so nothing is opted in to
cross-origin reads either.

Anything else under `/api/` is 404. Non-`/api/` GETs fall through to the static handler, which
resolves against `web/`, rejects any resolved path outside it, serves `index.html` for `/` and
for any path with no extension (so hash routes and deep links both land on the shell), and maps
`.html`, `.css`, `.mjs`, `.js`, `.svg` to their content types with `charset=utf-8`. All other
extensions are 404; the directory holds four files and there is no reason to serve more.

### D6. SSE stream

`GET /api/events` responds `200` with `content-type: text/event-stream`,
`cache-control: no-cache`, `connection: keep-alive`, then:

```
event: hello
data: {"root":"...","port":4321,"started":"2026-09-09T10:11:12.345Z"}

event: change
data: {"at":"2026-09-09T10:11:30.001Z","paths":["changes/web-dashboard/tasks.md","specs/"]}

: ping
```

- `hello` is sent immediately on connect so the client can confirm it is talking to the right
  root.
- `change` carries the debounced set of root-relative paths, `/`-separated, that fs reported
  since the last flush. The client uses the prefixes (`specs/`, `changes/`, `.my-flow/`) to
  decide what to refetch, and ignores the rest.
- `: ping` is an SSE comment written every 25 s so an idle connection stays warm and a dead
  socket surfaces as a write error.

Watching: `fs.watch(dir, { recursive: true })` on `specs/`, `changes/` and `.my-flow/`, each
only when it exists, each wrapped in try/catch. Events land in a `Set` and flush after 150 ms of
quiet, which collapses the several events a single editor save produces.

The `filename` a watcher yields needs normalizing before it can go on the wire, and all three
corrections matter:

- It is **relative to the watched directory**, not to the project root. A tick in
  `changes/demo/tasks.md` arrives as `demo\tasks.md` from the watcher on `changes/`, so the
  watched directory's own name has to be prepended or every path the client receives is wrong.
- It uses **platform separators**. On Windows that is `\`, which must be converted to `/` to
  match the root-relative form every other route returns and the prefixes the client tests.
- It can be **`null`**. Some platforms and some event types deliver no filename at all. A null
  is coalesced into the watched directory's own name rather than dropped, so the client still
  learns that something under that directory moved.

Each watcher also gets an `error` listener. An unhandled `error` event on an `FSWatcher` is
thrown as an exception and takes the process down, which is a poor way for a dashboard to react
to a directory being renamed. On error the server closes that watcher, logs one line, and
switches to the polling fallback for it.

Recursive watch is supported on Windows and macOS, and on Linux from Node 20.13.0; below that
the option is silently ignored rather than rejected, so subdirectory edits go unseen. If any
`fs.watch` call throws, or a watcher errors, the server logs one line and falls back to a 2 s
`setInterval` that compares `newestMtime` of the three directories and emits a `change` carrying
just the directory name. `.my-flow/state/dashboard.json` is filtered out of every event so the
server never notifies clients about itself.

Clients are held in a `Set`; `req.on('close')` removes the entry and any write error removes it
too. `close()` ends every open stream so the process can exit.

### D7. Save guard

`POST /api/file` with `{ path, content, mtimeMs, force? }`. The guard runs in this order and
stops at the first failure:

1. `path` must be a non-empty string with no NUL byte and must not be absolute
   (`isAbsolute(path)` is rejected, which also covers `C:\...` and `\\server\share`) → `400
   bad-path`.
2. `abs = resolve(root, path)` must satisfy `abs === root || abs.startsWith(root + sep)`.
   Because `resolve` normalizes first, `../` and `a/../../b` are caught here → `400 outside-root`.
3. `abs` must end in `.md`, case-insensitively → `403 not-writable`.
4. The root-relative, `/`-separated form must match `specs/**/*.md`, or
   `changes/<name>/**/*.md` where `<name>` is a member of `listChanges(root)`. Since
   `listChanges` (`scripts/spec.mjs:59-65`) already excludes `archive` and names starting with
   `.` or `_`, `changes/archive/**` and `.my-flow/**` can never match → `403 not-writable`.
5. The file must already exist → `404 no-such-file`. The dashboard edits; it does not create.
6. Unless `force === true`, `statSync(abs).mtimeMs` must equal the submitted `mtimeMs`. A
   mismatch returns `409` with `{ ok:false, error:"mtime", mtimeMs, content }` carrying the
   current on-disk text, and the file is left untouched. The client shows that content and
   offers Reload or Overwrite; Overwrite resubmits with `force: true`.
7. Line endings: the on-disk text decides. If it contains any `\r\n`, the incoming content is
   normalized to `\n` and then converted to `\r\n`; otherwise it is normalized to `\n`. A
   textarea always yields `\n` in `value`, so this is what keeps a CRLF file CRLF. Nothing else
   about the content is altered: no trailing-newline insertion, no trimming.
8. `writeFileSync(abs, out, 'utf8')`, then `200 { ok:true, path, mtimeMs, eol }` with the fresh
   mtime, which the client stores as the basis for its next save.

Reads are governed by a separate, wider allow-list: `specs/**`, `changes/**` (archive
included), and `.my-flow/{ask,verify,interviews}/**`, all `.md`, all root-contained by the same
step 2. `/api/file` returns `writable: false` for anything that passes the read list but fails
the write list, and the client renders those files without a Save button.

### D8. Markdown renderer

`web/md.mjs` exports `renderMarkdown(text) -> htmlString` and imports nothing. Every text run
is HTML-escaped first (`&`, `<`, `>`, `"`, `'`), then inline markup is applied to the escaped
text, so no input can inject markup. Supported subset, chosen from what
`templates/change/*.md`, `specs/*/spec.md` and the README tables actually use:

- ATX headings `#` through `######`
- Paragraphs separated by blank lines
- Unordered lists (`- `, `* `) with one level of nesting at two or more spaces of indent
- Ordered lists (`1. `)
- Task items `- [ ] ` and `- [x] `, rendered as a glyph plus `class="task open"` / `"task done"`
- Fenced code blocks with an optional language; contents escaped and never parsed further
- GFM pipe tables with a `---` separator row, including alignment colons
- Inline `**bold**`, `` `code` ``, and links `[text](target)` where target starts with `#`,
  `./`, `../`, `http://`, `https://`, or is a bare relative path. "Bare relative path" is
  defined negatively and precisely: the portion of the target **before its first `/` must
  contain no `:`**. Allow-listing two schemes and treating everything else as relative is not
  enough, because `data:text/html;base64,...` and `vbscript:msgbox` have no `//` and would sail
  through a naive "does not start with a known scheme" test straight into an `href`. Any target
  failing the rule renders as plain text
- Horizontal rules (`---` on its own line, when not a table separator)
- HTML comments, hidden; `<!-- via: <date>-<name> -->` is additionally captured and returned as
  provenance for the specs page

Anything outside this list, blockquotes, setext headings, images, raw HTML, `_emphasis_`,
reference links, footnotes, renders as escaped plain text inside its paragraph. That is the
proposal's stated bargain, and the tests assert it for at least one construct.

### D9. Frontend

Four files, no build step:

- `web/index.html`: `<nav>` with Changes / Specs / Archive / Scratch, a `<main id="view">`, a
  connection indicator, and one `<script type="module" src="/app.mjs">`.
- `web/app.mjs`: hash router (`#/changes`, `#/changes/<name>`, `#/specs`, `#/specs/<cap>`,
  `#/archive`, `#/scratch`), fetch helpers, one render function per page, the editor, and the
  `EventSource` client. On a `change` event it refetches only the data the current route needs;
  if a textarea is dirty it refreshes everything except that editor and shows a
  "file changed on disk" note instead.

  Two client rules keep that behavior honest:

  - **Suppress the client's own echo.** A successful save writes the file, which the watcher
    reports back as a `change` for the file being edited. Left alone, every save ends with the
    editor announcing that its own file changed on disk. The client remembers the `mtimeMs`
    that the save response returned, and ignores a `change` event for that path when the
    modification time it then reads back matches. A genuine outside edit produces a different
    time and still warns.
  - **Every `hello` is a full refetch**, not just the first. `EventSource` reconnects on its
    own after a dropped connection, and the events that occurred while it was disconnected are
    gone. Treating a reconnect `hello` as "already initialized" leaves the page showing state
    from before the gap, which is the failure this whole mechanism exists to prevent. The
    `hello` payload's root is also compared against the current one, so reconnecting to a
    server restarted on a different project reloads rather than silently mixing two projects.
- `web/app.css`: the sample's language transposed to plain CSS custom properties on `:root`
  with a `@media (prefers-color-scheme: dark)` block: paper `oklch(97.8% 0.018 95)`, ink
  `oklch(16% 0.018 165)`, lime `oklch(88% 0.22 125)`, black borders in both themes, dark ground
  `oklch(17% 0.025 165)` with the shadow switching to `oklch(70% 0.14 125)`
  (`../my-flow-sample/src/styles/globals.css:30-45`, `:86-99`). Square corners, 2 px borders
  and 3 px hard offset shadows on controls, 3 px and 6 px on panels (`:21-25`), 120 ms
  transitions, `ui-monospace, SFMono-Regular, Menlo, Consolas, monospace` for metadata, system
  sans for prose. Left navigation, content right. Progress bars are a 6 px track with a lime
  fill and a monospace `3/12` label beside them. No `@font-face`, no images, no gradients.
- `web/md.mjs`: D8.

## Risks / Trade-offs

- **The refactor is the risky part, not the server.** Any behavior drift in status or validate
  breaks the CLI silently. Mitigated by moving expressions rather than rewriting them, by
  returning `{ json, text }` from one code path, and by running `test/spec.test.mjs` unchanged
  as the first task's verification, before any dashboard file exists.
- **Recursive `fs.watch` is the least portable thing here.** Covered by the polling fallback in
  D6; the cost of the fallback is a ceiling of about two seconds instead of one, on platforms
  that would otherwise not update at all.
- **SSE gives no client-to-server channel.** Accepted: saves are POSTs, and nothing else needs
  to travel upward.
- **The mtime guard has a resolution floor.** Two writes inside the same filesystem timestamp
  tick can slip through. The proposal already scopes editing to "between stages, while no agent
  is writing", and closing this properly means content hashing, which is out of scope.
- **In-place `writeFileSync` can truncate a file if the process dies mid-write.** Accepted for
  a local editor; noted in Non-Goals so it is a decision rather than an oversight.
- **`SIGTERM` is not catchable on Windows**, so a stopped server can leave its state file
  behind. Handled by making `stop` and `status` both able to reclaim a stale file, and by
  probing `/api/health` before ever sending a signal.
- **Binding to a busy port fails loudly.** `EADDRINUSE` prints the port and exits 1 rather than
  silently picking another, so the printed URL is always the URL that works.
- **No `## File Ownership` section, deliberately.** The plausible split (library + server,
  frontend, skill + docs) is not disjoint in practice: the frontend cannot be written until the
  API shape is real, the skill wraps the CLI the server task creates, and the renderer's tests
  and the server's tests both grow from the same fixture helpers. The change is a chain, not a
  fan, so it executes in one context.

## Do-Not-Touch

Copied from `proposal.md`, Impact:

- `hooks/`
- `agents/`, `src/agents/`
- `src/core/`
- `templates/`
- `claude/` (including `claude/CLAUDE.block.md`)
- `codex/agents/`, `codex/AGENTS.block.md`, `codex/hooks.template.json`
- every existing skill under `src/skills/` and its generated outputs under `skills/` and
  `codex/skills/`
- `scripts/build.mjs` itself

Generated files are only ever changed by running the build, never by hand. The only generated
outputs this change may alter are `skills/dashboard/SKILL.md`,
`codex/skills/my-flow-dashboard/SKILL.md` and `.claude-plugin/plugin.json`, and only as the
result of `npm run build`.

## Rebuild / Re-run After Change

Copied from `proposal.md`, Impact:

1. `npm run build` after editing `src/skills/dashboard.md` or `manifest.json`.
2. `npm run check` afterwards; it must report `generated files are up to date`.
3. `npm test`, covering the pre-existing suites plus the new dashboard and markdown suites.
4. An end-to-end run of `my-flow dashboard` against `../my-flow-sample` or this repository,
   including start and stop through the skill path, with the transcript recorded under
   `.my-flow/verify/`.

## Test plan

`test/dashboard.test.mjs` (server and API) and `test/markdown.test.mjs` (renderer) both reuse
the existing helpers: `makeTmp` (`test/helpers.mjs:17-20`), `write` (`:30-35`), `cleanEnv`
(`:39-43`), and `runSpec` / `runSpecJson` (`:47-55`).
`package.json`'s `test` script grows to
`node --test test/spec.test.mjs test/completion-guard.test.mjs test/dashboard.test.mjs test/markdown.test.mjs`.

**Fixture** (one helper in `test/dashboard.test.mjs`, built per test into a fresh `makeTmp`
root): `changes/demo/{proposal,design,tasks}.md` with a mix of ticked and unticked boxes,
`changes/demo/specs/cap/spec.md` as an ADDED delta, `specs/cap/spec.md` carrying a
`<!-- via: -->` marker, `changes/archive/2026-01-01-old/` with a merged delta,
`changes/archive/2026-01-02-dropped-abandoned/`, `.my-flow/ask/x.md`, `.my-flow/verify/y.md`,
`.my-flow/interviews/z.md`, and `.my-flow/state/current-change.json` naming `demo`. Servers
start with `startServer({ root, port: 0 })` and are closed in `t.after`.

| Assertion | How |
|---|---|
| Status parity | `deepStrictEqual(await (await fetch(url + '/api/status')).json(), runSpecJson(root, ['status']).json)` |
| Validate parity | Same against `runSpecJson(root, ['validate']).json` |
| CLI unchanged | `test/spec.test.mjs` passes with no edits, all 31 of its tests |
| Library fail-open | Calling `statusReport` and `validateReport` for a root with no `changes/` and for a name with no directory returns a value and leaves the calling process alive |
| Busy port | Starting a second server on the first one's port exits non-zero naming the port and writes no state file |
| Health | `/api/health` returns `pid === process.pid` and the fixture `root` |
| State file | `.my-flow/state/dashboard.json` exists after start with the bound port and this pid; gone after `close()` |
| Stale pid | `dashboard status --root <root> --json` over a state file naming a dead pid reports stale, removes the file, and sends no signal |
| Save happy path | GET the file, POST with the returned `mtimeMs`, expect 200 and the new bytes on disk |
| Stale mtime | POST with `mtimeMs: 1`, expect 409, `error === 'mtime'`, `content` equal to the on-disk text, file unchanged |
| Force overwrite | The same POST with `force: true`, expect 200 and the file changed |
| Archive not writable | POST to `changes/archive/2026-01-01-old/proposal.md`, expect 403 `not-writable`, file unchanged |
| Scratch not writable | POST to `.my-flow/ask/x.md`, expect 403 `not-writable` |
| Non-markdown refused | POST to `changes/demo/notes.txt`, expect 403 |
| Traversal refused | POST `path: '../escape.md'`, an absolute path, and `C:foo.md`, expect 400, and assert no file appears outside the root |
| Cross-origin write refused | POST with `Host: evil.example` and POST with `content-type: text/plain`, expect 403 and 415, file byte-identical |
| Body cap | POST a body above 5 MB, expect 413 and no write |
| Missing file | POST to `changes/demo/ghost.md`, expect 404 |
| CRLF preserved | A CRLF fixture saved with LF content contains `\r\n` and no lone `\n` |
| LF preserved | An LF fixture contains no `\r` after a save |
| Read allow-list | `/api/file?path=package.json` is 403; `/api/file?path=.my-flow/ask/x.md` is 200 with `writable: false` |
| Static containment | `GET /../package.json` and `GET /%2e%2e/package.json` are 404 |
| Push update | Open `/api/events`, read the stream, append a line to `changes/demo/tasks.md`, expect a `change` event naming that path within 2 s |
| Offline | Read all four files under `web/` and assert no `http://` or `https://` occurrence |
| Renderer subset | One test per construct in D8 against a fixed expected HTML string, plus a golden render of `templates/change/design.md` |
| Renderer escaping | `<script>alert(1)</script>`, `&`, `"` all appear escaped; `[x](javascript:alert(1))`, `[x](data:text/html,...)` and `[x](vbscript:...)` produce no `href` with those targets |
| Renderer provenance | A requirement carrying `<!-- via: 2026-01-01-old -->` renders a link to the matching `changes/archive/` entry, and every other HTML comment is absent from the output |
| Renderer fallback | A blockquote and an image render as escaped plain text, not as `<blockquote>` or `<img>` |
