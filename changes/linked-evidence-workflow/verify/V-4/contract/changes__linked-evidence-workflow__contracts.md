# Linked workflow contracts (v2)

This is the implementation reference for design D-01–D-07. All paths below are proposed,
relative to a project root. New libraries keep explicit `root` arguments, no CLI parsing and
no process termination. Reuse `intent.mjs` readers, delta splitting and report formatting.

## C-01 — Durable files and readable metadata

`changes/<slug>/change.json`:

```json
{
  "schemaVersion": 2,
  "id": "UUID",
  "slug": "example",
  "kind": "change",
  "stage": "mf-plan",
  "revision": 1,
  "updated": "ISO timestamp",
  "children": [],
  "review": { "lane": "high", "reason": "Public API", "paths": ["scripts/spec.mjs"] },
  "verification": { "highWater": 0, "head": null }
}
```

`kind` is `change|umbrella`; stage retains `new|interview|mf-plan|execute|done|archived`.
`revision` is compare-and-swap lifecycle metadata, not task progress. UUID is generated once.
Children are `{repo: "self"|alias, changeId: UUID, after: [UUID]}`; no task status in JSON.
Validate unique children, existing same-repo references and cycles. Unknown external resolution
is an actionable unresolved state. Abandoned children cannot satisfy integration prerequisites.

Each task keeps the legacy checkbox grammar and optional indented fields:

```markdown
- [ ] 1.1 Reject unfinished archives and verify the unfinished-task fixture is refused
  - id: T-01
  - depends-on: none
  - accepts: AC-01
  - design: D-04
  - evidence: none
  - kind: work
```

Allowed metadata: `id`, `depends-on`, `accepts`, `design`, `evidence`, `kind`, `blocked`.
Lists use comma-separated IDs, `none` is an explicit empty list, absent dependencies mean
unknown. IDs match `T-[A-Za-z0-9-]+`, `AC-...`, `D-...`, `V-...`. A field attaches only to the
immediately preceding task, never across headings/fences. Unknown v2 fields, duplicate fields,
or orphan metadata are errors; legacy indented notes remain prose. The parser ignores fenced
examples and comments, preserves source spans, recognizes `[x]` and `[X]`, and never executes
content. Renumbering and title changes retain IDs. Kind defaults to `work`; `closeout` marks
the final bookkeeping gate and cannot exempt implementation work from evidence.

Acceptance lives in `acceptance.md`:

```markdown
### AC-01 — Refuse unfinished work

An archive attempt lists unfinished tasks and leaves files unchanged.
- evidence-mode: automated
- required: true
- checks: test/spec.test.mjs — unfinished archive
- requirements: spec-helper / Safe archive publication
```

Modes: `automated|manual|static|live`. More than one can be listed; each must be covered.
`required` defaults true. Check text describes the observation; it is not a shell DSL.
`design.md` decisions use `### D-... — Title`. Acceptance references may also name stable
scenario IDs in delta specs; unnumbered legacy scenarios remain full-text contract inputs.
A v2 plan is executable only with every work task's acceptance/design references resolved and
dependencies explicitly declared. General `validate` distinguishes draft warnings from errors;
`stage execute`, verification begin and archive require the executable contract.

Readiness precedence: invalid reference/cycle → invalid; amendment hold or explicit blocked
→ blocked (even if incorrectly checked); checked → complete; missing dependency declaration
→ unknown; unfinished prerequisites → waiting; otherwise → ready. Checked-but-blocked and
checked-with-unfinished-prerequisite states are diagnostics. An amendment explicitly reopens
affected checked tasks in tasks.md under C-07; the derived graph never silently changes boxes.
All completion and blocker changes are written to tasks.md, not a side ledger.

## C-02 — References and API

Canonical browser route: `#/change/<uuid>/<type>/<id>`, with type exactly
`task|acceptance|design|evidence`. A change route without type shows its tasks. Latest acceptance
routes show current text; `.../evidence/V-<n>/acceptance/AC-01` reads the captured attempt text.
Task-local refs resolve in their change; typed cross-change refs encode change UUID explicitly.
External links are context only and never satisfied dependencies. Reject malformed percent
encoding, unknown types, path traversal and duplicate IDs without rendering arbitrary HTML.

