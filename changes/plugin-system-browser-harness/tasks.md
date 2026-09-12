Umbrella ledger. Paths: MF = `H:/CommonProject/workflow/VibeCoding/my-flow`,
MB = `H:/CommonProject/workflow/VibeCoding/my-flow-browser`,
SF = `H:/CommonProject/workflow/VibeCoding/stagehand` (fork). `spec` = `node MF/scripts/spec.mjs`.
Only one sub-change may be at stage `execute` at a time, in any repository. Tick a box only
after its own verify clause passed with fresh output. Every `spec new` task writes the
sub-change's D1 capability (`plugin-contract`, `browser-harness`, `stagehand-privacy`,
`model-gateway`, `extension-bridge`, `temp-profiles`) under `### New Capabilities` in its
proposal.md, because mf-plan writes delta specs only for listed capabilities
(src/skills/mf-plan.md:58-60) and the archive clauses in 1.6, 2.8, 3.6, 4.5, 5.5 and 6.5 depend
on that delta being merged.

## 1. plugin-contract (repo my-flow)

- [x] 1.1 Confirm the entry criterion: `spec status --root MF` shows no change at stage `execute` and this umbrella at stage `mf-plan`, and verify the printed rows contain no `(execute)` and one `plugin-system-browser-harness <- current (mf-plan)` line
- [x] 1.2 Create `MF/changes/plugin-contract/` with `spec new plugin-contract --root MF`, write its `proposal.md` from design.md D2-D6 and D11 with the `## Umbrella` section first (`Umbrella: plugin-system-browser-harness (repo my-flow, sub-change 1 of 6: plugin-contract). Design source: ... D2, D3, D4, D5, D6, D11.`), its Non-Goals copied from the umbrella's Non-Goals, U1 and U7 under Decision Boundaries, the line `` `plugin-contract` `` under `### New Capabilities`, and under `## What Changes` the sentence `Merging happens in install, not build: scripts/build.mjs stays plugin-free because its outputs are committed and gated by --check (umbrella design D4).` so the user sees the deviation once more, and verify `spec validate plugin-contract --root MF` exits 0, `grep -c "^## Umbrella" MF/changes/plugin-contract/proposal.md` prints 1, `grep -c "stays plugin-free" MF/changes/plugin-contract/proposal.md` prints 1, and `grep -A3 "^### New Capabilities" MF/changes/plugin-contract/proposal.md | grep -c "plugin-contract"` is at least 1
- [x] 1.3 Plan it with `mf-plan plugin-contract --deliberate` (touches `scripts/cli.mjs` and `scripts/install.mjs`; the plan must keep `scripts/build.mjs` untouched, add `test/plugin.test.mjs` to `package.json` `test`, include the fixture plugin `test/fixtures/plugin-demo/` with one skill, one agent, one hook, one CLI verb, one dependency-free stdio MCP echo server and its own `.claude-plugin/marketplace.json`, include the duplicate `[mcp_servers.<name>]` skip-and-warn rule (D4) and the `plugin list` states `claude: unknown` and `setup: pending` (D4), and carry the spike from design.md D2 on whether a local-marketplace plugin is copied to the cache or used in place), and verify `spec status plugin-contract --root MF` reads `design=done tasks=done`, `spec validate plugin-contract --root MF` exits 0, `grep -c "scripts/build.mjs" MF/changes/plugin-contract/design.md` finds it only under `## Do-Not-Touch`, and `grep -c -i "spike" MF/changes/plugin-contract/tasks.md` is at least 1
- [x] 1.4 Execute it with `execute plugin-contract` (goal handoff, task loop, final gate), and verify `spec status plugin-contract --root MF` shows `N/N tasks` with N equal to the total, `npm run check` and `npm test` exit 0 in MF, with MY_FLOW_HOME set to a fresh temporary directory (scripts/lib/models.mjs:47), `node MF/scripts/cli.mjs plugin add MF/test/fixtures/plugin-demo` then `plugin list --json` lists `plugin-demo`, and `node MF/scripts/install.mjs codex --dry-run` prints a `[mcp_servers.plugin-demo]` line; afterwards `plugin list` with MY_FLOW_HOME unset does not list `plugin-demo`
- [x] 1.5 Verify it independently with `mf-verify plugin-contract` in a fresh context, and verify a file `MF/.my-flow/verify/plugin-contract-*.md` exists whose text contains `### Verdict: PASS`
- [x] 1.6 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/plugin-contract.md`, then archive with `spec archive plugin-contract --root MF`, and verify a directory `MF/changes/archive/<date>-plugin-contract/` exists, `MF/changes/plugin-contract/` does not, `MF/specs/plugin-contract/spec.md` contains at least one `### Requirement:` heading with a `<!-- via: <date>-plugin-contract -->` line, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/plugin-contract.md` prints 1

