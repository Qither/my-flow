# Independent verification: plugin-contract

Change: `changes/plugin-contract/` (sub-change 1 of the umbrella `plugin-system-browser-harness`)
Verifier: separate read-only context; did not write the code.
Machine: Windows 11, Node v24.1.0, repo `H:\CommonProject\workflow\VibeCoding\my-flow`.

Every hand-run command was executed with `MY_FLOW_HOME`, `CODEX_HOME` and `CLAUDE_CONFIG_DIR`
pointing at fresh directories under the session scratchpad (`.../scratchpad/verify1/`) and with
`MY_FLOW_SCHTASKS` pointing at the fake `scratchpad/fake-schtasks.mjs`, so the real
`~/.my-flow`, `~/.codex`, `~/.claude` and the real `my-flow-models-check` scheduled task were
never written. Proof at the end of this report.

### Verdict: PASS

Two delta-spec scenarios have no dedicated automated assertion. I exercised both by hand and
both behave as specified, so they are listed under Follow-ups, not as blockers.

## Commands run

### `npm run check`

```
> my-flow@0.1.0 check
> node scripts/build.mjs --check

generated files are up to date
CHECK_EXIT=0
```

### `npm test`

```
tests 157
suites 0
pass 157
fail 0
cancelled 0
skipped 0
todo 0
duration_ms 11148.7671
TEST_EXIT=0
```

### `node --test test/plugin.test.mjs`

21 tests, 21 pass, 0 fail, 0 skipped. The git-clone test ran rather than skipping, because
`hasGit()` is true on this machine.

```
ok manifest: the fixture is valid and fully described
ok manifest: missing file and invalid JSON
ok manifest: mutated copies yield the D2 error texts
ok renderers: placeholder substitution, skill rewrite, agent TOML, MCP tables, Claude commands
ok fixture MCP server: initialize, tools/list, tools/call, ping over stdio
ok registry: add -> list --json -> disable -> enable -> remove round trip under a temp home
ok registry: duplicate add, --dry-run, core collision, setup never executed
ok registry: a corrupt plugins.json cannot break core commands
ok list: setup, claude and codex states
ok dispatch: contributed verb, unknown verb, disabled plugin note, missing script
ok registry: --name registers under an alias and refuses core command names
ok install codex: dry-run prints the plugin lines and writes nothing
ok install codex: a real install renders skills, agent, hook and MCP table
ok install codex: no plugin registered leaves the core output unchanged
ok install codex: an unmanaged mcp_servers table wins and is reported
ok install codex: user content survives install + uninstall byte for byte
ok install codex: a disabled plugin is removed on the next install
ok install codex: a broken or missing plugin never aborts the core install
ok install claude: the three commands are printed and never executed
ok build --check is unaffected by a registered plugin
ok registry: git source is cloned under the my-flow home and deleted on remove
tests 21   pass 21   fail 0   skipped 0
```

### `node scripts/cli.mjs spec validate plugin-contract`

```
ok   plugin-contract
1 passed, 0 failed
exit=0
```

## Acceptance criteria (proposal.md Success Criteria 1-7)

### Criterion 1 - registry round trip under a temporary home: PASS

`node scripts/cli.mjs plugin add test/fixtures/plugin-demo` exited 0:

```
added plugin-demo 0.1.0 (H:/CommonProject/workflow/VibeCoding/my-flow/test/fixtures/plugin-demo) -> ...\verify1\mfh\plugins.json
setup (run it yourself; my-flow never executes it): echo demo setup
setup: pending (node_modules missing under H:/.../test/fixtures/plugin-demo)
next: node "H:\...\scripts\cli.mjs" install codex
      node "H:\...\scripts\cli.mjs" install claude
```

