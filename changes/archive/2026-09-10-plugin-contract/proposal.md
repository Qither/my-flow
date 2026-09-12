## Umbrella

Umbrella: plugin-system-browser-harness (repo my-flow, sub-change 1 of 6: plugin-contract).
Design source: changes/plugin-system-browser-harness/design.md D2, D3, D4, D5, D6, D11.

## Why

my-flow has no plugin concept: `manifest.json` lists only the core skills and agents,
`scripts/build.mjs` renders `src/` into the two tool surfaces, and `scripts/install.mjs`
installs those surfaces. The umbrella change needs an explicit contract so that an
independent repository (first: the Browser Harness, `my-flow-browser`) can contribute
skills, agents, hooks, CLI subcommands and MCP servers to Claude Code and Codex, and MCP
tools to any other MCP client, while the my-flow core keeps its promise of zero runtime
dependencies. This sub-change delivers that contract and the CLI around it, verified with
a dependency-free fixture plugin, before any browser code exists.

## What Changes

1. **Plugin manifest.** A plugin is an independent repository with `my-flow-plugin.json` at
   its root (umbrella design D2): `name`, `version`, `description`, `myFlow` version range,
   `node` engine hint, `codexSkillPrefix` (default `<name>-`), `contributes.skills` (dirs of
   `<skill>/SKILL.md` in Claude format), `contributes.agents` (dirs of `<role>.md`),
   `contributes.hooks` (a Claude `hooks.json`), `contributes.cli` (verb to script),
   `contributes.mcpServers` (name to `command` / `args` / `env` / `cwd`, optional
   `startupTimeoutSec`), `setup` (a line that is printed, never executed) and `setupCheck`
   (a path that must exist under the plugin root, default `node_modules`). `${PLUGIN_ROOT}`
   is the only placeholder; my-flow substitutes it per surface. A plugin repository is also a
   valid Claude Code plugin (`.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json`
   listing itself with a relative `source`, `skills/`, `agents/`, `hooks/hooks.json`) but must
   not declare `mcpServers` in `plugin.json` or ship `.mcp.json`; MCP servers are declared
   once in `my-flow-plugin.json`. Plugin skills on Claude invoke dependency-bearing code only
   through `my-flow <verb> ...`, never through `${CLAUDE_PLUGIN_ROOT}/...`.
2. **Registry.** `~/.my-flow/plugins.json` under the my-flow home (`MY_FLOW_HOME`,
   `scripts/lib/models.mjs:47`), design D3: `{ version: 1, plugins: { <name>: { path, source,
   enabled, added, version } } }`. Git sources are cloned by spawning `git` into
   `~/.my-flow/plugins/<name>/`; local paths are recorded resolved and absolute.
3. **CLI verbs** in a new `scripts/plugin.mjs`, dispatched from `scripts/cli.mjs` and listed
   in its usage text (design D4): `my-flow plugin add <path|git-url> [--name <n>] [--dry-run]`
   (validate the manifest, refuse a `contributes.cli` verb that collides with a core command,
   record, print the `setup` line and the two `install` commands), `plugin remove <name>`,
   `plugin list [--json]` (name, version, path, enabled, setup state, per-surface state; the
   Claude state uses `claude mcp get <server>` spawned with a timeout and reads
   `claude: unknown (claude not found)` when `claude` is not on `PATH` or times out;
   `setup: pending` while the `setupCheck` path is missing), `plugin enable|disable <name>`,
   and plugin-contributed verbs: when the first argument is not a core command, `cli.mjs`
   looks it up in the registry (enabled plugins only) and spawns `node <plugin>/<script> ...`
   with `MY_FLOW_PLUGIN_ROOT` set; unknown verbs keep exiting 1.
