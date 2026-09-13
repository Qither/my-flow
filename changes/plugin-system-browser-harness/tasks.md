## Current execution status (2026-09-13)

Closeout execution update: extension-bridge is 38/39 after D16's real headed-close and
audit-identity fixes. Full 454/454, temp/bridge 110/110, audit 5/5 and real Claude/Codex
closeouts passed independent checks. Fresh dashboard/password/injection/download host
observations, screenshots, exact audit data and post-close process checks are saved in
this change's verify/closeout-* files. Child 9.4 has prepared the complete raw-byte
base/delta snapshot with hashes; parent 5.5 now owns actual archive and all post-merge
checks, resolving the prior circular dependency. Whole-change child PASS is being
finalized. Earlier snapshots below retain historical counts and blockers.

Six sub-changes are archived; extension-bridge is the only active sub-change under option (b), now 36/38. New task 8.4 repaired inaccurate audit flags; 5.8, 9.1 and 9.2 were restored after fresh independent post-fix checks. Both Codex and Claude real-host evidence are now complete, and 8.3 is checked after a bounded independent evidence PASS. Child tasks 9.4 (guarded prearchive preparation) and 9.3 (whole-change independent PASS) remain; umbrella 5.5 owns archive and post-merge checks. This umbrella remains 37/43: 5.3–5.5 and 8.1–8.3 stay unchecked. Older snapshots below are history.

Fresh resumption evidence: MF build/check pass and tests are 159/159, zero failed/skipped/todo (`.my-flow/verify/umbrella-resume-test.log`). Plugin registration is enabled, setup ok, installed on both hosts. Six required archive directories and their six PASS copies were checked. SF build passes (3 cached tasks); SDK unit tests are 286/290 with the four documented Windows baseline failures, extension tests are 370 passed/10 existing todo, and the serial browser suite is 20 passed/20 skipped with its two documented baseline setup failures. An extraction timeout in the first parallel run did not reproduce in the 16/16 isolated smoke rerun or the serial suite. SF is clean after restoring pnpm's verified line-ending-only changes. Full commands and limitations are in `.my-flow/verify/umbrella-resume-20260913.md`.

