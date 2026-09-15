# Acceptance and test map

These IDs refine the proposal's outcomes without duplicating their rationale. Listed new suites
must be added to the explicit `npm test` list. Every task's phrase refers to the cases below;
run its named suite with `node --test <file>`. Source anchors and exact interfaces are in design
and contracts. Static skill assertions prove written instructions only; live host claims need
the separate observations below. Missing live evidence produces INCOMPLETE, not an inferred PASS.

Real-host observations follow [live-host-protocol.md](live-host-protocol.md): T-29 preflight is
an implementation prerequisite; T-25/T-31 build and isolate the candidate; T-28 obtains fresh
independent Claude and Codex observations, including the user's scheduled Claude goal exchange.

### AC-01 — Readable task entry

Task rows show a brief action and observable completion result; technical checks and historical
notes are reachable in details. Ordinary Markdown remains understandable outside the dashboard.
- evidence-mode: automated, manual
- required: true
- checks: `test/intent-graph.test.mjs`, `test/markdown.test.mjs`, `test/ui.test.mjs`; manual fixture reading
- tasks: T-01, T-05, T-06, T-08

Parse fields outside fences only, keep source spans, preserve nested legacy notes and reject
orphan/duplicate v2 fields. UI fixtures include a long legacy task, a concise v2 task, absent
evidence and missing dependency declaration. At 1280px and 390px, both palettes: title/result
are visible without opening commands; links have target names; no horizontal page overflow.

### AC-02 — Stable relationships and navigation

Identity-based links survive title/number changes and archive; explicit dependencies explain
readiness and generate reverse links. Dependencies, related information and group order differ.
- evidence-mode: automated, manual
- required: true
- checks: `test/intent-graph.test.mjs`, `test/dashboard.test.mjs`, `test/ui.test.mjs`
- tasks: T-02, T-03, T-04, T-06, T-07, T-08, T-14, T-18

Test a fork/join graph, unknown dependencies, blocked predecessors, duplicate UUID, archived
resolve, immutable evidence target navigation, malformed URI encoding and unknown types. Check
keyboard focus/back navigation and SSE refresh after task edit, target edit and archive move.

### AC-03 — Actionable structural diagnostics

Duplicate identities, missing references, cycles and invalid ledger annotations identify their
source and targets; CLI and Web derive the same graph and validation results.
- evidence-mode: automated
- required: true
- checks: `test/intent-graph.test.mjs`, `test/spec.test.mjs`, `test/dashboard.test.mjs`, `test/context.test.mjs`
- tasks: T-01, T-02, T-04, T-07, T-22

Test self/multi-node cycles, missing design/acceptance refs, ID renumbering, second-call freshness,
and unsupported metadata. Validate should not turn independent later completed tasks into errors
merely because earlier numbered tasks are open. JSON must contain complete diagnostics.

### AC-04 — Reviewed amendments and repeated-cause escalation

An approved amendment preserves old/new contracts, authority and affected IDs. Affected evidence
is invalid; dependent tasks wait; unrelated work remains available. Repeat causes trigger review.
- evidence-mode: automated, static, live
- required: true
- checks: `test/evidence.test.mjs`, `test/context.test.mjs`, `test/workflow.test.mjs`; host amendment fixture
- tasks: T-19, T-20, T-24

Test staged locator/equivalent/scope transitions, stale candidate approval, pending scope decision,
checked-task reopening, hold precedence, cancel/apply, unaffected task completion and lease refresh,
concurrent unrelated checkbox changes during review, descendant closure and retained reports.
The original approved semantic digest must remain executable while the candidate is pending.
T-19/T-21 fixtures start with an eligible high-lane base, apply authorized locator and equivalent
links, and assert both `stage execute` and evidence begin accept the resulting exact digest.
Missing authority, broken old/new digest links, unapplied candidates and unauthorized scope
changes reject both commands. A changed risk/trust boundary requires a new full direct review.
Live fixture: two different failed approaches
share a root cause; the agent requests design review before a third patch, preserves one
independent runnable task, and does not reduce the guarantee without a scope decision.

### AC-05 — Evidence mode matches the claim

Required criteria and their declared modes must be VERIFIED before PASS. Static instruction
checks cannot prove live host behavior; missing provenance never qualifies as independent.
- evidence-mode: automated, static, live
- required: true
- checks: `test/evidence.test.mjs`, `test/workflow.test.mjs`; separate-host verifier observation
- tasks: T-10, T-12, T-19, T-24, T-29, T-31, T-28