4. **Merging into the surfaces happens in `install`.** Merging happens in install, not
   build: scripts/build.mjs stays plugin-free because its outputs are committed and gated by
   --check (umbrella design D4). `install codex` renders every enabled plugin after the core:
   skills copied under `<codexSkillPrefix><skill>` with `${CLAUDE_PLUGIN_ROOT}` rewritten to
   the absolute root and `/<plugin-name>:<skill>` rewritten to `$<codexSkillPrefix><skill>`;
   agents rendered to TOML the way `scripts/build.mjs:117-127` does, with the managed
   `# my-flow agent:` header so uninstall recognises them; hooks through the existing shim
   and trusted-hash mechanism with `{{ROOT}}` = plugin root; `[mcp_servers.<server>]` tables
   (`command`, `args`, `cwd`, `env`, `startup_timeout_sec` when asked) inside the managed
   TOML block. Before writing a server table the installer scans the unmanaged part of
   `config.toml` for the same table header and, when found, skips it and warns
   (`skip [mcp_servers.<server>]: defined outside the my-flow block; remove it first to let
   my-flow manage it`), mirroring `scripts/install.mjs:321-323`. `uninstall codex` removes
   plugin content by the same markers. `install claude` prints, per enabled plugin, the three
   Claude commands (`claude plugin marketplace add "<root>"`, `claude plugin install ...`,
   `claude mcp add --transport stdio --scope user <server> -- node "<abs>/..."`) and never
   runs them (precedent `scripts/install.mjs:176-181`); uninstall prints the matching
   `claude mcp remove`. `plugin list --json` prints the exact `command` / `args` / `cwd` per
   server for any other MCP client (design D5).
5. **Zero dependencies.** `scripts/plugin.mjs` and the edits to `cli.mjs` / `install.mjs` use
   only `node:` modules; no MCP SDK enters the core (design D6).
6. **Fixture plugin and tests.** `test/fixtures/plugin-demo/` with one skill, one agent, one
   hook, one CLI verb, one dependency-free stdio MCP echo server (plain Node, speaks enough
   JSON-RPC to answer `initialize` and `tools/list`) and its own `.claude-plugin/plugin.json`
   and `marketplace.json`; `test/plugin.test.mjs` added to the `test` script in
   `package.json`, covering manifest validation, registry add / remove / enable / disable /
   list under a temporary `MY_FLOW_HOME`, `install codex --dry-run` output including the
   `[mcp_servers.plugin-demo]` table and the duplicate-table skip, and `install claude`
   printing the three commands.
7. **Spike (recorded, not decided by guessing).** Whether a plugin installed from a local
   marketplace is copied to `~/.claude/plugins/` or used in place, measured by installing the
   fixture plugin and comparing `installed_plugins.json` with the source path. The answer is
   recorded in this sub-change's `design.md`; the `my-flow <verb>` rule holds either way.
8. **Documentation.** `src/core/core.md` and the eight READMEs describe the contract, the
   verbs and the install flow; `npm run build` regenerates the surfaces from `core.md`.

## Non-Goals

- No hosted or cloud browser (Browserbase or any other SaaS browser provider). Local
  Chromium only.
- No non-Chromium browser support (Stagehand is Chromium-only).
- No exposure of Stagehand's high-level autonomous `agent()` mode or of raw CDP / arbitrary
  JavaScript to hosts outside the approval-gated `browser.unsafe.*` namespace.
- No provider credentials stored in, or readable by, the Stagehand driver or the plugin
  manifest; credentials live only in the model gateway configuration.
- No remote or multi-user access: every listener (MCP, gateway, OTEL collector) binds to
  loopback only.
- No change to the four-stage flow, the existing skills, the Stop-hook execute-guard, or
  the spec helper's archive semantics, unless the user approves it inside a sub-change.
- No runtime dependency added to my-flow core. Anything that needs a package lives in the
  plugin repository.
- No publishing to npm or a plugin marketplace in this programme; installation is from a
  local path or git URL.
- No edits to the open change `changes/execute-goal-default`; it is finished separately.
- Sub-change specific: no browser code, no Stagehand, no MCP protocol implementation in the
  core (the fixture echo server is test-only), no change to `scripts/build.mjs`, and no new
  field in `manifest.json` unless this sub-change's design proves one is needed and the user
  agrees.

