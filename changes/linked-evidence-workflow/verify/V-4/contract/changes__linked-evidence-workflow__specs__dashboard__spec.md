## ADDED Requirements

### Requirement: Task-oriented views and stable typed routes

The dashboard SHALL show concise task actions, observable completion, readiness and labeled
links to prerequisites, acceptance, design and evidence. Reverse links SHALL be derived.
Identity routes SHALL survive renumbering, title edits and archive. Legacy file/name routes
SHALL remain available. Evidence routes SHALL show their immutable captured contract.

#### Scenario: A waiting task explains its blocker
- **WHEN** a task has an unfinished explicit prerequisite
- **THEN** its row names that prerequisite and its link opens the prerequisite detail

#### Scenario: Archive preserves task navigation
- **WHEN** an active v2 change is archived
- **THEN** its prior identity-based task link resolves to the archived task

### Requirement: Constrained intent APIs

Typed intent APIs SHALL project only validated known identities and fields through the same
library as CLI inspect. They SHALL NOT expand arbitrary-file access. Malformed identities,
unknown types, duplicate IDs and traversal SHALL be rejected. Escaping, same-origin policy,
local-only resources, SSE freshness and keyboard accessibility SHALL remain in effect.

#### Scenario: A client requests a manifest as an arbitrary path
- **WHEN** a file API request targets a raw JSON manifest or outside-root path
- **THEN** the read allow-list refuses it while typed intent inspection remains available

#### Scenario: Relevant linked content changes
- **WHEN** task or linked acceptance content changes on disk
- **THEN** the active task view refreshes without losing navigation semantics

## MODIFIED Requirements

### Requirement: Guarded save endpoint

`POST /api/file` SHALL remain the only browser write endpoint and accept only existing allowed
Markdown within current specs or active changes. Absolute, escaping, non-string, symlink-escaping
and non-Markdown targets SHALL be refused. Archives, scratch and reserved evidence/snapshot/
migration/transaction artifacts SHALL remain unwritable. Typed APIs SHALL NOT add JSON writes.
Request validation SHALL precede lock checks, which SHALL precede existence/content/mtime
disclosure. Existing mtime conflict and line-ending preservation contracts SHALL remain intact.

#### Scenario: A normal unlocked file is saved
- **WHEN** an active mutable Markdown file is posted with the current mtime and no scoped lease
- **THEN** content is saved with preserved line endings and the new mtime is returned

#### Scenario: Evidence is immutable to the browser
- **WHEN** a client posts to an active change's `verify/V-1/report.md`
- **THEN** the request is refused as an unwritable reserved artifact without editing it

### Requirement: Edit lock during stage execute

The dashboard SHALL derive locks from active unexpired session leases using shared state rules.
A lease SHALL lock its change's mutable intent and claimed main spec capability files; unrelated
changes SHALL remain editable. Unambiguous legacy fallback SHALL retain the global execute lock
with the same TTL. Corrupt/ambiguous state SHALL give a recovery reason rather than silently
permit overlapping writes. Pending archive transactions SHALL lock intent writes. Eligible read
responses SHALL include writability and a human-readable lock reason; locked saves SHALL return
423 before disk disclosure. Lock changes SHALL apply on the next request without restart.

#### Scenario: Independent changes remain editable
- **WHEN** session A executes change A and a client edits unrelated change B
- **THEN** B may be saved while A's files report the A lease lock

#### Scenario: A stale mtime does not disclose locked content
- **WHEN** a save carries an old mtime while its target is locked
- **THEN** the response is 423 with a lock reason and no on-disk content

#### Scenario: A non-writable target keeps its own refusal
- **WHEN** a client posts to an archived, reserved or non-Markdown target during execute
- **THEN** ordinary write eligibility is refused before lease state is disclosed

#### Scenario: A lease expires
- **WHEN** the only relevant lease passes the shared TTL
- **THEN** the next request lifts that lease's lock unless another lease or transaction applies
