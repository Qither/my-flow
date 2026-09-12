# plugin-contract Specification

## Purpose
What a plugin repository must provide (`my-flow-plugin.json` at its root, a Claude plugin
layout without `.mcp.json`), and the observable behavior of `my-flow plugin
add|remove|list|enable|disable`, plugin-contributed verbs, `install codex`, `uninstall codex`,
`install claude` and `uninstall claude` for a registered plugin. The core stays
zero-dependency: it validates manifests, keeps a per-user registry and writes host
configuration; it never speaks MCP itself.

## ADDED Requirements

### Requirement: Plugin manifest validation

The system SHALL read `<root>/my-flow-plugin.json` and SHALL refuse `plugin add` with exit 1
and one stderr line per violation, prefixed `plugin add: <root>/my-flow-plugin.json:`, when
`name` (kebab-case), `version` (semver) or `description` is missing or malformed; when `name`
or a `contributes.cli` verb equals a core command (`build`, `install`, `uninstall`, `init`,
`ask`, `spec`, `dashboard`, `models`, `plugin`); when `codexSkillPrefix` is exactly the core
prefix `my-flow-`, when a resulting `<codexSkillPrefix><skill>` directory name equals a core
Codex skill directory name, or when the prefix is used by another registered plugin; when a `contributes.cli` verb, a
`contributes.agents` role or a `contributes.mcpServers` name is already contributed by another
registered plugin or (for roles) equals a core role; when a referenced directory, script or
hook file does not exist; when a hook command is not of the form
`node "${CLAUDE_PLUGIN_ROOT}/<script>"`; when an `mcpServers` value contains a `${...}`
placeholder other than `${PLUGIN_ROOT}`; when a server name or env key is not
`[A-Za-z0-9_-]+`; and when the repository declares `mcpServers` in `.claude-plugin/plugin.json`
or ships `.mcp.json`. `${PLUGIN_ROOT}` SHALL be the only placeholder the system substitutes,
with the absolute plugin root in forward-slash form. Unknown top-level fields SHALL produce a
warning, not a refusal.

#### Scenario: A valid fixture is accepted
- **WHEN** `plugin add test/fixtures/plugin-demo` runs with `MY_FLOW_HOME` set to an empty
  temporary directory
- **THEN** the command exits 0 and prints `added plugin-demo 0.1.0`

#### Scenario: A colliding CLI verb is refused
- **WHEN** `plugin add` runs on a copy of the fixture whose `contributes.cli` maps the verb
  `spec`
- **THEN** the command exits 1, stderr contains `cli verb "spec" collides with core command
  "spec"`, and no `plugins.json` is written

#### Scenario: A collision with a core Codex skill directory is refused
- **WHEN** `plugin add` runs on a copy whose `codexSkillPrefix` is `my-flow-`, and on a copy
  whose prefix is `my-` with a skill directory named `flow-spec`
- **THEN** the first exits 1 with `codexSkillPrefix "my-flow-" is reserved for the core` and
  the second exits 1 with `skill "my-flow-spec" collides with the core skill directory
  "my-flow-spec"`, while a prefix such as `my-flow-browser-` is accepted

#### Scenario: A foreign placeholder is refused
- **WHEN** `plugin add` runs on a copy whose server `args` contain `${HOME}/x`
- **THEN** the command exits 1 and stderr contains `unknown placeholder ${HOME}; only
  ${PLUGIN_ROOT} is substituted`

#### Scenario: MCP servers declared in the Claude plugin manifest are refused
- **WHEN** `plugin add` runs on a copy whose `.claude-plugin/plugin.json` contains an
  `mcpServers` key, or whose root contains `.mcp.json`
- **THEN** the command exits 1 and stderr names the offending file and says to declare MCP
  servers in `my-flow-plugin.json`

#### Scenario: All violations are reported at once
- **WHEN** `plugin add` runs on a copy missing both `name` and `version`
- **THEN** stderr contains one line for `name` and one line for `version`, and the command
  exits 1

### Requirement: Plugin registry commands

The system SHALL keep the registry at `<MY_FLOW_HOME>/plugins.json` (`MY_FLOW_HOME`
defaulting to `~/.my-flow`) as `{ version: 1, plugins: { <name>: { path, source, enabled,
added, version, cloned } } }`, written atomically. `plugin add <path|git-url> [--name <n>]
[--dry-run]` SHALL record a local path as its resolved absolute path without copying, SHALL
clone a git source (`http(s)://`, `ssh://`, `git://`, `file://`, `git@...`, or a `.git`
suffix) into `<MY_FLOW_HOME>/plugins/<name>/` with `cloned: true`, SHALL refuse a name that
is already registered, SHALL print the manifest's `setup` line without executing it, the
setup state and the two install commands, and with `--dry-run` SHALL write nothing. `plugin
remove <name>` SHALL drop the entry and delete the clone directory only when `cloned` is
true. `plugin enable|disable <name>` SHALL flip `enabled`. An unknown name SHALL exit 1.