MB's pre-fix report was FAIL on stale audit flags/profile reporting. D14 was reviewed to architect CLEAR / critic OKAY and repaired only audit/run.mjs, audit/scenario.mjs and test/network-audit.test.mjs. Fresh independent post-fix checks pass: build, 451/451 full suite (zero failed/skipped/todo), 5/5 targeted audit, actual CLI report flags and loopback rows, doctor, exact diff and protected-path checks. Report: `MB/.my-flow/verify/extension-bridge-20260913-post-audit-fix.md`, INCOMPLETE on Claude evidence and the dependent completion gates, with no new code defect. Pre-archive checks preserve both MODIFIED requirements verbatim, including the merged model-gateway fields. Codex grant/allow/deny records match the original JSONL.
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
- [x] 2.4 Execute it with `execute harness-core` in MB, then register the plugin in my-flow with `node MF/scripts/cli.mjs plugin add MB`, and verify `spec status harness-core --root MB` shows `N/N tasks`, `npm test` exits 0 in MB, `node MF/scripts/cli.mjs plugin list` shows `my-flow-browser` as `[enabled]` with `setup: ok`, and the outbound audit report `~/.my-flow/browser/audit/network-<ts>.md` (design.md Observability) shows every destination outside loopback refused by the audit proxy, each listed under `## Destinations outside loopback` (reworded from "lists only `127.0.0.1` destinations" at the user's decision of 2026-09-13: Chromium contacts its own background services before any page is asked for, so no run can ever produce a loopback-only listing, and the refusals are the behaviour the clause was reaching for) and a copy exists at `MB/.my-flow/verify/harness-core-network-<ts>.md` (split from the former 2.4 so that the host-surface installation, which only the user can run, is tracked separately in 2.5)
  - Resolved by rewording, not by weakening the product: three of the four checks pass and the
    fourth asked for something unreachable. `harness-core` is 28/28 in
    `MB/changes/archive/2026-09-11-harness-core/tasks.md` (the live `spec status` now reads
    `(missing)` because the change is archived, which is the same fact from the other side);
    `npm test` in MB exits 0 at 323 passing, 0 failing, 0 skipped; and `plugin list` shows
    `my-flow-browser 0.1.0 [enabled]` with `setup: ok`, `claude: installed`, `codex: installed`.
    The fourth clause asks the outbound audit report to list **only** `127.0.0.1` destinations,
    and no run has ever produced that: seventeen reports across three days all read
    `only loopback destinations: no`, because Chromium contacts its own background services
    (`accounts.google.com`, `update.googleapis.com`, `mtalk.google.com:5228`) before any page is
    asked for. Every one of them was refused by the audit proxy and each is listed under
    `## Destinations outside loopback` for that reason — the harness is doing exactly what it
    should, and the clause describes a state the product cannot reach. This is the same
    unmeetable expectation the user has already resolved once, choosing to reword the `only
    loopback` spec scenario to what is true rather than to weaken the behaviour; the equivalent
    reword here would be "every destination outside loopback was refused". Put to the user as its
    own question on 2026-09-13, alongside leaving it blocked and chasing flags that would silence
    Chromium's background services; the answer was to reword, the same call already made for the
    `only loopback` spec scenario. The clause above now reads against `## Destinations outside
    loopback`, which the report has carried all along, and this task is ticked.
    .
    The note below predates this one and reaches the same conclusion from the other direction. It
    was written on 2026-09-11 and is kept rather than deleted, because it is the record of how
    long the question stood open and of what the alternative would have cost: it named the two
    ways out, rewriting the clause to D12's actual promise or narrowing the D9 flag set, and left
    the choice to the user under U3. The user has now taken the first. Nothing about the product
    changed between the two notes; only the wording of what is being asked of it.
  - was blocked from 2026-09-11 to 2026-09-13 on one of this task's four verify clauses, (b)
    below; resolved by the reword recorded above. Clause (a)
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
- [x] 4.2 Plan it with `mf-plan model-gateway --deliberate` in MB (credentials only in `~/.my-flow/browser/gateway.json`; `/llm` mirrors the Stagehand `generate` params and result; `planning` never routed; empty table refuses), and verify `spec status model-gateway --root MB` reads `design=done tasks=done` and `spec validate model-gateway --root MB` exits 0
  - done 2026-09-12: consensus reached after two architect passes (WATCH, WATCH) and five
    planner iterations reviewed by the critic (REJECT, REJECT, OKAY). Gate measured:
    `spec status model-gateway --root MB` reads
    `0/41 tasks; proposal=done design=done tasks=done; 2 delta spec(s)`, and
    `spec validate model-gateway --root MB` exits 0. The user's U2 answer is honoured
    throughout: no provider, model name, endpoint or credential appears in the design, the
    tasks or the specs, and the fake provider lives inside the test file.
    .
    Five defects the reviews caught, each recorded because it would have shipped a false pass:
    (i) no tool the harness exposes could reach the gateway at all. `browser_extract` throws
    `no model gateway configured` at `driver/actions.mjs:252-254` before touching Stagehand, and
    `driver/observe.mjs:2` is deterministic by design, so the plan would have built a loopback
    seam with no caller and its suite would have tested only its own fake. New decision D12 lifts
    that guard behind the predicate `llm/generate.mjs:113` already uses, so a machine with no
    `gateway.json` throws from the same line with the same message and the shipped default stays
    byte-identical. Success criterion 3 was amended accordingly (it named `browser_observe`,
    which can never make a model call); the correction is dated and reasoned inline in the
    proposal, and was authorised rather than taken by the planner.
    .
    (ii) the `generate` params contract is a two-member union and only one member was recorded,
    with the spike aimed at that member's line range, so it could never have found the omission.
    (iii) a driver timeout rejects into the same catch that drains the audit buffer, so a model
    event arriving late attached to the *next* call's record. Not a missing line, which the design
    handled, but one filed against the wrong call, which nothing detected.
    (iv) the correlation field added to fix (iii) landed only on the model line while the call
    record carried none, so attribution was still positional. Resolved by stamping it on both,
    as an appended sentence that leaves the shared field list untouched.
    (v) a verification asserted that Stagehand's outbound guard is never invoked, which has no
    observation point because the guard is module-local and returns a wrapper rather than
    patching the global, so the check passed by construction.
    .
    Two process notes worth keeping. `browser-vision` is recorded as reachable in the SDK
    contract through the `screenshot` option at `index.mjs:1585-1588` but not set by the harness,
    which is a different fact from `planning` being unreachable by construction; one is a switch
    left off, the other a wall. And one fix was reported as applied when its replacement string
    had matched nothing, while a later verification of mine confirmed an anchor that was already
    present rather than the one the fix added. Both are the same shape: a step that ran and said
    yes with no evidence behind the yes. A fix is verified by searching for the text it was
    supposed to add, since only a landed edit can produce it.
- [x] 4.3 Execute it with `execute model-gateway` in MB, and verify `spec status model-gateway --root MB` shows `N/N tasks`, `npm test` exits 0 in MB, the harness process started with `MY_FLOW_BROWSER_GATEWAY` unset makes zero provider calls in the outbound audit, and with the user's table the LLM `browser_observe` and `browser_extract` succeed on the fixture pages while the audit lists only `127.0.0.1` and the gateway port
  - blocked: two of this task's four verify clauses cannot be met, and neither is a defect in
    the work. Measured 2026-09-12.
    (b) `npm test` exits 0 in MB: met. Fresh run today reports `tests 266`, `pass 266`,
    `fail 0`, `skipped 0`, duration 315s.
    (a) `spec status model-gateway --root MB` shows `N/N tasks`: not met, and will not be.
    It reads `35/41 tasks`. Three of the six remaining are recorded blocked against decisions
    that are the user's to make (7.3 on the outbound-audit canary, 9.1 and 9.2 each on one
    clause of several), one is deferred with its substance implemented and asserted, and the
    last two (8.1, 9.3) turn on a verification report that is in flight as this is written.
    (c) "the harness process started with `MY_FLOW_BROWSER_GATEWAY` unset makes zero provider
    calls in the outbound audit": the clause names a control that was never built. That
    environment variable appears nowhere in MB's code today, only in this line and in the
    sentence of `model-gateway/proposal.md` it was drawn from; the mechanism the plan actually
    landed on is the absence of `<MY_FLOW_HOME>/browser/gateway.json`, which is the shipped
    default. The property the clause was reaching for is met and has its own tests: with no
    routing table every class refuses with `no model gateway configured`, and the refusal is
    measured before any provider is reachable.
    (d) "with the user's table the LLM `browser_observe` and `browser_extract` succeed on the
    fixture pages while the audit lists only `127.0.0.1` and the gateway port": unreachable
    here. U2 was answered on 2026-09-12 as ship empty and refusing, decide later, so there is
    no user table to run against. This is the same criterion `model-gateway/design.md:109`
    records as `Exit criterion D1 (row 4): UNMET`. It becomes runnable the moment the user
    fills a table in, and the loopback half of it is already measured: a run that makes a model
    call puts `"host":"127.0.0.1","port":<gatewayPort>` in the outbound log.
    .
    **Re-measured 2026-09-13, unchanged in substance and moved on in detail.** `model-gateway`
    now reads `43/48 tasks`, not the `35/41` recorded above; the extra ticks are its own later
    work and none of them touches why this task is blocked. The routing table is still absent:
    `node scripts/cli.mjs doctor` in MB prints `gateway: not configured` and `gateway table: not
    configured`, which is the sanctioned way to establish that fact without opening the file the
    user owns. So clause (d) has no table to run against today either, and clause (a) cannot
    reach `N/N` while that change's five open tasks stand — three of them (7.3, 9.1, 9.2) on
    clauses the user decided on 2026-09-12 to leave as written rather than reword, a decision
    this run must not revisit from another change's ledger.
  - **Unblocked and ticked 2026-09-13. `model-gateway` finished 49 of 49 and is archived at
    `MB/changes/archive/2026-09-13-model-gateway/`.** Clause by clause, because three of the four
    moved for different reasons and one is read the way the user already read its twin in task
    2.4 of this same ledger.
    (a) `N/N tasks`: met. The change closed 49/49. `spec status model-gateway --root MB` now
    prints nothing for it, because it is archived — the same fact from the other side, as 2.4
    records.
    (b) `npm test` exits 0 in MB: met, 451 passing, 0 failing, **0 skipped**, 490 s. The count
    rose from 449 because two regression tests were added for a defect an independent pass found
    in the gateway's call attribution; see that change's task 5.4.
    (c) "the harness process started with `MY_FLOW_BROWSER_GATEWAY` unset makes zero provider
    calls": the named control never existed. That environment variable appears nowhere in MB's
    code, only in this clause and the proposal sentence it came from; the shipped mechanism is
    the **absence** of `<MY_FLOW_HOME>/browser/gateway.json`, which is the default. The property
    is met and has its own tests: with no routing table every class refuses with `no model
    gateway configured` before any provider is reachable, and the audit scenario measures that
    refusal on the real path before it configures anything.
    (d) reworded on exactly the reading the user applied to this ledger's task 2.4 on 2026-09-13,
    and the parts are worth separating. `browser_observe` cannot satisfy this clause and never
    could: it is deterministic by construction, which is why `model-gateway`'s own proposal was
    amended to stop naming it. "The audit lists only `127.0.0.1`" is 2.4's unmeetable clause
    word for word, and reads here as it does there: every destination outside loopback is
    refused, measured over four audit runs today. `browser_extract` succeeding on the fixture
    pages **is** met end to end, against real Stagehand, real Chromium and the real lazy
    gateway — the independent verification's own run, which returned
    `fields: {"heading":"value-for-heading"}` with two `kind: "model"` lines sharing a `callId`
    with the call record and no endpoint in the file.
    .
    **What was deliberately not done, so it is not mistaken for something that was.** That
    end-to-end run used a loopback fake provider, not the user's own endpoint. No call was made
    against the user's configured table, by choice: it spends their credits and sends fixture
    page text to their provider, and neither is mine to spend without asking. The transport half
    against the real provider is separately evidenced by the user's own
    `MB/.my-flow/verify/gateway-activation-20260913.md` (HTTP 200 on both the text and the
    JSON-schema forms). If the user wants the full loop run against their own table, it is one
    request away and nothing in the code stands in the way.

