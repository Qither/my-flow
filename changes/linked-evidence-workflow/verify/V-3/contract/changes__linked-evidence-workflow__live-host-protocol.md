# Real-host verification protocol

This protocol executes only after implementation is authorized. T-29 checks prerequisites before
source work; T-31 prepares the rebuilt candidate; T-28 performs the fresh independent observations.
The user explicitly retains both real-host requirements and the manual Claude goal exchange.
Do not launch live sessions during this planning turn.

## L-01 — Early prerequisite preflight (T-29)

1. Create a disposable directory under the system temp directory containing separate `claude/`
   and `codex/` workspaces and homes. Define one reusable Node child-launch environment for
   **every** version/help, installer, setup, feature-check, CLI and hook-descendant process:
   `MY_FLOW_HOME=<fixture>/homes/my-flow`, `CODEX_HOME=<fixture>/homes/codex`,
   `CLAUDE_CONFIG_DIR=<fixture>/homes/claude`, and
   `MY_FLOW_SCHTASKS=<fixture>/scheduler-recorder.mjs`. The recorder implements the existing
   scheduler test seam and records requests without invoking Task Scheduler. Every launch gets
   this same environment plus its explicit fixture cwd/session; never partially override it.
   Do not assign shell HOME/CODEX_HOME or mutate live config. Check all resolved output homes,
   registry/model state, shim and recorder paths stay within the fixture. Hash non-secret config
   in the real `.my-flow`, `.codex` and `.claude` homes before/after; do not read credential files.
   Authentication in temporary profiles may need the user; do not copy secrets.
2. Capture `claude --version`, `claude --help`, `codex --version` and `codex --help` through that
   same launcher in fixture output. Installed binaries alone do not prove authentication/features.
3. Before asking either empty profile to delegate, copy the current **baseline** generated
   plugin/roles into the fixture. Run its `scripts/install.mjs codex` with the shared child
   environment; confirm verifier TOML, skills, hooks and shim resolve to the baseline copy.
   Claude loads that baseline copy through `--plugin-dir` with project-only settings. Installer
   behavior at `scripts/install.mjs:566` warns about flags but does not enable them. Capture
   `codex features --help` and `codex features list` under the temporary environment, verify
   `goals`, `hooks` and `multi_agent` are supported, and set those features only in the temporary
   config (or documented per-invocation `--enable` flags). Re-read the temporary feature list
   to prove they are enabled. Existing true values in the real profile prove nothing about this
   empty profile. Unsupported flags are a prerequisite failure, not a reason for global edits.
4. Launch interactive Claude with that baseline plugin path, `--session-id <fixture-uuid>`,
   `--setting-sources project` and `--settings <fixture-settings.json>`. Launch Codex with
   `--cd <fixture-root> --no-alt-screen`. Use only flags confirmed in captured help. Prompt each:

   > This is a read-only capability preflight. Confirm this session is authenticated by replying
   > HOST_READY. Report whether the native goal mechanism is available without creating or
   > changing a goal. Launch one read-only verifier subagent to read fixture.txt and return its
   > exact contents plus its role. Do not edit files, create goals or claim unavailable tools.

   `fixture.txt` contains a fresh random sentinel recorded by the observer. Capture the visible
   native subagent invocation/result; a main-agent statement that it "used a verifier" is not
   sufficient. Codex must expose its goal tools; Claude must expose `/goal` in the interactive
   command/help surface. If capability discovery needs a session setting, record it explicitly.
5. Record host/version, auth success, goal capability and actual independent-agent evidence in
   `.my-flow/verify/linked-evidence-workflow-preflight.md`. No secrets or raw auth payloads.
   Arrange the user's availability for the final Claude `/goal` paste-and-reply. Missing auth,
   native goals or subagents means T-29 remains unchecked; request the specific user setup and
   pause implementation. Do not replace this requirement with a scripted fake transcript.