#### Scenario: Round trip under a temporary home
- **WHEN** `plugin add test/fixtures/plugin-demo`, then `plugin disable plugin-demo`, then
  `plugin enable plugin-demo`, then `plugin remove plugin-demo` run with `MY_FLOW_HOME` set to
  a temporary directory
- **THEN** each command exits 0, `plugin list --json` between the steps reports `enabled`
  as `true`, `false`, `true` in turn, and after the removal the plugin is absent; with a
  different empty `MY_FLOW_HOME` the plugin is never listed

#### Scenario: Setup is printed, never executed
- **WHEN** `plugin add` succeeds for a temporary copy of the fixture whose `setup` is
  `node <temp>/sentinel.mjs`, a script that would write `<temp>/sentinel.txt`
- **THEN** stdout contains `setup (run it yourself; my-flow never executes it): node
  <temp>/sentinel.mjs` and `setup: pending`, and `<temp>/sentinel.txt` does not exist
  afterwards

#### Scenario: A git source is cloned and removed with the entry
- **WHEN** `plugin add file://<temporary git repository containing the fixture>` runs
- **THEN** `<MY_FLOW_HOME>/plugins/plugin-demo/my-flow-plugin.json` exists, the registry entry
  has `cloned: true`, and `plugin remove plugin-demo` deletes that directory

#### Scenario: Dry-run adds nothing
- **WHEN** `plugin add test/fixtures/plugin-demo --dry-run` runs with an empty temporary
  `MY_FLOW_HOME`
- **THEN** stdout starts with `[dry-run] would add plugin-demo` and `plugins.json` does not
  exist afterwards

### Requirement: Plugin listing and states

`plugin list` SHALL print, per registered plugin, its name, version, `[enabled]` or
`[disabled]`, path, source, setup state, Claude state, Codex state, contributed verbs and the
substituted MCP server commands; `plugin list --json` SHALL print the same as one JSON
document whose `mcpServers` carry the substituted `command`, `args`, `cwd`, `env` and
`startupTimeoutSec` per server. The setup state SHALL read `setup: pending` while the
manifest's `setupCheck` path (default `node_modules`) is missing under the plugin root and
`setup: ok` otherwise. The Claude state SHALL be probed by reading
`<claude home>/plugins/installed_plugins.json` and spawning `claude mcp get <server>` with a
timeout, and SHALL read `claude: unknown (claude not found)` when `claude` is not on `PATH`
or times out; `MY_FLOW_PLUGIN_FAKE_CLAUDE` SHALL replace the spawn for tests. The Codex state
SHALL be probed from files only.

#### Scenario: Claude absent and setup pending
- **WHEN** `plugin list` runs with the fixture registered, temporary homes and
  `MY_FLOW_PLUGIN_FAKE_CLAUDE=missing`
- **THEN** stdout contains `plugin-demo 0.1.0 [enabled]`, `setup: pending`, `claude: unknown
  (claude not found)` and `codex: not installed`

#### Scenario: Setup satisfied on a prepared copy
- **WHEN** `plugin list` runs for a temporary copy of the fixture in which an empty
  `node_modules/` directory exists
- **THEN** stdout contains `setup: ok`

#### Scenario: JSON carries pasteable server commands
- **WHEN** `plugin list --json` runs with the fixture registered
- **THEN** the output parses, `plugins[0].mcpServers["plugin-demo"].command` is `node`, and
  `args[0]` is the absolute forward-slash path to the fixture's `server/mcp.mjs`

#### Scenario: Empty registry
- **WHEN** `plugin list` runs with `MY_FLOW_HOME` set to an empty directory
- **THEN** stdout is `no plugins registered (my-flow plugin add <path|git-url>)` and the exit
  code is 0

### Requirement: Contributed verb dispatch

When the first argument of `my-flow` is not a core command, the system SHALL look it up in
`contributes.cli` of every enabled registered plugin and, on a match, SHALL run
`node <plugin root>/<script> <remaining args>` with inherited stdio and cwd and the
environment variable `MY_FLOW_PLUGIN_ROOT` set to the plugin root, exiting with the child's
status. Core commands SHALL always take precedence. A verb of a disabled plugin SHALL print
the usage text and a note naming the plugin and exit 1. An unknown verb SHALL keep printing
the usage text and exit 1.