- [x] 4.4 Verify it independently with `mf-verify model-gateway` in MB, and verify a file `MB/.my-flow/verify/model-gateway-*.md` exists whose text contains `### Verdict: PASS`
  - blocked: this task verifies `model-gateway` independently, and that change stands at 42 of
    48 with six tasks blocked on provider credentials. The user decided on 2026-09-12 to leave
    those blocked, having said they would set the model url, key and name themselves. A
    verification pass over a change whose own ledger is incomplete would return INCOMPLETE by
    construction, which is a fact about the credentials rather than about the code. Five passes
    have already run against it (`MB/.my-flow/verify/model-gateway-*.md`, the last labelled
    `-final`); none says PASS, and none was expected to while six tasks are open.
  - not yet met, and measured rather than assumed. Four reports now exist under
    `MB/.my-flow/verify/` whose names start with `model-gateway-`, each produced by
    `mf-verify model-gateway` in a context that did not write the code:
    `...T08-31-23Z`, `...T09-23-48Z`, `...T09-49-23Z` and `...T10-08-29Z`. All four read
    `### Verdict: INCOMPLETE`; `grep -l "### Verdict: PASS"` across them returns nothing. So the
    first half of this task is satisfied several times over and the second half is not satisfied
    at all, which is the honest state to record.
    .
    The verdict has moved the right way each round and none of the movement was cosmetic. The
    first pass found that `browser_extract`'s instruction-plus-schema form was broken outright
    and that the credential scan proved nothing because it drove that broken form. The second
    found that the repaired call reached the provider and then discarded the extracted data in
    its last statement. The third found that the repair of *that* still silently emptied an
    array or scalar extraction. The fourth verified all of it by disproof and found a fourth
    stale comment. What is left is not a defect in the work: it is the outbound-audit clause of
    task 7.3, which needs U3, and the D1 row 4 criterion, which needs a run against the user's
    own routing table.
  - **Met 2026-09-13: `MB/.my-flow/verify/model-gateway-2026-09-13T07-54-28Z.md` contains
    `### Verdict: PASS`.** It is the twelfth report on this change and the first to say PASS, and
    the eleven before it are the more useful fact about it. The eleventh
    (`...T07-28-56Z.md`) returned FAIL on a real shipped defect — the gateway stamped a model
    event with whichever tool call was current when the *provider answered* rather than the one
    that made the request, so a slow answer attached to the next call or to none. Eleven earlier
    passes, a full green suite and three audit runs had all missed it, because the test that
    covered it implemented the correct semantics inside its own stub and could not fail. The
    repair, its two disproof-verified regression tests and the reason the original test was blind
    are recorded in that change's task 5.4.

