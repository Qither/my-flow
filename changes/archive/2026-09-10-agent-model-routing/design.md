# PLAN-DR

## Principles

1. **Inherit is the truth; the override is a cache.** The repository ships `model: inherit`
   and no Codex `model =` line. Everything the automatic layer writes can be deleted
   (`models reset`) and the installed files are back to what `scripts/build.mjs` emitted.
   Nothing under `src/` or `manifest.json` is ever written at runtime.
2. **The hook does no work that can wait.** SessionStart reads one small JSON file, compares
   strings, optionally spawns one detached process, and prints. No `--version` probe, no
   model call, no network. Measured: `codex --version` costs about 425 ms on this machine
   through the npm `.cmd` shim, which alone is most of the one-second budget.
3. **A recommendation is data to be validated, never an instruction.** The model answers with
   JSON; a fixed validator accepts only the four role names, the effort enum, and model names
   the CLI is known to accept. Anything else is discarded and logged, and the baseline stays.
4. **Reuse the transports the repo already has.** Detached spawn from `scripts/dashboard.mjs`,
   binary resolution from `scripts/lib/spawn.mjs`, the read-only model call from
   `scripts/ask.mjs`. No new dependency, no daemon.
5. **Every claim is observable.** The log, the state file, `models status --json`, and the
   one-line SessionStart summary are the only channels, and every test reads one of them.

## Decision Drivers

1. **Hook latency under one second, always exit 0** (proposal, What Changes 3; the hook is
   registered with a 10 s timeout at `hooks/hooks.json:11`, and a slow hook delays every
   session for both CLIs).
2. **Never break the installed surfaces** (proposal, Success Criteria 4): a bad
   recommendation, a failed analysis, a plugin update, or a `--plugin-dir` development
   checkout must all leave working agent files behind.
3. **Bounded cost** (proposal, Non-Goals and Decision Boundaries): one analysis per detected
   change, retried at most three times, throttled checks, one lock. No loop can call a model
   more than a handful of times without a human.

## Viable Options

### A. Who runs the version probes

- **A1. The hook runs `claude --version` and `codex --version` and compares.** *Rejected.*
  The Codex probe alone measured about 425 ms (`codex.cmd` starts a Node process); on the
  Codex side the hook already pays PowerShell start-up through `hooks/codex-shim.ps1`. Add
  Node start-up (about 63 ms) and the stdin wait (`hooks/lib/stdin.mjs:6-33`) and a cold
  antivirus scan turns this into multi-second session starts.
- **A2 (chosen). The hook only checks a throttle and spawns `models.mjs check` detached; the
  background process probes, compares, and analyses.** The hook's cost is one `statSync`, one
  JSON read, and one `spawn` with `detached: true`, `stdio: 'ignore'`, `unref()` (the exact
  pattern at `scripts/dashboard.mjs:689-698`). The proposal's "hook compares versions" becomes
  "hook schedules the comparison"; the observable behaviour (a detected upgrade starts the
  analysis on session start, hook returns at once) is unchanged.
- **A3. A file-fingerprint of the CLI binaries instead of `--version`.** *Rejected.* The
  Codex binary is an npm package behind a `.cmd` shim whose mtime does not track upgrades
  reliably, and it adds a second notion of "version" to explain.

### B. Shape of the analysis output

- **B1. A single "tier" per role that my-flow maps to models.** *Rejected.* It hides the model
  name from the log and from `models status`, and the mapping table would itself age.
- **B2 (chosen). A full role -> per-surface map: Claude `{ model }`, Codex
  `{ model, model_reasoning_effort }`, plus one `reason` string.** It is exactly what the
  renderer writes, it round-trips through `models.json` unchanged, and the validator can be
  a pure function over it. Claude agent frontmatter has no effort field, so only Codex
  carries one.
- **B3. Free text parsed heuristically.** *Rejected.* Not validatable.

### C. How the installed Claude surface is rewritten

- **C1. Rewrite whatever `CLAUDE_PLUGIN_ROOT` points to.** *Rejected.* With
  `claude --plugin-dir <repo>` (README Quick start) that is the repository itself, and the
  layer would silently dirty committed `agents/*.md`.
- **C2 (chosen). Resolve the installed plugin through
  `<CLAUDE_HOME>/plugins/installed_plugins.json` and rewrite only paths under
  `<CLAUDE_HOME>/plugins/`.** The file is the CLI's own record
  (`plugins["my-flow@my-flow"][].installPath`, currently
  `~/.claude/plugins/cache/my-flow/my-flow/0.1.0`); a plugin update changes that path, which is
  precisely the signal for re-applying. `CLAUDE_PLUGIN_ROOT` from the hook is recorded as a
  hint and used only when it also lies under `<CLAUDE_HOME>/plugins/`.
- **C3. Copy the plugin's agent files somewhere my-flow owns and point Claude at them.**
  *Rejected.* Claude Code loads plugin agents from the plugin directory; there is no
  redirection to configure.

### D. Transport for the analysis

- **D1. Import a function from `scripts/ask.mjs`.** *Rejected.* `ask.mjs` is a top-level
  script (argv parsing at `scripts/ask.mjs:20-46`, `process.exit` at `:181`); extracting a
  library is a refactor of untested code that the proposal did not ask for.
- **D2 (chosen). Shell out: `node scripts/ask.mjs <provider> --prompt-file <abs> --cwd
  <MY_FLOW_HOME> --ask-dir <MY_FLOW_HOME>/ask --timeout 180000`.** Everything the proposal
  wants from the transport is already there: read-only flags (`:95-118`), model override
  (`:34`, `:43`), timeout and SIGKILL (`:122-130`), empty output as failure (`:145`),
  stripping of `CLAUDECODE` / `CLAUDE_CODE_*` / `CODEX_*` so a nested `claude -p` is not
  refused (`:84-88`). The one edit to `ask.mjs` is a new optional `--ask-dir <dir>` flag
  replacing the default `<cwd>/.my-flow/ask` (`:49`), so artifacts land in `~/.my-flow/ask/`
  instead of `~/.my-flow/.my-flow/ask/`. Model selection semantics are untouched.

### E. Where the renderer gets the baseline

- **E1. Keep a pristine copy of the shipped agent files under `~/.my-flow/`.** *Rejected.*
  A second copy that must be kept in sync with plugin updates.
- **E2 (chosen). Derive it from the script's own root: `<root>/manifest.json` gives the
  effort tiers and `sandbox_mode`; the baseline Claude value is the constant `inherit`.** The
  renderer manages exactly three lines per file (`model:` in frontmatter; `model =` and
  `model_reasoning_effort =` in TOML) and leaves every other line alone, so "reset" equals
  "apply the baseline", byte-identical to `scripts/build.mjs` output.

# design.md

## Context

- `manifest.json:34-51` pins the four roles: Claude `opus` / `opus` / `sonnet` / `sonnet`,
  Codex `gpt-5.5` with effort `high` / `high` / `medium` / `medium`.
- `scripts/build.mjs:108-114` builds the Claude frontmatter from `cfg.claude?.model`;
  `frontmatter()` at `:47-55` skips `undefined`, `null` and `''`, so an absent model already
  produces no `model:` line. `:116-126` builds the TOML: `:121` emits `model =` only when set
  and `:122` the effort line; nothing emits `sandbox_mode`. Generated files are committed
  (`agents/critic.md:4` currently reads `model: sonnet`, `codex/agents/critic.toml:4`
  `model = "gpt-5.5"`).
