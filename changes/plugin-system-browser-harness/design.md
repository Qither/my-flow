## Context

This is the design of an **umbrella change**. It is never executed as code; its `tasks.md`
is a ledger of the lifecycle of six ordered sub-changes, each with its own
`proposal.md` / `design.md` / `tasks.md` and its own `mf-verify` in the repository it
belongs to. Every decision below exists so that the six sub-change proposals can be written
without guessing; a sub-change's own `mf-plan` refines the "how" inside the boundaries set
here and may not move a boundary without the user.

### Current state of my-flow (evidence)

- Zero runtime dependencies is a stated promise: `src/core/core.md:3-6` ("adds no runtime and
  no external tools"); `package.json:1-19` declares no `dependencies`; Node `>=20`
  (`package.json:15-17`). The dashboard spec even tests it
  (`specs/dashboard/spec.md:203-206`).
- There is no plugin concept. `manifest.json:5-51` lists only the core `skills` and `agents`.
  `scripts/cli.mjs:19-28` is a static dispatch table (`build, install, uninstall, init, ask,
  spec, dashboard, models`); an unknown command prints usage and exits 1
  (`scripts/cli.mjs:30-41`).
- `scripts/build.mjs` renders `src/` into committed generated files: skills
  (`scripts/build.mjs:75-95`), agents including the Codex TOML rendering
  (`scripts/build.mjs:103-128`), the core block (`:131-140`), the Claude plugin manifest with
  `skills` and `agents` only, no `mcpServers` (`:143-157`), the Codex hooks template
  (`:160-172`), then write / `--check` (`:175-216`) and pruning of stale entries (`:191-206`).
  Generated files are committed so `claude --plugin-dir` needs no build, and `--check` fails
  when they drift (`README.md:282`). Therefore anything that differs per user machine (an
  installed plugin) must NOT be baked into `build` output.
- `scripts/install.mjs` is the per-user step. Claude: backs up, sets the teams env, upserts the
  CLAUDE.md block, and **prints** the plugin commands instead of running them
  (`scripts/install.mjs:154-183`, precedent for "print, never run, Claude-side commands from
  inside a session"). Codex: copies skills with `{{MYFLOW_ROOT}}` substitution
  (`:296-315`), copies agent TOMLs only when the existing file carries the managed header
  (`:318-330`), writes the PowerShell shim (`:333-334`), merges `hooks.json` with trusted
  hashes (`:337-358`), and writes a managed block into `config.toml` between
  `# >>> my-flow managed >>>` / `# <<< my-flow managed <<<` (`:46-47`, `:360-371`).
  Uninstall reverses every one of those by marker (`:256-288`). Tool homes come from
  `CLAUDE_CONFIG_DIR` / `CODEX_HOME` (`:42-43`).
- Per-user state already lives under `~/.my-flow/` (`MY_FLOW_HOME`,
  `scripts/lib/models.mjs:47`; `specs/model-routing/spec.md:33-34`), which also knows where
  Claude installs plugins (`~/.claude/plugins/installed_plugins.json`,
  `scripts/lib/models.mjs:334-335`).
- Hooks reference the plugin root as `${CLAUDE_PLUGIN_ROOT}` (`hooks/hooks.json:10,21`);
  skills do the same on Claude and `{{MYFLOW_ROOT}}` on Codex (`src/skills/spec.md:13-21`).
- The intent layer works against any root: `scripts/spec.mjs:39` (`--root`),
  `scripts/spec.mjs:54-66` (`new`), `:124-148` (`archive` gate: all boxes ticked and a
  `Verdict: PASS` report whose file name starts with `<name>-` under `.my-flow/verify/`,
  `:129-136`). `my-flow init <dir>` creates `specs/`, `changes/{.templates,archive}`,
  `.my-flow/` and git-ignores it (`scripts/init.mjs:51-61,76-82`). Validation requires the
  two design sections (`scripts/lib/intent.mjs:233-235`) and the task line format
  (`scripts/lib/intent.mjs:242-246`).
- Tests are `node --test` over child processes in temp roots (`test/helpers.mjs:17-20,47-50`;
  `package.json:13`). New tests must be added to that `test` script line.
- Repository state: `changes/execute-goal-default` is already archived as
  `changes/archive/2026-09-10-execute-goal-default/` (listed 2026-09-10); `git status` shows
  only `changes/` and `specs/` as untracked. The state file names this umbrella at stage
  `interview` (`.my-flow/state/current-change.json`).
- Machine: Windows 11, Node v24.1.0 (`node --version`), which satisfies the Stagehand
  requirement below. No `../my-flow-browser` or `../stagehand` directory exists yet.

### External claims: verified, corrected, unverified

Stagehand (all checked 2026-09-10 against the official docs and the GitHub repository):

| Claim from the pasted advice | Result | Evidence |
|---|---|---|
| Stagehand v4 connects to a running browser with `localBrowser.connect({ cdpUrl })` | **Confirmed.** `await localBrowser.connect({ cdpUrl: "http://127.0.0.1:9222" })`; the browser must be started with `--remote-debugging-port` | https://docs.stagehand.dev/v4/configuration/browser |
| `localBrowser.launch()` exists | **Confirmed.** Options `headless`, `port`, `userDataDir` (+ `preserveUserDataDir`), `executablePath`, `proxy`, `viewport`. Launch prepends `--enable-unsafe-extension-debugging`, `--remote-allow-origins=*`, `--window-size=...`, `--enable-features=WebMCPTesting,DevToolsWebMCPSupport` | same page |
| Chromium only | **Confirmed.** "Attach to any Chromium browser"; local runs need Chrome installed | https://docs.stagehand.dev/v4/configuration/browser , https://docs.stagehand.dev/v4/first-steps/installation |
| Telemetry config `telemetry: TelemetryConfig` | **Corrected in shape, confirmed in existence.** The option is `telemetry: { traces: { endpoint, headers } }`; the endpoint must end in `/v1/traces`; omitting the option means no trace export. Traces are sampled at 100 % and W3C trace context crosses the SDK / extension boundary | https://docs.stagehand.dev/v4/configuration/observability |
| Telemetry is on by default and phones home | **Not supported by the code.** `packages/extension/tracing.ts` creates an OTLP exporter only inside `configure(telemetry, clientInfo)` when `traces.endpoint` is set; no hard-coded URL. `packages/extension/metrics.ts` is in-memory counters only. Logs go to stderr unless `onLog` is set (`level`, `format`, `onLog`; `"off"` silences both) | https://raw.githubusercontent.com/browserbase/stagehand/main/packages/extension/tracing.ts , https://raw.githubusercontent.com/browserbase/stagehand/main/packages/extension/metrics.ts , https://docs.stagehand.dev/v4/configuration/logging |
| Files `packages/extension/tracing.ts` etc. exist | **Confirmed.** `packages/` holds `docs, evals, extension, integrations, protocol, sdk-go, sdk-python, sdk-ts`; `extension/` holds `tracing.ts`, `metrics.ts`, `manifest.json`, `service-worker.ts`, `content-script.ts`, `inference.ts`, `rpcRouter.ts`, `llm/`, ... | https://github.com/browserbase/stagehand/tree/main/packages , https://github.com/browserbase/stagehand/tree/main/packages/extension |
| Provider list | **Corrected.** Five first-class providers, `"provider/model"` prefix mandatory: `openai`, `anthropic`, `google`, `groq`, `cerebras`. API key is passed on the model object; Stagehand reads no environment variables | https://docs.stagehand.dev/v4/configuration/models |
| `baseURL` support | **Corrected.** "There is no base URL option." The supported route to a custom endpoint is the bring-your-own-LLM callback `model: { generate(params) }` (`messages`, `systemPrompt`, `temperature`, `responseFormat`; returns `role`, `content`, `outputFormat`, `structuredContent`) | same page; https://www.browserbase.com/blog/stagehand-v4 |
| `observe` returns selectors | **Confirmed.** `observe()` returns `Action` objects `{ description, method, arguments, selector }` with XPath selectors (`xpath=...`); `act(Action)` replays without inference; with `selfHeal` on, a failed selector is re-inferred once | https://docs.stagehand.dev/v4/basics/observe , https://docs.stagehand.dev/v4/basics/act |
| `agent()` must be hidden from hosts | **Moot but kept.** "Stagehand v4 does not include an autonomous agent or a general-purpose MCP client"; Stagehand ships no MCP server of its own | https://docs.stagehand.dev/v4/best-practices/mcp-integrations |
| Architecture | **New fact.** v4 moved the runtime into a Chrome extension: the SDK talks to the extension service worker over the existing CDP socket (`Target.attachToTarget`, `Runtime.addBinding`, `Runtime.evaluate`, `Runtime.bindingCalled`). Local browsers load the extension from the SDK host via `Extensions.loadUnpacked`. The extension manifest requests `debugger`, `offscreen`, `scripting`, `tabs` and `host_permissions: ["<all_urls>"]`, with a content script on all frames at document start | https://www.browserbase.com/blog/stagehand-v4 , https://raw.githubusercontent.com/browserbase/stagehand/main/packages/extension/manifest.json |
| Branded Chrome 137+ ignores `--load-extension` | **Confirmed.** Chromium extensions PSA and the Chrome Enterprise release notes: from Chrome 137 official branded builds deprecate loading extensions through `--load-extension`; the flag keeps working in Chromium and Chrome for Testing; unpacked extensions load via `chrome://extensions` or, for automation, `Extensions.loadUnpacked` over CDP as Stagehand does | https://groups.google.com/a/chromium.org/g/chromium-extensions/c/1-g8EFx2BBY/m/S0ET5wPjCAAJ , https://support.google.com/chrome/a/answer/10314655 |
| Package facts | **New fact.** `@browserbasehq/stagehand` 4.1.0, `engines.node >=22.18.0`, runtime deps `@browserbasehq/sdk`, `@opentelemetry/api`, `@opentelemetry/core`, `zod`; MIT licence | https://github.com/browserbase/stagehand/blob/main/packages/sdk-ts/package.json , https://github.com/browserbase/stagehand , https://docs.stagehand.dev/v4/first-steps/installation |

Not verifiable from docs alone (each becomes a spike task inside the named sub-change):
- Whether the Stagehand extension can act on a tab the harness did not open (it holds
  `tabs` + `debugger` + `<all_urls>`, so assume yes until measured) -> `extension-bridge`.
- Whether `Stagehand.create()` accepts a `model.generate` callback that refuses every call
  (no model configured) without breaking `act(Action)` replay -> `harness-core`.
- Whether `@browserbasehq/sdk` opens any connection when no Browserbase key is configured
  (the outbound audit measures it) -> `harness-core` audit, `stagehand-fork` remedy.
- Which origin Stagehand needs `--remote-allow-origins=*` for, and whether the flag can be
  narrowed to that origin -> `harness-core` (D7).
- Whether a plugin installed from a local marketplace is copied into `~/.claude/plugins/`
  or used in place -> `plugin-contract` (D2).

Host mechanisms (verified 2026-09-10):
- Claude Code plugins declare MCP servers in `.mcp.json` at the plugin root or in the
  `mcpServers` field of `.claude-plugin/plugin.json`; fields `command`, `args`, `env`;
  placeholders `${CLAUDE_PLUGIN_ROOT}`, `${CLAUDE_PLUGIN_DATA}` (persistent, "installed
  dependencies"), `${CLAUDE_PROJECT_DIR}`; plugin servers start when the plugin is enabled and
  are addressed as `mcp__plugin_<plugin>_<server>__<tool>`
  (https://code.claude.com/docs/en/plugins-reference). User-level registration is
  `claude mcp add --transport stdio --scope user <name> -- <command> [args...]` stored in
  `~/.claude.json`; `claude mcp list | get <name> | remove <name>`; project scope writes
  `.mcp.json` with `{"mcpServers":{"<name>":{"type":"stdio","command":..,"args":..,"env":..}}}`
  (https://code.claude.com/docs/en/mcp). Local marketplaces:
  `.claude-plugin/marketplace.json` with `name`, `owner`, `plugins[{name, source}]`;
  `claude plugin marketplace add <dir>`, `claude plugin install <plugin>@<marketplace>`,
  `claude --plugin-dir <dir>` for in-place development
  (https://code.claude.com/docs/en/plugin-marketplaces).
- Codex CLI registers MCP servers in `~/.codex/config.toml` as `[mcp_servers.<name>]` with
  `command`, `args`, `env`, `cwd` (stdio) or `url` + `bearer_token_env_var` (HTTP), plus
  `enabled`, `startup_timeout_sec` (default 10), `tool_timeout_sec` (default 60);
  CLI `codex mcp add <name> -- <command>`, `codex mcp list | get | remove`
  (https://learn.chatgpt.com/docs/extend/mcp?surface=cli, redirect target of
  https://developers.openai.com/codex/mcp).
- MCP tool names: SEP-986 allows `A-Z a-z 0-9 _ - . /`, 1-64 chars, but some gateways
  (for example Bedrock) accept only `[a-zA-Z0-9_-]`
  (https://modelcontextprotocol.io/seps/986-specify-format-for-tool-names).

## Goals / Non-Goals

**Goals:**

- Fix the sub-change list: names, order, repository, entry and exit criteria, and what each
  consumes from the previous one, so each proposal can be written from this file alone.
- Decide the plugin contract at decision level: manifest name and schema, registry location,
  CLI verbs, the merge points for skills / agents / hooks / CLI / MCP on each surface, and the
  MCP registration mechanism per host.
- Decide the browser harness architecture at decision level: the four layers, the primitive
  surface and wire names, the default policy table, the deterministic-first rule, the
  injection defence, the model path, the isolation model.
- Fix the tracking convention that binds sub-changes to this umbrella and lets the umbrella's
  own `mf-verify` check every sub-change from the my-flow repository.
- Record the residual-risk verification (table above) so nobody re-verifies it.

**Non-Goals:**

- Everything in `proposal.md` `## Non-Goals` (no cloud browser, no non-Chromium, no `agent()`
  or raw CDP outside `browser.unsafe.*`, no credentials in the driver, loopback only, no
  change to the four-stage flow or existing skills, no core dependency, no npm publishing,
  no edits to `changes/execute-goal-default`).
- No implementation detail that a sub-change's `mf-plan` can settle with its own evidence
  (exact JSON schemas, function names, file splits, test names).
- No creation of the sub-change directories or the two new repositories during planning;
  those are tasks in `tasks.md`.
- No re-verification of the Stagehand claims inside the sub-changes beyond the three listed
  spikes.

## Decisions

### PLAN-DR

**Principles**
1. Core stays zero-dependency and machine-independent: anything per-user lives under
   `~/.my-flow/` or the tool homes, never in committed generated files.
2. Reuse the existing install machinery (managed markers, backup, dry-run, uninstall by
   marker) rather than inventing a second mechanism.
3. Security boundary in the harness, never in the driver: policy, approval, masking and audit
   are enforced in code the user owns; Stagehand only understands pages and performs actions.
4. Deterministic before probabilistic: locator over `act(text)`, replay over inference, API
   over browser, and no model call unless a primitive needs one and the gateway is configured.
5. Every host-facing surface is a plain file or a documented CLI of that host; nothing writes
   an undocumented host file.

**Decision drivers (top 3)**
1. `build --check` and committed generated output (`README.md:282`) forbid baking installed
   plugins into `build`; the merge must happen at install time.
2. Stagehand v4's architecture (runtime inside a privileged extension, five fixed providers, no
   base URL, `model.generate` callback) dictates where routing and tab confinement can live.
3. Three repositories, one ledger: the umbrella must be verifiable from my-flow with
   observable checks that survive worktrees and disposable `.my-flow/` directories.

**Viable options per major decision** are listed under each decision below (chosen option
first, rejected ones with the reason).

### D1. Sub-change list, order, repositories, criteria

| # | Name | Repo (path on this machine) | Capability spec it adds | Entry criterion | Exit criterion (archived when) |
|---|---|---|---|---|---|
| 1 | `plugin-contract` | my-flow (`H:\CommonProject\workflow\VibeCoding\my-flow`) | `plugin-contract` | Umbrella at stage `mf-plan` or later; no other my-flow change at stage `execute` | `my-flow plugin add|remove|list|enable|disable` work against the fixture plugin under `test/fixtures/plugin-demo/`; `install codex` renders its skills / agents / hooks / MCP; `install claude` prints its Claude commands; `npm run check` and `npm test` green; `src/core/core.md` and the eight READMEs document the contract |
| 2 | `harness-core` | new `my-flow-browser` (`H:\CommonProject\workflow\VibeCoding\my-flow-browser`) | `browser-harness` | 1 archived; repository created with `my-flow init` | Plugin conforms to the contract; MCP stdio server exposes the primitive surface; gateway enforces the default policy, masking, secret detection, approval, rate limit, audit log; Stagehand driver runs `observe -> policy -> act(Action)`; named profiles `Agent-General / Agent-Work / Agent-Sensitive`; e2e dashboard check passes from Claude Code and Codex with **no model configured** (deterministic observe); outbound audit report recorded |
| 3 | `stagehand-fork` | new fork of `browserbase/stagehand` (`H:\CommonProject\workflow\VibeCoding\stagehand`, branch `my-flow/privacy`) | `stagehand-privacy` | 2 archived (its outbound audit report is this sub-change's input) | Consumed as a pinned artifact (D10); allowlist guard in both the SDK and extension HTTP paths; telemetry export impossible without an explicit loopback endpoint; network audit test in the fork's CI; documented Windows firewall rule set; upstream tracking strategy recorded in its `design.md` |
| 4 | `model-gateway` | `my-flow-browser` | `model-gateway` | 3 archived | Loopback gateway `http://127.0.0.1:<port>/llm`; the harness's `model.generate` callback posts there with a task class; routing table and credentials only in `~/.my-flow/browser/gateway.json`; LLM `observe` / `extract` / self-heal verified end to end with the user-chosen routing table |
| 5 | `extension-bridge` | `my-flow-browser` | `extension-bridge` | 4 archived; spike result on tab reachability recorded | A user grants exactly one tab through the extension; every primitive fails against any other tab; enforcement point chosen from the spike (see D9) and tested |
| 6 | `temp-profiles` | `my-flow-browser` | `temp-profiles` | 5 archived | Per-task profile created, selectively seeded, destroyed at task end; cookies verifiably gone |

Order and per-repo boundary are fixed by the proposal (`proposal.md:29-31`). Adjacent
sub-changes may be merged by the sub-change's own `mf-plan` only when the exit criteria of
both are kept (for example if the outbound audit in 2 proves the SDK never leaves loopback,
3 may shrink to "allowlist guard + audit test + firewall doc" but still ships). Splitting is
allowed the same way.

Rejected: a single change across three repos (one `tasks.md` cannot be verified by three
`mf-verify` runs; the interview settled this, `.my-flow/interviews/plugin-system-browser-harness-20260910T230500.md:22-25`);
putting 3 before 2 (there is nothing to audit before a harness runs Stagehand).

### D2. Plugin manifest: `my-flow-plugin.json` at the plugin repository root

Chosen: one JSON file, `my-flow-plugin.json`, at the root of the plugin repository. Decision-level
schema (the `plugin-contract` design fixes the exact validation rules):

```
{
  "name": "my-flow-browser",              // kebab-case, unique, not a core command name
  "version": "0.1.0",                     // semver
  "description": "...",
  "myFlow": ">=0.1.0",                    // core version range the plugin was written for
  "node": ">=22.18",                      // engine hint printed by `plugin list`
  "codexSkillPrefix": "my-flow-browser-", // default "<name>-"
  "contributes": {
    "skills":  ["skills"],                // dirs of <skill>/SKILL.md in Claude format
    "agents":  ["agents"],                // dirs of <role>.md with frontmatter
    "hooks":   "hooks/hooks.json",        // Claude hooks.json format, ${CLAUDE_PLUGIN_ROOT}
    "cli":     { "browser": "scripts/cli.mjs" },     // verb -> script, run with node
    "mcpServers": {
      "my-flow-browser": { "command": "node", "args": ["${PLUGIN_ROOT}/server/mcp.mjs"],
                           "env": {}, "cwd": "${PLUGIN_ROOT}" }
    }
  },
  "setup": "npm ci && node scripts/cli.mjs browser doctor",  // printed, never executed
  "setupCheck": "node_modules"            // path that must exist, else `plugin list` says setup: pending
}
```

Rules the contract fixes:
- Paths are relative to the plugin root; `${PLUGIN_ROOT}` is the only placeholder and my-flow
  substitutes it per surface (`${CLAUDE_PLUGIN_ROOT}` is left as is for Claude files, because
  Claude resolves it; the Codex copy substitutes the absolute root, mirroring
  `scripts/install.mjs:310-312`).
- Skills are authored once in Claude `SKILL.md` format. For Codex, my-flow copies them under
  `<codexSkillPrefix><skill>` and rewrites `${CLAUDE_PLUGIN_ROOT}` -> absolute root and
  `/<plugin-name>:<skill>` -> `$<codexSkillPrefix><skill>` (the `{{CALL}}` idea of
  `scripts/build.mjs:63`, applied at install time).
- Agents: `<role>.md` with `description` frontmatter; Codex TOML is rendered the way
  `scripts/build.mjs:117-127` does (`developer_instructions` literal, managed header
  `# my-flow agent:` so uninstall recognises it, `scripts/install.mjs:321`).
- Hook scripts must run under plain Node with no dependency (they may run from the Claude
  plugin cache where `node_modules` is absent); on Codex they go through the existing shim
  and trusted-hash mechanism (`scripts/install.mjs:337-358`) with `{{ROOT}}` = plugin root.
- A plugin repository is also a valid Claude Code plugin (`.claude-plugin/plugin.json`,
  `.claude-plugin/marketplace.json` listing itself with a relative `source` so that
  `claude plugin marketplace add "<root>"` works the way my-flow's own
  `.claude-plugin/marketplace.json` does, `skills/`, `agents/`, `hooks/hooks.json`) so Claude
  consumes skills / agents / hooks natively. It must **not** declare `mcpServers` in
  `plugin.json` or ship `.mcp.json`; MCP servers are declared once in `my-flow-plugin.json`
  and registered by my-flow (see D5), because the Claude plugin cache may copy the repository
  without its `node_modules` (`${CLAUDE_PLUGIN_DATA}` exists for that reason,
  https://code.claude.com/docs/en/plugins-reference) and a server started from the cache would
  not find its dependencies.
- Rule for plugin skills on Claude: a skill invokes dependency-bearing code only through
  `my-flow <verb> ...` (the registry resolves the real plugin root, D4), never through
  `${CLAUDE_PLUGIN_ROOT}/...`; `${CLAUDE_PLUGIN_ROOT}` may address only dependency-free files
  (markdown, plain-Node hook scripts).
- Spike for sub-change 1: whether a plugin installed from a local marketplace is copied to
  `~/.claude/plugins/` or used in place, measured by installing the fixture plugin and
  comparing `installed_plugins.json` with the source path. The answer decides whether
  `${CLAUDE_PLUGIN_ROOT}` ever has `node_modules`; the rule above holds either way, the spike
  only records whether it is load-bearing.

Rejected: reusing `manifest.json` (that file drives `build`, which must stay plugin-free);
a `package.json` field (`my-flow` key) because plugins need not be npm packages and the
Stagehand fork is not one either.

### D3. Registry: `~/.my-flow/plugins.json` (`MY_FLOW_HOME`)

Chosen: one JSON file under the my-flow home (`scripts/lib/models.mjs:47`), same place as
`models.json` and `config.json`:

```
{ "version": 1,
  "plugins": { "my-flow-browser": { "path": "<abs>", "source": "<path or git url>",
                                    "enabled": true, "added": "<iso>", "version": "0.1.0" } } }
```

Git sources are cloned by spawning `git` (as `test/helpers.mjs:73-83` and the dashboard do)
into `~/.my-flow/plugins/<name>/`; local paths are recorded as given (absolute, resolved).
Rejected: project-level `.my-flow/plugins.json` (disposable and per worktree,
`src/core/core.md:120-121`); a registry inside the my-flow repo (per-user data would enter git).

### D4. CLI verbs and where merging happens

Verbs (all in a new `scripts/plugin.mjs`, dispatched from `scripts/cli.mjs:19-28` and listed
in its usage text `:31-40`):

- `my-flow plugin add <path|git-url> [--name <n>] [--dry-run]` - validate the manifest,
  refuse a `contributes.cli` verb that collides with a core command, record in the registry,
  print the plugin's `setup` line and the two `install` commands.
- `my-flow plugin remove <name>` - drop from the registry (and delete the clone under
  `~/.my-flow/plugins/` only when my-flow made it), print the `install` / `uninstall`
  commands that clean the surfaces.
- `my-flow plugin list [--json]` - name, version, path, enabled, setup state, and
  per-surface state: Claude = present in `~/.claude/plugins/installed_plugins.json`
  (`scripts/lib/models.mjs:334-335`) and `claude mcp get <server>` exits 0 (spawned with a
  timeout, as `models.mjs` spawns `claude --version`; when `claude` is not on `PATH` or times
  out the state reads `claude: unknown (claude not found)` rather than failing); Codex =
  `~/.codex/skills/<prefix>*` present and `[mcp_servers.<server>]` inside the my-flow managed
  block of `config.toml`. Setup state: `setup: pending` while the manifest's `setupCheck`
  path (default `node_modules`) is missing under the plugin root, which is the normal state
  right after `plugin add <git-url>` until the printed `setup` line has been run.
- `my-flow plugin enable|disable <name>` - flip the flag, print the `install` commands.
- `my-flow <verb> ...` for a plugin-contributed verb: when `cmd` is not a core command,
  `cli.mjs` looks the verb up in the registry (enabled plugins only) and spawns
  `node <plugin>/<script> ...` with `MY_FLOW_PLUGIN_ROOT` set; unknown verbs keep exiting 1.

Merge points:
- `build` is **not touched** for plugins (driver 1). The proposal's "build / install merging"
  is satisfied by `install`; this is recorded as a deliberate deviation within the agent's
  decision space (`proposal.md:114-116`).
- `install codex` renders every enabled plugin after the core (skills, agents, hooks,
  `[mcp_servers.*]` in the managed TOML block); `uninstall codex` removes them by the same
  markers. `install codex --dry-run` shows the plugin lines too. Before writing
  `[mcp_servers.<server>]` into the managed block, the installer scans the unmanaged part of
  `config.toml` for a table header `[mcp_servers.<server>]`; when one exists it skips that
  server and warns (`skip [mcp_servers.<server>]: defined outside the my-flow block; remove it
  first to let my-flow manage it`), mirroring the agent-TOML rule at
  `scripts/install.mjs:321-323`, because a duplicate TOML table would make Codex reject the
  whole file.
- `install claude` prints, per enabled plugin, the three Claude commands (marketplace add,
  plugin install, `claude mcp add --scope user --transport stdio ... -- node <abs>`), keeping
  the precedent of never running Claude commands from inside a session
  (`scripts/install.mjs:176-181`); it also prints the matching `claude mcp remove` on uninstall.

Rejected: executing `claude mcp add` from `install` (edits `~/.claude.json` while Claude Code
may hold it; the existing installer deliberately prints); writing `~/.claude.json` directly
(undocumented format); a my-flow-generated marketplace directory (extra generated artifact
that would need committing or per-user rendering).

### D5. MCP registration per host

- Claude Code: user scope via the documented CLI, `claude mcp add --transport stdio --scope
  user <server> -- node "<abs plugin root>/server/mcp.mjs"` (printed by `install claude`,
  verified by `plugin list` through `claude mcp get`). The plugin-cache route
  (`.mcp.json` + `${CLAUDE_PLUGIN_ROOT}`) is rejected for dependency-bearing servers (D2).
- Codex: `[mcp_servers.<server>]` with `command = "node"`, `args`, `cwd`, `env` inside the
  managed block that `scripts/install.mjs:363-371` already owns; `startup_timeout_sec`
  raised from the default 10 when the manifest asks (browser start is slow); an unmanaged
  table of the same name wins and is reported, never duplicated (D4).
- Any other MCP client: `my-flow plugin list --json` prints the exact `command` / `args` /
  `cwd` per server so a user can paste it anywhere.

### D6. Zero-dependency rule for the contract layer

`scripts/plugin.mjs` and the changes to `cli.mjs` / `install.mjs` use only `node:` modules
(JSON, fs, path, child_process for `git` and `claude mcp get`). No MCP SDK enters the core:
the core never speaks MCP, it only writes host configuration. Adding one would need the user
(`proposal.md:104`); this design proposes none.

### D7. Browser harness: repository, layers, model path

Repository `my-flow-browser` (Node `>=22.18` because of Stagehand; ESM; dependencies allowed):

```
my-flow-plugin.json  .claude-plugin/plugin.json  skills/  agents/  hooks/
server/     MCP stdio server (@modelcontextprotocol/sdk) - the only host-facing entry
gateway/    policy.mjs (allowlists, ACL, approval), mask.mjs, secrets.mjs, audit.mjs, ratelimit.mjs
driver/     stagehand.mjs (connect, observe/act/extract adapters), chromium.mjs (spawn, flags, profiles)
llm/        generate.mjs (Stagehand `model.generate` callback -> loopback gateway)   [sub-change 4 fills gateway/]
extension/  bridge extension + bridge server                                          [sub-change 5]
profiles/   named + temporary profile management                                       [sub-change 6]
test/       node --test; fixtures/pages/*.html incl. injection and password pages
specs/ changes/ .my-flow/   (my-flow init)
```

Layers (from the proposal, now bound to verified mechanisms):
1. Agent / Planner = the host model (Claude Code, Codex, any MCP client). It sees only the
   MCP tools; it never sees Stagehand, CDP or a provider key.
2. Browser Gateway = `server/` + `gateway/`: every tool call passes domain allowlist -> tab
   allowlist -> action ACL -> approval gate -> rate limit, then executes, then masks output and
   writes one audit record. Every listener binds `127.0.0.1` only.
3. Stagehand driver = `driver/`: `localBrowser.connect({ cdpUrl })` to a Chromium the harness
   spawned; `observe()` for candidate actions, `act(Action)` replay for execution,
   `extract()` behind masking. `act(string)` is never called with page-derived text; there is
   no `agent()` in v4 anyway.
4. Isolated Chromium = `driver/chromium.mjs` spawns Chrome with `--user-data-dir=<agent
   profile>`, `--remote-debugging-port=<random loopback port>`, and the flags Stagehand's
   own launch adds (`--enable-unsafe-extension-debugging`, feature flags; source in Context).
   `--remote-allow-origins=*` is **not** replicated as is: it lets any web origin open the
   CDP WebSocket on the loopback port, so a malicious page inside the agent browser could
   drive the whole browser. Spike for sub-change 2: find out which origin Stagehand needs
   the flag for (most likely the extension's own `chrome-extension://<id>` origin used by the
   service worker) and narrow the flag to `--remote-allow-origins=<that origin>`; if
   narrowing breaks the extension attach, record why and pick the narrowest working value.
   The answer is recorded in sub-change 2's `design.md`. The user's daily profile directory
   is refused by path check. Rejected alternative: `localBrowser.launch({ userDataDir })`
   (simpler, but the harness would not own the process, its flags, its `--proxy-server` for
   the outbound audit, or its lifetime).

Model path: Stagehand is created with `model: { generate }` where `generate` is the harness's
callback that POSTs the params to the loopback gateway with a task-class header
(sub-change 4). Page text leaves the harness through this callback too, so the callback
applies the same masking and secret detection as the host-facing results (D8) before the
request leaves the process, and the **harness, never the model,** sets the task-class header
from the active profile and the task's domain allowlist (`Agent-Sensitive`, or a domain
marked sensitive, -> `sensitive`; a screenshot in the request -> `browser-vision`; otherwise
`browser-extract`). The harness ships with the `generate` callback as its only model path;
Stagehand's built-in provider path is never configured and is treated as dead code (and is
still guarded by the fork, D10). Until the gateway is configured, `generate` throws
`no model gateway configured` and every LLM-dependent path is unavailable; the harness never
falls back to a provider. In `harness-core`, `browser.observe` therefore has a
**deterministic mode** (interactive elements from the DOM / accessibility tree, with XPath
selectors in the same `Action` shape) so the e2e and security scenarios of sub-change 2 run
with zero model calls; the LLM mode is added and verified in sub-change 4.

### D8. Primitive surface, wire names, default policy, injection defence

Logical names are the proposal's (`browser.open` ...). Wire names use underscores
(`browser_open`, `browser_unsafe_evaluate`) because some MCP consumers restrict tool names to
`[a-zA-Z0-9_-]` even though SEP-986 allows dots; Claude Code will show them as
`mcp__my-flow-browser__browser_open`. Surface (final; the sub-change fixes argument and
result shapes): `open, observe, read, click, type, extract, screenshot, back, tabs` and
`unsafe.evaluate, unsafe.cdp, unsafe.cookies`. Nothing else is exported; in particular no
`act(text)` tool.

Default policy (strict; any loosening needs the user, `proposal.md:107-108`):

| Action | Default |
|---|---|
| read DOM, screenshot, click, type into a non-password field | allow |
| type into a password field; read a password field's value | deny (field masked in `read` / `extract`) |
| cookies (read / write) | deny outside `unsafe.cookies`, which requires approval |
| localStorage | deny |
| clipboard, download, upload, payment submit, delete-like actions | require approval |
| `unsafe.*` | always require approval, always audited with the full payload |
| domain not in the task's allowlist; tab not granted | deny |

Approval = the MCP call returns `approval_required` with a one-time token and the harness's
local approval prompt (console / tray in `harness-core`, extension popup in
`extension-bridge`); the host re-calls with the token. Approval never comes from the host
model alone. Deterministic-first rule: locator over `act`, CSS/XPath over LLM, API over
browser, `observe` only when the page is unknown, self-heal only when a selector is unstable
(and only once, matching Stagehand's own `selfHeal` semantics).

Injection defence is architectural: page content enters the host only through `read` /
`extract` / `observe` results, wrapped as `{ untrusted: true, source: <url>, text }` and
truncated; no page text is ever interpolated into a Stagehand instruction; the only path from
observation to action is `observe -> candidate Action -> policy -> act(Action)`. The fixture
page with injected instructions is a required test in sub-change 2 and an e2e scenario on
both hosts.

Audit log: JSON lines under `~/.my-flow/browser/audit/<YYYY-MM-DD>.jsonl`, one record per
call (`ts, host, tool, profile, tab, url host, decision, approvalToken?, durationMs, error?`),
never the masked values. Rate limit and masking rules for known sensitive field types are the
sub-change's to fix (`proposal.md:120`).

### D9. Isolation, tab confinement, temporary profiles

- Named profiles `Agent-General / Agent-Work / Agent-Sensitive` under
  `~/.my-flow/browser/profiles/<name>/` (harness-core). The daily Chrome profile path is on a
  deny list; opening it with CDP is refused.
- Tab confinement (extension-bridge): tab grants exist only inside the agent-profile
  Chromium the harness spawned; there is no grant mechanism for the daily Chrome, by
  construction. The bridge extension is loaded into that Chromium the same way Stagehand's
  extension is, `Extensions.loadUnpacked` over CDP (branded Chrome 137 and later ignores
  `--load-extension`, so a command-line flag is not an option). It gives the user the gesture
  ("grant this tab") and reports `{ tabId, targetId, origin }` to the harness over a
  token-authenticated loopback WebSocket; the gateway's tab allowlist is the first
  enforcement point. Because the Stagehand extension holds `tabs` + `debugger` +
  `<all_urls>`, a second enforcement point is needed where actions are executed. Options for
  the spike in sub-change 5: (a) the fork's extension accepts an allowed-target list from the
  SDK and refuses others (preferred: enforcement next to the privilege), (b) a CDP proxy in
  the gateway filtering `Target.*` traffic (works only if actions cross the SDK socket),
  (c) one tab per profile process (weakest: a page can open tabs). The spike measures whether
  a granted-tab session can reach a second tab; (a) is the default, (b) the fallback, (c)
  never alone.
- Temporary profiles (temp-profiles): `~/.my-flow/browser/profiles/tmp-<taskId>/`, created
  from an empty directory, seeded by selective cookie import from a **named agent profile**
  (CDP `Network.getCookies` / `setCookies`, filtered by the task's domain allowlist),
  destroyed with the Chrome process at task end; destruction verified by the directory being
  gone and a fresh profile having no cookies for the seeded domains. Import from the daily
  Chrome profile is an open user decision (default: no).

### D10. Model gateway and the Stagehand fork

- Gateway (sub-change 4): loopback HTTP server, one endpoint `/llm` accepting exactly the
  `generate(params)` shape and returning the `generate` result shape, plus a header
  `x-my-flow-task: browser-extract | browser-vision | planning | sensitive`. Routing table and
  credentials in `~/.my-flow/browser/gateway.json` (file permission restricted where the OS
  allows). Providers are called with Node `fetch` over their HTTP APIs; a provider entry may
  also be an OpenAI-compatible local endpoint. `planning` is never routed (the host model
  plans); `sensitive` routes to a local model or refuses. **Provider, model names and the
  table are the user's** (`proposal.md:105-106`); the gateway ships with an empty table and
  refuses until it is filled.
- Fork (sub-change 3): branch `my-flow/privacy` on top of an upstream tag; kept rebaseable by
  limiting the diff to (i) an outbound allowlist covering **both** HTTP paths, the SDK's
  client in `packages/sdk-ts` and the extension's own one in `packages/extension/llm/` and
  `inference.ts` (with a provider model the request originates inside Chromium, not in the
  SDK; the harness never configures that path, D7, so the guard covers dead code, but it is
  the fork's job to make it dead everywhere): loopback + the gateway only, everything else
  throws and is logged; (ii) a guard that `telemetry.traces.endpoint` must be loopback;
  (iii) a network audit test. Consumption: `my-flow-browser` consumes the fork as an
  **immutable, pinned artifact that includes the built extension**, never a floating branch;
  a plain git dependency cannot address it because the npm package is `packages/sdk-ts`
  inside a monorepo that must ship the built extension. The mechanism (an `npm pack`
  tarball committed under `my-flow-browser/vendor/`, or a pushed fork tag with a `prepare`
  build step) is sub-change 3's decision, verified by `npm ls @browserbasehq/stagehand` in
  `my-flow-browser` resolving to the fork's version string. Whether the fork is pushed to
  GitHub or stays a local clone is the user's (U9, default local). Upstream tracking: rebase
  on each upstream minor, re-run the audit, rebuild the artifact. Firewall: a documented
  `netsh advfirewall` rule set for `node.exe` running the harness and for the agent Chromium
  (allow 127.0.0.1 and the gateway port, deny the rest) that the user applies by hand
  (needs administrator rights; never executed by the harness).

### D11. Tracking convention between umbrella and sub-changes

- Each sub-change `proposal.md` begins with a section `## Umbrella` placed before `## Why`:
  `Umbrella: plugin-system-browser-harness (repo my-flow, sub-change <n> of 6: <name>).
  Design source: changes/plugin-system-browser-harness/design.md D<x>, D<y>.` `spec validate`
  only requires that the standard sections exist (`scripts/lib/intent.mjs:236-239`), so the
  extra section is harmless.
- The two new repositories are initialised with `node <my-flow>/scripts/init.mjs <dir>` so
  they carry the same `specs/`, `changes/`, `.my-flow/` layout and templates; the my-flow
  scripts are run against them with `--root <dir>` (`scripts/spec.mjs:39`) or from inside
  their own Claude / Codex sessions with the installed my-flow skills.
- The umbrella `tasks.md` names, for every sub-change, the observable artefacts of each
  lifecycle step in that sub-change's repository: the change directory, `spec validate`
  exit 0, the `N/N tasks` status line, the `Verdict: PASS` report under that repository's
  `.my-flow/verify/`, and the `changes/archive/<date>-<name>/` directory.
- Verify reports live in the disposable `.my-flow/verify/` and `spec archive` does not move
  them (`scripts/spec.mjs:150-163` moves only `changes/<name>`). Therefore each archive step
  of the umbrella also copies the sub-change's PASS report to
  `MF/changes/plugin-system-browser-harness/verify/<sub-change>.md` (committed, inside the
  umbrella's own diff, which is what task 7.2 cleans and nothing else). The umbrella's final
  `mf-verify` (run in my-flow) reads those six files plus the six archive directories and
  writes its own report to
  `H:\CommonProject\workflow\VibeCoding\my-flow\.my-flow\verify\plugin-system-browser-harness-<ts>.md`,
  which is the file `spec archive` needs (`scripts/spec.mjs:132-136`).
- One loop authority: only one sub-change is at stage `execute` at a time, in whichever
  repository it lives; in MF the single state file follows sub-change 1 from `spec new
  plugin-contract` (`scripts/spec.mjs:64` overwrites it) until its archive; the umbrella has
  no stage of its own afterwards and is never at `execute`; neither `spec archive` nor
  `mf-verify` reads the umbrella's stage, so nothing depends on it. The umbrella carries no
  delta specs of its own: the two capabilities named in `proposal.md` are added by the
  sub-changes' deltas, and the umbrella archive merges nothing.
- End-to-end evidence files that are not verifier reports (`<name>-e2e-<host>.md`,
  `<name>-network-<ts>.md`) never contain the string `Verdict:`, so the archive gate
  (`scripts/spec.mjs:135`) cannot match them; precedent
  `.my-flow/verify/web-dashboard-e2e-2026-09-09T13-22.md`.

### Open user decisions (never decided silently)

| Id | Question | Default recommendation | Blocks |
|---|---|---|---|
| U1 | Any dependency in my-flow core (including an MCP SDK) | none; the contract layer writes host config only (D6) | nothing unless a sub-change wants one |
| U2 | Cheap model / provider for Stagehand and the routing table (extract / vision / planning / sensitive) | ship empty and refusing; the user fills `gateway.json` | sub-change 4 exit criterion |
| U3 | Any loosening of the default policy table (D8) | none | the sub-change that wants it |
| U4 | Any change to the four-stage flow, `core.md` stage rules or existing skills (for example `mf-verify` picking up `browser.*` automatically) | none; the harness contributes its own skills only | the sub-change that wants it |
| U5 | Cookie import into temporary profiles from the daily Chrome profile | no; import only from named agent profiles | sub-change 6 scope |
| U6 | Location of the two new repositories on disk | sibling directories of my-flow as in D1 | tasks 2.1 and 3.1 in `tasks.md` |
| U7 | Whether `install claude` may run `claude mcp add` itself instead of printing it | print (precedent `scripts/install.mjs:176-181`) | nothing; changes sub-change 1 tasks only |
| U8 | Applying the firewall rule set (administrator rights) | documented, applied by the user | sub-change 3 exit criterion |
| U9 | Push the Stagehand fork to GitHub (outward-facing) or keep it a local clone | local clone; the artifact mechanism in D10 works either way. Task 3.1 records the answer as a line `U9 answer: local` or `U9 answer: github` directly below this table | task 3.1 |

U9 answer: github

U2 answer (2026-09-12): ship the gateway with an empty routing table that refuses every model
call, and decide provider, model names and the table later. Consequence, recorded here rather
than discovered at the gate: sub-change 4's exit criterion in D1 ("LLM observe / extract /
self-heal verified end to end with the user-chosen routing table") cannot be met while the
table is empty, so sub-change 4 will finish built-and-refusing and stay unarchived, and under
D1's ordering that also holds up sub-changes 5 and 6, which do not otherwise depend on the
gateway. Resolving that is a user decision of its own: either split sub-change 4's exit
criterion (archive on a gateway that is built, unit-tested against a fake provider and refusing
by default, deferring only the real-table end-to-end) or let 5 and 6 proceed with 4 left open.

U5 answer (2026-09-12): import only from the named agent profiles (`Agent-General`,
`Agent-Work`, `Agent-Sensitive`), selectively and filtered by the task's domain allowlist. The
daily Chrome profile is never read for cookies, as everywhere else in this programme.

U3 answer (2026-09-11): the policy table is unchanged. The user closed harness-core's frame
enumeration work at the tenth verification pass (`-8d`, no defect found), redefined harness-core
task 8.3 to that pass plus success criteria 1 and 3 completed by the user, and filed the
request-level alternative as sub-change 7 (`request-interception`), accepting that pages
render with holes inside an agent-only profile.

## Risks / Trade-offs

### Pre-mortem (three scenarios)

1. **"It only ever worked in Claude Code."** Six months in, the Codex surface is broken: a
   Codex release changes `config.toml` handling (as the hooks hash already did,
   `scripts/install.mjs:355-357`), the managed `[mcp_servers.*]` block is rejected, and nobody
   noticed because the e2e ran in Claude. Mitigations: `plugin list` probes the Codex surface
   on every call (skills present, block present) and the umbrella success criterion demands
   the e2e and the security scenarios on both hosts (`proposal.md:160-168`); sub-change 1
   ships an integration test that renders the block and re-parses it; the fixture plugin keeps
   the mechanism testable without the browser.
2. **"The granted tab was a fiction."** The Stagehand extension holds `tabs`, `debugger` and
   `<all_urls>`; an observed action on the granted tab is fine, but a self-heal or a page
   script opens a second tab and the runtime acts there; the gateway's tab allowlist only saw
   target ids at call time. Mitigations: the spike is the first task of sub-change 5 and its
   result selects the enforcement point (D9 a / b); the acceptance test is "the same
   primitives fail against any other tab" (`proposal.md:169-170`); `selfHeal` stays off
   unless the selector is unstable and never inside a granted-tab session; temp-profile
   processes are killed at task end so nothing survives.
3. **"The ledger and reality drifted."** Sub-change 4 was archived in `my-flow-browser`, but
   the umbrella box stayed unticked (or was ticked early); `.my-flow/verify/` in one repo was
   lost with a worktree; the umbrella `mf-verify` trusted remembered results. Mitigations: every
   umbrella verify clause is an observable in the sub-change repository that survives
   `.my-flow/` loss (the `changes/archive/<date>-<name>/` directory and its ticked
   `tasks.md`); the umbrella's final verifier re-lists all six and copies the verdict lines;
   the state file is per repository so a stale `execute` stage in one cannot mask another.

### Other risks and trade-offs

- **Print-not-run on Claude** (D4) costs the user three manual commands per plugin; the gain is
  never editing `~/.claude.json` under a running session. Revisit under U7.
- **Deterministic observe in harness-core** duplicates a slice of what Stagehand's LLM observe
  does. It is the price of a model-free default and of testing the security boundary without
  a provider; it stays as the "page is known" branch of the deterministic-first rule.
- **Fork maintenance**: even a small diff needs a rebase per upstream release. The allowlist
  guard is the only mandatory patch; if the audit in sub-change 2 shows no default egress at
  all, sub-change 3 shrinks (D1) rather than growing a large patch set.
- **Stagehand `model` requirement**: if `Stagehand.create()` refuses a callback-only model
  without a provider, the harness-core spike falls back to a callback that returns a fixed
  refusal payload; either way no provider key exists in the process.
- **Windows-only assumptions** (firewall, `conhost`, profile paths) are accepted; the proposal's
  machine is Windows and the my-flow installer already special-cases it
  (`scripts/install.mjs:55-79`).
- **Codex startup timeout** for a browser-backed MCP server: set `startup_timeout_sec` from
  the manifest; the harness must answer `initialize` before it starts Chrome.

## Test Plan

**Unit (my-flow, `node --test`, added to `package.json:13`):** `test/plugin.test.mjs` -
manifest validation (missing fields, colliding CLI verb, bad placeholder), registry
add / remove / enable / disable round trips in a temp `MY_FLOW_HOME`, `${PLUGIN_ROOT}`
substitution, Codex skill rewrite (`/<plugin>:<skill>` -> `$<prefix><skill>`), agent TOML
rendering for a plugin role, Codex `mcp_servers` TOML block text. Fixture:
`test/fixtures/plugin-demo/` (one skill, one agent, one hook, one CLI verb, one MCP server
that is a ten-line stdio echo script with no dependency).
**Unit (my-flow-browser):** policy decisions for every row of D8 (allow / deny / approval),
password masking in `read` and `extract` fixtures, secret detection, rate limit, audit record
shape, deterministic observe on fixture pages, tool schema of the MCP server; gateway routing
by task class with a fake provider; profile path deny list.

**Integration (my-flow):** `install codex --dry-run` with the fixture enabled prints the
skill, agent, hook and `[mcp_servers.plugin-demo]` lines; a real `install codex` into a temp
`CODEX_HOME` produces files that `uninstall codex` removes byte-for-byte; `install claude
--dry-run` prints the three Claude commands with the absolute path; `my-flow plugin-demo
hello` dispatches to the fixture script; `npm run check` stays green with a plugin enabled
(proves `build` is untouched by plugins).
**Integration (my-flow-browser):** the MCP server over stdio with a minimal client
(`initialize`, `tools/list`, `tools/call browser_open` against a fixture page served on
loopback); Stagehand `observe -> act(Action)` on the fixture pages in the `Agent-General`
profile; gateway `/llm` contract test against Stagehand's `generate` params; outbound audit
harness (in-process `http` / `https` / `fetch` interception log plus Chromium
`--proxy-server` to a loopback logging proxy) producing a report listing every destination.

**End-to-end (umbrella success criteria, both hosts):** from Claude Code and from Codex, an
agent uses only `browser_*` tools to open the my-flow dashboard (`my-flow dashboard start`,
`127.0.0.1:4321`), observe, click a change, screenshot, in an isolated profile; every call is
in the audit log. Security: password field masked; download returns `approval_required` and
does not proceed without the token; the injection fixture page yields no unrequested action;
outbound audit shows only `127.0.0.1` and the gateway port. Extension bridge: one granted tab,
every primitive fails on a second tab. Temp profile: gone at task end, cookies gone. Each
host run is recorded as a transcript excerpt plus the audit lines in the sub-change's
`.my-flow/verify/` report.

**Observability:** `my-flow plugin list --json` (per-surface state), the audit JSONL, the
outbound audit report (`~/.my-flow/browser/audit/network-<ts>.md`, copied by the sub-change
to `MB/.my-flow/verify/harness-core-network-<ts>.md` and by umbrella task 2.8 to
`MF/changes/plugin-system-browser-harness/verify/harness-core-network-audit.md`, the
durable input of sub-change 3), the harness `doctor`
verb (`my-flow browser doctor`: Node version, Chrome path, profile dirs, gateway reachability,
fork tag), and Stagehand logs at `level: "info"` to stderr only (`onLog` feeds the audit,
`telemetry` left unset or pointed at a loopback collector).

## Do-Not-Touch

- `changes/execute-goal-default/` and its archived form
  `changes/archive/2026-09-10-execute-goal-default/` (already archived on 2026-09-10; still
  never edited by this programme).
- `hooks/completion-guard.mjs` (the Stop-hook execute-guard) and `hooks/session-context.mjs`.
- `scripts/spec.mjs` archive semantics (`scripts/spec.mjs:84-163`) and `scripts/lib/intent.mjs`
  validation rules; the umbrella relies on them unchanged.
- `agents/*`, `src/agents/*`, and the four role definitions; `src/skills/*` of the existing
  skills (U4).
- `scripts/build.mjs` (D4: plugins never enter `build`); `manifest.json` except when
  sub-change 1's own design proves a field is needed and the user agrees.
- The user's daily Chrome profile directory (never opened with CDP, never copied, never read
  for cookies unless U5 says otherwise).
- Upstream `browserbase/stagehand` `main`: the fork works on its own branch only.

## Rebuild / Re-run After Change

- my-flow, after any edit under `src/`, `scripts/`, `hooks/`, `test/`: `npm run build`,
  `npm run check`, `npm test`; after any surface change: `node scripts/install.mjs codex`
  (and follow the printed Claude commands), then `my-flow plugin list` to confirm both
  surfaces.
- my-flow-browser, after any edit: its own `npm test`, `npm run build` if it gains a build
  step (the bridge extension will), `my-flow browser doctor`; after a change to
  `my-flow-plugin.json` or `skills/ agents/ hooks/`: `node <my-flow>/scripts/install.mjs codex`
  and the printed Claude commands again.
- Stagehand fork, after any edit: its package build and tests, the network audit test,
  rebuild the pinned artifact (tag or tarball, D10), then `npm ci` in my-flow-browser to pick
  it up.
- After a sub-change is archived in another repository: `git -C <repo> log -1` and the
  archive directory listing, then tick the umbrella box in my-flow and re-run
  `node scripts/spec.mjs validate plugin-system-browser-harness`.