Add read-only APIs `GET /api/intent/<uuid>` and
`GET /api/intent/<uuid>/<type>/<id>` plus evidence acceptance subroute; CLI counterpart
`spec inspect <name-or-uuid> [--task T-01] --json`. Both use one resolver projection containing
schemaVersion, identity, location, tasks, typed outgoing/incoming refs, readiness and diagnostics.
Unknown ID = 404; duplicate identity/invalid graph = 409; incomplete archive transaction = 503
with a recovery instruction. Existing status/validate APIs retain exact parity with CLI.
Their existing keys remain; additive `schemaVersion`, `sessions`, `diagnostics` fields are
documented, not silently wrapped. Existing `current` remains a nullable compatibility projection.

Do not widen `READ_RE`. Typed endpoints resolve only known manifest/attempt fields and
Markdown blocks; they cannot read client-supplied paths. Preserve same-origin/Host checks,
escaping, local-only resources and existing mtime conflict guards. Reject writes to evidence,
snapshots, manifests and transaction internals through `POST /api/file`, even when a reserved
artifact has a `.md` suffix. Ordinary active proposal/design/tasks/acceptance/delta Markdown
remains editable outside the scoped execute lock; invariants are checked before accepting v2
edits. No dashboard command-execution or migration button in this delivery.

`repo` aliases resolve through `.my-flow/state/repositories.json` entries `{alias, root}` set
locally by `spec repo add <alias> --path <path>`. Validate alias, realpath and an intent root;
never allow aliases through API parameters. Cross-repo API projections expose identity and
state, not arbitrary files or absolute paths. `self` is reserved. Missing map entry renders
unavailable and blocks umbrella integration verification, but not ordinary local reading.

## C-03 — Implementation and acceptance digests

Use SHA-256 and canonical JSON (sorted keys; arrays retain declared semantic order). Inventories
sort slash-normalized relative paths by code-point ordering. A record is `{path,type,mode,hash}`;
file hashes use actual bytes, symlinks hash their link text, deletion is explicit. Reject links
escaping root, case-colliding paths on Windows, unresolved Git conflicts and unreadable inputs.

Git enumeration uses `git ls-files -z --cached --others --exclude-standard` and HEAD inventory
to include deletions; use argv subprocess calls with timeouts and Windows hidden windows.
HEAD/ref/dirty metadata are recorded, but content hash decides matching. Include worktree bytes
for tracked files regardless of staging. Exclude `.git/`, `.my-flow/`, `changes/`, `specs/`,
`docs/changes/` only because intent inputs are handled below. Untracked ignored files are not
implicitly verified: required ignored/environment inputs must be declared in the target input
manifest. Submodules require explicit per-repo snapshots; otherwise begin fails with a named
unsupported input. A non-Git root uses an explicit approved input inventory; no default broad
filesystem traversal or arbitrary exclusion configuration.

Acceptance target includes proposal, design, acceptance, every task's ID/action/check/relations,
all delta specs, spec-base.json, verification-inputs.json, touched main requirement blocks and
declared supporting contract files. Store
LF-normalized exact text plus normalized semantic records. Exclude task checkbox state and
`evidence`/`blocked` annotations only; changed title/check/dependency/kind remains significant.
Also include manifest identity/kind/children/review and declared input schema; exclude lifecycle
stage/revision/timestamps/verification. Ignore only generated `via` provenance marker lines in requirement
base comparison, not arbitrary comments. Freeze referenced local evidence input definitions;
never recursively ingest verify output. Supporting contract input paths are explicitly listed
when beginning verification; missing referenced files fail validation.

Attempt outputs `verify/**`, usage, reviews, amendments history, transaction journal, archive receipt
and migration backups are not acceptance inputs. An amendment changes current contract text,
which changes its digest; history is not a substitute. Freeze metadata excluding bookkeeping,
not every Markdown line that happens to contain the word "report". Current target digest is
independent of archive directory location. Persisted attempt text permits viewing old versions.

Target environment records OS/arch, Node and Git versions, declared tool/config versions and
explicit external fixture/service identities, with `unknown` for unavailable facts. Required
unknown environment inputs prevent a claim that depends on them. Do not record credentials.
Before and after checks, recompute inventory and acceptance digests; drift produces INCOMPLETE.
Archive recomputes the same required environment inputs; mismatch requires a new attempt.