- `scripts/install.mjs:40-41` resolves `CLAUDE_HOME` (`CLAUDE_CONFIG_DIR` or `~/.claude`) and
  `CODEX_HOME` (`CODEX_HOME` or `~/.codex`). `install codex` copies `codex/agents/*.toml` into
  `<CODEX_HOME>/agents/` (`:244-257`) and refuses to replace a file that does not start with
  `# my-flow agent` (`:248`); uninstall removes only such files (`:192-198`). `install claude`
  writes settings and the CLAUDE.md block and only prints the plugin commands (`:105-110`).
  Already shipped during execute: `install codex` no longer writes a top-level `state` key
  into `hooks.json` (`delete doc.state` in `scripts/install.mjs`), because Codex 0.154
  rejects it ("unknown field `state`") and then loads no hooks; trust state lives only in
  `config.toml` `[hooks.state.*]`, and new or changed hooks are trusted once in `/hooks`.
- `hooks/session-context.mjs` is the SessionStart hook for both CLIs: skip flag at `:11-15`,
  stdin JSON via `readHookInput()` (`:17`, 3 s cap at `hooks/lib/stdin.mjs:35`), pure file
  scan, prints `{}` when it has nothing to say (`:78-81`) or `{ systemMessage,
  hookSpecificOutput.additionalContext }` (`:83-89`), always exit 0. Registered at
  `hooks/hooks.json:10-11` as `node "${CLAUDE_PLUGIN_ROOT}/hooks/session-context.mjs"`,
  timeout 10 s.
- Codex side: `scripts/build.mjs:160-161` renders the hook command as the PowerShell shim
  with `-Script "{{ROOT}}/hooks/session-context.mjs"`, and `scripts/install.mjs:267`
  substitutes `{{ROOT}}` with the repository path. `hooks/codex-shim.ps1:5-17` starts Node
  with the script path and forwards stdin, stdout, stderr; it sets no `CLAUDE_PLUGIN_ROOT`.
  So on Codex the hook, and therefore `scripts/`, run from the repository checkout, not from
  a plugin cache.
- Claude plugin at runtime: `~/.claude/plugins/installed_plugins.json` (`"version": 2`,
  `plugins["my-flow@my-flow"][0].installPath = ...\plugins\cache\my-flow\my-flow\0.1.0`). That
  directory is a full copy of the repository (`agents/`, `codex/`, `scripts/`, `hooks/`,
  `manifest.json`, `package.json`), so scripts inside it can resolve their own root exactly as
  in the checkout.
- `scripts/dashboard.mjs:689-698` is the detached-process pattern (`spawn(process.execPath,
  [...], { detached: true, stdio: 'ignore', windowsHide: true })`, `unref()`), `:699-708` polls
  a state file for up to 5 s, `:602-610` `alive(pid)` via `process.kill(pid, 0)`, `:62-82`
  state file helpers, `:768-770` the `main()` guard that keeps the module importable by tests.
- `scripts/lib/spawn.mjs:11-21` resolves a binary with `where.exe` preferring `.exe` then
  `.cmd`; `:29-37` `spawnCli()` handles the `.cmd` shell case. Measured on this machine:
  `claude --version` 55 ms (`~/.local/bin/claude.exe`, prints `2.1.259 (Claude Code)`),
  `codex --version` 425 ms (`C:\Program Files\nodejs\codex.cmd`, prints `codex-cli 0.153.4`),
  bare Node start-up 63 ms.
- `scripts/ask.mjs`: options `:27-46` (`--model`, `--timeout`, `--prompt-file`, `--cwd`; env
  `MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL` at `:34`); artifact dir `<cwd>/.my-flow/ask`
  at `:48-50`; env scrubbing `:84-88`; CLI args `:95-119`; status rules `:133-145`; stdout is
  `artifact: <path>`, `status: <s> (<t>s)`, a blank line, then the raw output (`:177-180`);
  exit 0 only when status is `ok` (`:181`).
- `scripts/cli.mjs:18-26` maps sub-commands to scripts, `:29-37` is the help text.
- Config inputs: `~/.claude/settings.json:6` `"model": "claude-fable-5-1[1m]"`;
  `~/.codex/config.toml:5` `model = "gpt-6-astra"`, `:101-103` `[agents]` holds only
  `max_threads` / `max_depth` (no default model). Installed `~/.codex/agents/*.toml` still say
  `model = "gpt-5.5"`.
- `~/.codex/models_cache.json` is a local file the Codex CLI writes for itself (keys
  `fetched_at`, `etag`, `client_version`, `models[]`; each model has `slug`, `visibility`
  `"list"` | `"hide"`, `supported_reasoning_levels[].effort`, `default_reasoning_level`).
  On this machine it lists `gpt-6-astra` (low, medium, high, xhigh, max, ultra),
  `gpt-5.6-sol`, `gpt-5.6-terra`, `gpt-5.6-luna` and `gpt-5.5` (low, medium, high, xhigh),
  and hides `gpt-reserve` and `codex-auto-review`. my-flow reads it read-only and fail-open;
  it is not an enumeration API, so the proposal's "no list-models API assumed" non-goal
  still holds: when the file is missing or unparsable the allowed set shrinks to the main
  model plus `knownModels` and the effort set to `low|medium|high|xhigh`.
- Tests: `test/helpers.mjs:17-20` `makeTmp()` (realpath of a temp dir), `:39-43` `cleanEnv()`,
  `:58-67` `runHook()` runs the Stop hook as a child with JSON on stdin;
  `test/dashboard.test.mjs:94-100` starts a server on port 0 and tears it down in `t.after`.
  `package.json:13` enumerates the test files, so a new suite must be added there.
  `scripts/lib/intent.mjs:240-246` validates task lines.
- Official facts (given, not re-verified): Claude subagent `model` accepts
  `sonnet|opus|haiku|fable`, a full id, or `inherit`; omitted means
  `CLAUDE_CODE_SUBAGENT_MODEL` then the main model. Codex agent TOML needs only
  `name`/`description`/`developer_instructions`; `model` and `model_reasoning_effort` resolve
  spawn value -> `[agents]` default -> parent session; `sandbox_mode = "read-only"` is
  supported per agent. Neither CLI has a confirmed "list models" command.

## Goals / Non-Goals

**Goals:**

- Ship the inherit baseline (manifest, build, generated files, README) as a self-contained
  first group.
- Add a user-level override layer under `MY_FLOW_HOME` (default `~/.my-flow/`) that rewrites
  only the installed agent files, validated, reversible with one command.
- Detect a CLI upgrade or main-model change from a session start without slowing it, analyse
  in the background through `ask.mjs`, and report on the next session start in one line.
- Provide `my-flow models status|analyze|apply|reset` over the same library.

**Non-Goals:**

- Anything listed under Non-Goals in `proposal.md` (no repo edits at runtime, no model
  enumeration API, no change to `ask.mjs` model selection, no per-project routing).
- Changing role prompts, the `mf-plan` / `mf-verify` flow, or `hooks/completion-guard.mjs`.
- Live reload: a rewritten agent file takes effect on the next session of that CLI.

## Decisions

### D1. Baseline in `manifest.json` and `build.mjs`