## Decision Boundaries

Needs the user:

- U1: adding any dependency to my-flow core, including an MCP SDK for the contract layer.
  Default: none; the contract layer writes host configuration only.
- U7: whether `install claude` may run `claude mcp add` itself instead of printing it.
  Default: print, following `scripts/install.mjs:176-181`.

The agent may decide alone (recorded with reasons in `design.md`):

- The exact validation rules of `my-flow-plugin.json`, error messages, and the `plugin list`
  text and JSON layouts.
- The registry file layout details beyond the fields above, and where clones live under
  `~/.my-flow/plugins/`.
- The Codex managed-block markers used for plugin content, as long as `uninstall codex`
  removes exactly what `install codex` wrote.
- The shape of the fixture plugin and the test file layout.

## Capabilities

### New Capabilities
- `plugin-contract`: what a plugin repository must provide (`my-flow-plugin.json`, Claude
  plugin layout without `.mcp.json`), and what `plugin add|remove|list|enable|disable`,
  plugin-contributed verbs, `install codex`, `uninstall codex` and `install claude` do with a
  registered plugin.

### Modified Capabilities
none. `spec-helper`, `model-routing` and `dashboard` are not touched.

## Impact

- `scripts/cli.mjs` (dispatch and usage), new `scripts/plugin.mjs`, `scripts/install.mjs`
  (plugin rendering for Codex, printed commands for Claude, uninstall), `package.json`
  (`test` script only), `src/core/core.md` and the eight READMEs, generated
  `claude/CLAUDE.block.md` and `codex/AGENTS.block.md` via `npm run build`, new
  `test/plugin.test.mjs` and `test/fixtures/plugin-demo/`, new `specs/plugin-contract/spec.md`
  through the delta spec of this change.
- User machine: `~/.my-flow/plugins.json` and `~/.my-flow/plugins/` appear only when
  `plugin add` is run; tests use a temporary `MY_FLOW_HOME` and never touch the real one.
- Not touched: `scripts/build.mjs`, `manifest.json`, `hooks/*`, `agents/*`, `src/agents/*`,
  existing `src/skills/*`, `scripts/spec.mjs`, `scripts/lib/intent.mjs`.

## Success Criteria

1. With `MY_FLOW_HOME` set to a fresh temporary directory, `node scripts/cli.mjs plugin add
   test/fixtures/plugin-demo` exits 0 and `plugin list --json` lists `plugin-demo` with its
   version, path, `enabled: true` and setup state; `plugin disable`, `plugin enable` and
   `plugin remove` change the listing accordingly; afterwards, with `MY_FLOW_HOME` unset,
   `plugin list` does not list `plugin-demo`.
2. `node scripts/install.mjs codex --dry-run` with the fixture registered prints the plugin's
   skill directory, agent TOML, hook entry and a `[mcp_servers.plugin-demo]` table, and skips
   with a warning when an unmanaged `[mcp_servers.plugin-demo]` already exists in the test
   `config.toml`.
3. `node scripts/install.mjs claude --dry-run` with the fixture registered prints the three
   Claude commands for it and runs none of them.
4. `node scripts/cli.mjs demo-hello` (the fixture's contributed verb) runs the fixture script
   with `MY_FLOW_PLUGIN_ROOT` set; an unknown verb still exits 1 with the usage text; a
   manifest whose `contributes.cli` verb collides with a core command is refused by
   `plugin add`.
5. `npm run check` and `npm test` exit 0; `test/plugin.test.mjs` is part of the `test`
   script; `scripts/build.mjs` is unchanged (`git diff --stat -- scripts/build.mjs` is empty).
6. The spike result (cache copy or in place) is recorded in `changes/plugin-contract/design.md`.
7. `src/core/core.md` and the eight READMEs document the contract; `npm run check` proves the
   generated blocks match.
