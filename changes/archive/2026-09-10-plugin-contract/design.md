## Context

Sub-change 1 of the umbrella `plugin-system-browser-harness`; the umbrella design fixes the
decision level (D2 manifest, D3 registry, D4 verbs and merge points, D5 MCP registration per
host, D6 zero dependencies, D11 tracking). This file fixes the "how" inside those boundaries
and records the decisions the proposal leaves to the agent (`proposal.md:116-124`). U1 (no
dependency in core, default none) and U7 (`install claude` prints, never runs, default print)
stay as recorded user decisions and are not changed here.

### Current state (evidence)

- Dispatch is a static table in `scripts/cli.mjs:19-28`; an unknown or missing command prints
  the usage text and exits 1 (`scripts/cli.mjs:30-42`); the chosen script is spawned with
  `process.execPath` and inherited stdio (`scripts/cli.mjs:44-46`). `uninstall` is the same
  script as `install` with `--uninstall` prepended (`scripts/cli.mjs:44`).
- Tool homes: `CLAUDE_HOME = CLAUDE_CONFIG_DIR || ~/.claude` and `CODEX_HOME = CODEX_HOME ||
  ~/.codex` (`scripts/install.mjs:42-43`). The my-flow home is `MY_FLOW_HOME || ~/.my-flow`
  (`scripts/lib/models.mjs:47`); `claudeHome()` prefers the recorded `config.json` home, then
  `CLAUDE_CONFIG_DIR` (`scripts/lib/models.mjs:48`), `codexHome()` prefers `CODEX_HOME`
  (`scripts/lib/models.mjs:49`). Those three env vars are the documented test seams
  (`scripts/lib/models.mjs:12-14`), so a test can redirect every write to temp directories.
- `install claude` backs up, sets the teams env, upserts the CLAUDE.md block, records the
  home, registers the launcher, then **prints** the plugin commands and exits
  (`scripts/install.mjs:154-183`, the print-not-run precedent at `:176-181`); `uninstall
  claude` prints the `claude plugin disable` line (`scripts/install.mjs:159`).
- `install codex`: skills are copied from `codex/skills/` and `{{MYFLOW_ROOT}}` is replaced
  by the forward-slash repo root (`scripts/install.mjs:296-315`; `--link` junctions skip the
  substitution, `:307,315`); agent TOMLs are copied only when the target is absent or starts
  with `# my-flow agent` (`:318-330`, skip message `:321-323`); the PowerShell shim is written
  (`:333-334`) and takes `-Script <path>` (`hooks/codex-shim.ps1:1,13`); `hooks.json` is
  rebuilt from the template with `{{SHIM}}` / `{{ROOT}}` substituted (`:337-341`), our old
  entries stripped by the `my-flow-shim.ps1` marker (`isOurs`, `:222`; `stripOurHooks`,
  `:232-245`), new groups appended per event (`:344-346`) and a trusted hash computed for
  **every** entry that `isOurs` matches (`:347-354`, hash at `:214-220`, event labels `:212`).
  `config.toml` gets one managed block between `# >>> my-flow managed >>>` and
  `# <<< my-flow managed <<<` (`:46-47`) that is stripped and regenerated wholesale
  (`stripTomlBlock` `:247-253`, block `:360-371`). Uninstall reverses by marker: skills by
  prefix `my-flow-` (`:258-263`, prefix from `manifest.json:4`), agents by header (`:264-270`),
  shim, hooks, block, AGENTS.md (`:271-284`).
- Both install branches call `registerLauncher()` (`scripts/install.mjs:174,383`), which on
  win32 spawns the real `schtasks` binary with `/create /f` (`:55-79`, spawns at `:68,71`;
  delete at `:100`). A real install into a temp home would therefore repoint the user's
  scheduled task; `scripts/lib/models.mjs:125-133,777-787` already accepts a replacement
  binary through `MY_FLOW_SCHTASKS`: whenever the variable is defined, it runs
  `process.execPath <value> <args>`, otherwise `schtasks <args>` (`scripts/lib/models.mjs:130-133`,
  `:784-787`), and `test/models.test.mjs:775-810` uses fake scripts for it.
- Hooks address the plugin root as `${CLAUDE_PLUGIN_ROOT}` in Claude format
  (`hooks/hooks.json:10,21`); the Codex form is the shim call
  `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "{{SHIM}}" -Script "{{ROOT}}/hooks/<script>"`
  (`codex/hooks.template.json:9,20`).
- The build step renders a Codex agent TOML as a header line `# my-flow agent: <name> (...)`,
  `name`, `description`, optional model lines, and `developer_instructions` as a `'''` literal
  string, refusing a body that contains `'''`. Its outputs are committed and `npm run check`
  (`package.json:12`) fails when they drift (`README.md:282`); therefore plugin content, which
  differs per machine, is merged at install time and the build step is not touched.
- The Claude plugin surface shape the fixture must mirror: `.claude-plugin/plugin.json` with
  `name` (`:2`), `skills` (`:17-27`) and `agents` (`:28-33`) and no `mcpServers`;
  `.claude-plugin/marketplace.json` with `name` (`:3`), `owner`, and `plugins[]` whose single
  entry has `name` and `source: "./"` (`:8-21`).
- `installed_plugins.json` lives under `<claude home>/plugins/` and is read by
  `locateClaudeSurface` (`scripts/lib/models.mjs:334-335`); CLI probes use `spawnCli` with a
  15 000 ms timeout and treat a failed spawn as `null` (`scripts/lib/models.mjs:481-492`,
  `scripts/lib/spawn.mjs:29-37`).
- Tests: `node --test` over an explicit file list (`package.json:13`); each test gets a temp
  root (`test/helpers.mjs:17-20`), a clean env (`:39-43`), a 20 s spawn budget (`:45`) and
  git helpers `hasGit` / `gitInit` (`:69-83`). `spec validate` requires the two design
  sections (`scripts/lib/intent.mjs:233-235`) and the task line shape (`:241-246`); delta
  specs need a `## ADDED|MODIFIED|REMOVED Requirements` section and `#### Scenario:` blocks
  with `**WHEN**` / `**THEN**` (`scripts/lib/intent.mjs:185-215`).