`manifest.agents.<role>.claude = { "model": "inherit" }` for all four roles.
`manifest.agents.<role>.codex = { "model_reasoning_effort": "high" | "medium" }` with
`"sandbox_mode": "read-only"` added for architect and critic only. The verifier gets no
`sandbox_mode` (user decision, see Risks): its read-only behaviour stays prompt-enforced,
matching the Claude side where Bash remains allowed so it can run the tests. `build.mjs`
gains one line next to `:122`: `c.sandbox_mode ? \`sandbox_mode = ${JSON.stringify(c.sandbox_mode)}\` : null`.
`model: inherit` is written explicitly (not omitted) so a reader of the file sees the intent
and so the override renderer always has a line to replace.

*Alternative:* omit `model` on Claude and rely on `CLAUDE_CODE_SUBAGENT_MODEL`. Rejected:
that env var is a global knob the user may set for other plugins; `inherit` says what we mean.

### D2. Files under `MY_FLOW_HOME`

`MY_FLOW_HOME` = `process.env.MY_FLOW_HOME` or `join(homedir(), '.my-flow')`. Contents:

| File | Written by | Purpose |
|---|---|---|
| `config.json` | `install claude` / `install codex` (merge, never clobber unknown keys) | `{ claude: { home, knownModels: [] }, codex: { home, agentsDir, knownModels: [] }, launcher: { task, root, node, home, registered } \| absent, updated }` |
| `models.json` | background analysis, `models analyze`, deleted by `models reset` | the override (shape in D5) |
| `models-state.json` | hook (small fields) and background | `{ version: 1, lastSpawn: { at, pid, launcher: 'schtasks' \| 'primary' }, lastCheck: { at, pid }, seen: { cliVersions, mainModels }, claudePluginRoot, applied: { claudeRoot, codexAgentsDir, hash, at } \| null, pending: { line, at } \| null, analysis: { attempts, lastError } }` |
| `models.lock` | background (`wx` create, removed on exit) | `{ pid, started }`; stale when pid dead or older than 30 min |
| `models.log` | background and CLI, append-only | `ISO level message` lines; rotated to `models.log.1` above 256 KB |
| `ask/` | `ask.mjs` via `--ask-dir` | prompt and result artifacts of each analysis |

All JSON writes are atomic (write `<file>.<pid>.tmp`, then `renameSync`; the pid in the
name keeps the hook and a concurrent background process from truncating each other's
temporary file). Every reader treats a missing
or unparsable file as empty (fail open), the same way `readDashboardState` does.

*Alternative:* one combined file. Rejected: the hook must rewrite `models-state.json` on
every start (pending line, throttle) and must never risk corrupting the override.

### D3. Module layout

- `scripts/lib/models.mjs` (new, pure library, Node built-ins only): `myFlowHome()`,
  `readConfig()`, `ROLES` (keys of the script root's `manifest.json`), `baseline()`,
  `resolveAllowed()`, `readModelsCache()`, `validateRecommendation(obj, allowed)`,
  `launchCheck(script, { platform, schtasksBin })` (D4; env seams `MY_FLOW_SCHTASKS`,
  `MY_FLOW_MODELS_LAUNCHER`),
  `renderClaudeAgent(text, model)`,
  `renderCodexAgent(text, { model, effort })`, `locateClaudeSurface()`,
  `locateCodexSurface()`, `applyRoles(roles)`, `resetSurfaces()`, `probeVersions()`,
  `readMainModels()`, `buildPrompt(ctx)`, `parseRecommendation(stdout)`, `runAnalysis(ctx)`,
  `check(opts)`, `hookTick({ pluginRoot, scriptsDir })`, state / log helpers.
- `scripts/models.mjs` (new CLI): `status [--json]`, `analyze [--provider claude|codex]
  [--timeout ms] [--dry-run]`, `apply`, `reset`, `check [--quiet]` (internal, what the hook
  spawns). Uses the `main()` guard from `scripts/dashboard.mjs:768`.
- `scripts/cli.mjs`: add `models: 'models.mjs'` and a help line.
- `hooks/session-context.mjs`: after the change-status lines, inside one `try/catch`:
  `const { hookTick } = await import('../scripts/lib/models.mjs'); const routing = await
  hookTick(...)`, then append `routing.lines` to `lines`. The import is dynamic and sits
  inside the `try`, so a missing or syntactically broken library (a half-updated plugin
  cache, an old checkout on the Codex side) still yields the change-status output and exit
  0. The module exists in both runtime roots (plugin cache and repository checkout).

The script root is resolved from each file's own location: in `scripts/models.mjs` it is
`resolve(dirname(fileURLToPath(import.meta.url)), '..')` as in `scripts/build.mjs:19`; in
`scripts/lib/models.mjs`, which sits one level deeper, it is
`resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')`. In the plugin cache that
root is the cache directory, on Codex it is the checkout.

### D4. What the hook does (all under 1 s)

1. If `MY_FLOW_SKIP_HOOKS` contains `model-routing` or `all`: nothing (the change-status
   part keeps its own existing `session-context` skip).
2. Read `models-state.json`. If `pending` is set: emit its `line` (exactly one line, prefixed
   `model routing`), clear `pending`, write the state.
3. If `CLAUDE_PLUGIN_ROOT` is set and differs from `state.claudePluginRoot`: record it.
4. `needApply` (hook side, cheap only) = `models.json` exists and `CLAUDE_PLUGIN_ROOT` is
   under `<CLAUDE_HOME>/plugins/` and `state.applied?.claudeRoot !== CLAUDE_PLUGIN_ROOT`
   (string compare, case-insensitive on win32 like `sameRoot` at
   `scripts/dashboard.mjs:61`). The full definition, including the read-back of the
   installed files, lives in `check` (D7 step 2); the hook only compares the root string.
5. `needCheck` = `lastSpawn` missing or `lastSpawn.at` older than
   `MY_FLOW_MODELS_CHECK_HOURS` (default 1; `0` means every start).
6. If `needApply || needCheck`: start the background check through `launchCheck()`, set
   `lastSpawn = { at: now, pid, launcher }`, write the state. The hook never waits for the
   child. `launchCheck()` picks the launcher:
   - **`schtasks`** (win32 only): when `config.launcher.task` is set in `config.json` (D9)
     and `MY_FLOW_MODELS_LAUNCHER` is not `primary`, run
     `spawnSync('schtasks', ['/run', '/tn', config.launcher.task], { timeout: 750,
     windowsHide: true })` and, on exit code 0, record
     `lastSpawn = { at, pid: null, launcher: 'schtasks' }`. Task Scheduler starts the check
     outside any job object, so it survives the hook's exit under both CLIs. Measured cost
     of `/run`: 66 ms; the 750 ms cap keeps even a hung `schtasks` inside the one-second
     bound. The test seam `MY_FLOW_SCHTASKS=<script>` replaces the `schtasks` binary with
     `node <script> /run /tn <name>` so the selection is unit-testable without a real task.
   - **`primary`**: everywhere else (non-win32, no task registered, `/run` non-zero or
     timed out, `MY_FLOW_MODELS_LAUNCHER=primary`): the plain
     `spawn(process.execPath, [script, 'check', '--quiet'], { detached: true, stdio:
     'ignore', windowsHide: true })` plus `unref()`, recorded as
     `{ at, pid: child.pid, launcher: 'primary' }`.
   - Ownership (as implemented): `hookTick` reads the state once and passes that object into
     `launchCheck(script, { state, now })`; `launchCheck` mutates only `state.launcherFailedAt`
     (set on failure, deleted on the next successful `/run`) and `hookTick` performs the single
     state write, so nothing is overwritten. The `MY_FLOW_SCHTASKS` seam is detected by the
     variable being set (its value is run as `node <script> /run /tn <task>`).
   - Failure memory: on a non-zero exit or a timeout of `/run`, the hook records
     `state.launcherFailedAt = now` and logs `schtasks /run failed (<code or timeout>),
     falling back to primary` exactly once for that failure. While `launcherFailedAt` is
     younger than `MY_FLOW_MODELS_CHECK_HOURS` (default 1 h) the hook does not attempt
     `schtasks` at all and goes straight to `primary` without logging; the next attempt
     after the window succeeds silently and clears `launcherFailedAt`, or fails and logs
     again. A hung `schtasks` therefore costs at most one 750 ms hit per hour.
   - The `cmd.exe /c start /b` variant is removed: task 6.2 proved it stays inside the
     hook's job object (pid 28220 killed about one second after `check start`).

   Pid evidence: `check` writes `check start (pid N)` as its first log line and
   `check done (pid N)` as its last, and records `lastCheck = { at, pid: process.pid }`
   (D7). "The child survived the hook" is verifiable as: `models.log` has a
   `check start (pid N)` and `check done (pid N)` pair with the same `N`, written after
   `lastSpawn.at`, with `N === lastCheck.pid` and `lastCheck.at` newer than `lastSpawn.at`.
   The extra equality `N === lastSpawn.pid` holds only under `primary` (under `schtasks`
   `lastSpawn.pid` is `null`; the process was started by Task Scheduler). A `check start`
   without `check done` is the "child died with the hook" signal; no `check start` at all
   means the hook never ran, never spawned, or the task's action could not start (node or
   the recorded root missing: `models status` shows both).

   History recorded by task 6.2 (kept as evidence): a plain detached child survived a short
   check under Claude Code (first run, about 300 ms, pid pair 20060), but under Codex the
   child was killed about one second after `check start` while its analysis was running
   (prompt written, no result, no `check done`, stale lock) with the primary spawn (pid
   31980) and again with `cmd.exe /d /s /c "start /b ..."` (pid 28220): Codex tears down the
   hook's job object and neither launcher breaks out of it. A long analysis under Claude
   Code is unverified and treated as at risk too, so the scheduled task is used for both
   CLIs. Measured escape options: `wmic` absent; PowerShell `Invoke-CimMethod Win32_Process
   Create` escapes the job but costs 1.26 s; `schtasks /run` costs 66 ms and needs a task
   registered at install time (user decision: this one).

   *Alternatives for the launcher:* (a) PowerShell `Invoke-CimMethod` from the hook:
   escapes the job but 1.26 s blows the one-second bound. Rejected. (b) Accept that only
   the Claude hook and the manual command can run an analysis: leaves the Codex-triggered
   detection unable to do the one thing it exists for. Rejected. (c) A resident helper
   process: a daemon, which the proposal's Decision Boundaries reserve for the user.
   Rejected. (d) Task Scheduler (chosen): 66 ms, no admin for a "run only when user is
   logged on" task, outside every job object, present on every supported Windows.

