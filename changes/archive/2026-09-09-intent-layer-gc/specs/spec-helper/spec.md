## Purpose

Observable behavior of `scripts/spec.mjs` for the maintenance path of the intent layer: how
`status` reports changes that have gone quiet, deltas that collide, and capabilities nobody has
re-checked; how a change leaves `changes/` without being archived; and the provenance marker
`archive` writes into `specs/`.

## ADDED Requirements

### Requirement: Stale marking in status

The system SHALL mark an active change as stale when its tasks are not all ticked and the newest
modification time of the `changes/<name>/` directory itself and of every file and directory under
it is older than the stale threshold. Directory times count because a copied file keeps its
source time on Windows, while a directory's time records when its entries were created. The
threshold SHALL default to 14 days, and SHALL be overridable by the `--stale-days <n>` option,
which takes precedence over the `MY_FLOW_STALE_DAYS` environment variable, which takes
precedence over the default. A value that is not a positive number SHALL fall back to the
default rather than fail.

#### Scenario: A change untouched for 30 days is marked stale
- **WHEN** `spec status` runs on a project whose `changes/quiet/` directory and all of its files
  carry a modification time 30 days in the past, with unticked tasks
- **THEN** the text row for `quiet` ends with ` [stale 30d]`, and the JSON row carries
  `stale: true` and a `lastModified` ISO timestamp

#### Scenario: A freshly touched change is not marked stale
- **WHEN** `spec status` runs on a project whose `changes/active/` files were modified today
- **THEN** the text row for `active` carries no stale marker and the JSON row carries
  `stale: false`

#### Scenario: The threshold is raised past the age of the change
- **WHEN** `spec status --stale-days 60` runs, or `MY_FLOW_STALE_DAYS=60 spec status` runs, on
  the project holding the 30-day-old change
- **THEN** no row is marked stale, and the option value `60` is consumed as the option's
  argument rather than read as a change name

#### Scenario: A finished change awaiting archive is never stale
- **WHEN** `spec status` runs on a project holding a 30-day-old change whose `tasks.md` boxes
  are all ticked
- **THEN** the row carries no stale marker, because a completed change waiting to be archived
  is not abandoned work

### Requirement: State-file warning in status

The system SHALL warn when `.my-flow/state/current-change.json` names a change that is stale or
no longer exists, and SHALL suppress that warning when the recorded stage is `archived`.

#### Scenario: The current change has gone stale
- **WHEN** `spec status` runs while the state file names a change that is marked stale
- **THEN** a warning line naming that change appears after the change rows, and the same string
  appears in the JSON top-level `warnings` array

#### Scenario: The current change no longer exists
- **WHEN** `spec status` runs while the state file names a change with no directory under
  `changes/` and no `docs/changes/<name>.md`
- **THEN** a warning names the missing change

#### Scenario: A just-archived change does not warn
- **WHEN** `spec status` runs immediately after a successful `spec archive`, so the state file
  names a directory that has been moved and records stage `archived`
- **THEN** no state warning is emitted

### Requirement: Delta-overlap warning

The system SHALL report when two or more active changes carry a delta claiming the same
requirement name in the same capability, and SHALL name every change involved together with the
delta section that makes each claim. Claims SHALL be collected from the ADDED, MODIFIED and
REMOVED sections by requirement heading, and from RENAMED sections by their `- FROM:` lines.
Detection is reporting only; the system SHALL NOT resolve an overlap.

#### Scenario: Two changes claim one requirement under different sections
- **WHEN** `spec status` runs while `changes/a/specs/cap/spec.md` lists `Foo` under MODIFIED and
  `changes/b/specs/cap/spec.md` lists `Foo` under REMOVED
- **THEN** a warning reads `overlap: cap "Foo" in changes a (MODIFIED) and b (REMOVED)`

#### Scenario: A renamed requirement collides with a modification
- **WHEN** one change carries `- FROM: ### Requirement: Foo` under RENAMED and another carries
  `Foo` under MODIFIED
- **THEN** the overlap warning names both changes with the kinds RENAMED and MODIFIED, because
  RENAMED claims are read from their FROM lines rather than from requirement headings

#### Scenario: A requirement claimed by one change is not an overlap
- **WHEN** only one active change claims `Foo` in `cap`
- **THEN** no overlap warning is emitted

#### Scenario: Validate reports the overlap as a warning, never an error
- **WHEN** `spec validate a` runs while `a` and `b` overlap
- **THEN** the command exits 0 and prints a `warn:` line naming `b` and its section kind

### Requirement: The abandon subcommand

The system SHALL provide `spec abandon <name> [--reason "..."] [--force]` as a third exit for a
change. It SHALL require an `## Abandoned` section in `proposal.md` carrying a `**Reason**:`
line, which `--reason` appends when absent. It SHALL move the change to
`changes/archive/<YYYY-MM-DD>-<name>-abandoned/`, SHALL NOT read or merge delta specs, and SHALL
set the state file to stage `archived` when the abandoned change was the current one. It SHALL
refuse a change whose tasks are all ticked unless `--force` is given, because such a change is
an archive rather than an abandonment.