`plugin list --json` reported `"name": "plugin-demo"`, `"version": "0.1.0"`, the absolute
forward-slash `path`, `"enabled": true`, `"setup": { "state": "pending", "check":
"node_modules", "command": "echo demo setup" }`, `"claude": { "state": "unknown", "detail":
"claude not found" }`, `"codex": { "state": "not installed" }`, `cli.demo-hello`, and the
substituted `mcpServers["plugin-demo"]` with `command` `node`, `args[0]` the absolute
`server/mcp.mjs`, `cwd` the plugin root and `startupTimeoutSec` 20.

`plugin disable plugin-demo` moved `enabled` to false; `plugin enable plugin-demo` moved it
back to true; `plugin remove plugin-demo` printed `removed plugin-demo`, the refresh hint and
`claude mcp remove plugin-demo`, and left the registry as `{ "version": 1, "plugins": {} }`.
`plugin list` afterwards printed `no plugins registered (my-flow plugin add <path|git-url>)`
and exited 0. `plugin enable nosuch` exited 1 with
`plugin enable: plugin "nosuch" is not registered`.

Deliberate deviation from the literal wording. The criterion's last clause says "with
`MY_FLOW_HOME` unset". Running with the variable unset would read the user's real
`~/.my-flow`, which this verification is required to leave alone. I used a second, empty
temporary home instead, which proves the same property: the registry is per-home. The real
`~/.my-flow/plugins.json` does not exist before or after this verification, which is the same
evidence from the other side.

### Criterion 2 - Codex dry-run renders the plugin, duplicate table skipped: PASS

With the fixture registered, `node scripts/install.mjs codex --dry-run` printed, among the
core lines:

```
[dry-run] add ...\verify1\cxh\skills\plugin-demo-demo
[dry-run] add ...\verify1\cxh\agents\demo-reviewer.toml
[dry-run] add hook SessionStart: powershell.exe -NoProfile -ExecutionPolicy Bypass -File "...\cxh\hooks\my-flow-shim.ps1" -Script "H:/.../test/fixtures/plugin-demo/hooks/demo-hook.mjs"
[dry-run] add [mcp_servers.plugin-demo]
[dry-run]   [mcp_servers.plugin-demo]
[dry-run]   command = "node"
[dry-run]   args = ["H:/.../test/fixtures/plugin-demo/server/mcp.mjs"]
[dry-run]   cwd = "H:/.../test/fixtures/plugin-demo"
[dry-run]   startup_timeout_sec = 20
plugin plugin-demo: skills plugin-demo-*, mcp plugin-demo
```

`CODEX_HOME` held zero entries afterwards, so the dry run wrote nothing.

With `[mcp_servers.plugin-demo]` and `command = "x"` planted above the managed block, the dry
run printed exactly one relevant line:

```
[dry-run] skip [mcp_servers.plugin-demo]: defined outside the my-flow block; remove it first to let my-flow manage it
```

A following real `install codex` left `grep -c '^\[mcp_servers\.plugin-demo\]' config.toml`
equal to 1, the user's own table, with no plugin table inside the managed block.

A real `install codex` into a clean temporary `CODEX_HOME` produced:

- `skills/plugin-demo-demo/SKILL.md` with `name: plugin-demo-demo`, `$plugin-demo-demo`, the
  absolute plugin root in place of the Claude plugin-root placeholder, and no placeholder left;
- `skills/plugin-demo-demo/.my-flow-plugin` containing `plugin-demo`;
- `agents/demo-reviewer.toml` whose first line is
  `# my-flow agent: demo-reviewer (plugin plugin-demo, written by my-flow install codex - edit H:/.../agents/demo-reviewer.md instead)`,
  followed by `name`, `description` and a `developer_instructions` literal string;
- `hooks.json` whose `hooks.SessionStart` has two groups, the plugin group last, its command
  ending `-Script "H:/.../hooks/demo-hook.mjs"`, plus a third `[hooks.state...]` trust entry
  (`session_start:1:0`) generated for it by the existing trust loop;
- a managed block carrying the `# Plugin MCP servers (...)` comment and
  `[mcp_servers.plugin-demo]` with `command = "node"`, `args`, `cwd` and
  `startup_timeout_sec = 20`.