The hook's own output stays the single JSON object of `hooks/session-context.mjs:83-89`; the
routing line is one more entry in `lines`, so a project without `changes/` still gets the
summary (the `!lines.length` early exit at `:78` is preserved for the empty case).

*Alternative:* have the hook write nothing and let the background process clear `pending`.
Rejected: the summary must be printed exactly once, and only the hook knows it was shown.

### D5. Override shape and validation rules

`models.json`:

```json
{
  "version": 1,
  "updated": "2026-09-10T08:00:00.000Z",
  "analyzedBy": "claude",
  "cliVersions": { "claude": "2.1.260", "codex": "0.153.4" },
  "mainModels": { "claude": "claude-fable-5-1[1m]", "codex": "gpt-6-astra" },
  "roles": {
    "planner":   { "claude": { "model": "inherit" }, "codex": { "model": null, "model_reasoning_effort": "high" } },
    "architect": { "claude": { "model": "inherit" }, "codex": { "model": null, "model_reasoning_effort": "high" } },
    "critic":    { "claude": { "model": "sonnet" },  "codex": { "model": null, "model_reasoning_effort": "medium" } },
    "verifier":  { "claude": { "model": "sonnet" },  "codex": { "model": null, "model_reasoning_effort": "medium" } }
  },
  "reason": "one paragraph from the model"
}
```

The model's answer is only the `roles` and `reason` members; the rest is provenance added by
my-flow. `validateRecommendation(obj, allowed)` is a pure function returning
`{ ok: true, roles }` or `{ ok: false, errors: [] }`:

- `obj.roles` must be an object whose key set equals exactly `ROLES`
  (`planner`, `architect`, `critic`, `verifier`); missing or extra keys reject the whole
  answer.
- Each role needs `claude` and `codex` objects.
- `claude.model`: string matching `/^(inherit|sonnet|opus|haiku|fable)$/` **or** a member of
  `allowed.claude` = `{ settings.json model }` ∪ `config.claude.knownModels`. Full ids are
  accepted only from that set, because only the main model is known to exist for this account.
- `codex.model`: `null` (inherit) **or** a member of `allowed.codex` =
  `{ config.toml model }` ∪ `{ models[].slug of <CODEX_HOME>/models_cache.json where
  visibility === "list" }` ∪ `config.codex.knownModels`. Any other string rejects (a Codex
  agent with an unknown model cannot be spawned at all, so the regex-only rule from the
  proposal is tightened to a positive list; the cache and `knownModels` extend it). The
  cache is read once per validation, read-only, and any read or parse error simply drops
  its contribution.
- `codex.model_reasoning_effort`: `null` (omit the line, inherit) **or** a member of
  `efforts(codex.model ?? mainModels.codex)`, where `efforts(slug)` =
  `models_cache.json` -> `models[slug].supported_reasoning_levels[].effort`, falling back to
  `low|medium|high|xhigh` when the cache is missing or the slug is absent. So `ultra` is
  valid for `gpt-6-astra` on this machine and invalid for `gpt-5.5`.
- `allowed` is computed once by `resolveAllowed()` (`{ claude: Set, codex: Set,
  efforts(slug) }`) and passed to both the validator and the prompt builder (D8), so the
  model is told exactly the sets it is validated against.
- `reason`: optional string, truncated to 2000 characters.
- `sandbox_mode` and `disallowedTools` are not part of the recommendation and are never
  changed by the renderer.

*Alternative:* accept any `^[a-z0-9.-]+$` Codex model. Rejected in the pre-mortem below.

### D6. Renderer and surface location

- **Codex surface**: `config.codex.agentsDir`, else `<CODEX_HOME>/agents`. For each role,
  `<dir>/<role>.toml` is rewritten only if it exists and starts with `# my-flow agent`
  (`scripts/install.mjs:248`). The renderer removes any existing `model =` and
  `model_reasoning_effort =` lines and inserts the new ones directly after the
  `description =` line; all other lines, including `sandbox_mode` and
  `developer_instructions`, are copied verbatim. CRLF is preserved if present.