- The eight READMEs are hand-written: `README.md:270-282` lists the generated directories
  (`skills/ agents/ .claude-plugin/plugin.json`, `codex/`, `claude/`) and no README is among
  them; the build step's source mentions README only in a comment (its line 9). The seven
  translations mirror the English section order one for one (`## CLI commands` at line 124
  in all eight; `## Dashboard` at `README.md:210` and at line 203 in the translations; the
  intent-layer section follows it), each with a numbered table of contents at lines 24-40.
- `src/core/core.md` has seven numbered sections; `## 7. Paths` is the last (`:118-123`);
  `npm run build` (`package.json:11`) regenerates `claude/CLAUDE.block.md` and
  `codex/AGENTS.block.md` from it.
- Machine: Windows 11, Node v24.1.0; `package.json:15-17` requires `>=20`.

## Goals / Non-Goals

**Goals:**

- A validated plugin manifest (`my-flow-plugin.json`) with exact rules and error texts.
- A per-user registry under the my-flow home and the five `plugin` verbs plus
  plugin-contributed verb dispatch, all zero-dependency.
- `install codex` / `uninstall codex` / `install claude` / `uninstall claude` handling every
  enabled plugin through the existing marker mechanisms, with `--dry-run` parity.
- A dependency-free fixture plugin and `test/plugin.test.mjs` covering the success criteria
  under temporary homes only.
- The D2 spike recorded here (result or "pending"), without the executor running any
  `claude plugin` / `claude mcp` command.
- Documentation in `src/core/core.md` and the eight READMEs.

**Non-Goals:**

- Everything in `proposal.md` `## Non-Goals`: no browser code, no Stagehand, no MCP protocol
  implementation in the core (the fixture echo server is test-only), no build-step change, no
  `manifest.json` field, no npm or marketplace publishing.
- No `codex mcp add` execution and no direct edit of `~/.claude.json`; Codex is configured
  through the managed block, Claude through printed commands (U7).
- No change to the model-routing layer: `models apply` keeps re-rendering the four core roles
  only; plugin agents are outside its scope.
- No plugin enable/disable per project; the registry is per user (D3).

## Decisions

### PLAN-DR

**Principles**
1. Core stays zero-dependency and machine-independent: per-user data lives under the my-flow
   home or the tool homes, never in committed generated files (umbrella principle 1).
2. Reuse the existing install machinery: managed markers, `isOurs`, the managed TOML block,
   backup, `--dry-run`, uninstall by marker. Add exactly one new marker (a file inside a
   copied plugin skill directory) and nothing else.
3. Never run a host CLI that mutates host state from inside a session: Claude commands are
   printed (U7); `plugin list` spawns only read-only probes (`claude mcp get`) with a timeout
   and a test seam.
4. Refuse at registration time, not at install time: every collision that can be detected
   from the manifest and the registry (core commands, verbs, prefixes, server names, roles)
   is an error in `plugin add`, so `install` only has to handle the host's own files.