#### Scenario: The fixture verb runs with its root
- **WHEN** `my-flow demo-hello a b` runs with the fixture registered and enabled
- **THEN** stdout contains `hello from plugin-demo at <absolute fixture path>` and `a b`,
  and the exit code is 0

#### Scenario: Unknown verb
- **WHEN** `my-flow nope` runs
- **THEN** the usage text is printed and the exit code is 1

#### Scenario: A corrupt registry cannot break core commands
- **WHEN** `<MY_FLOW_HOME>/plugins.json` contains only `{` and `my-flow build --check` runs
- **THEN** the exit code and output are the same as with no registry file, because the
  plugin library is loaded only for non-core commands

#### Scenario: Disabled plugin verb
- **WHEN** `my-flow demo-hello` runs after `plugin disable plugin-demo`
- **THEN** the exit code is 1 and stderr contains `is contributed by plugin "plugin-demo",
  which is disabled`

### Requirement: Codex surface rendering for plugins

`install codex` SHALL, after the core content and for every enabled registered plugin, copy
each skill to `<codex home>/skills/<codexSkillPrefix><skill>/` with the frontmatter `name`
set to that directory name, `${CLAUDE_PLUGIN_ROOT}` replaced by the absolute plugin root and
`/<plugin>:<skill>` replaced by `$<codexSkillPrefix><skill>`, writing a marker file
`.my-flow-plugin` containing the plugin name; SHALL write each agent as
`<codex home>/agents/<role>.toml` whose first line starts with `# my-flow agent: <role>
(plugin <plugin>` and whose body is a `developer_instructions` literal string; SHALL append
each hook handler as a shim command `-Script "<plugin root>/<script>"` after the core hook
groups so that the existing trusted-hash step covers it; SHALL emit one
`[mcp_servers.<server>]` table per server inside the managed block of `config.toml` with
`command`, `args`, `cwd`, optional `startup_timeout_sec` and an optional
`[mcp_servers.<server>.env]` table; SHALL skip a skill or agent target that exists and is not
marked as managed; SHALL remove marker-bearing skill directories and plugin-header agent
files before rendering so disabled or removed plugins disappear; SHALL read the registry
once, treat an unreadable registry as empty with a stderr warning, and skip a plugin whose
path is missing or whose manifest has errors with `skip plugin <name>: <first error>` while
the core install continues with its normal exit code. Before emitting a server
table the system SHALL scan the text outside the managed block for a header of the same name
and, when found, SHALL skip that server and log exactly `skip [mcp_servers.<server>]: defined
outside the my-flow block; remove it first to let my-flow manage it`.

#### Scenario: Skills, agent, hook and server are rendered
- **WHEN** `install codex` runs with the fixture registered, temporary `MY_FLOW_HOME`,
  `CODEX_HOME`, `CLAUDE_CONFIG_DIR` and `MY_FLOW_SCHTASKS` pointing at a fake script
- **THEN** `<CODEX_HOME>/skills/plugin-demo-demo/SKILL.md` contains `name: plugin-demo-demo`
  and `$plugin-demo-demo` and no `${CLAUDE_PLUGIN_ROOT}`, the marker file
  `.my-flow-plugin` contains `plugin-demo`, `<CODEX_HOME>/agents/demo-reviewer.toml` starts
  with `# my-flow agent: demo-reviewer (plugin plugin-demo`, the parsed `hooks.json` has the
  plugin group as the last entry of `hooks.SessionStart` and that entry's command string ends
  with `-Script "<abs fixture, forward slashes>/hooks/demo-hook.mjs"` (the raw file
  JSON-escapes the quotes as `\"`, so the check parses the file rather than grepping it),
  and `config.toml` contains `[mcp_servers.plugin-demo]`,
  `command = "node"` and `startup_timeout_sec = 20` inside the managed block

#### Scenario: An unmanaged table of the same name wins
- **WHEN** `config.toml` already contains `[mcp_servers.plugin-demo]` above the managed block
  and `install codex --dry-run` then `install codex` run
- **THEN** the dry-run output contains the exact skip line, and after the real install the
  file contains exactly one `[mcp_servers.plugin-demo]` header, the user's table

#### Scenario: A plugin whose directory vanished does not break the core install
- **WHEN** a registered plugin's directory is deleted and `install codex` runs
- **THEN** the command exits 0, stdout contains `skip plugin plugin-demo: path <absolute
  path> is missing`, and the core files (`AGENTS.md`, `hooks.json`, `config.toml` block) are
  still written

