## ADDED Requirements

### Requirement: Safe archive publication

V2 archive SHALL preflight complete structure/tasks, latest eligible independent evidence,
matching targets and requirement bases before writing any output. ADDED requires absence;
MODIFIED/REMOVED require matching bases; RENAMED also requires an absent destination. Mere
overlap SHALL remain a warning. Conflicts SHALL preserve base/current/proposed information.
`--force` SHALL NOT bypass these v2 guarantees.

#### Scenario: A second overlapping change has a stale base
- **WHEN** A and B start from the same requirement and A archives first
- **THEN** A may succeed and B is refused with its base conflict until reviewed integration

#### Scenario: A later capability fails preflight
- **WHEN** the second capability in a multi-capability archive is invalid
- **THEN** none of the capability files or change location are modified

### Requirement: Recoverable archive transactions

Publication SHALL preserve durable preimages, outputs and per-step hashes in a journal before
mutation. Cooperating readers SHALL report recovery pending while publication is incomplete;
writers SHALL refuse concurrent publication. Explicit recovery SHALL be idempotent and SHALL
stop on external edits rather than overwrite them. Receipts SHALL distinguish verified v2
archive, unverified legacy archive and abandonment.

All cooperating intent mutations and complete multi-file read snapshots SHALL use one repository
lock protocol. A reader SHALL finish materializing its coherent result before release. The common
journal/recovery primitive SHALL be delivered before migration relies on it. Evidence reservation,
review/amend, lifecycle/session updates and dashboard saves SHALL not bypass this coordination.

#### Scenario: A crash interrupts publication
- **WHEN** execution stops after one spec replacement and before relocation
- **THEN** the journal permits safe continuation and readers report recovery pending

#### Scenario: An external editor changes a pending target
- **WHEN** recovery finds content matching neither stored preimage nor output
- **THEN** it preserves that content and reports the conflicting path

#### Scenario: A reader spans publication
- **WHEN** a multi-file reader pauses after its first file and archive tries to publish
- **THEN** publication waits or reports busy and the reader never combines old and new files

#### Scenario: Evidence creation races archive
- **WHEN** evidence begin and archive target the same repository concurrently
- **THEN** the shared lock serializes them and archive sees either the reserved head or the prior coherent state

### Requirement: Explicit legacy upgrade

Legacy changes and simple-mode documents SHALL remain readable. Active legacy upgrades SHALL
require explicit application, preserve originals and checkbox claims, and leave unknown
dependencies/acceptance unapproved. Historical archives SHALL NOT be rewritten. Legacy reports
SHALL NOT silently receive version-bound trust. Forced legacy archive MAY be labeled unverified
but SHALL NOT silently overwrite requirements without bases.

#### Scenario: Reading a historical archive
- **WHEN** the new CLI or dashboard reads a legacy archive
- **THEN** its files remain byte-identical and its evidence is labeled legacy/unbound

#### Scenario: Upgrade preview is not an edit
- **WHEN** `spec upgrade <name> --dry-run` is invoked
- **THEN** it reports proposed identity/metadata changes and leaves all files unchanged

## MODIFIED Requirements

### Requirement: Shared status and validate library

Status and validate SHALL remain shared explicit-root functions without process termination or
persistent caches. CLI and dashboard SHALL return equal JSON from the same code path. Existing
keys and command exit semantics SHALL remain supported; documented additive version/session/
diagnostic fields MAY extend results. Invalid v2 structures SHALL produce actionable errors.

#### Scenario: CLI and API remain equal
- **WHEN** status or validate is read through both surfaces against identical disk state
- **THEN** parsed JSON values are deeply equal, including additive v2 fields

#### Scenario: An edit is observed on the next read
- **WHEN** task metadata changes between calls in one long-lived server
- **THEN** the next result reflects the current file rather than a cached graph

### Requirement: State-file warning in status

Status SHALL report durable lifecycle and per-session bindings. A supplied known session SHALL
not inherit another current pointer. Legacy current-change warnings SHALL remain available only
under the documented unambiguous fallback; stale/missing changes warn and archived changes do
not. Corrupt or ambiguous session data SHALL be diagnosed without guessing a current change.

#### Scenario: A known unbound session reads status
- **WHEN** another session has an active binding and the requesting session has none
- **THEN** current is null for the requester and the other session is listed separately

#### Scenario: A legacy just-archived change
- **WHEN** fallback state records archived stage after relocation
- **THEN** status does not warn that its former active directory is missing