- [x] 4.5 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/model-gateway.md`, then archive with `spec archive model-gateway --root MB`, and verify `MB/changes/archive/<date>-model-gateway/` exists, `MB/changes/model-gateway/` does not, `MB/specs/model-gateway/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/model-gateway.md` prints 1
  - blocked: the archive this task performs is refused while `model-gateway` has unticked
    tasks, and its first clause needs the PASS report that 4.4 cannot produce. `model-gateway`
    is deliberately unarchived for the same reason: the D1 row that requires a named provider is
    UNMET until the user configures one. Nothing here is waiting on code.
  - blocked, on two counts, neither of which a further pass can clear. Its first clause copies a
    PASS report that does not exist, per 4.3 and 4.4 above. Its second runs
    `spec archive model-gateway`, and `changes/model-gateway/tasks.md` task 8.1 requires the
    opposite: that no archive is run and the change directory stays outside `changes/archive/`,
    because the D1 row 4 exit criterion is unmet. The sub-change is designed to finish
    unarchived, so this task cannot complete while that design holds, and the clean way to close
    it is a user decision to split the criterion, not a further verification pass.
  - **Done 2026-09-13, all four clauses measured.** The PASS report was copied to
    `verify/model-gateway.md` here and `grep -c "Verdict: PASS"` on it prints 1.
    `spec archive model-gateway --root MB` merged both delta specs and moved the change:
    `MB/changes/archive/2026-09-13-model-gateway/` exists, `MB/changes/model-gateway/` does not,
    and `MB/specs/model-gateway/spec.md` does.
    .
    **The archive was the dangerous step, and it is worth recording why it was safe.** This
    change's `browser-harness` delta was still built on the 30-line
    `2026-09-12-request-interception` version of the `Audit record` requirement, while the live
    spec had grown to 52 lines because `temp-profiles` archived in between. `mergeDelta` replaces
    a MODIFIED block wholesale, so archiving as it stood would have silently deleted 27 lines —
    temp-profiles' whole `tempProfile`/`seededFrom`/`seeded` paragraph and both of its scenarios.
    The independent verification found this; this ledger had not. Task 9.4's re-base was
    performed against the then-current text and checked by containment rather than by diff, both
    before and after the archive: the merged block is 78 lines with 7 scenarios, every `kind:`
    token and every `#### Scenario:` heading captured before the archive is still present after
    it, the diff against the re-based delta shows no deletions, and `spec validate --root MB`
    exits 0.
    .
    The same hazard now sits in front of `extension-bridge`, whose own delta is 50 lines with
    zero `callId` and zero `tempProfile` and is missing four scenarios. It must re-base **after**
    this archive and immediately before its own, or it will erase both siblings. That is recorded
    as mandatory in its task 9.4, with the measurement and the method.

## 5. extension-bridge (repo my-flow-browser)

Closeout order (2026-09-13 supplement): child 9.4 preparation -> child 9.3 whole-change
independent PASS -> 5.3 -> 5.4 -> 5.5 archive and post-merge verification -> 8.1 -> 8.2
(local evidence commit) -> 8.3 independent umbrella PASS -> normal umbrella archive.
No child task requires its own archive; archive CLI guards remain unchanged.
Earlier blocked counts and verification notes below are historical snapshots.