## C-04 — Immutable attempts and trustworthy closeout

`spec evidence begin <name> --inputs <json-file>` uses the single repository lock in C-09 and
requires no pending amendment. `change.json.verification` is the durable high-water/head record
outside attempt directories. First validate inputs; then atomically replace the manifest to
reserve `highWater + 1` and set head `{sequence, state: "reserved", requestDigest: null}`. Only
after that durable reservation create
`verify/V-<seq>/request.json` and `target.json` plus normalized `contract/` text. Request has
changeId, sequence, started, input digests, required criterion IDs/modes, session/actor identity
when available. Publish the directory by rename, then atomically set head to `open` with request
digest before releasing the lock. A crash anywhere after reservation blocks old PASS, including
when the entire new directory is absent. Sequence never decreases or derives from timestamps.

`spec evidence record <name> --attempt V-<seq> --result <json-file> --report <md-file>` writes
an immutable `result.json` and verbatim `report.md`, rejecting overwrite. Result includes:
schemaVersion, request digest, end digests, verdict, criteria `[{id,status,modes,evidenceRefs}]`,
commands `[{command,exitCode,summary,logHash}]`, origin `{kind,actorId,writerActorId,sourceRef}`,
reportHash and finished. Evidence refs name contained attempt artifacts; full log files are
copied explicitly and hashed using result `artifacts: [{sourcePath, relativePath, hash}]`; source
paths are local input files, destination paths must stay inside the attempt's `artifacts/`.
Never serve original source paths through the API. Report header verdict
must agree with result; all required IDs/modes must be VERIFIED for PASS. A same actor as writer
or missing independent provenance is unqualified for verified closeout. A trusted local operator
can supply a native independent-agent source reference; this is procedural attestation, not
proof enforced against a hostile operator. Unattested imports remain visibly unqualified. Under
the same repository lock, publish immutable result/report files, then atomically close the
manifest head with the result digest. A crash before head closure is incomplete, not PASS.

The manifest head is authoritative: reserved/open head, absent directory/result, failed digest,
FAIL or INCOMPLETE blocks archive. Missing/corrupt verification metadata, numbering beyond its
high-water or a mismatched head is corruption; never scan backwards for PASS. `evidence cancel`
can close even a reserved missing-directory attempt by writing an INCOMPLETE cancellation record
and closing that same head; it never reduces the high-water or restores old PASS. Missing older
numbered artifacts are also diagnosed. Historical scratch reports remain unqualified history.
The final closeout checkbox may be open during verification; verifier must actually run its
gate and report its outcome. All task boxes must be checked at archive. Completion ticks and
adding evidence links do not alter the target, but cannot create a result or bypass coverage.

## C-05 — Bases, conflicts and archive publication

`spec baseline <name>` captures `spec-base.json` entries `{capability,requirement,operation,
baseHash,baseText,destination}` from current specs and proposed delta claims. This is explicit
at plan finalization, never silently refreshed during archive. Base capture with existing entries
refuses overwrite; `--amend <amendment-id>` permits an independently reviewed rebase and changes
the acceptance digest. ADDED base is absent; rename destination must be absent. Base text is
normalized LF, with generated via lines removed. Duplicate requirement headings are errors.

Preflight: acquire the C-09 repository intent lock; check no pending journal or amendment;
resolve unique identity/destination; validate complete contract/tasks and latest eligible evidence;
compare all source/acceptance/environment digests; compare every spec base; calculate all output
files and provenance in memory. Validate output specs too. Reject conflicts with base/current/
proposed diagnostics; write no spec/change files. `--force` cannot bypass v2 checks. Active
overlap is only a warning; actual stale bases are errors. RENAMED is handled explicitly in the
in-memory merge with source/destination checks, not silently ignored.

Publication: create durable `changes/.transactions/<tx-id>/journal.json` with original/output
bytes, before/after hashes, source/destination paths and phases. Flush files before publishing
the journal. Recheck preimages after staging. Apply per-file temporary-write/rename operations;
write the archive receipt and stage in the source change, then rename the change directory;
mark transaction committed; finally release lock. Receipt binds attempt, base and output hashes
and classification `verified-v2|unverified-legacy`. Backup/journal survives success for recovery
inspection; it is never a task ledger. All paths are confined and symlink-checked.

