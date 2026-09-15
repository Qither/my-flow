## PLAN-DR

Principles: one progress ledger; stable identity with immutable evidence versions; explicit
relationships; independent judgment proportional to risk; compatibility without invented trust.

Decision drivers: (1) readable tasks and reliable navigation, (2) trustworthy closeout under
concurrent edits, (3) lower repeated context and rework without weaker verification.

Viable options:

| Option | Benefit | Cost / decision |
| --- | --- | --- |
| Shorter prose and ordinary Markdown links only | Small immediate change | Cannot validate dependencies or evidence freshness; insufficient alone |
| Versioned metadata alongside Markdown, shared library and current dashboard | Reuses existing surfaces and supports deterministic checks | Selected; adds a small file contract and explicit upgrade |
| Mandatory jj or a task database | Rich history or querying | Rejected for this delivery: unnecessary dependency and migration; jj remains optional later |

## Context

This is a full, deliberate plan: archive publication, persisted contracts, APIs and migrations
change. All four scope decisions are confirmed in [proposal.md](proposal.md). English is the
default authoring language; existing content is not translated. No implementation occurs here.

Repository baseline: `6a84be8`. Recent conventions include `44b1cb2` (shared dashboard library),
`09ff314` (fast lane/UI), `bb56875` (goal guard), and `be46bff` (plugin boundary). There is no
repository-root AGENTS.md/CLAUDE.md; the supplied working agreement and
`templates/project/AGENTS.md:1` apply. No `.codegraph/` exists.

Existing patterns to retain:

| Evidence | Pattern / implication |
| --- | --- |
| `scripts/lib/intent.mjs:5` | “every function ... takes root explicitly”; shared CLI/server results remain one implementation |
| `scripts/lib/intent.mjs:46`, `:241` | Checkbox counts and `- [ ] N.M` grammar; retain this readable syntax |
| `scripts/spec.mjs:95`, `:125` | Merge writes capability by capability; any scratch PASS currently qualifies; replace both guarantees |
| `scripts/lib/intent.mjs:269` | Existing delta/name validation is reusable; strengthen ADDED collisions and RENAMED handling |
| `scripts/dashboard.mjs:85`, `:105`, `:434`, `:458` | Markdown allow-list and pre-disclosure execute lock; extend typed data without widening raw file access |
| `web/app.mjs:13`, `:233`, `:649` | Hash routes, file-centric change page, SSE refresh; extend these, retaining file view |
| `web/md.mjs:21`, `:50` | Safe links, escaped text, hidden comments; keep renderer dependency-free |
| `hooks/completion-guard.mjs:109`, `hooks/session-context.mjs:28` | Duplicate task/state parsing; replace through shared, fail-open hook adapters |
| `src/skills/execute.md:89`, `:95` | Blocked independent work and fixed final gate; preserve their intent |
| `src/skills/mf-verify.md:16`, `src/agents/verifier.md:13` | Every criterion and independent fresh commands; context packets must not hide criteria |
| `scripts/init.mjs:55`, `scripts/build.mjs:86`, `:114`, `:135` | Copy-if-missing project templates; generated host surfaces from src |
| `test/helpers.mjs:2`, `package.json:13` | Temporary roots and child-process checks with explicit test entry list |

## Goals / Non-Goals

Deliver the twelve proposal criteria through ordered phases: linked intent; basic task UI;
evidence and archive integrity; session isolation; efficient workflow and integration. Dependencies
are explicit in [tasks.md](tasks.md); [acceptance.md](acceptance.md) maps outcomes to checks.

Non-goals follow the proposal. In particular, no runtime browser fixes, jj adapter, automatic
test-result reuse across verification attempts, token telemetry scraping, graph-layout library,
bulk history rewrite, or automated semantic spec merge. No additional model/provider routing.

## Decisions

### D-01 — Keep Markdown authoritative and add stable identities

The exact v2 syntax and interfaces are in [contracts.md](contracts.md). `change.json` owns a
UUID and lifecycle metadata; `tasks.md` alone owns task completion and blockers. Acceptance
blocks and design headings carry stable IDs. IDs are not numbering or titles. A derived graph
provides forward/back links, cycle diagnostics and readiness; no duplicated task database.

Default task rows contain a short action and observable result. References open named details.
No embedded executable shell DSL. Technical checks name normal test files or commands in the
acceptance detail. A length diagnostic is advisory; readability is also manually reviewed.

Legacy Markdown remains readable with dependency state `unknown`; numbering never implies an
edge. `spec upgrade <name> --dry-run` and explicit `--apply` convert active changes only, preserve
content/checkboxes and save originals. They do not invent acceptance or dependencies. Resume
prompts for this explicit upgrade once; historical archives and simple-mode documents stay
unchanged. Simple mode continues legacy reading/guard behavior, without claiming v2 guarantees.

### D-02 — Resolve typed links by identity

Use the current hash-router with `#/change/<uuid>/<task|acceptance|design|evidence>/<id>`.
Resolvers scan active and archived change manifests each request; duplicate UUIDs are errors.
Old file/name/archive routes continue to work. Display names are resolved from targets, not
copied into reverse indices. Evidence links include attempt identity and immutable target
content. New typed API routes return validated projections, never arbitrary JSON files.