### Criterion 3 - Claude commands printed, never run: PASS

`node scripts/install.mjs claude --dry-run` printed:

```
plugin plugin-demo (run in a terminal, not inside a Claude session):
  claude plugin marketplace add "H:/CommonProject/workflow/VibeCoding/my-flow/test/fixtures/plugin-demo"
  claude plugin install plugin-demo@plugin-demo
  claude mcp add --transport stdio --scope user plugin-demo -- node "H:/.../test/fixtures/plugin-demo/server/mcp.mjs"
```

`CLAUDE_CONFIG_DIR` held zero entries after the dry run. With a fake `claude.cmd` (and a
`claude` shell script) that writes a sentinel file, prepended to `PATH`, the sentinel was
absent after the dry run, after a real `install claude` into the temporary
`CLAUDE_CONFIG_DIR`, and after `--uninstall claude --dry-run`, which printed
`claude mcp remove plugin-demo` and `claude plugin disable plugin-demo@plugin-demo`.

### Criterion 4 - contributed verb, unknown verb, core collision: PASS

```
$ node scripts/cli.mjs demo-hello a b
hello from plugin-demo at H:/CommonProject/workflow/VibeCoding/my-flow/test/fixtures/plugin-demo
a b
exit=0
```

`node scripts/cli.mjs nope` printed the usage text, whose last line is
`  demo-hello ...   (plugin plugin-demo)`, and exited 1. After `plugin disable plugin-demo`,
`demo-hello` exited 1 with the stderr line
`note: "demo-hello" is contributed by plugin "plugin-demo", which is disabled (my-flow plugin enable plugin-demo)`.
`plugin add` on a copy whose `contributes.cli` maps the verb `spec` exited 1 with
`plugin add: <copy>/my-flow-plugin.json: cli verb "spec" collides with core command "spec"`
and wrote no `plugins.json`; the target home stayed empty.

### Criterion 5 - build untouched, package.json only in `test`: PASS

`git diff --stat -- scripts/build.mjs` produced no output. The `package.json` diff is exactly
one changed line, appending `test/plugin.test.mjs` to the `test` script. `npm run check` and
`npm test` both exit 0, as recorded above.

### Criterion 6 - spike result recorded: PASS with an open item

`grep -c "^spike result: \|^spike pending: user has not run the commands" changes/plugin-contract/design.md`
prints 1; line 530 reads `spike pending: user has not run the commands`. The user-run
instructions exist at `.my-flow/tmp/plugin-contract-spike.md` and name the exact commands and
the comparison to make. This satisfies task 4.1 and the design's recorded fallback, but the
underlying question, cache copy or in place, is still unanswered and needs the user to run two
`claude plugin` commands outside a session.

### Criterion 7 - documentation: PASS

`src/core/core.md` has a new `## 8. Plugins` section covering the manifest, the five verbs, the
install flow and the rule that a plugin skill reaches dependency-bearing code only through
`my-flow <verb>`. `grep -c "## 8. Plugins"` prints 1 for both `claude/CLAUDE.block.md` and
`codex/AGENTS.block.md`, and `npm run check` proves they match the source. All eight READMEs
carry the `plugin add|remove|list|enable|disable` CLI table row directly after the `models`
row, a Plugins section as section 11 directly before the intent-layer section, with translated
headings in the seven translations, a matching table-of-contents entry and consistent
renumbering through section 16. `grep -l "my-flow-plugin.json" README*.md | wc -l` prints 8.

## Do-Not-Touch

`git diff --stat` covers only allowed files:

```
 README.de.md           |  56 ++++++++++++--
 README.es.md           |  55 +++++++++++--
 README.fr.md           |  55 +++++++++++--
 README.ja.md           |  54 +++++++++++--
 README.ko.md           |  54 +++++++++++--
 README.md              |  55 +++++++++++--
 README.zh-CN.md        |  48 ++++++++++--
 README.zh-TW.md        |  48 ++++++++++--
 claude/CLAUDE.block.md |  22 ++++++
 codex/AGENTS.block.md  |  22 ++++++
 package.json           |   2 +-
 scripts/cli.mjs        |  50 +++++++++++-
 scripts/install.mjs    | 206 ++++++++++++++++++++++++++++++++++++++++++++++++-
 src/core/core.md       |  22 ++++++
 14 files changed, 702 insertions(+), 47 deletions(-)
```