`spec recover <tx-id>` uses the C-09 lock/recovery protocol and validates journal hashes. For each step, if current
bytes equal after image, continue; if equal before image, apply after image; otherwise stop with
conflict and preserve external edits. Missing expected source/destination or two copies is a
diagnostic, not an overwrite. Re-entry is idempotent. Refuse concurrent live-owner recovery;
stale-lock recovery is explicit, never timeout-only deletion. Test failpoints immediately before
and after each file rename, change relocation and committed marker. Pending journals cause CLI
mutations to refuse and intent readers to return recovery-pending; dashboard save is 423 before
file disclosure. An outside editor may see intermediate files; this is recoverable publication,
not filesystem-wide isolation.

Legacy forced archive still preflights all deltas; without recorded bases it refuses MODIFIED,
REMOVED and RENAMED and asks for upgrade/baseline. ADDED absence is mechanically checkable.
It may archive no-delta changes unverified. Preserve existing `archived`, `dest`, `log` result
keys with added verification classification. `abandon` still merges nothing, preserves identity
and writes a receipt; it cannot be misread as verified archive.

## C-06 — Sessions and coordinated mutation

Session key precedence: explicit CLI `--session` → `MY_FLOW_SESSION_ID` → hook adapter's
documented-and-tested host ID (Claude `session_id`; Codex only if live preflight confirms one) → hash of canonical nonempty hook
`transcript_path` → unidentified. Do not use cwd or PID as a shared session identity. CLI cannot
guess a hook transcript path: execute carries the resolved session via option/env, or asks
`spec session new` for a UUID and tells the user how to propagate it; no binding is assumed.

`.my-flow/state/sessions/<sha256-key>.json` contains schemaVersion, opaque sessionId, changeId,
stage, updated, leaseUntil and revision. Separate files prevent cross-session replacement.
TTL uses `MY_FLOW_EXECUTE_GUARD_TTL_HOURS` default 12; reject far-future timestamps, treat expired
as inactive. `stage` refreshes only its binding and compare-and-swaps change lifecycle revision;
optional `--expected-revision` detects stale transitions. The same session's execute-stage refresh
only renews its lease and remains allowed during a pending amendment; it does not approve a new
contract. Entry to execute requires the approved contract. Different sessions bound to the same
change may both read, but only one live execute lease is allowed per physical project root.
Release affects only the requesting session. A new actor can explicitly recover an expired
lease; no background daemon. Scratch loss removes leases, not lifecycle or verification history.

Known key without valid binding → no current session, never fallback to global. Unidentified:
if any v2 live/ambiguous leases exist, hook reports ambiguity and does not enforce another
session's task guard; CLI mutation requiring a session rejects and asks for `--session`.
Otherwise fresh legacy `current-change.json` supports legacy guard/simple mode. Global pointer
is written only for unidentified legacy operations; new session writes do not overwrite it.
Lifecycle remains visible in status even when no session is active. Hooks fail-open on missing
dependencies/malformed scratch and keep completion-pattern scan and `/goal` exemption intact.

Dashboard save locks are the union of live execute leases: that change's mutable intent files
and main spec capability paths claimed by its deltas. Legacy fallback keeps the old global lock
only when no v2 session data is present; the shared TTL now applies consistently. Ambiguous or
corrupt lease with identifiable change blocks only that target; corrupt unidentifiable lease
blocks intent writes with a repair diagnostic. This conservative UI behavior is distinct from
the non-blocking Stop-hook failure policy. Preserve request validation before lock disclosure.

## C-07 — Amendments, context and usage

`verification-inputs.json` declares supportingContractPaths, extraImplementationPaths,
repositories and requiredEnvironment fields. Paths are confined relative paths; no glob
exclusions. `spec evidence begin --inputs` must match this reviewed file, not substitute another
scope. Inventory changes require a reviewed revision. Checklists remain executable prose.