5. Tests touch temporary homes only; every write path is reachable through
   `MY_FLOW_HOME`, `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and the launcher seam.

**Decision drivers (top 3)**
1. `npm run check` and committed generated output forbid plugin content in the build step
   (umbrella driver 1): all merging happens in `install`.
2. Codex rejects a `config.toml` with a duplicate table and the whole my-flow hook trust would
   be lost with it (umbrella D4): duplicate detection and strict key validation are mandatory.
3. `uninstall codex` must remove exactly what `install codex` wrote even when the registry
   entry is gone: removal must be driven by markers in the host files, not by the registry.

**Viable options** are listed under each decision (chosen first, rejected with reason).

### D1. File split: `scripts/plugin.mjs` (CLI) plus `scripts/lib/plugins.mjs` (library)

Chosen: the verbs live in `scripts/plugin.mjs` as the proposal says (`proposal.md:37`); the
shared logic (registry read / write, manifest loading and validation, placeholder
substitution, verb lookup, Codex renderers, Claude command lines) lives in
`scripts/lib/plugins.mjs`, imported statically by `scripts/plugin.mjs` and
`scripts/install.mjs`, and by `scripts/cli.mjs` only through a dynamic `await import()`
that runs when `cmd` is not in the core table or when the usage text is printed (D6), so
core commands keep today's startup path and a corrupt registry can never break `my-flow
build`. Reason: `install.mjs` already imports its shared logic from `scripts/lib/models.mjs`
(`scripts/install.mjs:27`), and `cli.mjs` must resolve a contributed verb in-process rather
than spawn a second script for a lookup. Both files use `node:fs`, `node:path`, `node:os`,
`node:child_process`, `node:url` only (D6, U1 default).

Rejected: a single `scripts/plugin.mjs` that `install.mjs` spawns (two processes per install
and no way to share the renderers); putting the logic into `scripts/lib/models.mjs` (that file
is the model-routing layer and is 800 lines already).

### D2. Manifest validation rules and error texts

`loadManifest(root)` reads `<root>/my-flow-plugin.json` and returns `{ manifest, errors,
warnings }`; `plugin add` prints every error as `plugin add: <root>/my-flow-plugin.json:
<message>` on stderr and exits 1 when `errors` is non-empty (all errors, not only the first,
so a plugin author fixes them in one round). Rules:

| Field | Rule | Error text (after the file prefix) |
|---|---|---|
| file | must exist and parse as a JSON object | `missing my-flow-plugin.json` / `invalid JSON: <reason>` |
| `name` | required; `^[a-z0-9]+(-[a-z0-9]+)*$`; not a core command (`build install uninstall init ask spec dashboard models plugin`, exported as one constant `CORE_COMMANDS`) | `name is required and must be kebab-case` / `name "<n>" collides with core command "<n>"` |
| `version` | required; `^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$` | `version must be semver` |
| `description` | required non-empty string | `description is required` |
| `myFlow` | optional; `^>=?\d+\.\d+\.\d+$`; compared with `package.json` `version` | malformed: `myFlow must look like ">=0.1.0"`; unsatisfied: **warning** `plugin wants my-flow <range>, installed 0.1.0` (informational: the core is 0.1.0 and nothing else is enforced) |
| `node` | optional string, printed by `plugin list`, never enforced | none |
| `codexSkillPrefix` | optional; default `<name>-`; `^[a-z0-9][a-z0-9-]*-$`; must not be exactly the core prefix from `manifest.json:4` (`my-flow-`); no resulting `<prefix><skill>` directory name may equal a core Codex skill directory name (`<manifest.json codexSkillPrefix><skill key>` for every key of `manifest.json` `skills`, the nine `codex/skills/my-flow-*` directories), because the core install loop iterates the core source directory (`scripts/install.mjs:298`) and would `replace` such a target (`:301-303`) while the plugin step would then find an unmarked directory and skip it; a directory name that merely starts with `my-flow-` is never touched by the core install, and `uninstall codex` removes plugin directories by marker anyway (D8), so `my-flow-browser-` (umbrella D2) is legal by construction; must not be used by another registered plugin | `codexSkillPrefix must be kebab-case and end with "-"` / `codexSkillPrefix "my-flow-" is reserved for the core` / `skill "<prefix><skill>" collides with the core skill directory "<dir>"` / `codexSkillPrefix "<p>" is already used by plugin "<other>"` |
| `contributes.skills` | optional array of relative directories; each must exist; each child directory containing `SKILL.md` is one skill; skill names kebab-case | `contributes.skills[<i>]: directory "<d>" not found` / `skill "<s>" is not kebab-case` |
| `contributes.agents` | optional array of relative directories; each `<role>.md` must carry a `description:` frontmatter line and a body without `'''`; role must not be a core role (`manifest.json` `agents` keys via `ROLES`, `scripts/lib/models.mjs:38`) and must not be contributed by another registered plugin | `agent "<role>.md": missing description` / `agent "<role>.md": body must not contain '''` / `agent "<role>" collides with core agent "<role>"` / `agent "<role>" is already contributed by plugin "<other>"` |
| `contributes.hooks` | optional relative path to a JSON file `{ hooks: { <Event>: [ { matcher?, hooks: [ { type: "command", command, timeout? } ] } ] } }`; events limited to the seven `EVENT_LABEL` keys (`scripts/install.mjs:212`); every command must have the form `node "${CLAUDE_PLUGIN_ROOT}/<relative path>"` and the file must exist | `hooks: unknown event "<E>"` / `hooks: command must be node "${CLAUDE_PLUGIN_ROOT}/<script>" (got: <cmd>)` / `hooks: script "<p>" not found` |
| `contributes.cli` | optional object verb -> relative script; verb `^[a-z0-9]+(-[a-z0-9]+)*$`, not in `CORE_COMMANDS`, not contributed by another registered plugin; script must exist | `cli verb "<v>" collides with core command "<v>"` / `cli verb "<v>" is already contributed by plugin "<other>"` / `cli "<v>": script "<p>" not found` |
| `contributes.mcpServers` | optional object name -> `{ command (required string), args (array of strings, default []), env (object of string -> string, default {}), cwd (string, default "${PLUGIN_ROOT}"), startupTimeoutSec (positive integer, optional) }`; server name and env keys `^[A-Za-z0-9_-]+$` (bare TOML keys, MCP-safe); name not contributed by another registered plugin | `mcpServers.<n>: command is required` / `mcpServers name "<n>" must match [A-Za-z0-9_-]` / `mcpServers.<n>.env key "<k>" must match [A-Za-z0-9_-]` / `mcpServers "<n>" is already contributed by plugin "<other>"` |
| placeholders | inside `mcpServers` values (`args`, `env` values, `cwd`) the only `${...}` token allowed is `${PLUGIN_ROOT}` | `mcpServers.<n>: unknown placeholder ${X}; only ${PLUGIN_ROOT} is substituted` |
| `setup` | optional string, printed, never executed | none |
| `setupCheck` | optional relative path, default `node_modules` | none |
| Claude layout | when `contributes.skills`, `agents` or `hooks` is non-empty: `.claude-plugin/plugin.json` must exist, its `name` must equal `name`, it must not contain `mcpServers`, and `<root>/.mcp.json` must not exist; `.claude-plugin/marketplace.json` must exist with a `name` and a `plugins[]` entry whose `name` equals `name` | `.claude-plugin/plugin.json is missing` / `.claude-plugin/plugin.json must not declare mcpServers (declare them in my-flow-plugin.json)` / `.mcp.json is not allowed; declare MCP servers in my-flow-plugin.json` / `.claude-plugin/marketplace.json must list plugin "<name>"` |
| unknown top-level keys | warning `unknown field "<k>" ignored` | |

Skill and hook files keep `${CLAUDE_PLUGIN_ROOT}` (Claude resolves it, umbrella D2); the
Codex copy rewrites it. `${PLUGIN_ROOT}` is substituted with the absolute plugin root using
forward slashes on both surfaces (precedent `scripts/install.mjs:312`).

Rejected: a JSON-schema file (a validator is a dependency or a second implementation);
enforcing `node` and `myFlow` ranges (a wrong refusal would block the only plugin this
programme has; the values are hints and are shown by `plugin list`).

### D3. Registry layout, clone location, `--name`

`<MY_FLOW_HOME>/plugins.json` (umbrella D3):

```
{ "version": 1,
  "plugins": { "<key>": { "path": "<abs, forward slashes>", "source": "<path or url as given>",
                          "enabled": true, "added": "<iso>", "version": "<manifest version>",
                          "cloned": false } } }
```

- `cloned` (added field, within `proposal.md:120-121`) is `true` only when my-flow ran
  `git clone`; `plugin remove` deletes `<MY_FLOW_HOME>/plugins/<key>/` only then, never a
  user path.
- A source is a git URL when it matches `^(https?|ssh|git|file)://`, starts with `git@`, or
  ends with `.git`; otherwise it is a local path that must exist. Git sources are cloned by
  `spawnSync('git', ['clone', '--depth', '1', url, tmp])` (precedent
  `test/helpers.mjs:73-83`) into `<MY_FLOW_HOME>/plugins/.tmp-<pid>/`, validated, then renamed
  to `<MY_FLOW_HOME>/plugins/<key>/`; on validation failure the temp clone is deleted.
  Local paths are recorded resolved and absolute; nothing is copied.
