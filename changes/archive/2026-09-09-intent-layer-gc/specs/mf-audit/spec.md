## Purpose

The contract of the `mf-audit` skill: what it accepts, where it writes its report, what that
report contains, the guarantee that it never edits the current truth, and how its findings
re-enter the normal change flow.

## ADDED Requirements

### Requirement: Audit inputs

The skill SHALL accept one capability name or the literal `all`, resolved against the directories
under `specs/` in the working directory. It SHALL stop with a message when `specs/` is missing or
the named capability has no directory, rather than auditing nothing silently.

#### Scenario: A named capability is audited
- **WHEN** `mf-audit spec-helper` runs in a project containing `specs/spec-helper/spec.md`
- **THEN** exactly that capability is audited and one report is produced

#### Scenario: Every capability is audited
- **WHEN** `mf-audit all` runs in a project with three capability directories under `specs/`
- **THEN** each capability is audited in its own agent run and produces its own report

#### Scenario: An unknown capability stops the run
- **WHEN** `mf-audit ghost` runs and `specs/ghost/` does not exist
- **THEN** the skill reports that the capability is unknown and writes no report

### Requirement: Read-only delegation

The skill SHALL delegate the judgment to the read-only `architect` role, one run per capability,
and SHALL instruct that role that for this run it reads `specs/<capability>/spec.md` and the
source and test files each requirement would touch, in place of the `proposal.md` and `design.md`
its default loop begins with. The role SHALL cite `path:line` for every finding and SHALL edit no
file. Because the role cannot write, the skill's own context SHALL save the report.

#### Scenario: The audit reads the spec instead of a proposal
- **WHEN** the skill delegates an audit of `spec-helper`
- **THEN** the delegation prompt names `specs/spec-helper/spec.md` and the requirement inventory
  as the starting point, and states that the proposal and design steps of the role's default loop
  do not apply

#### Scenario: Findings carry evidence
- **WHEN** the report claims a requirement has no implementation
- **THEN** the claim cites the files that were opened, by `path:line`

### Requirement: Audit report

The skill SHALL write the report to `.my-flow/verify/audit-<capability>-<timestamp>.md`. The
report SHALL open with `## Spec Audit: <capability>` and a `### Status: CLEAN | DRIFT | BROKEN`
line, and SHALL carry sections for the requirement inventory, requirements with no traceable
implementation, behavior in code or tests with no requirement, requirements that contradict each
other, and requirements that appear to belong to another capability. The report SHALL NOT contain
the word `Verdict` on any line, so that it can never satisfy the PASS gate `spec archive` applies
to files under `.my-flow/verify/`.

#### Scenario: The report lands in the expected place
- **WHEN** an audit of `demo-cap` completes
- **THEN** a file matching `.my-flow/verify/audit-demo-cap-<timestamp>.md` exists and opens with
  `## Spec Audit: demo-cap` followed by a `### Status:` line

#### Scenario: An unimplemented requirement is reported
- **WHEN** the audited spec contains a requirement that the code and tests do not implement
- **THEN** that requirement is listed under the unimplemented section of the report

#### Scenario: The report can never satisfy the archive gate
- **WHEN** the delegated role returns text containing a `Verdict:` line from its default output
  block
- **THEN** the skill rewrites that line to the `### Status:` form, or requests one correction,
  before writing the file, and the written report contains no `Verdict:` line

### Requirement: Audits never edit the current truth

The skill SHALL NOT modify anything under `specs/` or `changes/archive/`. Its only output is the
report file.

#### Scenario: The spec tree is untouched by an audit
- **WHEN** an audit runs over a capability and finishes
- **THEN** every file under `specs/` is byte-identical to its state before the run

### Requirement: Hand-off to a change

The report SHALL end with a suggested change name whose last segments are `audit-<capability>`,
so that archiving or abandoning the resulting change clears the audit nudge. Fixes SHALL be made
only through the normal flow, beginning with `spec new <name>`. When the status is CLEAN there is
nothing to fix, and the skill SHALL recommend recording the clean audit with `spec new
audit-<capability>` followed by `spec abandon audit-<capability> --reason "audit clean"`, so that
the nudge clears without inventing work.

#### Scenario: Findings become a change name
- **WHEN** an audit reports drift
- **THEN** the last section of the report names a kebab-case change ending in
  `audit-<capability>`, and the skill points at `spec new <that name>` as the next step

#### Scenario: A clean audit is still recorded
- **WHEN** an audit finds nothing and reports `### Status: CLEAN`
- **THEN** the skill recommends the two-command record that creates and immediately abandons
  `audit-<capability>` with a reason, rather than leaving the audit nudge to fire forever