Reject omitted IDs, required PARTIAL, mismatched report/result verdict, same writer/verifier ID,
missing source attestation and static-only evidence for live criteria. Final independent verifier
must execute current checks; a previous PASS can inform reading but cannot satisfy fresh coverage.

### AC-06 — Durable evidence belongs to exact inputs

Persist reports verbatim with target snapshots. Newer started/failed/incomplete attempts block
old PASS; changed source, contract or required environment inputs require new verification.
- evidence-mode: automated
- required: true
- checks: `test/evidence.test.mjs`, `test/archive.test.mjs`, `test/dashboard.test.mjs`
- tasks: T-09, T-10, T-12, T-14, T-24, T-30, T-32

Use temp Git repositories with staged/unstaged/deleted/untracked files, moved HEAD with equal
content, symlinks, ignored declared inputs, missing submodule input, changed source during checks,
missing report file, corrupted digests, interrupted attempts and concurrent sequence allocation.
Remove the entire newest attempt directory after a reserved/open/closed head; old PASS must not
qualify. Inject failures between high-water reservation, directory publication and head closure.
Test missing/corrupt head metadata and evidence begin/record racing archive under the shared lock.

### AC-07 — Archive cannot silently overwrite intent

All structures, input versions and spec bases pass before publication. A stale base blocks;
mere overlap does not. Recovery neither loses original content nor overwrites external edits.
- evidence-mode: automated
- required: true
- checks: `test/intent-io.test.mjs`, `test/archive.test.mjs`, `test/spec.test.mjs`, `test/dashboard.test.mjs`
- tasks: T-11, T-12, T-13, T-14, T-30

Test ADDED collision, MODIFIED/REMOVED stale bases, RENAMED destination collision, duplicate
headings, multi-capability preflight failure, two changes with same baseline, post-preflight edit,
destination collision, each transaction failpoint, idempotent recovery and external edit refusal.
Check readers expose recovery-pending and writers do not enter a second transaction. Pause a
reader after its first file and start publication: publication must wait or return busy; the
reader returns one coherent snapshot. Race dashboard save, review record, evidence begin and
stage update against archive. All use one lock; no nested-lock deadlock or partial success.

### AC-08 — Bookkeeping does not invalidate the verified target

Saving reports/logs, final checkbox/evidence annotations and relocation preserve matching inputs;
changing a work task's text, constraint, dependency, child target or source invalidates them.
- evidence-mode: automated
- required: true
- checks: `test/evidence.test.mjs`, `test/archive.test.mjs`
- tasks: T-09, T-10, T-13, T-14

Use an explicit exclusion matrix including LF/CRLF contract normalization, source raw-byte changes,
via marker insertion, task kind changes and attempts to hide work in a closeout task. Verify a
checked box alone cannot create evidence and final closeout remains required at archive.

### AC-09 — Sessions and umbrellas preserve boundaries

Sessions cannot replace each other's activity. Locks follow active writers; umbrellas show child
state separately from integration verification, including unresolved cross-repo references.
- evidence-mode: automated, live
- required: true
- checks: `test/intent-state.test.mjs`, `test/completion-guard.test.mjs`, `test/dashboard.test.mjs`, `test/workflow.test.mjs`
- tasks: T-15, T-16, T-17, T-18, T-24, T-29, T-31, T-32, T-28

Test explicit/env/transcript/unknown identity, known-but-unbound session, two sessions, corrupt
lease, expiry/future timestamps, conflicting lifecycle CAS, same physical change lease conflict,
legacy simple fallback, lost scratch, targeted save locks, original request/lock/mtime precedence,
child cycles, archived/abandoned/missing child, unavailable alias and integration failure despite
all children complete. Host fixture confirms the session passed to stage matches hook input.

### AC-10 — Less repeated context without weaker independent review

Risk selects review roles with recorded reasons. Packets are current and complete for their
purpose; repeats focus on changes/findings; final verification remains a fresh separate pass.
- evidence-mode: automated, static, live
- required: true
- checks: `test/context.test.mjs`, `test/workflow.test.mjs`, `test/models.test.mjs`; host lane/handoff fixtures
- tasks: T-20, T-21, T-22, T-24, T-25, T-29, T-31, T-28

Test low/medium/high and uncertain risk, explicit fast/deliberate/go combinations, medium review
rejection and escalation; auto lanes never start implementation. Packet tests assert complete
constraints/index, dependency closure, stale digest refusal, changed-block selection and full
verifier mode. Live observations on available Claude/Codex hosts confirm role separation and
their existing goal handoff; unavailable host scenarios remain INCOMPLETE. Measure packet
characters separately from actual imported tokens; do not label characters as token savings.