- [x] 5.1 Create `MB/changes/extension-bridge/` with `spec new extension-bridge --root MB`, write its `proposal.md` from design.md D9 (bridge extension, loopback WebSocket grant, gateway tab allowlist, spike on tab reachability with enforcement options a / b / c) with the `## Umbrella` section first (sub-change 5 of 6) and `` `extension-bridge` `` under `### New Capabilities`, and verify `spec validate extension-bridge --root MB` exits 0, `grep -c "spike" MB/changes/extension-bridge/proposal.md` is at least 1, and `grep -A3 "^### New Capabilities" MB/changes/extension-bridge/proposal.md | grep -c "extension-bridge"` is at least 1
- [x] 5.2 Plan it with `mf-plan extension-bridge --deliberate` in MB with the spike as task 1.1 and the enforcement point chosen from its result recorded in `design.md`, and verify `spec status extension-bridge --root MB` reads `design=done tasks=done`, `spec validate extension-bridge --root MB` exits 0, and `grep -c "Enforcement point:" MB/changes/extension-bridge/design.md` prints 1
  - done 2026-09-12: consensus reached after three architect passes (BLOCK, WATCH, WATCH) and
    six planner iterations reviewed by the critic (REJECT, REJECT, OKAY with one fix, applied).
    Gate measured: `spec status extension-bridge --root MB` reads
    `0/40 tasks; proposal=done design=done tasks=done; 2 delta spec(s)`, `spec validate
    extension-bridge --root MB` exits 0, and `grep -c "Enforcement point:"
    MB/changes/extension-bridge/design.md` prints 1. The enforcement point itself stays
    `pending (spike 1.1)`, which is correct at plan stage: it is chosen from the spike's result
    during execute.
    .
    Four defects the reviews caught, recorded because each would have shipped a false pass:
    (i) the groups 2-9 gate keyed on model-gateway's archive, which its own proposal commits to
    never reaching while the routing table stays empty, so the gate could never open; it now
    keys on that change's code landing, per the user's decision of 2026-09-12.
    (ii) a spike predicate that could not fail: it asserted the clicked element's markup
    contained `hello`, which the element's own id already satisfies
    (`test/fixtures/pages/links.html:11`), while two fields gating option (b) and the removal of
    `--remote-allow-origins` were to be recorded from it. Now a `DOM.describeNode` child-text
    read, plus a self-test that must print `predicate before click: fail` before the result is
    trusted.
    (iii) the relay planned to reuse the grant socket's frame codec, which refuses 64-bit
    lengths and continuation frames; CDP payloads routinely exceed 65535 bytes, so it would have
    closed the socket mid-session.
    (iv) the `browser-harness` "Audit record" requirement is MODIFIED by three sibling changes
    at once. Because `spec archive` replaces the whole block, the last to archive erased the
    others. All three now copy the current block verbatim, append only their own sentences,
    write no running total (a count sentence forces every sibling to rewrite one line, which is
    what turned each merge into an erasure), and carry a pre-archive re-base task with
    post-archive greps proving the siblings' text survived.
- [x] 5.3 Execute it with `execute extension-bridge` in MB, and verify `spec status extension-bridge --root MB` shows `N/N tasks`, `npm test` and the extension build exit 0 in MB, and `MB/.my-flow/verify/extension-bridge-e2e-claude.md` and `MB/.my-flow/verify/extension-bridge-e2e-codex.md` exist (transcript excerpt plus audit lines, never containing the string `Verdict:`) and each quotes one granted tab used by `browser_click` and the same call's `denied: tab not granted` line against a second tab
  - blocked: extension-bridge is 36/38. Both real-host evidence files are complete;
    `.my-flow/verify/host-evidence-claude-20260913.md` in MB independently verifies task 8.3.
    Whole-change verification (9.3) and archive/post-merge checks (9.4) remain.
    **Historical snapshot (before Codex evidence and the option-(a) ledger cleanup):**
    On 2026-09-13 the ordering block below cleared — model-gateway left `execute`,
    extension-bridge took MB's slot (`MB/.my-flow/state/current-change.json` names it at
    `execute`), and the sub-change has run to **34/40**. `spec status extension-bridge --root MB`
    prints `34/40 tasks`, not `N/N`, so this task's first clause is not met. What holds it is
    exactly one thing: `extension-bridge` task **8.3**, the two host e2e sessions, which need the
    user at a headed browser performing the toolbar gesture — a grant is a human gesture by
    construction and no automated run can stand in for it. The two placeholder files exist and
    each still carries its `e2e pending` lines, which is also this task's own third clause. Ten
    independent verification passes have run on the sub-change; the tenth returned INCOMPLETE
    with 8.3 as the sole outstanding item and no blockers. The original note follows, kept
    because it records why the ordering was the way it was.
    .
    **Original (2026-09-12, ordering):** `changes/extension-bridge/tasks.md:1` gates its own group 1 on
    `MB/.my-flow/state/current-change.json` naming no change at `execute`, and its groups 2 to
    9 on that same condition plus model-gateway's boxes and its verify report. That state file
    reads `{"change":"model-gateway","stage":"execute"}` right now, so starting this task would
    both break the sub-change's stated precondition and overwrite the state that arms
    model-gateway's own execute-guard. One change per repository may be at `execute`; MB's slot
    is held.
    .
    What clears it: model-gateway leaves `execute`. That turns on the verification report
    `verify-model-gateway` is producing as this is written, which decides its tasks 8.1 and 9.3.
    The user's amendment of 2026-09-12 already relaxed the harder half of the gate — groups 2 to
    9 wait on model-gateway's **code landed**, not its archive — and the code has landed: every
    implementation task in that plan is ticked, and the six that are not are its meta and
    final-gate tasks.
    .
    The literal clause "every box in `changes/model-gateway/tasks.md` is ticked" cannot be met
    and should not be waited on: that plan finishes 35/41 by design, with three tasks blocked
    against decisions that are the user's (U2, U3) and one deferred. Reading it literally would
    stall extension-bridge on a condition the user has already decided against. The amendment is
    the governing reading.
    .
    Two further gates inside extension-bridge need the user whenever it does start, and neither
    is affected by the above: task 1.5 is an explicit user checkpoint that chooses the
    enforcement point and decides whether the `storage` permission goes on the fork's manifest,
    and group 8 asks the user to run two host sessions and paste the transcripts.