#### Scenario: A second dry-run reports replace, not skip
- **WHEN** `install codex --dry-run` runs after a successful real `install codex`
- **THEN** stdout contains `[dry-run] replace <CODEX_HOME>/skills/plugin-demo-demo` and no
  `skip` line for that directory, because the marker identifies it as managed

#### Scenario: A disabled plugin is removed on the next install
- **WHEN** `plugin disable plugin-demo` runs after a successful `install codex`, then
  `install codex` runs again
- **THEN** `skills/plugin-demo-demo/`, `agents/demo-reviewer.toml`, the hook entry and the
  `[mcp_servers.plugin-demo]` table are gone from `CODEX_HOME`

### Requirement: Claude surface commands are printed, never run

`install claude` SHALL print, per enabled registered plugin and in both normal and dry-run
mode, `claude plugin marketplace add "<plugin root>"`, `claude plugin install
<plugin>@<marketplace>` and, per server, `claude mcp add --transport stdio --scope user
<server> -- <command> "<substituted args>"`, and SHALL NOT execute any of them. `uninstall
claude` SHALL print `claude mcp remove <server>` per server and `claude plugin disable
<plugin>@<marketplace>`.

#### Scenario: Three commands for the fixture
- **WHEN** `install claude --dry-run` runs with the fixture registered and temporary homes
- **THEN** stdout contains `claude plugin marketplace add "<absolute fixture path>"`,
  `claude plugin install plugin-demo@plugin-demo` and `claude mcp add --transport stdio
  --scope user plugin-demo -- node "<absolute fixture path>/server/mcp.mjs"`, and
  `CLAUDE_CONFIG_DIR` contains no new file

#### Scenario: The printed commands are never executed
- **WHEN** a temporary directory holding a fake `claude` executable that writes
  `<temp>/claude-ran.txt` is first on `PATH`, and `install claude --dry-run` and then a real
  `install claude` into a temporary `CLAUDE_CONFIG_DIR` run with the fixture registered
- **THEN** `<temp>/claude-ran.txt` does not exist after either run

#### Scenario: Uninstall prints the reverse
- **WHEN** `install.mjs --uninstall claude --dry-run` runs with the fixture registered
- **THEN** stdout contains `claude mcp remove plugin-demo`

### Requirement: Uninstall codex removes exactly what install wrote

`uninstall codex` SHALL remove every `<codex home>/skills/*/` directory carrying the
`.my-flow-plugin` marker, every `<codex home>/agents/*.toml` whose first line starts with
`# my-flow agent:` and names a plugin, every hook entry that calls the my-flow shim, and the
managed block of `config.toml`, and SHALL leave every other file and every unmarked directory
untouched, without reading the registry.

#### Scenario: Planted user content survives byte for byte
- **WHEN** `<CODEX_HOME>/skills/plugin-demo-keep/SKILL.md` (no marker), a user
  `[mcp_servers.other]` table in `config.toml` and a user hook entry in `hooks.json` exist,
  then `install codex` and `uninstall codex` run with the fixture registered
- **THEN** `config.toml`, `hooks.json` and `skills/plugin-demo-keep/SKILL.md` are byte-identical
  to their planted content, and `skills/plugin-demo-demo/` and `agents/demo-reviewer.toml` do
  not exist

#### Scenario: Removal does not need the registry
- **WHEN** the plugin is removed from the registry after `install codex`, then `uninstall
  codex` runs
- **THEN** the plugin's skill directory, agent file, hook entry and server table are removed
  all the same

### Requirement: Dry-run behaviour

`install codex --dry-run`, `install claude --dry-run`, `uninstall codex --dry-run` and
`plugin add --dry-run` SHALL print every `add`, `replace`, `remove`, `skip` and `write`
action they would take, prefixed `[dry-run] `, and SHALL create or modify no file under
`MY_FLOW_HOME`, `CODEX_HOME` or `CLAUDE_CONFIG_DIR`.

#### Scenario: Codex dry-run with a plugin
- **WHEN** `install codex --dry-run` runs with the fixture registered and an empty temporary
  `CODEX_HOME`
- **THEN** stdout contains `[dry-run] add <join(CODEX_HOME, 'skills', 'plugin-demo-demo')>`,
  the agent target, `[dry-run] add hook SessionStart: ...`, `[dry-run] add
  [mcp_servers.plugin-demo]` followed by the indented table lines, and `[dry-run] write
  <CODEX_HOME>/config.toml`, and `CODEX_HOME` is still empty afterwards