## 2. harness-core (repo my-flow-browser)

- [x] 2.1 Create the repository at MB (`git init`, `package.json` with `"engines": {"node": ">=22.18"}` and `"type": "module"`, MIT licence, `node MF/scripts/init.mjs MB`), and verify `MB/changes/.templates/tasks.md`, `MB/specs/README.md` and `MB/.my-flow/state/` exist, `git -C MB status` exits 0, and `grep -c ".my-flow/" MB/.gitignore` prints 1
- [x] 2.2 Create `MB/changes/harness-core/` with `spec new harness-core --root MB`, write its `proposal.md` from design.md D7-D9 (layers, primitive surface and wire names, default policy table, deterministic-first rule, injection defence, model-free default with deterministic observe, named profiles, outbound audit as an output) with the `## Umbrella` section first (sub-change 2 of 6), U3 / U4 in its Decision Boundaries and `` `browser-harness` `` under `### New Capabilities`, and verify `spec validate harness-core --root MB` exits 0, `grep -c "browser_unsafe_" MB/changes/harness-core/proposal.md` is at least 1, and `grep -A3 "^### New Capabilities" MB/changes/harness-core/proposal.md | grep -c "browser-harness"` is at least 1
- [x] 2.3 Plan it with `mf-plan harness-core --deliberate` in MB (the plan must contain the three spikes from design.md Context and D7: `Stagehand.create()` with a refusing `model.generate`, the outbound audit harness, and the origin behind `--remote-allow-origins=*` with the narrowed flag recorded in sub-change 2's `design.md`; the MCP server must answer `initialize` before Chrome starts; the `generate` callback applies the D8 masking and sets the task-class header itself), and verify `spec status harness-core --root MB` reads `design=done tasks=done`, `spec validate harness-core --root MB` exits 0, `grep -c -i "spike" MB/changes/harness-core/tasks.md` is at least 3, and `grep -c "remote-allow-origins" MB/changes/harness-core/design.md` is at least 1
- [ ] 2.4 Execute it with `execute harness-core` in MB, then register the plugin in my-flow with `node MF/scripts/cli.mjs plugin add MB`, and verify `spec status harness-core --root MB` shows `N/N tasks`, `npm test` exits 0 in MB, `node MF/scripts/cli.mjs plugin list` shows `my-flow-browser` as `[enabled]` with `setup: ok`, and the outbound audit report `~/.my-flow/browser/audit/network-<ts>.md` (design.md Observability) lists only `127.0.0.1` destinations and a copy exists at `MB/.my-flow/verify/harness-core-network-<ts>.md` (split from the former 2.4 so that the host-surface installation, which only the user can run, is tracked separately in 2.5)
  - blocked: one of this task's four verify clauses is not satisfied, (b) below. Clause (a)
    is met since 2026-09-11: after the user completed success criteria 1 and 3 (2.5, 2.6),
    the eleventh verification pass returned PASS (`MB/.my-flow/verify/harness-core-verify-9-20260911T145044Z.md`),
    harness-core is archived at `MB/changes/archive/2026-09-11-harness-core/` with 28/28
    tasks, and `plugin list` shows `my-flow-browser 0.1.0 [enabled]`, `setup: ok`, both
    surfaces installed; `npm test` exits 0 in MB.
    (b) The outbound audit report does NOT list only `127.0.0.1` destinations, and this
    is a measurement rather than a mistake. The harness process itself reached nothing
    but loopback (every `node fetch` / `node net.connect` / `node websocket` row is
    127.0.0.1), which is the property this sub-change exists to establish, and harness-core
    D12 only promises that Chromium's own traffic is listed, not absent. Chromium
    additionally attempted `accounts.google.com:443`, `www.google.com:443`,
    `android.clients.google.com:443`, `update.googleapis.com:443` and
    `mtalk.google.com:5228`, all refused by the audit proxy (`via proxy`). The D9 flag set
    does not suppress Chrome's own background networking, contradicting what D12
    predicted. Narrowing it needs more flags or a permanent loopback proxy in front of
    the agent browser, which changes D9 and is the user's decision (U3): either this
    clause is rewritten to D12's actual promise (harness rows loopback only; non-loopback
    rows all `via proxy`, refused, and carried forward in 2.8 as input for sub-change 3)
    and the Chrome quieting becomes its own sub-change after 7, or this task stays
    blocked until D9 is narrowed. Recorded as `spike b` in
    `MB/changes/harness-core/design.md`; the current report copy is
    `MB/.my-flow/verify/harness-core-network-20260911T130540Z.md` (regenerated at 0f5976f).