Same-repository child references use UUIDs. Cross-repository umbrellas use an explicit local
alias map in scratch and relative repository aliases in durable metadata; API callers cannot
supply filesystem roots. Unknown/missing external children remain unresolved. See contracts
for confinement and archived-child resolution. A local adjacency list is sufficient for v1;
an optional small SVG view uses that same graph, without new dependencies.

### D-03 — Bind reports to concrete inputs and keep independent verification fresh

Start every final verification attempt before delegating. Capture acceptance and implementation
targets, then the read-only verifier runs the declared checks itself. The parent stores its
verbatim report and structured result through a recording command. Required PARTIAL/MISSING
means INCOMPLETE; contradicted behavior means FAIL. An in-progress or newer non-PASS attempt
supersedes an old PASS. Immutable attempt directories survive archive.

The implementation snapshot hashes a conservative repository-wide inventory, including staged,
unstaged, deleted and nonignored untracked files. Intent and evidence are captured separately.
Comparison at start/end detects writer drift; for an isolated verification workspace its
content digest must match, regardless of local absolute path. Environment identity and command
results are recorded. Unenumerable submodules/ignored build inputs are explicit blockers or
declared inputs, never silently omitted. See the exact exclusion and hashing rules in contracts.

Hashes detect changed inputs, not a malicious local writer or fabricated authorship. Report
origin records distinguish native independent-agent output, imported historical material and
unattested input. No cryptographic signer or transcript parser is introduced. Final verification
still requires a fresh independent pass in the current attempt. Previous reports are context,
not cached approval. Self-reference exclusions cover only known bookkeeping fields/paths.

### D-04 — Make archive a preflighted, recoverable publication

Keep overlap warnings; competing proposals alone must not deadlock. Capture requirement base
blocks when the plan is finalized/upgraded; archive compares each claimed requirement against
that base. ADDED requires absence, MODIFIED/REMOVED require matching content, and RENAMED
requires a matching source and absent destination. Prepare all results before any spec writes.
Conflicts identify base/current/proposed blocks and leave unrelated tasks runnable.

A durable transaction journal with before/after hashes and backups protects multi-file changes.
All intent writers and complete multi-file reads share one repository intent lock (C-09),
delivered before migration. CLI/server readers finish one locked snapshot or report busy/recovery
pending rather than serving a mixed snapshot. Rename operations remain
same-volume and per-file atomic; there is no claim that the entire filesystem transaction is
atomic to external editors. Recovery detects external edits and stops without overwriting them.
Detailed ordering and fault cases are in contracts.

For v2, `--force` never bypasses required evidence, task completion, conflicts or structure.
For legacy, retain reading but require upgrade before a verified archive. An explicitly forced
legacy archive can retain the old escape hatch only with `verification: unverified-legacy` in
its publication receipt; it still runs structural/base-availability diagnostics and may not
silently overwrite a current requirement. No historical report acquires v2 provenance.

### D-05 — Separate lifecycle, session activity and umbrella integration

Durable stage lives in `change.json`; active session leases live in individual scratch files.
Use explicit session identity before fallback; never assume undocumented host payload fields.
Known session resolution never falls back to another session's global pointer. All consumers
share TTL, parse behavior and precedence. Without session identity the legacy pointer is a
compatibility hint only when no session leases create ambiguity. The UI locks the leased change
and current spec paths it claims, not every active change. A malformed lease for a known target
keeps that target read-only with a recovery explanation; hooks continue fail-open.

Umbrella children and prerequisites are durable references, not copied completion counters.
Derived child states are visible separately from the umbrella's own integration acceptance.
Umbrella task boxes remain manual claims backed by evidence; child completion never ticks them.
Different physical workspaces are recommended for concurrent writers; leases do not isolate
files or coordinate arbitrary external processes.

### D-06 — Controlled amendments and focused escalation

Add `mf-plan --amend <name>` using a staged candidate containing old/new references, reason,
evidence, affected task/acceptance IDs and review authority. Locator-only corrections may be
recorded by the executor; equivalent verification-method corrections need independent review;
guarantee reductions or expanded commitments require a scope decision under existing user
authorization. Preserve old revisions and invalidate affected evidence. Pause affected tasks
and descendants; explicitly reopen their checked boxes and record the hold in tasks.md. Keep
approved executable text active for unaffected tasks and allow their existing lease refresh.
Only reviewed apply changes canonical text; locator/equivalent/scope authority and cancel/apply
transitions are specified in C-07. No requirement is lowered because code fails it.

Two materially different failed approaches with the same identified root cause trigger design
review, not another blind patch or automatic escalation to the user. Record a compact finding
ID and linked attempts; architect/planner select a remedy inside scope. A changed trust boundary
returns to full review. Task-local blocker text remains in tasks.md; amendment files are history.

### D-07 — Route review by risk and reduce repeated context