- **Claude surface**: `locateClaudeSurface()` reads `<CLAUDE_HOME>/plugins/installed_plugins.json`.
  The value under `plugins["my-flow@my-flow"]` may be an array of entries (version 2, as on
  this machine) or a single entry object (older registries); both are accepted, entries
  without a string `installPath` are ignored, and a missing or unparsable file is treated
  as "no registry" (logged once per `check`), in which case only `state.claudePluginRoot`
  as recorded by the hook is used. It keeps only paths that resolve inside
  `<CLAUDE_HOME>/plugins/` and contain `agents/<role>.md` with `name: <role>` in the
  frontmatter. A path outside
  (`claude --plugin-dir <checkout>`) is logged as `claude surface: development checkout, not
  rewritten` and skipped. For each role the `model:` line in the frontmatter is replaced, or
  inserted after `description:` when absent.
- Missing surface (no Codex install, no Claude plugin): skipped and logged, never an error.
- After a successful apply, `state.applied = { claudeRoot, codexAgentsDir, hash, at }` where
  `hash` is `sha256(JSON.stringify(roles))`.
- `resetSurfaces()` = `applyRoles(baseline())` with the constants from D1, then delete
  `models.json`, clear `applied`, log `reset`.

Plugin update interaction: the new cache directory carries the shipped baseline. The next
SessionStart sees `CLAUDE_PLUGIN_ROOT !== applied.claudeRoot` and spawns `check`, which
re-applies `models.json` before doing anything else (D4 step 4). `models apply` does the same
on demand. Until then the new cache runs the baseline, which is always valid.

### D7. Detection and analysis (`check`)

1. Acquire `models.lock` (`openSync(path, 'wx')`); if it exists and its pid is alive and
   younger than 30 min, exit silently. Otherwise replace it. `models analyze` acquires the
   same lock the same way and exits 1 with `analysis already running (pid N)` when it is
   held, so a manual run and a hook-spawned check never analyse concurrently. `models apply`
   and `models reset` acquire it the same way too (same exit code and message), so a manual
   apply or reset never interleaves its file writes with a running check.
2. `needApply` (full definition) = `models.json` exists and validates **and** at least one
   of: `state.applied?.claudeRoot` differs from the located Claude root;
   `state.applied?.codexAgentsDir` differs from the located Codex agents dir; or the
   effective `model:` / `model =` / `model_reasoning_effort =` values read back from any
   located surface file differ from `models.json` roles (a plugin update, a re-run of
   `install codex`, or a hand edit all show up here). When true: apply, log
   `re-applied override to <path>`. The hook (D4 step 4) evaluates only the cheap root
   comparison; this content comparison runs only here.
3. Probe: `spawnCli('claude', ['--version'])` and `spawnCli('codex', ['--version'])`, 15 s
   timeout each, `windowsHide`; version = first `\d+\.\d+\.\d+` match, `null` if the binary is
   missing or the call fails. Test seam: `MY_FLOW_MODELS_FAKE_VERSIONS="claude=2.9.0,codex=0.200.0"`
   replaces the probes (an empty value means `null`).
4. Main models: `settings.json` -> `model` (string or `null`); `config.toml` -> the first
   top-level `^model\s*=\s*"([^"]+)"` before any `[section]` line, or `null`.
5. `current = { cliVersions, mainModels }`. If `state.seen` is absent: record it, log
   `first run: recorded ... (no analysis; run "models analyze" to request one)`, stop.
   If `current` deep-equals `seen`: log `unchanged`, update `lastCheck`, stop.
6. Provider order: the CLI whose version changed first; both changed or only a main model
   changed: `claude` then `codex`; a provider whose binary cannot be resolved is skipped.
   When `MY_FLOW_MODELS_FAKE_VERSIONS` is set, a provider with a non-empty fake version
   counts as resolvable and no `where.exe` lookup happens, so the fixture tests (3.4
   "changed + failing script", 6.1 failure fixture) reach `analysis failed` rather than
   `no CLI available` on a machine without `claude` / `codex` on `PATH`.
   If no provider remains: log `no CLI available`, record `seen`, stop.
7. For each provider in order, `runAnalysis` (D8). First valid answer wins. On success:
   write `models.json`, apply (D6), set `pending.line` to
   `model routing updated for claude <v> / codex <v> (by <provider>): planner=<c>/<x>@<e>, architect=..., critic=..., verifier=...`
   where `<c>` is the Claude model, `<x>` the Codex model or `inherit`, `<e>` the effort;
   record `seen`, reset `analysis.attempts`.
8. On failure of all providers: `analysis.attempts += 1`, `analysis.lastError = reason`,
   `pending.line = "model routing analysis failed: <reason> (baseline inherit kept)"`. If
   `attempts >= 3`, record `seen` so the hourly check stops retrying; otherwise leave `seen`
   unchanged so the next check retries. Installed files are never touched on this path.
9. Always: `lastCheck = { at: now, pid: process.pid }`, remove the lock, and log `check done (pid <process.pid>)` as
   the last line (the first line of every run, written right after the lock is taken, is
   `check start (pid <process.pid>)`). `--quiet` suppresses stdout; the log carries
   everything.

`models analyze` is step 6 to 8 with the provider forced (or the default order), run in the
foreground, printing the recommendation; `--dry-run` validates and prints but writes neither
`models.json` nor the surfaces.

### D8. The analysis call

`buildPrompt(ctx)` produces one Markdown document with: the four roles with their one-line
purpose (from the installed agent descriptions), the read-only flag of each, the current CLI
versions and main models, the previous `models.json` if any, the exact allowed value sets
from `resolveAllowed()` (D5) spelled out per surface, including the per-model effort lists
taken from `models_cache.json` (for example `gpt-6-astra: low, medium, high, xhigh, max,
ultra`; `gpt-5.5: low, medium, high, xhigh`), the baseline, and the instruction to answer
with a single fenced `json`
block `{ "roles": {...}, "reason": "..." }` and nothing else, optimising for quality of
planning/review and cost. The prompt is written to `<MY_FLOW_HOME>/ask/<ts>-models-prompt.md`.