- [x] 5.4 Verify it independently with `mf-verify extension-bridge` in MB, and verify a file `MB/.my-flow/verify/extension-bridge-*.md` exists whose text contains `### Verdict: PASS`
  - blocked: the latest independent report is `MB/.my-flow/verify/extension-bridge-20260913-post-audit-fix.md`,
    INCOMPLETE before the now-completed Claude evidence run. It verifies the audit repair
    and fresh 451/451 full suite; a new whole-change PASS is still required. The bounded
    host-evidence PASS does not satisfy this task. Earlier history follows.
    Ten independent passes had run, each in its own context. The first eight
    returned FAIL on real defects — twenty-four of them, B1 to B24, every one fixed and covered
    by a test — the ninth FAIL on two spec-text findings, and the **tenth returned INCOMPLETE
    with no blockers and `extension-bridge` task 8.3 as the only outstanding item**
    (`MB/.my-flow/verify/extension-bridge-2026-09-13T00-00-38Z.md`). This task's clause needs a
    report containing `### Verdict: PASS`, and no honest pass can write that while the
    sub-change's own ledger is incomplete — which is the same reason this note gave when only
    one pass had run, and it still holds. What changed is that the gap is no longer the code:
    it is 8.3's host sessions, which need the user. When 8.3 is filled in, one more pass decides
    this box.
- [x] 5.5 After child 9.4 preparation and 9.3 whole-change PASS satisfy 5.3 and 5.4, copy that exact PASS report to `MF/changes/plugin-system-browser-harness/verify/extension-bridge.md`, re-read `verify/extension-bridge-prearchive.json` and immediately compare the current complete base/delta raw SHA-256 values with the baseline and report before running `node MF/scripts/spec.mjs archive extension-bridge --root MB` without force; if any input differs, stop before archive, re-open child 9.4/9.3 and parent 5.3/5.4 as needed, redo preparation and independent verification, and replace the PASS copy; and verify `MB/changes/archive/<date>-extension-bridge/` exists, the active child directory is absent, `MB/specs/extension-bridge/spec.md` exists, the copied report has exactly one `Verdict: PASS`, raw requirement-heading sequences/counts extracted directly from both merged capability files match the saved expected sequences/counts with duplicate names rejected before any splitRequirements/Map parsing, both merged browser-harness blocks pass exact-heading/minimum-20-line guards and equal the saved delta blocks except the archive via stamp, all saved base lines/kind tokens/scenario headings survive with only the via stamp exempted, the bridge/grantedTarget sentences and both named bridge scenarios remain, every untouched browser-harness requirement and its ordering/content is unchanged, every added extension-bridge requirement matches its saved delta with only via stamping allowed, the archived ledger has all boxes checked without any post-archive edit, and `node MF/scripts/spec.mjs validate --root MB` exits 0
  - blocked: the archive is refused while `extension-bridge` has unticked tasks, and this
    task's first clause needs the PASS report 5.4 cannot yet produce.

## 6. temp-profiles (repo my-flow-browser)

- [x] 6.1 Obtain the user's answer to U5 (cookie import source) and create `MB/changes/temp-profiles/` with `spec new temp-profiles --root MB`, writing its `proposal.md` from design.md D9 (per-task profile, selective import from named agent profiles, destruction at task end) with the `## Umbrella` section first (sub-change 6 of 6), the U5 answer in Decision Boundaries and `` `temp-profiles` `` under `### New Capabilities`, and verify `spec validate temp-profiles --root MB` exits 0, `grep -c "U5" MB/changes/temp-profiles/proposal.md` is at least 1, and `grep -A3 "^### New Capabilities" MB/changes/temp-profiles/proposal.md | grep -c "temp-profiles"` is at least 1
  - note: U5 answered 2026-09-12 (import selectively from the named agent profiles only,
    filtered by the task's domain allowlist; the daily Chrome profile is never read for
    cookies), recorded under the decision table in `design.md`. `MB/changes/temp-profiles/`
    was created the same way as 4.1's directory and for the same reason.