### AC-11 — Usage reports expose uncertainty

Available metrics are attributed to change/stage/attempt/actor including failed work; unknown
inputs and unavailable scopes never become zero or a made-up total.
- evidence-mode: automated, manual
- required: true
- checks: `test/usage.test.mjs`; review an exported comparison fixture
- tasks: T-23, T-24

Test duplicate event import, unknown metrics, cached-input subset, inclusive parent/child data,
failed/abandoned attempts, interval-union wall time and unsupported source payload. A comparison
names risk/sample coverage and absent data; no pricing or percentage-saving assertion is emitted.

### AC-12 — Compatibility is explicit and recoverable

Historical files remain unchanged; upgrades are explicit and preserve originals. Existing
CLI/API keys, raw Markdown safety, simple mode and generated host boundaries remain supported.
- evidence-mode: automated, static, manual
- required: true
- checks: `test/intent-io.test.mjs`, `test/spec.test.mjs`, `test/archive.test.mjs`, `test/dashboard.test.mjs`, `test/plugin.test.mjs`, `test/workflow.test.mjs`; build/check and full npm test
- tasks: T-03, T-04, T-05, T-08, T-11, T-12, T-13, T-15, T-16, T-17, T-21, T-25, T-26, T-27, T-28, T-29, T-30, T-31, T-32

Hash historical archive fixtures before/after reading, migration and init. Test customized old
templates, failed migration recovery, simple-mode upgrade refusal, legacy forced unverified
archive, v2 force refusal, read allow-list/traversal/symlink/origin defenses and reserved evidence
write denial. Rebuild generated surfaces and verify temporary-home install/shim loading with no
live home edits. Final diff review checks Do-Not-Touch and no placeholder/skipped tests.
T-29 loads/installs baseline generated roles before temporary-profile delegation; T-31 repeats
with the rebuilt candidate. Every subprocess shares temporary MY_FLOW_HOME/CODEX_HOME/
CLAUDE_CONFIG_DIR and the scheduler recorder. Assert resolved output paths remain inside the
fixture and real three-home configuration is unchanged; prove supported Codex goals/hooks/
multi_agent flags are enabled in the temporary profile, not merely the real profile.
T-30 independently proves generic multi-file recovery before T-05 uses it. T-32 rehearses a
legacy active change upgraded with all commands present: baseline, full review recording, session
stage refresh and evidence begin work in order; preserve historical archives and progress claims.
The real plan follows that same switch only after the fixture passes.

## Implementation ownership map

| Tasks | Production paths | Test ownership |
| --- | --- | --- |
| T-29, T-31, T-28 live protocol | Disposable roots/config and `test/fixtures/live-workflow/` | real host logs, role/goal events and session snapshots |
| T-30 | `scripts/lib/intent-io.mjs`, CLI/server outer read/write boundaries | intent-io/spec/dashboard |
| T-01–T-05 | `scripts/lib/intent-graph.mjs`, `intent-state.mjs`, `intent.mjs`, `scripts/spec.mjs`, `scripts/init.mjs`, `templates/change/*` | graph/spec/dashboard |
| T-06–T-08, T-14 | `web/app.mjs` (including its styleguide), `web/md.mjs`, `web/app.css`, `scripts/dashboard.mjs` | UI/markdown/styles/dashboard |
| T-09–T-13 | `scripts/lib/evidence.mjs`, `archive.mjs`, `intent.mjs`, `scripts/spec.mjs` | evidence/archive/spec |
| T-15–T-18 | `intent-state.mjs`, `intent-graph.mjs`, `scripts/spec.mjs`, both hooks, `scripts/dashboard.mjs`, `web/app.mjs` | state/guard/dashboard/workflow |
| T-19–T-24 | `evidence.mjs`, `context.mjs`, `usage.mjs`, `scripts/spec.mjs`, `src/skills/{mf-plan,execute,mf-verify,spec}.md`, `src/agents/{planner,architect,critic,verifier}.md`, `src/core/core.md` | evidence/context/usage/workflow/models |
| T-25–T-28, T-32 | README compatibility notes, `templates/project/**`, `templates/simple/change.md`, `templates/specs-README.md`, `package.json`, generated outputs; explicit active-plan upgrade | complete suites, bootstrap and live/manual evidence |

Use a single sequential integration writer. The map names responsibility and verification,
not permission for concurrent edits to shared files.