- Registry key: `--name <n>` when given (kebab-case, same collision rules as `name`),
  otherwise the manifest `name`. Adding a key that exists is refused (`plugin "<key>" is
  already registered; remove it first`). Collision checks against other registered plugins
  (D2) run against all entries, enabled or not.
- Writes are atomic: write `plugins.json.tmp`, then `renameSync` (precedent
  `scripts/lib/models.mjs` state writes). Read side: a missing file is an empty registry; an
  unparsable file is an empty registry with a stderr warning for `list` and verb dispatch, and
  an error (exit 1, naming the file) for `add` / `remove` / `enable` / `disable`, so a corrupt
  file is never silently overwritten. A `version` other than 1 is an error.

Rejected: recording installed-surface state in the registry (would go stale and is
reconstructible by probing, D5); a per-project registry (umbrella D3).

### D4. `plugin` verbs, output text, exit codes

Dispatched by adding `plugin: 'plugin.mjs'` to the table (`scripts/cli.mjs:19-28`) and one
usage line `plugin add|remove|list|enable|disable ...  register plugin repositories
(my-flow-plugin.json)` (`:31-40`). All verbs exit 0 on success, 1 on a refused operation, 2 on
bad usage (matching `scripts/install.mjs:38-39`).

- `plugin add <path|git-url> [--name <n>] [--dry-run]`: validate (D2), record (D3), print:
  ```
  added <key> <version> (<abs path>) -> <registry path>
  setup (run it yourself; my-flow never executes it): <setup line>      (only when set)
  setup: pending (<setupCheck> missing under <abs path>)   |   setup: ok
  next: node "<my-flow root>/scripts/cli.mjs" install codex
        node "<my-flow root>/scripts/cli.mjs" install claude
  ```
  `--dry-run` validates a local path and prints `[dry-run] would add ...` without writing; for
  a git source it prints `[dry-run] would clone <url> into <dir>; manifest validation skipped
  (dry-run does not clone)` and exits 0.
- `plugin remove <name>`: drop the entry, delete the clone when `cloned`, print `removed
  <name>` and `next: ... install codex  (refreshes the Codex surface)` plus, when the plugin
  has MCP servers, `claude mcp remove <server>` lines (umbrella D4). Unknown name: exit 1,
  `plugin "<name>" is not registered`.
- `plugin enable|disable <name>`: flip `enabled`, print `<name> enabled|disabled` and the two
  install commands. Unknown name: exit 1.
- `plugin list [--json]` (D5 below).

Rejected: `plugin add` also running `install` (install needs its own backup and dry-run
choices; the printed commands keep one step per decision).

### D5. `plugin list` layouts and the three state probes

Text (one block per plugin, registry order; `no plugins registered (my-flow plugin add
<path|git-url>)` when empty):

```
<name> <version> [enabled|disabled] <abs path>
  source: <source>            node: <node hint>          (node only when set)
  setup: ok | pending (<setupCheck> missing; run: <setup line>)
  claude: installed | not installed (<detail>) | unknown (claude not found)
  codex: installed | not installed | partial (skills <k>/<n>, mcp <k>/<n>)
  verbs: <verb> [, <verb>]
  mcp: <server>: <command> <args...> (cwd <cwd>)
  path: missing                                          (only when the path is gone)
```

JSON (`--json`, stdout only, exit 0):

```
{ "version": 1, "registry": "<path>", "plugins": [ {
    "name", "version", "description", "path", "source", "enabled", "added", "cloned",
    "node": "<hint>|null", "pathExists": true,
    "setup": { "state": "ok|pending", "check": "<setupCheck>", "command": "<setup>|null" },
    "claude": { "state": "installed|not installed|unknown", "detail": "<text>" },
    "codex": { "state": "installed|not installed|partial", "skills": { "<dir>": true|false },
               "mcpServers": { "<server>": true|false } },
    "cli": { "<verb>": "<abs script>" },
    "mcpServers": { "<server>": { "command", "args": [<substituted>], "cwd", "env", "startupTimeoutSec": <n>|null } }
} ] }
```

`mcpServers` carries the substituted absolute values so any other MCP client can paste them
(umbrella D5).

Probes:
- Setup: `setup: pending` while `<path>/<setupCheck>` does not exist (default
  `node_modules`), otherwise `ok`.
- Claude: `installed` when `<claude home>/plugins/installed_plugins.json` (read the way
  `scripts/lib/models.mjs:334-347` reads it, array or map, key `<name>@<marketplace name>`)
  lists the plugin **and** `claude mcp get <server>` exits 0 for every server (spawned with
  `spawnCli`, `scripts/lib/spawn.mjs:29`, timeout 10 000 ms per server); `not installed
  (<detail>)` when `claude` ran but a condition failed (detail names the first failing one:
  `not in installed_plugins.json` or `claude mcp get <server> exited <n>`); `unknown (claude
  not found)` when the spawn errors or times out (the literal string required by the
  proposal, `proposal.md:42-43`). Test seam `MY_FLOW_PLUGIN_FAKE_CLAUDE` (precedent
  `MY_FLOW_MODELS_FAKE_VERSIONS`, `scripts/lib/models.mjs:12-14`): `missing` means no spawn and
  state `unknown (claude not found)`; a comma-separated list of server names means those
  `claude mcp get` calls "exit 0" and all others "exit 1", without spawning.
- Codex: `<codex home>/skills/<prefix><skill>/SKILL.md` present for every skill and
  `[mcp_servers.<server>]` present inside the managed block of `<codex home>/config.toml` for
  every server; all true = `installed`, none = `not installed`, otherwise `partial`.

Rejected: a table layout (paths are long on Windows and wrap badly); probing Codex with
`codex mcp get` (a plain file read is enough and needs no spawn).

### D6. Contributed verb dispatch in `cli.mjs`