`spec review record <name> --file <json-file>` stores immutable `reviews/R-<id>/review.json` and
its LF-normalized contract snapshot under `reviews/R-<id>/contract/`. Review fields are
schemaVersion, changeId, contractDigest, role, actorId, writerActorId, verdict, sourceRef,
findings and reviewedAt. Its input digest excludes reviews themselves. High lane requires
planner draft plus architect CLEAR/WATCH without blocking findings and critic OKAY; medium
requires independent critic OKAY; low requires its explicit acceptance contract and risk
rationale. Roles/actor identities and provenance are procedural attestations with the same
limits as evidence. The shared eligibility function used by `stage execute`, evidence begin
and archive accepts either (a) lane-compliant direct review of the current semantic digest or
(b) a valid applied-amendment chain from such an eligible base to that exact current digest.
Every chain link binds its predecessor's exact new digest as its old digest, its exact candidate
new digest, type, applied record and required authority. Locator links require valid executor
locator authority; equivalent-check links require independent equivalence review; scope links
require authorized scope and the new lane's review. Missing links/authority, cycles, unapplied
candidates or digest mismatch reject the chain. A high-lane base therefore remains eligible
after an authorized locator/equivalent link without rerunning unaffected design reviews.
Any change to risk classification or trust boundary requires fresh full-lane direct review of
the new digest and cannot inherit approval through a cheaper link. `mf-plan` remains available
for drafting. Checkbox-only changes do not require new review. This approval inheritance never
reuses old final verification results: changed target digests still require fresh evidence.

Amendments use a staged candidate, never an unapproved edit of the live executable contract.
`spec amend propose <name> --file <json-file>` records immutable old/candidate text, digests,
type `locator|equivalent-check|scope`, cause, changed task/acceptance/design IDs and proposed
impact under `amendments/A-<id>/`. The old digest must match the active approved contract. Derive
affected tasks from changed IDs plus both old/new dependency descendants; reviewer may expand
that set. One pending amendment per change avoids competing candidate branches in this delivery.

The propose transaction explicitly changes affected `[x]` tasks to `[ ]` and adds
`blocked: amendment A-<id> pending` in tasks.md, preserving any earlier blocker text. Canonical
action/check/acceptance/design text remains the approved version. Thus its semantic digest still
matches approval, unaffected ready tasks may execute and lease refresh succeeds. Pending holds
override an incorrectly rechecked box. Final evidence begin/archive are refused while pending.

Transitions: `propose → review → apply` or `propose → cancel`. Locator-only corrections may
record executor authority if they change only file/symbol locators and no guarantee/check;
equivalent-check requires independent critic approval of equivalence; scope changes require
the new lane's review plus explicit user-scope authority. A locator with semantic changes is
reclassified. `spec review record --amend A-<id>` reviews the staged candidate digest rather
than live files; records hold new approval without replacing active approval. No approval is
inferred from PASS text. Failed/pending review leaves the previous contract active for unaffected
tasks. An amendment may broaden affected IDs only through another explicit reopen transaction.

`spec amend apply <name> --id A-<id>` rechecks old semantic digest and required candidate review,
then publishes candidate files, activates their approval and reopens every impacted task and
descendant with old evidence links removed. Task text merges by stable ID while preserving the
latest unaffected checkbox/evidence changes; unexpected semantic drift refuses apply. Candidate
manifest updates replace semantic fields only, retaining live lifecycle/revision and verification
head/high-water metadata; an old candidate cannot reset a newer reservation. Remove
only this amendment's hold; earlier blockers remain. New affected tasks start unchecked. The
new whole-change final report needs fresh checks; retained old reports remain historical.
`cancel` removes this amendment's hold and retains the old approved text, but never restores
reopened boxes without verification. All transitions are C-09 journaled transactions. Direct
unreviewed canonical edits invalidate entry/contexts; already-owned lease refresh remains allowed
and reports the drift. Context packets for unaffected tasks use the active approved text while
showing the pending impact set. Stable finding IDs link repeated-root-cause attempts.

`spec context <name> --task T-01 [--since <digest>]` emits Markdown or JSON with full global
constraints and criteria index, selected task plus prerequisite closure, referenced blocks,
file/symbol locators with content hashes, and open findings. `--since` compares persisted packet
inputs, not timestamps. Missing input/cycle is diagnostic. Final-verifier context has no task
filter and includes all criteria. Limit successful detail output, never silently drop required
criteria; show truncation plus retrieval refs. Store packets/logs only in scratch.