Transport: `spawnSync(process.execPath, [askScript, provider, '--prompt-file', promptPath,
'--cwd', MY_FLOW_HOME, '--ask-dir', askDir, '--timeout', '180000'], { timeout: 200000 })`
where `askScript` defaults to `<root>/scripts/ask.mjs` and the test seam
`MY_FLOW_ASK_SCRIPT=<path>` replaces it. `MY_FLOW_CLAUDE_MODEL` / `MY_FLOW_CODEX_MODEL` are
inherited unchanged, so the user's existing overrides also steer the analysis model. The
child's env additionally sets `MY_FLOW_SKIP_HOOKS` to the existing value plus
`model-routing` (comma-joined), because the nested `claude -p` / `codex exec` session runs
the SessionStart hook itself: without the flag it would consume `pending` before the user
ever saw it and could spawn a second `check`. With the flag the routing part of the hook
does nothing at all (no state read, no write, no spawn), while the change-status part still
runs.
`parseRecommendation(stdout)` takes the text after the first blank line, extracts the first
```` ```json ```` fence (or the outermost `{...}` when no fence), `JSON.parse`s it, and hands
the object to `validateRecommendation`. A non-zero exit, empty output, parse error or
validation error is one failure with a one-line reason (`exit 1`, `timeout after 180000 ms`,
`invalid: codex.model "gpt-7" for critic is not in the allowed set`).

### D9. `install` records paths and registers the launcher (`config.json`)

`install claude` writes `config.claude.home = CLAUDE_HOME`; `install codex` writes
`config.codex.home = CODEX_HOME` and `config.codex.agentsDir`. Both create the file with
`knownModels: []` on first write and merge on later writes (`--dry-run` only prints). The
background process prefers these paths and falls back to the same env/home resolution as
`scripts/install.mjs:40-41`, so an install is not required for the layer to work.

Home precedence, stated because a task started by Task Scheduler inherits the **user's**
environment, not the hook's (so `MY_FLOW_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` set only
for a session or a test never reach it): `myFlowHome()` = env `MY_FLOW_HOME` else
`~/.my-flow`; `claudeHome()` = `config.claude.home` else env `CLAUDE_CONFIG_DIR` else
`~/.claude` (already so at `scripts/lib/models.mjs:47`); `codexHome()` = env `CODEX_HOME`
only when set, else `config.codex.home`, else `~/.codex` (already so at `:48`). Under the
scheduled task the config values therefore decide, which is why both installers record
them.

**Scheduled task (win32 only).** Both `install claude` and `install codex` register, or
re-register with `/f`, one task named `my-flow-models-check`:

- Action: `conhost.exe --headless "<process.execPath>" "<ROOT>/scripts/models.mjs" check
  --quiet --home "<MY_FLOW_HOME>"`. A task that "runs only when the user is logged on" is
  interactive, so a bare `node.exe` action would show a console window for the whole
  analysis (minutes). `conhost.exe --headless` (measured by the architect on this machine)
  runs a console program with no window at all (`GetConsoleWindow` returns 0), costs about
  30 ms and preserves quoted paths with spaces, so no shim file is needed. The installer
  refuses to register (prints why, records nothing) when
  `%SystemRoot%\System32\conhost.exe` is missing. `--home <dir>` is a new option of
  `scripts/models.mjs` (parsed in `parseArgs`, applied as `process.env.MY_FLOW_HOME =
  opts.home` before any library call), which is how a custom `MY_FLOW_HOME` chosen at
  install time reaches a task that inherits only the user's persistent environment.
- Trigger: `/sc once /st 00:00` (a one-shot time that is already past, so the trigger never
  fires by itself; schtasks may print a "start time is earlier than current time" warning
  and still create the task). The task is started only by `schtasks /run` from the hook.
  If a Windows build refuses the past `once` trigger, the fallback trigger is
  `/sc onlogon`, which costs one throttled check per logon and nothing else.
- No `/ru` / `/rp`: the task runs as the current user, "run only when user is logged on",
  which needs no administrator rights. Task Scheduler's default multiple-instance policy
  does not start a second instance while one runs; `models.lock` covers the rest.
- Recorded as `config.launcher = { task: 'my-flow-models-check', root: <ROOT>, node:
  <process.execPath>, home: <MY_FLOW_HOME>, registered: <iso> }`. `models status` prints
  it, plus whether `schtasks /query /tn <task>` succeeds and whether
  `root/scripts/models.mjs` and `node` still exist.
- A second registration from a different checkout: last install wins (`/f` replaces the
  action); `config.launcher.root` shows which checkout the task runs, and `models status`
  says so. The hook does not care which checkout runs the check; both surfaces are located
  from `config.json` and the registries (D6).
- `--dry-run` prints the `schtasks /create ...` line and writes nothing.
- Uninstall: `uninstall claude` and `uninstall codex` each remove their own
  `config.<tool>.home` (keeping `knownModels`); when neither `config.claude.home` nor
  `config.codex.home` remains afterwards, the task is deleted with `schtasks /delete /tn
  my-flow-models-check /f` and `config.launcher` cleared (there is no shim to delete);
  otherwise the task is kept and the installer prints `scheduled task kept for the other
  surface`.
- On non-Windows platforms nothing is registered; `launchCheck()` uses `primary` there.

*Alternative:* register the task lazily from the hook. Rejected: `schtasks /create` is a
write outside the hook's one-second budget and outside the proposal's write set; the
installer is the place the user already runs deliberately.

### D10. Codex-side trigger

The Codex hook runs from the checkout (Context). `hookTick` receives no `CLAUDE_PLUGIN_ROOT`
there, records nothing for Claude, and the same `check` re-renders both surfaces because it
locates the Claude surface through `installed_plugins.json` (D6). Nothing in the routing part
of the hook reads the hook's stdin payload, so the Codex payload shape is irrelevant.

### D11. Summary line contract

Exactly one line, starting with `model routing`, produced only from `state.pending` and only
once. Two cases: `model routing updated for ...` and `model routing analysis failed: ...`.
`models reset` and `models apply` also set `pending` (`model routing reset to baseline`,
`model routing re-applied ...`) so a CLI action taken in one terminal is visible in the next
session.

## Risks / Trade-offs

- A detected change is acted on at most an hour late (throttle) and after the next session
  start. Acceptable: the baseline is always a valid configuration.
- The analysis costs one read-only model call per detected change, up to three on failure.
  The lock, the throttle and the attempt cap bound it; `MY_FLOW_SKIP_HOOKS=model-routing`
  turns it off entirely.
- The Codex allowed set is the main model, the listed slugs of `models_cache.json` and
  `knownModels`; without the cache it shrinks to the main model plus `knownModels`, and the
  Codex side of a recommendation is then mostly about effort until the user lists more
  models.
- Rewriting files inside `~/.claude/plugins/cache/` is undocumented territory; a plugin
  update or `claude plugin uninstall` discards the change, which D6 handles by re-applying.
- `install codex` must be re-run once by the user so the installed TOMLs carry
  `sandbox_mode` and no `model =` pin; the renderer works on old files too but cannot add
  lines it does not manage.
- `sandbox_mode = "read-only"` on the Codex verifier would block `npm test`: every suite
  writes to a temp directory (`test/helpers.mjs:17-20` `makeTmp()`), while
  `src/agents/verifier.md:28` instructs the verifier to run the tests itself. With the
  read-only sandbox the Codex verifier could only report "could not run", which defeats the
  role. Decision (user): the sandbox line goes on architect and critic only; the verifier
  keeps prompt-enforced read-only behaviour on both surfaces, the same trade-off the Claude
  side already makes by leaving Bash allowed. Residual risk: a Codex verifier that ignores
  its prompt can write; the Stop hook and the separate-context rule in mf-verify remain the
  backstop.
- `models_cache.json` is undocumented and its shape may change with a Codex release. Every
  read of it is fail-open (D5): a missing key or a parse error drops the cache's
  contribution and falls back to the main model and `low|medium|high|xhigh`, never to an
  error.
- Task Scheduler disabled by policy (service stopped, `schtasks` blocked, or `/create`
  refused at install): the installer prints the failure and records no `config.launcher`;
  `launchCheck()` then uses `primary`, logs `schtasks /run failed ..., falling back to
  primary` when a task was recorded but cannot be run, and the Codex-triggered check is
  back to the job-object limitation (short checks complete, an analysis may be killed).
  `models status` shows `launcher: primary (no scheduled task)` so the state is visible.
- The task points at a deleted or moved checkout (or a replaced Node): `schtasks /run`
  still returns 0, the action fails silently, and the log shows no `check start`.
  `models status` prints `config.launcher.root` / `node` with an `exists` flag for each;
  the fix is to re-run `install claude` or `install codex` from the current checkout.
- Under the scheduled task the `PATH` is the user's persistent `PATH`, not a shell's, so a
  CLI reachable only through a shell profile probes as `null` there, and a shell-run
  `models analyze` may then see different versions than the task's `check`; `models
  status` shows `seen` (what the task recorded) next to the surfaces so the mismatch is
  visible, and the fix is to put the CLI on the persistent user `PATH`.
- The scheduled task is a write outside the proposal's original write set
  (`~/.my-flow/`, `~/.codex/agents/`, the plugin `agents/`). It was decided by the user
  when the job-object evidence came back (mf-plan iteration 3); it is created only by the
  installer, named `my-flow-models-check`, and removed by uninstall.

## Pre-mortem

**Scenario 1: the model recommends a Codex model that does not exist, every Codex subagent
fails to start, and mf-plan is dead until someone notices.** Prevention: D5 accepts a Codex
model only from the positive set `{ config.toml main model } ∪ { listed slugs in
models_cache.json } ∪ knownModels`, an effort only from that model's own
`supported_reasoning_levels`, and a Claude full id only from `{ settings.json model } ∪
knownModels`; any other name rejects the whole answer and the baseline stays. Containment: `models status` prints the effective values per
role read back from the installed files, the summary line names them at the next session
start, and `models reset` restores the baseline in one command without a rebuild.

**Scenario 2: session start becomes slow or hangs because the hook probes CLIs, waits on a
lock, or blocks on a child.** Prevention: A2 moves every probe and every model call into a
detached child (`stdio: 'ignore'`, `unref()`); the hook does one `statSync`, one JSON read,
one JSON write and one `spawn`, each in `try/catch` with fail-open defaults; a throttle
(`lastSpawn`) prevents spawning on every start; the test in group 4 asserts the hook's warm
wall time under 1000 ms and the in-process `hookTick` under 200 ms with a cold state.
Containment: the 10 s timeout at
`hooks/hooks.json:11` still bounds the worst case, and `MY_FLOW_SKIP_HOOKS=model-routing`
removes the whole path without touching the change-status output.

**Scenario 3: the background process writes into the wrong place: the developer's checkout
under `claude --plugin-dir`, or a stale cache directory after a plugin update, so the
override silently vanishes or dirties git.** Prevention: D6 rewrites Claude files only when
the path resolves inside `<CLAUDE_HOME>/plugins/` and is listed in `installed_plugins.json`
(or was reported by the hook and also lies inside that directory); a checkout is logged and
skipped; the Codex renderer touches only files with the `# my-flow agent` header. A plugin
update changes `installPath`, the hook notices `applied.claudeRoot` no longer matches and
schedules a re-apply. Containment: `models status` reports `override recorded, claude surface
at <path> shows inherit (drift)` and `models apply` fixes it; `node scripts/build.mjs --check`
in the checkout stays green because nothing there is written.