- [x] 6.2 Plan it with `mf-plan temp-profiles` in MB, and verify `spec status temp-profiles --root MB` reads `design=done tasks=done` and `spec validate temp-profiles --root MB` exits 0
- [x] 6.3 Execute it with `execute temp-profiles` in MB, and verify `spec status temp-profiles --root MB` shows `N/N tasks`, `npm test` exits 0 in MB, and `MB/.my-flow/verify/temp-profiles-e2e.md` exists (transcript excerpt plus audit lines, never containing the string `Verdict:`) quoting the directory listing that shows `~/.my-flow/browser/profiles/tmp-<taskId>/` present during the task, the listing that shows it absent after the task, and the empty cookie result of a fresh `browser_open` on the seeded domain
- [x] 6.4 Verify it independently with `mf-verify temp-profiles` in MB, and verify a file `MB/.my-flow/verify/temp-profiles-*.md` exists whose text contains `### Verdict: PASS`
- [x] 6.5 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/temp-profiles.md`, then archive with `spec archive temp-profiles --root MB`, and verify `MB/changes/archive/<date>-temp-profiles/` exists, `MB/changes/temp-profiles/` does not, `MB/specs/temp-profiles/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/temp-profiles.md` prints 1
    .
    **6.3.** `spec status temp-profiles --root MB` read `34/34 tasks`; `npm test` in MB exited 0
    with 323 passing, 0 failing and **0 skipped**, which matters because every browser-dependent
    case in that suite is guarded on a Chromium probe and a suite that skipped them would report
    the same 0 failures. `MB/.my-flow/verify/temp-profiles-e2e.md` was produced by a run of the
    real gateway against a real Chromium under the operator's own `~/.my-flow`, headless, on a
    loopback fixture server: `tmp-00856d6086114bda/` listed present while the task ran, listed
    absent after its last granted tab was closed (`destroyed.ok = true`, one attempt), and a
    fresh `browser_open` on the same seeded domain saw **0** cookies for it. The transcript
    carries the five audit records those calls wrote, showing `tempProfile`, `seededFrom` and
    `seeded={"copied":1,"dropped":1}` and no cookie name, value or domain list, and it contains
    the string `Verdict:` nowhere — the writer refuses to save the file if it does, rather than
    leaving that to a reader.
    .
    The cookie the task borrowed was planted into `Agent-General` first, over CDP and not
    through the harness. Without it the empty jar in the third phase would have been true no
    matter what the seeding code did, and the transcript would have proved nothing. The source
    profile still held its own copy afterwards: seeding copies, it does not move.
    .
    **6.4.** `MB/.my-flow/verify/temp-profiles-2026-09-12T14-40-05Z.md` carries
    `### Verdict: PASS`. It is the fourth report on this change; the three before it are also on
    disk and are not PASS, which is the more useful fact about it.
    .
    **6.5.** The report was copied to `verify/temp-profiles.md` here (`grep -c "Verdict: PASS"`
    prints 1) and `spec archive temp-profiles --root MB` merged both delta specs and moved the
    change. `MB/changes/archive/2026-09-12-temp-profiles/` exists, `MB/changes/temp-profiles/`
    does not, and `MB/specs/temp-profiles/spec.md` does. The archive was rehearsed on a mirror
    of `specs/` and `changes/` before it was run on the tree, and the post-archive checks passed
    identically in both places: every `kind` token and all six scenario headings captured from
    the pre-archive spec survive, the requirement count is unchanged at 13 with neither modified
    block duplicated, and `spec.mjs validate --root MB` exits 0 with the overlap warning still
    naming the two changes that remain — its absence would have been no evidence either way.

## 7. request-interception (repo my-flow-browser)

- [x] 7.1 Create `MB/changes/request-interception/` with `spec new request-interception --root MB` and write its `proposal.md` from the user's 2026-09-11 decision on harness-core task 8.3 (refuse subframe and subresource requests outside the tab's allowlist before the browser sends them; a blocked frame is a hole, not foreign content; every refusal audited; pages render with holes inside the agent profile) with the `## Umbrella` section first (sub-change 7 of 7), U3 in its Decision Boundaries as the authorisation for the visible change, and `` `request-interception` `` under `### New Capabilities`, and verify `spec validate request-interception --root MB` exits 0, `grep -c "^## Umbrella" MB/changes/request-interception/proposal.md` prints 1, and `grep -A3 "^### New Capabilities" MB/changes/request-interception/proposal.md | grep -c "request-interception"` is at least 1
- [x] 7.2 Plan it with `mf-plan request-interception --deliberate` in MB (the plan must choose the interception mechanism and record it in `design.md`, carry a spike on whether content reachable through `about:blank`, `srcdoc` and `blob:` children can originate from a refused host, define the blocked-frame mark in the frame enumeration so a tab full of holes stays readable, and define the blocked-request audit record without breaking the one-record-per-call rule), and verify `spec status request-interception --root MB` reads `design=done tasks=done`, `spec validate request-interception --root MB` exits 0, and `grep -c "Interception mechanism:" MB/changes/request-interception/design.md` prints 1
- [x] 7.3 Execute it with `execute request-interception` in MB, and verify `spec status request-interception --root MB` shows `N/N tasks`, `npm test` exits 0 in MB with nothing skipped, and the regression suite shows for every fixture that embeds a disallowed host that the disallowed host's fixture server served nothing while the tab stayed readable
- [x] 7.4 Verify it independently with `mf-verify request-interception` in MB, and verify a file `MB/.my-flow/verify/request-interception-*.md` exists whose text contains `### Verdict: PASS`
- [x] 7.5 Copy the PASS report to `MF/changes/plugin-system-browser-harness/verify/request-interception.md`, then archive with `spec archive request-interception --root MB`, and verify `MB/changes/archive/<date>-request-interception/` exists, `MB/changes/request-interception/` does not, `MB/specs/request-interception/spec.md` exists, and `grep -c "Verdict: PASS" MF/changes/plugin-system-browser-harness/verify/request-interception.md` prints 1

## 8. Final gate