- [x] 2.5 Apply both host surfaces for the registered plugin: `node MF/scripts/install.mjs codex`, then print the three Claude commands and ask the user to run them in a terminal outside the session, continuing only after the user confirms (D4 forbids running them from inside a session), and verify `node MF/scripts/cli.mjs plugin list` shows `my-flow-browser` with `codex: installed` and `claude: installed`, and `~/.codex/config.toml` contains exactly one `[mcp_servers.my-flow-browser]` table inside the managed block
  - done 2026-09-11 by the user in a terminal outside any session: `install codex` (backups
    under `~/.codex/.my-flow-backup/2026-09-11T10-23-13`, scheduled task re-registered),
    then the three Claude commands. Verified: `plugin list` shows `codex: installed` and
    `claude: installed`; `grep -c "^[mcp_servers.my-flow-browser]" ~/.codex/config.toml`
    prints 1 and the table sits inside the managed block; `claude mcp get my-flow-browser`
    reports `Status: Connected`.
- [x] 2.6 Run the model-free end-to-end on both hosts (Claude Code and Codex: open the my-flow dashboard, observe, click, screenshot in profile `Agent-General`; password masking, download approval, injection fixture treated as data), and verify `MB/.my-flow/verify/harness-core-e2e-claude.md` and `MB/.my-flow/verify/harness-core-e2e-codex.md` exist (transcript excerpt plus audit lines, never containing the string `Verdict:`, so the archive gate at scripts/spec.mjs:135 cannot match them) and each quotes audit JSONL lines for `browser_open`, `browser_observe`, `browser_click` and `browser_screenshot` and one `approval_required` line for the download
  - done 2026-09-11 by the user: Claude Code run 10:32-10:35Z (11 records, download click
    `approval_required` then approved via the PowerShell prompt and `allow`), Codex run
    11:27-11:30Z (9 records including two `error` from a profile collision with the Chrome the
    Claude run left behind, then the four steps `allow` and the download click
    `approval_required`). Both files filled; `grep -c "Verdict:"` is 0 on each, each quotes
    `browser_open`, `browser_observe`, `browser_click`, `browser_screenshot` and one
    `"decision":"approval_required"` line. Note for harness-core: a second host starting
    Chrome on a profile another MCP server still holds gets only the 15 s DevTools timeout,
    not a message naming the holder (`state/session-<pid>.json` knows it); usability, not
    security.
- [x] 2.7 Verify it independently under the acceptance the user set for harness-core task 8.3 on 2026-09-11: the `-8d` pass found no defect, success criteria 1 and 3 are completed by the user through 2.5 and 2.6, then one `mf-verify harness-core` pass in MB in a fresh context that covers the commits after `-8d` (004ad7c onward) and reads that acceptance, and verify a file `MB/.my-flow/verify/harness-core-*.md` newer than `harness-core-verify-8d.md` exists whose text contains `### Verdict: PASS`
  - unblocked 2026-09-11: 2.5 and 2.6 are done by the user, so the pass can run. Ten
    verification passes exist under `MB/.my-flow/verify/`; the tenth (`-8d`, at 279a665)
    found no defect. The pass must cover 004ad7c, 5cdd638 and 0f5976f (the commits after
    `-8d`; 0f5976f is the archived `agent-window-visible` change) and read harness-core
    8.3's acceptance. The frame-enumeration work that the first nine passes kept finding
    defects in is closed by the user's decision and its request-level alternative is
    sub-change 7; nothing in this task waits on it.