## Test plan

| Level | What | How it is checked |
|---|---|---|
| Unit | `validateRecommendation`: accepts the baseline and a full valid map; rejects a missing role, an extra role, `gpt-7` for Codex, `claude-unknown` for Claude, non-object input; with a fixture `models_cache.json` listing `gpt-5.5` without `ultra`, effort `ultra` rejects; with `gpt-6-astra` listed with `ultra`, it passes; with no cache file, `ultra` rejects and `xhigh` passes; a hidden slug (`visibility: "hide"`) is not in the allowed set | `test/models.test.mjs` imports `scripts/lib/models.mjs`; `resolveAllowed()` is pointed at the fixture via `CODEX_HOME`; deep-equal on `{ ok, errors }` |
| Unit | `locateClaudeSurface()` registry parsing: version-2 array entry, version-1-style single object entry, entry without a string `installPath`, unparsable file (falls back to the recorded plugin root and logs once) | table-driven on fixture `installed_plugins.json` files under a temp `CLAUDE_CONFIG_DIR` |
| Unit | `renderClaudeAgent` / `renderCodexAgent`: replace, insert, idempotent, CRLF kept, `sandbox_mode` and `developer_instructions` untouched, non-managed TOML refused | run on copies of `agents/*.md` and `codex/agents/*.toml` in a temp dir; byte comparison; applying the baseline reproduces the shipped file exactly |
| Unit | `parseRecommendation`, version parsing (`2.1.259 (Claude Code)`, `codex-cli 0.153.4`), `config.toml` main model (top-level only), `settings.json` model | table-driven asserts |
| Integration | `models check` with `MY_FLOW_HOME`, `CLAUDE_CONFIG_DIR`, `CODEX_HOME` pointing at temp fixtures (a fake `plugins/installed_plugins.json` and cache dir, fake `agents/*.toml`), `MY_FLOW_MODELS_FAKE_VERSIONS`, `MY_FLOW_ASK_SCRIPT` = fixture script printing a canned answer | first run records `seen` and writes no `models.json`; changed version + valid answer writes `models.json`, rewrites both surfaces, sets `pending`; fixture exiting 1 leaves files byte-identical and logs `analysis failed`; three failures record `seen`; lock held by a live pid makes a second `check` exit without a log line |
| Integration | `models apply`, `models reset`, `models status --json` | `apply` on a hand-edited invalid `models.json` exits 1 and changes nothing; `reset` deletes the override and files equal the shipped baseline; `status --json` reports `override: null`, per-role effective values, `pending` |
| Integration | `ask.mjs --ask-dir` | `node scripts/ask.mjs claude --ask-dir <tmp> --timeout 1 x` creates its artifact in `<tmp>` and nothing under `<cwd>/.my-flow/ask/` |
| Integration | SessionStart hook as a child process (`runSessionHook` helper mirroring `runHook` at `test/helpers.mjs:58-67`) | child wall time < 1000 ms on the second of two consecutive runs (warm); `hookTick()` called in-process with a cold state completes in < 200 ms; `pending` line appears exactly once across two runs; `lastSpawn` written; `MY_FLOW_SKIP_HOOKS=model-routing` produces no routing output, spawns nothing (no `lastSpawn`) and leaves a set `pending` in place untouched; with `scripts/lib/models.mjs` renamed in a temp copy of the plugin root the hook still prints the change-status JSON and exits 0 |
| Integration | `models analyze` while `models.lock` is held by a live pid | exits 1 with `analysis already running (pid N)`, writes nothing |
| Unit | `launchCheck()` selection with `MY_FLOW_SCHTASKS` pointing at a fixture script that records its argv and exits 0 or 1 | `config.launcher.task` set and fixture exits 0: the fixture was called with `/run /tn my-flow-models-check` and the result is `{ launcher: 'schtasks', pid: null }`; fixture exits 1: result `{ launcher: 'primary' }` with a numeric pid, one `falling back to primary` log line and `launcherFailedAt` set; fixture sleeps 2 s: result `primary`, the hook's wall time still < 1000 ms, `launcherFailedAt` set, and a second `hookTick()` within the hour never calls the fixture and adds no log line; no `config.launcher`: `primary` and the fixture never called; `models.mjs check --home <tmp>` writes `models-state.json` and `models.log` under `<tmp>` and nothing under the default home; `MY_FLOW_MODELS_LAUNCHER=primary`: `primary`; a non-win32 platform (stubbed through an option) never calls the fixture. The automated suite otherwise keeps `MY_FLOW_MODELS_LAUNCHER=primary` (set by `runSessionHook` and the fixture env) because a real scheduled task cannot see the fixture environment |
| Integration | `install claude --dry-run` and `install codex --dry-run` on win32 with `MY_FLOW_HOME` at a temp dir | stdout contains one `schtasks /create /f /tn my-flow-models-check` line whose `/tr` starts with `conhost.exe --headless`; no file created, no task registered (`schtasks /query /tn my-flow-models-check` result unchanged before and after) |
| End-to-end | Simulated upgrade: state with older versions, fake versions newer, fake ask valid; run the hook, poll `models.log` for a `check start` / `check done (pid N)` pair with `N === lastCheck.pid` up to 15 s (dashboard-style poll), and before every further hook run and before `reset` poll until the count of `check done` lines equals the number of hook runs so far | `models.json` valid, Claude and Codex fixture files carry the recommended values, `models.log` has `updated`, second hook run prints one `model routing updated ...` line, third prints none, the run after `reset` prints one `model routing reset to baseline` line; the fresh failing fixture keeps the baseline and, after its own `check done`, its second hook run prints one `analysis failed` line |
| End-to-end (manual, mf-verify) | `node scripts/cli.mjs models analyze --dry-run` against the real CLI | prints a recommendation that passes validation, writes an artifact under `~/.my-flow/ask/`, changes no installed file (`models status` unchanged before/after) |
| End-to-end (manual, this machine) | User-side install first (asks the user once, since `install codex` rewrites `~/.codex/config.toml`, `hooks.json`, `AGENTS.md`), then hook-spawned checks under the real CLIs from a temp directory outside the repo: `env -u CLAUDECODE -u CLAUDE_CODE_ENTRYPOINT MY_FLOW_MODELS_CHECK_HOURS=0 claude -p "reply ok" --max-turns 1` and `MY_FLOW_MODELS_CHECK_HOURS=0 codex exec --skip-git-repo-check -C <tmp> "reply ok"`; then `models analyze` (the one real model call, writes and applies `models.json`), `models status --json` non-null, `models apply`, and one more Claude session | `schtasks /query /tn my-flow-models-check` exits 0 after the install; after each CLI `models-state.json` has `lastSpawn.launcher === 'schtasks'` and `models.log` has a `check start` / `check done (pid N)` pair with the same `N`, written after `lastSpawn.at`, with `N === lastCheck.pid` and `lastCheck.at` newer than `lastSpawn.at` (`N === lastSpawn.pid` only under `primary`); after the extra session the `model:` line of each cache `agents/<role>.md` equals `roles.<role>.claude.model` in `~/.my-flow/models.json`, the `model_reasoning_effort =` line of each `~/.codex/agents/<role>.toml` equals `roles.<role>.codex.model_reasoning_effort`, and the `check done` written after that session is preceded by `unchanged` (no re-apply, no second analysis); a `check start` without `check done` under `schtasks` is a blocker to report, not a launcher to switch; no `check start` at all means either SessionStart did not fire (Codex: ask the user to run interactive `codex` once from that directory with `MY_FLOW_MODELS_CHECK_HOURS=0` in their shell and `/exit`) or the task's action failed (`models status` shows the recorded root / node with an `exists` flag; re-run install) |
| Observability | `models.log`, `models-state.json`, `models status`, the summary line, `~/.my-flow/ask/*` artifacts | every branch above asserts on at least one of them; the README troubleshooting row points to `models status` and the log |