Configuration references already consulted for this plan: [Claude CLI](https://code.claude.com/docs/en/cli-usage),
[Claude hooks](https://code.claude.com/docs/en/hooks), [Codex configuration](https://learn.chatgpt.com/docs/config-file/config-advanced),
and [Codex CLI commands](https://learn.chatgpt.com/docs/developer-commands?surface=cli).
Claude common hook input includes `session_id`, `transcript_path` and `cwd`; subagent events
include agent identity. Codex payload identity is not assumed. Refresh help if versions change.

## L-02 — Candidate setup (T-25 and T-31)

After `node scripts/build.mjs` and `--check` pass, copy the candidate into disposable test roots
with Git initialized and a baseline commit. Seed full/medium/amendment fixture changes using the
candidate CLI; never test by modifying this project's real lifecycle. Repeat L-01's complete
shared child environment, resolved-path checks, install/load and temporary feature enablement
with the rebuilt **candidate** replacing the baseline. Start with new fixture profiles; do not
reuse baseline agent files accidentally. Load Claude via `--plugin-dir <candidate-copy>` and
install Codex using `node scripts/install.mjs codex` with all four isolation variables still set.
Confirm generated skills, agents, hook shim and feature state refer to the candidate fixture.
Capture before/after hashes proving the real three homes' non-secret configuration is unchanged.

Add child-only `MY_FLOW_SESSION_ID=<fixture-uuid>` to that reusable environment for each host and use that same identity in
all fixture `spec stage ... --session <uuid>` calls. For Claude also pass that UUID through
`--session-id`. A test wrapper records only hook `cwd/session_id` and guard output; it delegates
to the actual generated hook and does not replace its decisions. For Codex the explicit env
identity is the propagation contract; capture the matching session lease and CLI arguments.
This does not depend on undocumented host payload fields.

Fixtures: `medium` changes two tiny text modules with explicit automated acceptance; `high`
changes a public CLI behavior in a toy command; `amend` has tasks A → B plus independent C,
initially A checked and B/C open. The amendment changes A's check to an equivalent check while
retaining its guarantee. Fixture files/checks are ordinary tiny Node tests in
`test/fixtures/live-workflow/`; use their implementation test snapshots to make expected results
deterministic. Each host receives its own root/session, not a shared writable fixture.

## L-03 — Exact observation prompts (T-28)

The independent verifier owns observation and records evidence source references; writer output
is context only. Run both hosts against the rebuilt final candidate and capture candidate hash,
host settings identity and fixture input hashes at start and end. No source edits during checks.

**Risk selection, each host:**

> Use my-flow-mf-plan for change medium. Plan only. Determine its risk from the fixture proposal
> and files, record the lane, and complete the required independent review. Do not implement.
> Then plan change high with --fast. Preserve the full-review rule for its public CLI change.

Pass: medium uses main-context draft plus actual independent critic; high refuses fast and
invokes planner, architect, critic in order. There is no execute lease or implementation diff.
Record actual delegated role events and outputs, not only the final textual lane claim.

**Goal handoff, Claude:**

> Invoke my-flow-execute medium in this fixture. Follow its native goal handoff exactly and stop
> until I provide the required response. Use the configured fixture session identity.

Observer records the printed `/goal` statement and verifies no task edit/execute lease before
the response. The user manually pastes that exact `/goal ...` command and replies `continue`.
No agent/tool impersonates this reply. Observe the same session begin execution, independently
verify one task, tick it and refresh its lease. `/goal` text must not trigger a false completion
block. Record the visible exchange and state before/after; exit the disposable session afterward.

**Goal handoff, Codex:**

> Invoke $my-flow-execute medium in this fixture. Inspect native goal state and create the one
> task goal only if none exists. Do not replace an unrelated goal. Use the fixture session
> identity and run the first task through its normal verification and stage refresh.

Pass: actual native `get_goal`/`create_goal` events show one correct goal, or an explicitly
identified matching existing goal; no stacked goal. A separate preseeded unrelated-goal fixture
must stop and explain the conflict rather than replacing it. No `/goal` user paste is invented
for Codex. Observe its real read-only verifier separately run the check and preserve identity.

**Amendment and repeated cause, each host:**

> Use the amend fixture. Record the two provided failed approaches as the same root cause F-1.
> Request design review before attempting a third patch. Propose the supplied equivalent-check
> amendment through the staged amendment path. While its review is pending, continue only C
> under the approved contract and refresh this session lease. Do not tick held A or B. After
> independent equivalence review, apply the amendment and show which tasks reopened.

Pass: design review precedes a third patch; A/B are unchecked and held while C completes; old
canonical guarantee remains active pending review; lease refresh succeeds. Actual independent
review authorizes candidate application; A/B stay unchecked afterward, C stays checked and old
evidence is visibly historical. No guarantee is weakened. Capture task/contract/lease snapshots.

**Independent final-verifier behavior, each host:**

> Invoke my-flow-mf-verify for the supplied verify fixture. One required criterion is live but
> has only old static evidence. Start a new attempt and use a separate read-only verifier that
> runs its checks itself. Preserve the verdict and gaps without softening them.

Pass: new attempt/provenance exists; the verifier actually runs fresh commands; the missing live
criterion produces INCOMPLETE and neither completion nor archive reuses the fixture's old PASS.
This fixture's expected INCOMPLETE is a successful behavioral test, not the verdict of this core
change. Then satisfy the live fixture criterion and run a new independent attempt to demonstrate
eligible PASS for its exact target. Use the observed outputs as evidence for core AC-05/06/10.

## L-04 — Evidence and stop conditions

Write logs/screenshots and concise observation tables under disposable
`observations/<host>/<scenario>/`; record role/session/goal tool events, fixture before/after
hashes and command outputs. During T-28 copy those files into this change's current
`verify/V-<seq>/artifacts/live/<host>/` via the evidence recording interface and reference their
hashes per criterion. Preflight and T-31 setup evidence remain explicitly separate from the fresh
final observations. Redact secrets before capture; do not import entire personal transcripts.

Required outcomes are binary observed/not-observed. Unavailable authentication, goal UI/tool,
subagent events, manual response or lost transcript evidence means INCOMPLETE with the exact
missing prerequisite. The user can resolve it; it is never silently downgraded to static proof.
Record results before removing only the resolved disposable roots. Do not delete user profiles,
publish fixture repositories or mark the actual change done until the independent verdict passes.