Low: reversible single-file, known approach and explicit acceptance; direct execution with
independent final verification. Medium: multiple files with clear design and no high-risk
category; main-context short plan plus critic. High/uncertain: planner → architect → critic and
deliberate pre-mortem. Preserve the existing high-risk category list once in mf-plan. Automatic
selection records reasons and touched paths; `--fast` requests medium and cannot override high;
`--deliberate` forces high. `--go` still requires explicit `--fast` and existing execute handoff.
An auto lane never authorizes implementation. Changed scope can escalate a lane, not silently
downgrade it. Medium REJECT requires re-review of fixes before approval; bounded loops escalate.

Create derived context packets containing full constraints, task/acceptance index, selected
task closure, relevant design/spec blocks, source locators and digests, and unresolved findings.
Packets are scratch, never authoritative summaries. A repeated review receives the previous
review plus changed blocks and open findings. Reviewer can expand source reads; high-risk
architect and critic remain independent. Final verifier receives the complete required criteria
index and fresh commands, not a writer-selected subset. Changed packet inputs force regeneration.

Mechanical checks return totals, actionable failures and a full log path. Do not hide truncated
failures; JSON is complete. No token-saving claim follows from collapsed UI content. Measure
available usage per attempt/actor/stage with explicit unknowns and disjoint accounting scopes;
do not infer tokens from characters or account quota deltas. Compare similar-risk completed
changes including rejected/abandoned attempts, wall time and post-closeout defects.

### D-08 — Bootstrap and follow-up boundaries

Keep this plan legacy through T-31; exercise new v2 behavior in disposable fixtures. T-30 delivers
the common lock/journal/recover primitives before T-05 migration. T-32 explicitly upgrades this
plan only after stage/session/review/amend/evidence/archive recovery commands exist. At T-32,
review the migration diff, complete dependencies and verification-inputs, capture bases, record
fresh full-lane reviews and switch its stage/session binding. Preserve existing checkbox claims,
but obtain all final evidence afresh after the switch. No future command bootstraps itself.

The user confirmed real Claude and Codex observations. T-29 preflights authentication, native
goal and independent-agent capability before implementation, including a scheduled manual Claude
handoff. T-25 builds and temporary-installs source changes; T-31 prepares disposable fixtures;
the independent T-28 pass runs [live-host-protocol.md](live-host-protocol.md). Missing required
host capability is an early prerequisite failure requiring user resolution, not static PASS.

Later independent changes: optional jj adapter (snapshot/workspace/recovery compatibility with
Git and Windows line endings), browser audit close-drain implementation/spec reconciliation,
browser Purpose cleanup and stagehand maintenance. Reinspect each sibling baseline first.
Their delivery does not block this core change; document handoff acceptance in [follow-ups.md](follow-ups.md).

## Risks / Trade-offs

The schema and archive work are the main complexity. Prefer conservative whole-source snapshots
to speculative impact-based test reuse. Cross-repo evidence needs available local repos to
verify, while ordinary reading remains useful when an alias is missing. Local file formats
provide auditability and recovery, not tamper-proof authorization.

Pre-mortem:

1. A report's own save makes it stale. Test the exclusion allow-list against final checkbox,
   evidence and relocation changes, then prove a task/constraint/source edit still invalidates it.
2. A crash publishes only one capability. Inject a fault at every transaction transition;
   readers must report recovery pending, and resume either completes or identifies external edits.
3. A second session releases the first session's lock. Run two leases plus an unidentified hook;
   verify independent bindings, targeted locks, expiry and no cross-session fallback.

## Do-Not-Touch

Do not edit sibling repositories, existing `changes/archive/**`, user home installs, plugin
registries, models/pricing configuration or unrelated source. Do not hand-edit generated skills,
agents or host blocks; regenerate them. Main `specs/**` are merged only during archive; all delta
work belongs to this change. Do not change goal creation/approval semantics or completion claim
recognition beyond session/task-data integration.

## Rebuild / Re-run After Change

Use `node --test` with the named suites in acceptance.md while working. Add new suites to
`package.json`'s explicit list. After source/template changes run `node scripts/build.mjs`,
`node scripts/build.mjs --check`, `npm test`, and `node scripts/spec.mjs validate
linked-evidence-workflow`. Rebuild after the last relevant edit. Exercise temporary-home
installation only; do not update live Codex/Claude installations. Final UI validation uses
the local dashboard in both palettes at desktop and narrow widths. Save browser observations
and screenshots as evidence, not as a substitute for CLI/API checks.

## Test Plan

Unit: Markdown graph/resolver, hashing canonicalization, session precedence, report schemas,
archive three-way comparisons, context selection and usage arithmetic. Integration: temporary
Git roots, CLI/server parity, hook subprocesses, paused read/publication races, journal recovery,
verification head loss, concurrent sessions,
opt-in migration and generated surfaces. End-to-end: create → link → amend → verify → archive
→ navigate, including an interrupted attempt and two competing spec changes. Observability:
diagnostics name IDs/paths, missing metrics stay null and required absent evidence blocks PASS.
Exact test groups and manual evidence requirements are in acceptance.md.

Execution is sequential because CLI/library changes share files. A team is not planned; the
responsibility map in acceptance.md identifies files without authorizing overlapping writers.