## Do-Not-Touch

- `src/` (agent prompts, skills, core document): the roles, their prompts and the flow do not
  change; only `manifest.json` and the generated outputs move.
- `hooks/completion-guard.mjs`, `hooks/lib/stdin.mjs`, `hooks/codex-shim.ps1`,
  `hooks/hooks.json` (no new hook is registered; the SessionStart command stays the same).
- `scripts/spec.mjs`, `scripts/dashboard.mjs`, `scripts/init.mjs`, `scripts/lib/intent.mjs`,
  `scripts/lib/spawn.mjs`, `web/`, `specs/`, `templates/`.
- `scripts/ask.mjs` beyond the single optional `--ask-dir` flag (PLAN-DR option D2); no
  change to provider args, env scrubbing, model selection or artifact format.
- `changes/mf-plan-fast/` and everything under `changes/archive/`.
- At runtime, never written by any script in this change: the repository `manifest.json`,
  `src/`, `agents/`, `codex/` of a development checkout, `~/.claude/settings.json`,
  `~/.codex/config.toml`, `~/.codex/models_cache.json`, `installed_plugins.json`.
- The Task Scheduler store and the task `my-flow-models-check` are written only by
  `install` / `uninstall`; the hook and `check` only call `schtasks /run` and `/query`.

## Rebuild / Re-run After Change

- After editing `manifest.json` or `scripts/build.mjs`: `node scripts/build.mjs`, then
  `node scripts/build.mjs --check` must exit 0 and the generated `agents/*.md`,
  `codex/agents/*.toml` are committed with the change.
- After any script or test edit: `npm test` (which must list `test/models.test.mjs` in
  `package.json`).
- After the change is installed on this machine (user-side, outside the repo):
  `node scripts/install.mjs codex` to replace the pinned `~/.codex/agents/*.toml` with the
  baseline and record `config.json`; `node scripts/install.mjs claude` to record
  `config.json`; update the Claude plugin (`claude plugin update my-flow@my-flow` or
  re-add the marketplace) so the cache carries the new hook and scripts; then
  `node scripts/cli.mjs models status` to confirm both surfaces read `inherit`.
- After `install codex`: open `codex`, run `/hooks` and trust the my-flow entries once
  (Codex 0.154 silently skips new or changed hooks until trusted; `hooks.json` carries no
  `state` key any more, trust lives in `config.toml` `[hooks.state.*]`).
- After the hook change is installed: the manual hook-under-real-CLI check of task 6.2
  (`MY_FLOW_MODELS_CHECK_HOURS=0`, one Claude session and one Codex session, confirm a
  `check` entry in `~/.my-flow/models.log` from a pid other than the hook's and an advanced
  `lastCheck`; then `models analyze` as the one real model call, `models status --json`
  showing a non-null override, `models apply`, plus one more Claude session, after which
  the `model:` line of each cache `agents/<role>.md` equals `roles.<role>.claude.model` in
  `~/.my-flow/models.json`, the `model_reasoning_effort =` line of each
  `~/.codex/agents/<role>.toml` equals `roles.<role>.codex.model_reasoning_effort`, and the
  `check done` written after that session is preceded by `unchanged`; `models reset` is
  available afterwards if the user prefers the baseline). Under the scheduled-task
  launcher (D4, D9) the evidence also includes `schtasks /query /tn my-flow-models-check`
  exiting 0 and `lastSpawn.launcher === 'schtasks'`; re-running `install claude` or
  `install codex` from the current checkout is what re-registers the task after the
  checkout or Node moves.
- The new agent files take effect in the next Claude / Codex session, not the running one.