#### Scenario: Abandoning without a recorded reason is refused
- **WHEN** `spec abandon dropped` runs and `changes/dropped/proposal.md` has no `## Abandoned`
  section with a `**Reason**:` line
- **THEN** the command exits 1 with a message naming the missing section, and the change
  directory is left in place

#### Scenario: The reason option records the reason and succeeds
- **WHEN** `spec abandon dropped --reason "superseded by rework"` runs
- **THEN** an `## Abandoned` section carrying that reason is appended to `proposal.md`, the
  directory is moved to `changes/archive/<date>-dropped-abandoned/`, and the command exits 0

#### Scenario: Abandoning never touches the current truth
- **WHEN** a change carrying an ADDED delta for `cap` is abandoned
- **THEN** `specs/cap/spec.md` is byte-identical before and after, and the merge log is empty
  because no delta was read

#### Scenario: A fully ticked change is refused without force
- **WHEN** `spec abandon done-work` runs on a change whose boxes are all ticked
- **THEN** the command exits 1 and says the change should be archived instead, and the same
  command with `--force` exits 0

#### Scenario: The state file follows the abandoned change
- **WHEN** the abandoned change was the one named in `.my-flow/state/current-change.json`
- **THEN** the state file records stage `archived`, and when another change was current the
  state file is left untouched

### Requirement: Provenance marker on merge

The system SHALL write a provenance marker of the exact form `<!-- via: <YYYY-MM-DD>-<name> -->`
into every requirement block that `spec archive` adds or modifies in `specs/<capability>/spec.md`,
on its own line directly after the `### Requirement:` heading. Before inserting, the system SHALL
remove every existing marker line anywhere in that block, so each merged block carries exactly
one marker. Removed requirements SHALL NOT be marked, and `spec validate` SHALL accept a spec
file containing markers.

#### Scenario: Merged requirements carry exactly one marker
- **WHEN** `spec archive merge` merges a delta holding one ADDED and one MODIFIED requirement
- **THEN** each merged block in `specs/cap/spec.md` contains exactly one `<!-- via: ` line,
  naming the archive date and `merge`, on the line directly after its heading

#### Scenario: A marker carried inside a delta block is replaced, not stacked
- **WHEN** a MODIFIED delta block already contains `<!-- via: 2020-01-01-old -->` several lines
  below its heading, in the middle of the requirement text, and the change is archived
- **THEN** the merged block contains exactly one marker, it names the change just archived
  rather than `2020-01-01-old`, and it sits directly after the heading

#### Scenario: Markers do not break validation
- **WHEN** `spec validate` runs over a `specs/` tree whose requirements all carry markers
- **THEN** the command exits 0 and reports no error about the marker lines

### Requirement: Audit nudge in status

The system SHALL suggest auditing a capability once the number of archived changes that merged a
delta for it, counted since the last recorded audit of that same capability, reaches a threshold
that defaults to 5 and is overridable by `MY_FLOW_AUDIT_EVERY`. The count SHALL be derived from
`changes/archive/` alone, with no new state file. An archived directory SHALL count as the audit
anchor for capability `<cap>` only when its name matches
`^\d{4}-\d{2}-\d{2}-(?:.*-)?audit-<cap>(?:-abandoned)?$`, so that an abandoned audit still
records that an audit happened. A directory whose name ends in `-abandoned` SHALL NOT be counted
as a merge, because its deltas were never merged. Reading the archive SHALL be guarded, since the
directory need not exist.

#### Scenario: The nudge appears at the threshold
- **WHEN** `spec status` runs on a project with `specs/cap/` and five archived directories each
  containing `specs/cap/spec.md`
- **THEN** the output contains `audit suggested: cap (5 merges since last audit)`, while the same
  project with four such directories produces no nudge

#### Scenario: An audit resets the count
- **WHEN** an archived directory named `<date>-audit-cap` sorts after four merge directories and
  one merge directory follows it
- **THEN** the count restarts from that anchor and no nudge is printed

#### Scenario: A clean audit is recorded by abandoning it
- **WHEN** a capability is audited with no findings and the result is recorded by
  `spec new audit-cap` followed by `spec abandon audit-cap --reason "audit clean, no findings"`
- **THEN** the resulting `changes/archive/<date>-audit-cap-abandoned/` is recognised as the audit
  anchor and clears the nudge, and the same directory is not counted as a merge

#### Scenario: The anchor does not match a longer capability name
- **WHEN** the project has capabilities `spec` and `spec-helper`, and an archived directory is
  named `<date>-audit-spec-helper`
- **THEN** the counter for `spec-helper` is reset and the counter for `spec` is not, because the
  match is anchored to the end of the directory name

#### Scenario: A project that has never archived anything still works
- **WHEN** `spec status` runs on a project that has `specs/cap/` but no `changes/archive/`
  directory at all
- **THEN** the command exits 0, prints no nudge, and raises no error for the missing directory