`spec usage import <name> --file <json-file>` stores immutable records under `usage/` keyed by
source event ID; `spec usage <name> --json` aggregates. Fields: eventId, attemptId, actorId,
parentActorId, stage, outcome, started/finished, source, accountingScope `self|inclusive`,
inputTokens/outputTokens/cachedInputTokens/reasoningTokens (nullable), units/provider metadata.
Missing means null, not zero. Cached tokens are an input subset, never added again. Inclusive
parent values and child values are shown separately and not double-counted in totals; unknown
scope means no total. No transcript scraping, pricing estimate or account-quota allocation.
Wall time uses interval union, effort may sum actor durations. Records include failures and
abandoned work; available host metrics may be explicitly imported by the agent. Baseline and
comparison reports name sample/risk class and absent fields; no promised saving percentage.

## C-08 — Migration and CLI compatibility

All new commands use the existing `--root`/`--json` style; unknown flags and missing values fail
with usage rather than becoming positional arguments. Add explicit parsers, not a dependency.
`new` defaults v2 only when v2 bundled/project templates are available; an existing customized
legacy `.templates` set remains legacy with a clear upgrade message. `init` copies new optional
templates if missing; never overwrites local templates. Add template version marker. Explicit
`upgrade --apply` stores originals under `migration/original/`, assigns stable IDs and an
unapproved draft acceptance inventory, leaves unknown dependencies unknown, and prints remaining
author decisions. It does not mark completed boxes as newly verified. Atomic migration staging
uses the generic C-09 journal/recover implementation delivered before migration; archives and
simple mode are refused. This change itself stays legacy until the explicit late bootstrap
task, although v2 fixtures exercise each feature earlier.

New helper modules: `scripts/lib/intent-io.mjs`, `intent-graph.mjs`, `intent-state.mjs`, `evidence.mjs`,
`archive.mjs`, `context.mjs`, `usage.mjs`. `intent.mjs` remains the public status/validate facade.
`scripts/spec.mjs` owns CLI dispatch; `scripts/dashboard.mjs` consumes projections. Small parsing
helpers may be colocated, but do not create separate framework/package layers. Hook imports must
remain compatible with installed shim-relative source resolution and tolerate missing libraries.

## C-09 — One coordinated I/O protocol

Deliver this primitive before any new mutation: `scripts/lib/intent-io.mjs` owns the one
exclusive repository lock `changes/.transactions/intent.lock` and generic journal/recover
operations. No per-change or separate archive lock exists. Every cooperating intent writer
uses it: new/upgrade, baseline, review/amend, evidence, lifecycle/session/repository alias,
usage, abandon/archive and dashboard saves. Validate request syntax first; acquire once at
the outer operation; check pending journal and lifecycle/lease/mtime conditions under lock;
read/compute/recheck preimages; publish; release. Nested library calls receive the existing
lock token and never acquire a second lock. Cross-repo umbrella reads acquire each root alone,
capture its identity/digest, then recheck digests; no nested cross-root locks or atomic cross-repo
publication claim. A changed child yields retry/incomplete integration inputs.

All CLI/API multi-file intent reads, including raw allowed Markdown reads, hold that same lock
until their complete result has been materialized in memory. Release before HTTP delivery or
SSE notification. A reader paused between files therefore blocks a publication; it cannot
combine before/after states. Bounded acquisition (2 seconds) returns retryable busy (CLI exit 2,
API 503; writes 423); no partial successful payload. Hooks fail-open with a diagnostic if busy.
This serializes short local operations deliberately; test commands and model calls never hold
the lock. Evidence target capture holds the lock only for capture, releases for independent
checks, and reacquires for end comparison/record. Source edits outside the helper remain
detectable via before/after hashes, not prevented by the intent lock.

Multi-file writes stage before/after images in a durable journal before changing targets;
the generic recovery rules in C-05 apply to upgrade/amend/publication. Single-file writes use
temporary file plus atomic replacement under lock. Evidence reservation is its explicit
write-ahead protocol from C-04. Pending journals prevent normal reads/writes until recover;
missing head artifacts remain incomplete independently of journal state. Explicit recover
checks recorded owner liveness before reclaiming a stale lock, acquires the same lock, validates
preimages and rolls forward. It never deletes a lock by timeout alone or overwrites a live
owner/external edit. All lock/journal paths and fixtures remain inside the selected root.