When `cmd` is not in the core table, `cli.mjs` loads the library with
`await import('./lib/plugins.mjs')` (never on the core path: `my-flow build --check` with a
corrupt `plugins.json` behaves exactly as today) and calls `resolvePluginVerb(cmd)`: it
reads the registry, and for each **enabled** plugin whose manifest still loads
and whose `contributes.cli` has the verb, returns `{ plugin, root, script }`. Then
`spawnSync(process.execPath, [script, ...rest], { stdio: 'inherit', env: { ...process.env,
MY_FLOW_PLUGIN_ROOT: root } })` and `process.exit(r.status ?? 1)`, mirroring
`scripts/cli.mjs:45-46`; cwd is inherited (plugin verbs act on the user's project). Core
commands always win (they are checked first). When the verb belongs to a **disabled** plugin
the usage text is printed plus `note: "<verb>" is contributed by plugin "<name>", which is
disabled (my-flow plugin enable <name>)` on stderr, exit 1. When the script file is missing:
`plugin "<name>": script <abs> is missing; run my-flow plugin add again`, exit 1. Unknown
verbs keep the current behaviour: usage, exit 1 (`scripts/cli.mjs:30-42`). The usage text
appends one line per enabled plugin verb: `  <verb> ...   (plugin <name>)`.

Rejected: registering plugin verbs into the static table at build time (per-machine data in
committed output, driver 1).

### D7. `install codex`: plugin rendering, markers, order

Each enabled plugin is rendered after the corresponding core step, all of it inside the
existing `install` branch and inside the `--dry-run` discipline (`log` / `write`,
`scripts/install.mjs:49,115-120`; every action prints `add` / `replace` / `remove` / `skip`
/ `write` lines and dry-run writes nothing).

**Failure path (applies to `install codex`, `uninstall codex`, `install claude` and
`uninstall claude`):** the registry is read once at the start of the install branch; an
unreadable registry is treated as empty with a stderr warning (the same rule as D3 `list`);
a plugin whose `path` is missing or whose manifest has errors is skipped with
`skip plugin <name>: <first error>` (for a missing directory the error is `path <abs> is
missing`) and the core install continues; a plugin failure never aborts the core install and
never changes its exit code. `<name>` is the registry key; `<abs>` is the forward-slash
path stored in the registry.

Path forms: every `add` / `replace` / `remove` / `skip` / `write <path>` line prints the
`join()` path (backslashes on Windows, e.g. `[dry-run] add C:\...\skills\plugin-demo-demo`),
so tests build the expected text with `join(CODEX_HOME, 'skills', 'plugin-demo-demo')`; every
plugin-root path (the `skip plugin` line, `-Script`, the printed claude commands, `args`) is
the forward-slash registry path.

Steps:

1. **Stale plugin content is removed first**, so a disabled or removed plugin disappears on
   the next install: every `<codex home>/skills/*/` directory containing the marker file
   `.my-flow-plugin` and every `<codex home>/agents/*.toml` whose first line matches
   `^# my-flow agent: \S+ \(plugin ` is deleted (logged as `remove <path>`).
2. **Skills** (after the core loop, `scripts/install.mjs:296-315`): for each skill directory
   `<dir>/<skill>/` of each `contributes.skills` entry, copy to `<codex home>/skills/<prefix><skill>/`
   (`cpSync` recursive, always copy even with `--link`, note logged once: `note: plugin skills
   are always copied so their placeholders can be rewritten`), then rewrite `SKILL.md`: the
   frontmatter `name:` becomes `<prefix><skill>` (the core does the same: `skills/spec/SKILL.md:2`
   vs `codex/skills/my-flow-spec/SKILL.md:2`), `${CLAUDE_PLUGIN_ROOT}` -> absolute root with
   forward slashes, `/<plugin name>:<skill>` -> `$<prefix><skill>` for every skill of that
   plugin, and write the marker file `.my-flow-plugin` containing `<plugin name>\n`. An
   existing directory without the marker is skipped with `skip <path> (exists and is not
   managed by my-flow; remove it first to replace)` (same wording as `:322`). Dry-run
   consistency: under `--dry-run` step 1 removes nothing, so an existing target that carries
   the marker is logged `replace <path>` (the core wording at `:302`), and only a target
   without the marker is `skip`ped; a second `install codex --dry-run` after a real install
   therefore prints `replace` for the plugin skill, never `skip`.
3. **Agents** (after `:318-330`): for each `<role>.md`, write `<codex home>/agents/<role>.toml`
   with the same TOML rendering the build step uses: header
   `# my-flow agent: <role> (plugin <plugin name>, written by my-flow install codex - edit <abs root>/agents/<role>.md instead)`,
   `name = "<role>"`, `description = <JSON string>`, `developer_instructions = '''\n<body>'''`
   where the body gets the same rewrites as skills; no model lines (inherit baseline). An
   existing file whose first line does not start with `# my-flow agent` is skipped with the
   `:322` wording. The header keeps the `# my-flow agent` prefix so the core's own check
   (`:266,321`) recognises it as managed.
4. **Hooks** (between the template merge `:344-346` and the trust loop `:347-354`): each
   handler command `node "${CLAUDE_PLUGIN_ROOT}/<script>"` is rewritten to
   `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "<shimPath>" -Script "<abs root>/<script>"`
   built as a JavaScript string after JSON parsing, with `shimPath` inserted verbatim (single
   backslashes) and the plugin root in forward slashes; it is the same in-memory shape the
   core entries have after the template substitution (`:339-340`), and `JSON.stringify` at
   `:358` does the escaping when `hooks.json` is written. The group is appended to
   `doc.hooks[<event>]` **after** the core groups, so the core's `[hooks.state.*]` indices
   stay stable; the existing trust loop (`:347-354`) hashes that same in-memory string because
   `isOurs` matches the shim path (`:222`). `stripOurHooks` already removes it on the next
   install and on uninstall (`:232-245,342`). Each appended plugin handler is logged through
   `log` as `add hook <Event>: <command>`.
5. **MCP servers** (inside the managed block, `:363-369`, after the `[hooks.state.*]` entries):
   ```
   # Plugin MCP servers (regenerated by `my-flow install codex`; registry: <MY_FLOW_HOME>/plugins.json)
   [mcp_servers.<server>]
   command = "<command>"
   args = ["<arg>", ...]
   cwd = "<cwd>"
   startup_timeout_sec = <n>            (only when startupTimeoutSec is set)
   [mcp_servers.<server>.env]           (only when env is non-empty)
   <KEY> = "<value>"
   ```
   Strings are emitted with `JSON.stringify` (valid TOML basic strings for every escape JSON
   produces; the build step uses the same for `name` / `description`), paths use forward
   slashes. **Duplicate rule:** before emitting a table, the unmanaged text (what
   `stripTomlBlock` returned, `:361`) is scanned with
   `^\s*\[mcp_servers\.(?:<server>|"<server>"|'<server>')(?:\.[^\]]*)?\]` (multiline); on a match
   the server is skipped and the line
   `skip [mcp_servers.<server>]: defined outside the my-flow block; remove it first to let my-flow manage it`
   is logged (dry-run prefix included), mirroring `:321-323`. Because the whole block is
   regenerated on every install and stripped on uninstall (`:247-253,361`), no new marker is
   needed for MCP tables. Each emitted table is logged through `log` as
   `add [mcp_servers.<server>]` followed by every table line indented two spaces, so
   `--dry-run` prints the table text; for a skipped server the single `skip
   [mcp_servers.<server>]: ...` line replaces the `add [mcp_servers.<server>]` line and its
   table lines, so the dry-run text for the planted-table scenario contains no `add` line
   for that server.
6. The closing message (`:385-390`) gains one line per enabled plugin: `plugin <name>: skills
   <prefix>*, mcp <server list>`.

`install codex --dry-run` prints all of the above without writing (success criterion 2).

Rejected: a second managed block for plugins (two blocks to strip, no gain); recording the
written files in the registry (stale after `plugin remove`, driver 3); a marker in the
SKILL.md frontmatter (a YAML comment might not survive Codex's parser; a dotfile is inert).

### D8. `uninstall codex`

Adds to the existing branch (`scripts/install.mjs:256-288`): remove every skill directory
carrying `.my-flow-plugin`, every agent TOML whose first line matches the plugin header
regex (D7 step 1); the shim, hooks and TOML block steps already remove plugin hooks and MCP
tables by marker (`:271-283`). No registry read is needed, so a plugin removed from the
registry after install still gets cleaned (driver 3). A user directory that merely starts
with a plugin's prefix but has no marker is never touched.

### D9. `install claude` and `uninstall claude` print only

After the existing "Next steps" block (`scripts/install.mjs:176-181`), one block per enabled
plugin, printed in both dry-run and real mode (nothing is executed either way):

```
plugin <name> (run in a terminal, not inside a Claude session):
  claude plugin marketplace add "<abs root>"
  claude plugin install <plugin.json name>@<marketplace.json name>
  claude mcp add --transport stdio --scope user <server> [--env KEY=value ...] -- <command> "<arg>" ...
```

Args are substituted (`${PLUGIN_ROOT}` -> absolute root) and quoted. One `claude mcp add`
line per server. The D7 failure path applies: an unreadable registry is empty with a
warning, a plugin with a missing path or a broken manifest is reported as `skip plugin
<name>: <first error>` and the core Claude install continues with its normal exit code.
`uninstall claude` (`:155-161`) prints, per registered plugin with servers,
`claude mcp remove <server>` and `claude plugin disable <name>@<marketplace>`. A plugin with
no `contributes.skills|agents|hooks` prints only the `claude mcp add` lines. The `--env`
flag spelling could not be verified in this session (the umbrella recorded the command form
without env, umbrella Context "Host mechanisms"); the fixture declares no `env`, so tests do
not depend on it, and the executor must not run `claude mcp add --help` to check it (the
user may).

### D10. Launcher seam for tests: `MY_FLOW_SCHTASKS` in `install.mjs`

The integration test performs a real `install codex` and `uninstall codex` into a temp
`CODEX_HOME`, which would otherwise call the real `schtasks /create /f` and repoint the
user's task (`scripts/install.mjs:55-79`). Chosen: a small `schtasks(args)` helper in
`install.mjs` that honours `MY_FLOW_SCHTASKS` exactly as `scripts/lib/models.mjs:130-133`
and `:784-787` implement it: whenever `MY_FLOW_SCHTASKS` is defined, spawn
`process.execPath <value> <args>`; otherwise spawn `schtasks <args>`; no keying on a file
suffix. The helper replaces the three direct spawns at `:68`, `:71` (`registerLauncher`) and
`:100` (`unregisterSurface`, so uninstall goes through the seam too); the test passes a fake
script that exits 0 and records its argv. Documented in the header comment of `install.mjs`.
Rejected: a new "skip launcher" env (a second seam for the same thing); dry-run-only tests
(cannot prove byte-for-byte removal).

### D11. Fixture plugin and test layout

`test/fixtures/plugin-demo/` (never executed by `npm test` as a test file because
`package.json:13` lists test files explicitly; the header comment of `test/plugin.test.mjs`
states that rule so nobody switches to a bare `node --test`, which would pick up
`test/fixtures/**`):

```
my-flow-plugin.json           name plugin-demo 0.1.0, myFlow ">=0.1.0", node ">=20",
                              contributes: skills ["skills"], agents ["agents"], hooks "hooks/hooks.json",
                              cli { "demo-hello": "scripts/hello.mjs" },
                              mcpServers { "plugin-demo": { command "node", args ["${PLUGIN_ROOT}/server/mcp.mjs"],
                                                            cwd "${PLUGIN_ROOT}", startupTimeoutSec 20 } },
                              setup "echo demo setup", setupCheck default (node_modules -> pending)
.claude-plugin/plugin.json    name plugin-demo, version, description, skills ["./skills/demo/"], agents ["./agents/demo-reviewer.md"]; no mcpServers
.claude-plugin/marketplace.json  name plugin-demo, owner, plugins [{ name plugin-demo, source "./", version }]
skills/demo/SKILL.md          frontmatter name demo; body mentions /plugin-demo:demo, ${CLAUDE_PLUGIN_ROOT}/README.md and `my-flow demo-hello`
agents/demo-reviewer.md       frontmatter description; short read-only body
hooks/hooks.json              SessionStart matcher startup|resume|clear -> node "${CLAUDE_PLUGIN_ROOT}/hooks/demo-hook.mjs", timeout 10
hooks/demo-hook.mjs           reads stdin, prints {} and exits 0 (plain Node)
scripts/hello.mjs             prints `hello from plugin-demo at <MY_FLOW_PLUGIN_ROOT>` and the argv rest, exit 0
server/mcp.mjs                newline-delimited JSON-RPC over stdio: `initialize` -> { protocolVersion: <echoed from the request>,
                              capabilities: { tools: {} }, serverInfo: { name: "plugin-demo", version: "0.1.0" } };
                              `tools/list` -> one tool `echo` with an object schema;
                              `tools/call` with name `echo` -> { content: [{ type: "text", text: <arguments.text> }] };
                              `ping` -> {}; `notifications/initialized` and other notifications accepted silently;
                              anything else -> error -32601; any logging goes to stderr only; exits on stdin end
```

`test/plugin.test.mjs` follows `test/spec.test.mjs`: `node:test`, `makeTmp` per test, every
spawn with `cleanEnv({ MY_FLOW_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, MY_FLOW_PLUGIN_FAKE_CLAUDE,
MY_FLOW_SCHTASKS })` so the real homes are never read or written (`scripts/install.mjs:42-43`,
`scripts/lib/models.mjs:47-49`), spawning `scripts/cli.mjs`, `scripts/plugin.mjs`,
`scripts/install.mjs` and the fixture server as child processes. Tests that need `git` skip
when `hasGit()` is false (`test/helpers.mjs:69`). The `ok` setup state is observed on a temp
copy of the fixture with an empty `node_modules/` directory created by the test.

Rejected: generating the fixture at test time (a real directory is what a plugin author
copies); a fixture with dependencies (nothing to install in CI).

### D12. Documentation placement

- `src/core/core.md`: new `## 8. Plugins` after `## 7. Paths` (`:118-123`), about eight lines:
  what a plugin is (`my-flow-plugin.json` at the root of a separate repository, also a Claude
  plugin, MCP servers declared once in the manifest), the verbs, the install flow (`plugin add`
  -> printed `setup` -> `install codex` / the printed Claude commands), and the rule that
  plugin skills call dependency-bearing code only through `my-flow <verb>`.
- Each of the eight READMEs: a row for `plugin add|remove|list|enable|disable` in the CLI
  table, placed after the `models` row (line 143 in all eight files) and a new `## Plugins` section placed directly before
  the intent-layer section (after `## Dashboard`), plus its table-of-contents entry (lines
  24-40), numbering shifted. Translations are written in their language; the command lines,
  file names and the warning text stay in English.

### Spike result (D2)

The executor wrote the user-run instructions to `.my-flow/tmp/plugin-contract-spike.md` and
never runs `claude plugin ...` or `claude mcp ...` itself. Either answer keeps the D2 rule
that plugin skills reach dependency-bearing code only through `my-flow <verb>`; the spike
only records whether that rule is load-bearing.

spike pending: user has not run the commands

## Risks / Trade-offs

### Pre-mortem (three scenarios)

1. **"Codex refused the whole config.toml."** A plugin server name with a dot, an env key with
   a space, or a table that already existed outside the block made Codex reject the file, and
   with it every my-flow hook trust entry. Mitigations: D2 restricts server names and env keys
   to bare-key characters; D7 skips any server whose table exists outside the block and prints
   the exact warning; the integration test asserts that after install every
   `[mcp_servers.<server>]` header occurs exactly once in the file and that the block text
   equals the expected rendering; the block is regenerated wholesale so a bad render never
   accumulates.
2. **"Uninstall left ghosts, or deleted the user's own skill."** A plugin removed from the
   registry left its Codex skill behind, or a user directory named `plugin-demo-notes` was
   wiped. Mitigations: removal is marker-driven (`.my-flow-plugin` file, plugin agent header,
   `isOurs`, managed block), not registry-driven (D7, D8); an unmarked directory is skipped
   with a logged reason; the integration test plants an unmarked `<prefix>keep/` directory and
   a user `[mcp_servers.other]` table and asserts both survive install and uninstall byte for
   byte.
3. **"The verb ran the wrong code."** A plugin directory was moved, a disabled plugin's verb
   still ran, or a later core command was shadowed by a plugin verb. Mitigations: core
   commands are matched first (D6); disabled plugins are never consulted for dispatch; a
   missing script exits 1 with a message naming the plugin; `plugin list` shows `path:
   missing`; `plugin add` refuses core-command collisions today, and the core-command list
   lives in one exported constant so a future core verb is checked in the same place.

### Other risks and trade-offs

- **Print-not-run on Claude** (U7): three manual commands per plugin; accepted, and the
  `--env` flag spelling stays unverified until the user runs the printed line (D9).
- **Windows-only shim**: plugin hooks on Codex inherit the PowerShell shim the core already
  relies on (`scripts/install.mjs:333-334`); on other platforms the same limitation applies
  to the core and is not new.
- **`--link` asymmetry**: core skills may be junction-linked, plugin skills are always
  copied because their placeholders must be rewritten (D7); a note is logged.
- **Probe cost**: `plugin list` may spawn `claude mcp get` once per server with a 10 s cap;
  `--json` consumers that need speed can set `MY_FLOW_PLUGIN_FAKE_CLAUDE=missing`.
- **Marker file inside a skill directory**: Codex reads `SKILL.md`; a dotfile is expected to
  be inert. If a future Codex release lists it, the marker can move to a sidecar
  `<prefix><skill>.my-flow` file without changing the contract (uninstall reads the marker
  through one helper).
- **Spike may stay pending**: the design and the code do not depend on the answer; the
  pending line is an honest record, not a blocker (task 4.1).

## Test Plan

**Unit (`test/plugin.test.mjs`, library functions and `plugin.mjs` as child processes):**
manifest validation on the fixture (no errors) and on mutated temp copies: missing `name`,
non-semver `version`, `cli` verb `spec` (core collision), `codexSkillPrefix` `my-flow-`
(reserved for the core), prefix `my-` with a skill `flow-spec` (resulting directory
`my-flow-spec` equals a core Codex skill directory), unknown placeholder `${HOME}` in `args`,
`.mcp.json` present, `mcpServers` in `plugin.json`, each producing the D2 text and exit 1;
setup never executed: a mutated copy whose `setup` is `node <temp>/sentinel.mjs` (a script
that writes `<temp>/sentinel.txt`) is added and the sentinel file does not exist afterwards
while stdout carries the printed line; registry round trip `add` -> `list --json` (`enabled:
true`, `setup.state: pending`) -> `disable` -> `enable` -> `remove` under a temp
`MY_FLOW_HOME`, then `list` with a second temp home not listing it; `add` of the same key
twice refused; `add --dry-run` writes nothing; `add file://<temp git repo>` clones under
`<MY_FLOW_HOME>/plugins/plugin-demo/` and `remove` deletes the clone (skipped without git);
`${PLUGIN_ROOT}` substitution; the Codex skill rewrite (`/plugin-demo:demo` ->
`$plugin-demo-demo`, `${CLAUDE_PLUGIN_ROOT}` -> root); the agent TOML text (header, literal
string); the `[mcp_servers.plugin-demo]` block text; the fixture MCP server answering
`initialize` (protocolVersion echoed), `tools/list` (tool `echo`), `tools/call` for `echo`
(text echoed back) and `ping` over stdio, with nothing written to stdout that is not a
JSON-RPC response.

**Integration (child processes, temp homes, `MY_FLOW_SCHTASKS` fake):** `install codex
--dry-run` with the fixture registered prints `add <CODEX_HOME>/skills/plugin-demo-demo`, the
agent TOML target, the hook `-Script` line, `[mcp_servers.plugin-demo]` and writes nothing;
with an unmanaged `[mcp_servers.plugin-demo]` planted in `config.toml` it prints the exact
skip warning and the block contains no second table; a real `install codex` then `uninstall
codex` leaves the planted `config.toml`, `hooks.json`, `<prefix>keep/` directory and user
`[mcp_servers.other]` table byte-identical and no `.my-flow-plugin` marker behind; after
`plugin disable`, `install codex` removes the plugin skill and agent; a second `install codex
--dry-run` after a real install prints `replace` for `skills/plugin-demo-demo`, not `skip`;
with a registered plugin whose directory was deleted afterwards, `install codex` exits 0 and
prints `skip plugin plugin-demo: path <abs> is missing` while the core files are still
written; with a corrupt `plugins.json` (`{`), `install codex --dry-run` exits 0 with a
stderr warning and `cli.mjs build --check` exits exactly as with no registry; `install
claude --dry-run` prints the three commands with the absolute fixture path and
`CLAUDE_CONFIG_DIR` gets no new file; Claude commands are never executed: a temp directory
holding a fake `claude.cmd` (and a `claude` shell script for non-Windows) that writes
`<temp>/claude-ran.txt` is prepended to `PATH`, and the sentinel is absent after `install
claude --dry-run` and after a real `install claude` into the temp `CLAUDE_CONFIG_DIR` (with
the `MY_FLOW_SCHTASKS` fake); `uninstall claude` prints `claude mcp remove plugin-demo`;
`cli.mjs demo-hello a b` prints the `MY_FLOW_PLUGIN_ROOT` line and the args, `cli.mjs nope`
exits 1 with the usage text, and the disabled-plugin note appears after `plugin disable`;
`plugin list`
with `MY_FLOW_PLUGIN_FAKE_CLAUDE=missing` prints `claude: unknown (claude not found)` and with
`=plugin-demo` plus a planted `installed_plugins.json` prints `claude: installed`;
`node scripts/cli.mjs build --check` spawned with `process.execPath` exits 0 printing
`generated files are up to date` with the fixture registered (build ignores the registry;
tests never `spawnSync('npm')`, which fails with EINVAL on Windows without a shell).

**End-to-end (manual, recorded in the verify report):** with a temporary `MY_FLOW_HOME`,
`CODEX_HOME` and `CLAUDE_CONFIG_DIR` in a shell: `plugin add test/fixtures/plugin-demo`,
`install codex`, inspect the temp `config.toml`, `hooks.json` and `skills/plugin-demo-demo/`,
`uninstall codex`, `install claude --dry-run`, `cli.mjs demo-hello`; then the user, outside
the session, runs the spike commands from task 4.1 against the real Claude and reports.

**Observability:** `plugin list` / `plugin list --json` are the status surface (setup, per
host, verbs, substituted server commands); every install action is a logged `add / replace /
remove / skip / write` line with the `[dry-run]` prefix when applicable; refusals name the
manifest path and every failing rule; the registry file and clone directory are plain files
under the my-flow home.

## Do-Not-Touch

- `scripts/build.mjs` (umbrella D4: plugins never enter the build; success criterion 5 checks
  `git diff --stat -- scripts/build.mjs` is empty).
- `manifest.json` (no new field; U1 / proposal non-goal).
- `hooks/*` (`completion-guard.mjs`, `session-context.mjs`, `codex-shim.ps1`, `hooks.json`,
  `hooks/lib/`), `agents/*`, `src/agents/*`, and the existing `src/skills/*`.
- `scripts/spec.mjs` and `scripts/lib/intent.mjs` (archive and validation semantics the
  umbrella relies on).
- `changes/plugin-system-browser-harness/` (the umbrella ledger is ticked by the outer loop,
  never by this sub-change) and `changes/archive/`.
- Generated files are edited only through `npm run build` (`claude/CLAUDE.block.md`,
  `codex/AGENTS.block.md`); nothing under `skills/`, `agents/`, `codex/skills/`,
  `codex/agents/`, `.claude-plugin/` changes because no skill or agent source changes.

## Rebuild / Re-run After Change

- After editing `src/core/core.md`: `npm run build` (regenerates `claude/CLAUDE.block.md` and
  `codex/AGENTS.block.md`), then `npm run check` (exit 0 proves the committed output matches).
- After any edit under `scripts/`, `test/`, `package.json`: `npm test` (the `test` script now
  includes `test/plugin.test.mjs`) and `npm run check`.
- Manual smoke after the install changes, with temporary homes exported in the shell:
  `node scripts/install.mjs codex --dry-run` and `node scripts/install.mjs claude --dry-run`.
- The eight `README*.md` files are edited by hand; nothing regenerates them
  (`README.md:270-282` lists the generated directories and no README is among them).
- Nothing on the user's real machine is re-run by this change; `~/.my-flow/plugins.json`
  appears only when the user runs `plugin add` outside the tests.