`scripts/build.mjs`, `manifest.json`, `hooks/*`, `agents/*`, `src/agents/*`, the existing
`src/skills/*`, `scripts/spec.mjs` and `scripts/lib/intent.mjs` are absent from the diff, so
none of them changed. The new untracked files are exactly `scripts/plugin.mjs`,
`scripts/lib/plugins.mjs`, `test/plugin.test.mjs` and `test/fixtures/plugin-demo/**`. The
fixture includes a `README.md` beyond design D11's list; the fixture skill references it, so it
is intended rather than stray.

For the umbrella, `changes/plugin-system-browser-harness/design.md` (mtime 00:14) and
`proposal.md` (23:34) predate this execution run and were not touched. Only its `tasks.md`
(01:46) changed, which is the outer loop's ledger, not this sub-change's diff.
`find changes/archive -type f -newermt "2026-09-11 00:50"` returned nothing, so the archive is
untouched.

## Delta spec coverage

| Requirement | Code | Automated test | Hand-checked here |
|---|---|---|---|
| Plugin manifest validation | `scripts/lib/plugins.mjs` `loadManifest` | 3 tests, 34 assertions | valid fixture, `spec` verb collision, both-fields-missing case |
| Plugin registry commands | `scripts/plugin.mjs` plus `readRegistry` / `writeRegistry` | 4 tests including the git clone | add, disable, enable, remove, second home |
| Plugin listing and states | `plugin list` in `scripts/plugin.mjs` | `list: setup, claude and codex states` | text and JSON layout, empty registry |
| Contributed verb dispatch | `scripts/cli.mjs` dynamic import plus `resolvePluginVerb` | dispatch test, corrupt-registry test | verb runs, unknown verb, disabled note |
| Codex surface rendering | `scripts/install.mjs` render steps | 6 install-codex tests | full real install, duplicate skip, replace-not-skip, disabled removal, missing path |
| Claude commands printed, never run | `claudeCommands` and the two print blocks | `install claude: ...` | dry run, real install, sentinel absent |
| Uninstall codex removes exactly what install wrote | `removeStalePluginContent` plus existing marker steps | byte-for-byte test | planted files byte-identical, removal without the registry |
| Dry-run behaviour | the `log` / `write` discipline | dry-run tests | `CODEX_HOME` and `CLAUDE_CONFIG_DIR` empty after dry runs |

Two scenarios in the delta spec have no direct automated assertion. I exercised both by hand.

1. **All violations are reported at once.** The test file asserts
   `name is required and must be kebab-case` and `version must be semver` on two separate
   mutated copies through `loadManifest`, not both at once through `plugin add` stderr. Hand
   run on a copy with both fields deleted:

   ```
   plugin add: <copy>/my-flow-plugin.json: name is required and must be kebab-case
   plugin add: <copy>/my-flow-plugin.json: version must be semver
   plugin add: <copy>/my-flow-plugin.json: .claude-plugin/marketplace.json must list plugin "undefined"
   exit=1
   ```

   Behaviour matches the scenario. The third line is a cascade of the missing `name` and reads
   `plugin "undefined"`; cosmetic only.

2. **Removal does not need the registry.** Hand run: register the fixture, `install codex`,
   `plugin remove plugin-demo`, then `uninstall codex`. Result: the skill directory is gone,
   `agents/demo-reviewer.toml` is gone, no `[mcp_servers.plugin-demo]` header remains, no shim
   entry remains in `hooks.json`, exit 0.

Two further scenarios I re-ran by hand for fresh evidence, both matching the spec:

- A second `install codex --dry-run` after a real install printed
  `[dry-run] replace ...\skills\plugin-demo-demo` and no `skip` line for that directory. It
  also printed the `[dry-run] remove` line from step 1, which is the design's marker sweep, not
  a skip.
- After `plugin disable plugin-demo`, a fresh `install codex` removed the skill directory, the
  agent TOML, the hook entry and the MCP table from `CODEX_HOME`.

## Diff hygiene

A grep over `scripts/plugin.mjs`, `scripts/lib/plugins.mjs`, `test/plugin.test.mjs`,
`test/fixtures/plugin-demo/**`, `scripts/cli.mjs` and `scripts/install.mjs` found no `TODO`,
`FIXME`, `XXX`, `HACK`, "not implemented", `debugger`, `console.debug` or `console.dir`, and no
`.only`, `.skip` or `test.todo` in the test file. The test file holds 215 `assert.` calls, and
every one of the 21 tests carries at least two. `scripts/lib/plugins.mjs` and
`scripts/plugin.mjs` import only `node:` built-ins plus `./models.mjs` and each other, so the
zero-dependency promise holds, and the existing style test asserting no runtime dependencies
still passes. `scripts/cli.mjs` has no static import of the plugin library; it uses
`await import('./lib/plugins.mjs')` only for the usage text and for non-core verbs, which is
what keeps a corrupt registry away from `build --check`.

The fixture MCP server was driven directly over stdio and answered correctly with exactly three
stdout lines and one stderr line:

```
{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":"2025-06-18","capabilities":{"tools":{}},"serverInfo":{"name":"plugin-demo","version":"0.1.0"}}}
{"jsonrpc":"2.0","id":2,"result":{"tools":[{"name":"echo","description":"Returns the given text unchanged.","inputSchema":{...}}]}}
{"jsonrpc":"2.0","id":3,"result":{"content":[{"type":"text","text":"hi"}]}}
stderr: plugin-demo mcp: notification notifications/initialized
```

## Safety of this verification

- `~/.my-flow/plugins.json` did not exist before the run and does not exist after it, and
  `~/.my-flow/plugins/` does not exist.
- `~/.codex/skills/` contains no `plugin-demo` directory.
- Every install and uninstall ran with `MY_FLOW_SCHTASKS` set to the fake script. The fake's
  log recorded the `/create` and `/delete` argv, so the real `my-flow-models-check` scheduled
  task was never reached.
- No real `claude` or `codex` binary was executed. The Claude probe ran with
  `MY_FLOW_PLUGIN_FAKE_CLAUDE=missing`, and the sentinel `claude` placed first on `PATH` was
  never invoked.
- No file outside `.my-flow/verify/` was written by this verification.

## Follow-ups (non-blocking)

1. Add two assertions to `test/plugin.test.mjs`: one `plugin add` on a copy missing both `name`
   and `version` asserting both stderr lines, and one `uninstall codex` after `plugin remove`
   asserting the plugin content still goes away. Both behaviours are correct today, but only
   the code, not a test, protects them.
2. When `name` is missing, the marketplace check emits `must list plugin "undefined"`.
   Suppressing that cascade would make the first-round error list cleaner for a plugin author.
3. The D2 spike is still pending. Ask the user to run the two commands recorded in
   `.my-flow/tmp/plugin-contract-spike.md` and replace the pending line with the observed
   result before the umbrella closes.

---

## Addendum (umbrella copy, written by the execute run)

After this PASS the two assertions of follow-up 1 were added to `test/plugin.test.mjs`
(a `plugin add` on a copy missing both `name` and `version`, and an `uninstall codex` after
`plugin remove`). No source file changed. Re-run afterwards: `npm test` 159 pass, 0 fail;
`npm run check` exit 0. Follow-ups 2 and 3 are carried forward: the `undefined` cascade in the
marketplace check, and the D2 spike, which stays pending until the user runs the commands in
`.my-flow/tmp/plugin-contract-spike.md`.