- [x] 2.8 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/harness-core.md` and the network audit copy `MB/.my-flow/verify/harness-core-network-<ts>.md` to `MF/changes/plugin-system-browser-harness/verify/harness-core-network-audit.md` (durable input for sub-change 3 in another repo), then archive with `spec archive harness-core --root MB`, and verify `MB/changes/archive/<date>-harness-core/` exists, `MB/changes/harness-core/` does not, `MB/specs/browser-harness/spec.md` exists, `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/harness-core.md` prints 1, and `MF/changes/plugin-system-browser-harness/verify/harness-core-network-audit.md` exists

## 3. stagehand-fork (repo stagehand fork)

- [x] 3.1 Obtain the user's answer to U9 (push the fork to GitHub or keep it a local clone; default local) and create the fork at SF (`git clone` of `https://github.com/browserbase/stagehand` at the upstream tag that maps to the `@browserbasehq/stagehand` version in `MB/package.json`, found with `git -C SF tag` after the clone, branch `my-flow/privacy`, `node MF/scripts/init.mjs SF`, pushed only if U9 says so), and verify `git -C SF branch --show-current` prints `my-flow/privacy`, `git -C SF describe --tags` prints the upstream tag, `SF/changes/.templates/tasks.md` exists, and the U9 answer is recorded as a line directly below the open-decision table in `MF/changes/plugin-system-browser-harness/design.md` so that `grep -cE "U9 answer: (local|github)$" MF/changes/plugin-system-browser-harness/design.md` prints 1
- [x] 3.2 Create `SF/changes/stagehand-fork/` with `spec new stagehand-fork --root SF`, write its `proposal.md` from design.md D10 (allowlist guard in both the SDK and the extension HTTP paths, loopback-only `telemetry.traces.endpoint`, network audit test, firewall rule document, upstream tracking, and the pinned-artifact consumption mechanism as its own decision) with the `## Umbrella` section first (sub-change 3 of 6), `MF/changes/plugin-system-browser-harness/verify/harness-core-network-audit.md` named as its input, U8 and U9 in its Decision Boundaries, and `` `stagehand-privacy` `` under `### New Capabilities`, and verify `spec validate stagehand-fork --root SF` exits 0, `grep -c "Umbrella" SF/changes/stagehand-fork/proposal.md` is at least 1, `grep -c "packages/extension" SF/changes/stagehand-fork/proposal.md` is at least 1, `grep -c "harness-core-network-audit.md" SF/changes/stagehand-fork/proposal.md` is at least 1, and `grep -A3 "^### New Capabilities" SF/changes/stagehand-fork/proposal.md | grep -c "stagehand-privacy"` is at least 1
- [x] 3.3 Plan it with `mf-plan stagehand-fork --deliberate` in SF (scope may shrink per design.md D1 if the audit showed no default egress, but the allowlist guard, the audit test and the firewall document stay), and verify `spec status stagehand-fork --root SF` reads `design=done tasks=done` and `spec validate stagehand-fork --root SF` exits 0
- [x] 3.4 Execute it with `execute stagehand-fork` in SF, tag the result, build the pinned artifact that includes the built extension (tarball under `MB/vendor/` or a pushed tag with a `prepare` step, per sub-change 3's design), and point `MB/package.json` at it, and verify `spec status stagehand-fork --root SF` shows `N/N tasks`, the fork's own test command exits 0 including the network audit test, `git -C SF tag --points-at HEAD` prints the new tag, and in MB `npm ci` exits 0, `npm ls @browserbasehq/stagehand` resolves to the fork's version string, and `npm test` exits 0
  - was blocked, now done: executed and archived on 2026-09-12. SF `my-flow/privacy` at
    1701669f5; the change is `changes/archive/2026-09-12-stagehand-fork/` with 30/30 ticked and
    `specs/stagehand-privacy/spec.md` merged (6 requirements). MB consumes the artifact:
    `npm ci` exits 0, `npm ls @browserbasehq/stagehand` prints `4.1.0-myflow.1`, `npm test`
    199/199 with 0 skipped.
    .
    Two clauses read against their intent rather than their letter, both recorded here rather
    than quietly: (i) "the fork's own test command exits 0 including the network audit test" -
    the network audit test passes and every file that passed at the base tag still passes, but
    `test:unit` and `test:browser` exit 1 because of two upstream files that fail on this
    Windows checkout exactly as they did before any edit (`spawn npm ENOENT`; a test whose own
    path code yields a doubled drive letter). The user accepted that reading on 2026-09-12.
    (ii) "`git -C SF tag --points-at HEAD` prints the new tag" - the tag sits on `eacd8ace9`,
    the commit the artifact was packed from, and HEAD has since moved on by five ledger-only
    commits (`git diff --stat eacd8ace9..HEAD -- packages docs` is empty). `git tag --points-at
    eacd8ace9` prints it. The clause's intent, that the artifact's commit is tagged and the
    integrity chain holds, is satisfied; moving the tag to HEAD would break the chain the
    tarball's sha512 anchors.
- [x] 3.5 Verify it independently with `mf-verify stagehand-fork` in SF, and verify a file `SF/.my-flow/verify/stagehand-fork-*.md` exists whose text contains `### Verdict: PASS`
  - was blocked, now done: the final independent pass returned PASS at a6cda64f5 -
    `SF/.my-flow/verify/stagehand-fork-20260912T053120Z.md`, containing `### Verdict: PASS`.
    It took three passes: INCOMPLETE pending the user's two decisions, INCOMPLETE again on a
    ledger defect the re-tick had introduced (four task lines lost their text), and PASS once
    both were resolved.
- [x] 3.6 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/stagehand-fork.md`, then archive with `spec archive stagehand-fork --root SF`, and verify `SF/changes/archive/<date>-stagehand-fork/` exists, `SF/changes/stagehand-fork/` does not, `SF/specs/stagehand-privacy/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/stagehand-fork.md` prints 1
  - was blocked, now done: PASS report copied to
    `MF/changes/plugin-system-browser-harness/verify/stagehand-fork.md` (`grep -c "Verdict:
    PASS"` prints 1); `spec archive stagehand-fork --root SF` merged the delta and moved the
    change; `SF/changes/archive/2026-09-12-stagehand-fork/` exists, `SF/changes/stagehand-fork/`
    does not, and `SF/specs/stagehand-privacy/spec.md` carries its 6 requirements.
- [x] 4.1 Obtain the user's answer to U2 (provider, model names, routing table for extract / vision / planning / sensitive) and record it in `MB/changes/model-gateway/proposal.md` Decision Boundaries after creating the change with `spec new model-gateway --root MB` and writing the proposal from design.md D7 (model path) and D10 (gateway) with the `## Umbrella` section first (sub-change 4 of 6) and `` `model-gateway` `` under `### New Capabilities`, and verify `spec validate model-gateway --root MB` exits 0, `grep -c "Routing table (user decision U2)" MB/changes/model-gateway/proposal.md` prints 1, and `grep -A3 "^### New Capabilities" MB/changes/model-gateway/proposal.md | grep -c "model-gateway"` is at least 1
  - note: U2 answered 2026-09-12 (ship the gateway empty and refusing; provider, models and
    the table deferred), recorded under the decision table in `design.md` together with its
    consequence: D1's exit criterion for this sub-change cannot be met while the table is
    empty, so it will finish built-and-refusing and stay unarchived until the user names a
    provider or splits that criterion. `MB/changes/model-gateway/` was created by copying
    `MB/changes/.templates/{proposal,design,tasks}.md`, which is what `spec new` does minus its
    `setState` call, because MB's current-change state belonged to another session's
    `request-interception` run at the time.
- [ ] 4.2 Plan it with `mf-plan model-gateway --deliberate` in MB (credentials only in `~/.my-flow/browser/gateway.json`; `/llm` mirrors the Stagehand `generate` params and result; `planning` never routed; empty table refuses), and verify `spec status model-gateway --root MB` reads `design=done tasks=done` and `spec validate model-gateway --root MB` exits 0
- [ ] 4.3 Execute it with `execute model-gateway` in MB, and verify `spec status model-gateway --root MB` shows `N/N tasks`, `npm test` exits 0 in MB, the harness process started with `MY_FLOW_BROWSER_GATEWAY` unset makes zero provider calls in the outbound audit, and with the user's table the LLM `browser_observe` and `browser_extract` succeed on the fixture pages while the audit lists only `127.0.0.1` and the gateway port
- [ ] 4.4 Verify it independently with `mf-verify model-gateway` in MB, and verify a file `MB/.my-flow/verify/model-gateway-*.md` exists whose text contains `### Verdict: PASS`
- [ ] 4.5 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/model-gateway.md`, then archive with `spec archive model-gateway --root MB`, and verify `MB/changes/archive/<date>-model-gateway/` exists, `MB/changes/model-gateway/` does not, `MB/specs/model-gateway/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/model-gateway.md` prints 1

## 5. extension-bridge (repo my-flow-browser)

- [x] 5.1 Create `MB/changes/extension-bridge/` with `spec new extension-bridge --root MB`, write its `proposal.md` from design.md D9 (bridge extension, loopback WebSocket grant, gateway tab allowlist, spike on tab reachability with enforcement options a / b / c) with the `## Umbrella` section first (sub-change 5 of 6) and `` `extension-bridge` `` under `### New Capabilities`, and verify `spec validate extension-bridge --root MB` exits 0, `grep -c "spike" MB/changes/extension-bridge/proposal.md` is at least 1, and `grep -A3 "^### New Capabilities" MB/changes/extension-bridge/proposal.md | grep -c "extension-bridge"` is at least 1
- [ ] 5.2 Plan it with `mf-plan extension-bridge --deliberate` in MB with the spike as task 1.1 and the enforcement point chosen from its result recorded in `design.md`, and verify `spec status extension-bridge --root MB` reads `design=done tasks=done`, `spec validate extension-bridge --root MB` exits 0, and `grep -c "Enforcement point:" MB/changes/extension-bridge/design.md` prints 1
- [ ] 5.3 Execute it with `execute extension-bridge` in MB, and verify `spec status extension-bridge --root MB` shows `N/N tasks`, `npm test` and the extension build exit 0 in MB, and `MB/.my-flow/verify/extension-bridge-e2e-claude.md` and `MB/.my-flow/verify/extension-bridge-e2e-codex.md` exist (transcript excerpt plus audit lines, never containing the string `Verdict:`) and each quotes one granted tab used by `browser_click` and the same call's `denied: tab not granted` line against a second tab
- [ ] 5.4 Verify it independently with `mf-verify extension-bridge` in MB, and verify a file `MB/.my-flow/verify/extension-bridge-*.md` exists whose text contains `### Verdict: PASS`
- [ ] 5.5 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/extension-bridge.md`, then archive with `spec archive extension-bridge --root MB`, and verify `MB/changes/archive/<date>-extension-bridge/` exists, `MB/changes/extension-bridge/` does not, `MB/specs/extension-bridge/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/extension-bridge.md` prints 1

## 6. temp-profiles (repo my-flow-browser)

- [x] 6.1 Obtain the user's answer to U5 (cookie import source) and create `MB/changes/temp-profiles/` with `spec new temp-profiles --root MB`, writing its `proposal.md` from design.md D9 (per-task profile, selective import from named agent profiles, destruction at task end) with the `## Umbrella` section first (sub-change 6 of 6), the U5 answer in Decision Boundaries and `` `temp-profiles` `` under `### New Capabilities`, and verify `spec validate temp-profiles --root MB` exits 0, `grep -c "U5" MB/changes/temp-profiles/proposal.md` is at least 1, and `grep -A3 "^### New Capabilities" MB/changes/temp-profiles/proposal.md | grep -c "temp-profiles"` is at least 1
  - note: U5 answered 2026-09-12 (import selectively from the named agent profiles only,
    filtered by the task's domain allowlist; the daily Chrome profile is never read for
    cookies), recorded under the decision table in `design.md`. `MB/changes/temp-profiles/`
    was created the same way as 4.1's directory and for the same reason.
- [ ] 6.2 Plan it with `mf-plan temp-profiles` in MB, and verify `spec status temp-profiles --root MB` reads `design=done tasks=done` and `spec validate temp-profiles --root MB` exits 0
- [ ] 6.3 Execute it with `execute temp-profiles` in MB, and verify `spec status temp-profiles --root MB` shows `N/N tasks`, `npm test` exits 0 in MB, and `MB/.my-flow/verify/temp-profiles-e2e.md` exists (transcript excerpt plus audit lines, never containing the string `Verdict:`) quoting the directory listing that shows `~/.my-flow/browser/profiles/tmp-<taskId>/` present during the task, the listing that shows it absent after the task, and the empty cookie result of a fresh `browser_open` on the seeded domain
- [ ] 6.4 Verify it independently with `mf-verify temp-profiles` in MB, and verify a file `MB/.my-flow/verify/temp-profiles-*.md` exists whose text contains `### Verdict: PASS`
- [ ] 6.5 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/temp-profiles.md`, then archive with `spec archive temp-profiles --root MB`, and verify `MB/changes/archive/<date>-temp-profiles/` exists, `MB/changes/temp-profiles/` does not, `MB/specs/temp-profiles/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/temp-profiles.md` prints 1

## 7. request-interception (repo my-flow-browser)

- [x] 7.1 Create `MB/changes/request-interception/` with `spec new request-interception --root MB` and write its `proposal.md` from the user's 2026-09-11 decision on harness-core task 8.3 (refuse subframe and subresource requests outside the tab's allowlist before the browser sends them; a blocked frame is a hole, not foreign content; every refusal audited; pages render with holes inside the agent profile) with the `## Umbrella` section first (sub-change 7 of 7), U3 in its Decision Boundaries as the authorisation for the visible change, and `` `request-interception` `` under `### New Capabilities`, and verify `spec validate request-interception --root MB` exits 0, `grep -c "^## Umbrella" MB/changes/request-interception/proposal.md` prints 1, and `grep -A3 "^### New Capabilities" MB/changes/request-interception/proposal.md | grep -c "request-interception"` is at least 1
- [x] 7.2 Plan it with `mf-plan request-interception --deliberate` in MB (the plan must choose the interception mechanism and record it in `design.md`, carry a spike on whether content reachable through `about:blank`, `srcdoc` and `blob:` children can originate from a refused host, define the blocked-frame mark in the frame enumeration so a tab full of holes stays readable, and define the blocked-request audit record without breaking the one-record-per-call rule), and verify `spec status request-interception --root MB` reads `design=done tasks=done`, `spec validate request-interception --root MB` exits 0, and `grep -c "Interception mechanism:" MB/changes/request-interception/design.md` prints 1
- [x] 7.3 Execute it with `execute request-interception` in MB, and verify `spec status request-interception --root MB` shows `N/N tasks`, `npm test` exits 0 in MB with nothing skipped, and the regression suite shows for every fixture that embeds a disallowed host that the disallowed host's fixture server served nothing while the tab stayed readable
- [x] 7.4 Verify it independently with `mf-verify request-interception` in MB, and verify a file `MB/.my-flow/verify/request-interception-*.md` exists whose text contains `### Verdict: PASS`
- [x] 7.5 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/request-interception.md`, then archive with `spec archive request-interception --root MB`, and verify `MB/changes/archive/<date>-request-interception/` exists, `MB/changes/request-interception/` does not, `MB/specs/request-interception/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/request-interception.md` prints 1

## 8. Final gate

- [ ] 8.1 Targeted verification of the whole change (build, tests, Rebuild / Re-run steps): `npm run build`, `npm run check`, `npm test` in MF; `npm test` in MB; the fork's tests in SF; `node MF/scripts/cli.mjs plugin list` shows `my-flow-browser` enabled on both surfaces; the seven archive directories listed in 1.6, 2.8, 3.6, 4.5, 5.5, 6.5 and 7.5 all exist; the umbrella success criteria 1-5 of `proposal.md` re-run on both hosts with fresh output
- [ ] 8.2 Cleanup of own diff only, then re-verify (the umbrella's diff is `changes/plugin-system-browser-harness/` including its `verify/` copies, and nothing else in MF)
- [ ] 8.3 Independent verification report says PASS (.my-flow/verify/): `mf-verify plugin-system-browser-harness` in MF reads the seven committed copies under `MF/changes/plugin-system-browser-harness/verify/` (each containing `Verdict: PASS`) and re-lists the seven archive directories in MF, MB and SF, and `MF/.my-flow/verify/plugin-system-browser-harness-*.md` contains `### Verdict: PASS`