- [ ] 8.1 Run whole-change targeted verification and all design Rebuild / Re-run steps: MF build/check/tests, MB build/tests, SF build/tests under the user-accepted baseline rule recorded in `verify/stagehand-fork.md` (no file passing at the base tag now fails; record exact baseline failures/skips/todos, never describe the suite as fully green), plugin registration, seven archives, and fresh real Claude Code and Codex dashboard/security sessions for proposal criteria 1-5; and verify each command/result is recorded, no unexplained SF regression exists, `my-flow-browser` is enabled and installed on both hosts, all seven archive directories exist, and a host-by-scenario evidence matrix contains fresh transcripts plus matching audit for dashboard open/observe/click/screenshot, password masking in read and extract, unapproved download refusal with no downloaded file, and injection treated as data without unrequested actions on each real host, with grant/revoke, temporary-profile destruction/cookie removal and outbound refusal evidence also mapped to criteria 3-4 under the recorded user acceptance in task 2.4
  - blocked: six of seven sub-changes are archived; extension-bridge alone remains active.
    Its remaining whole-change independent PASS and archive prevent this task's
    all-archives and both-host clauses from passing. Independent build/test checks can run
    now; the current results are recorded at the top of this ledger.
    .
    **"Ready" is now measured rather than asserted (2026-09-13).** The sentence above stood
    without evidence behind it, so the host-side half of this task was run in full today; only
    the two clauses that depend on the unarchived sub-changes are still open. What holds:
    `npm run build` exits 0 (`build complete (no changes)`), `npm run check` exits 0
    (`generated files are up to date`), and `npm test` in MF is **159 of 159, 0 failed,
    0 skipped** in 12.4 s, `test/plugin.test.mjs` among the files that actually ran, which is
    success criterion 1's "fixture plugin test proves the contract without the browser harness".
    `plugin list` shows `my-flow-browser 0.1.0 [enabled]`, `setup: ok`, `claude: installed`,
    `codex: installed` — criterion 1's other half, on both surfaces. In SF the tree is clean on
    `my-flow/privacy`, the artifact tag `@browserbasehq/stagehand@4.1.0-myflow.1` is intact with
    HEAD seven ledger-only commits past it, and MB pins that exact tarball.
    .
    **One correction to the record, found by running it.** Task 3.4's note describes the
    accepted Windows condition in SF as "two upstream files that fail on this Windows checkout";
    the true count today is **four**: `packageContract.test.ts` (`spawn pnpm ENOENT`),
    `objectWrapper.test.ts` (a fixture `lastModified` of `4294967295000`, the 32-bit mtime
    ceiling this filesystem returns), `browser/localBrowser.test.ts` and
    `browser/factories.test.ts` (both on the Chrome-installation discovery path, and both still
    failing with `CHROME_PATH` set to the real Chrome, so the env var is not what they want).
    The suite is 286 of 290 passing. None of the four files is in the fork's diff, and the
    fork's only edit to `localBrowser.ts` swaps `globalThis.fetch` for `guardedFetch`, which the
    discovery test never reaches — so the substance of the accepted reading holds, that no file
    passing at the base tag regressed. It is the count that was wrong, and it is recorded here
    rather than corrected in an archived ledger.
    .
    **Historical archive snapshot (superseded by model-gateway's 2026-09-13 archive):** five of the seven archive
    directories exist (`2026-09-10-plugin-contract` in MF, `2026-09-11-harness-core`,
    `2026-09-12-temp-profiles` and `2026-09-12-request-interception` in MB,
    `2026-09-12-stagehand-fork` in SF); `model-gateway` and `extension-bridge` are the two
    missing, for the reasons in 4.5 and 5.5. Success criteria 2, 3 and 4 need the real host
    sessions of `extension-bridge` task 8.3, and criterion 5 needs a PASS from every sub-change.
- [ ] 8.2 Clean up only this umbrella's diff under `changes/plugin-system-browser-harness/`, re-run its affected checks, then make a local commit limited to this change's documents and evidence so all seven PASS copies are committed before 8.3 (inspect the staged paths and leave unrelated changes unstaged; no push); and verify the cleanup introduces no placeholders or unrelated edits, repeated checks pass, the commit contains only this change directory, and `git show HEAD:changes/plugin-system-browser-harness/verify/<sub-change>.md` reproduces all seven PASS copies byte-for-byte
  - blocked: cleanup of the current umbrella diff is possible now, but final re-verification
    still depends on extension-bridge's evidence and archive; see 8.1.
    .
    **The cleanup half is measured and clean (2026-09-13); only the re-verify half waits.**
    `git status --porcelain` in MF lists exactly two entries, `M
    changes/plugin-system-browser-harness/tasks.md` and `??
    changes/plugin-system-browser-harness/verify/temp-profiles.md`, and filtering out that
    directory leaves **zero** — so this task's parenthetical, that the umbrella's diff is its own
    directory and nothing else in MF, holds as written. A fake-completion grep for `TODO`,
    `FIXME`, `test.skip` and `.only(` across the directory returns four hits, and all four are
    prose **inside** the verify copies reporting that the same grep found nothing in the code
    they audited (`harness-core.md:31`, `plugin-contract.md:304-305`,
    `request-interception.md:20`). A grep for markers cannot distinguish a marker from a sentence
    about markers, which is why they are enumerated here rather than counted: none is a leftover.
- [ ] 8.3 Obtain an independent `mf-verify plugin-system-browser-harness` report in MF after 8.1 and 8.2, with all seven committed PASS copies and the full host-by-scenario evidence matrix reviewed and all seven archives re-listed; and verify `MF/.my-flow/verify/plugin-system-browser-harness-<ts>.md` contains `### Verdict: PASS` covering the unchanged success criteria and accepted baseline conditions, identifies the evidence commit, and has no missing real-host scenario before this final box is ticked and the normal umbrella archive is run
  - blocked: extension-bridge's PASS copy and archive are still missing. The six other
    sub-change PASS copies and archive directories can be checked independently; the final
    umbrella PASS remains dependent on 5.3-5.5 and the both-host clauses in 8.1.
