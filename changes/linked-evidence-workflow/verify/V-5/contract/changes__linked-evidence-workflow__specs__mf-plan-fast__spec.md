## MODIFIED Requirements

### Requirement: Fast lane produces the full artifact set with one critic pass

Medium-risk planning, selected automatically or requested by `--fast`, SHALL use a main-context
short draft and an independent critic. It SHALL preserve proposal/design/tasks/delta artifacts
and required constraints, while omitting mandatory PLAN-DR expansion. On REJECT, fixes SHALL
receive focused critic re-review before approval. Repeated rejection SHALL escalate to full
planning within the existing bounded review loop; unresolved findings SHALL not be called done.
Automatic lane selection SHALL NOT authorize implementation.

#### Scenario: A clear multi-file change is classified medium
- **WHEN** files, acceptance and approach are explicit and no high-risk category applies
- **THEN** the main context drafts and an independent critic reviews the complete short plan

#### Scenario: A critic rejects the draft
- **WHEN** the critic identifies a blocking executability error
- **THEN** the fixed blocks are re-reviewed and planning does not claim approval before resolution

### Requirement: `Plan mode: fast` marker in design.md

V2 plans SHALL record lane, reasons and affected paths in review metadata and a concise context
line. Legacy `Plan mode: fast (one critic pass, no architect).` markers SHALL remain readable;
their absence SHALL not imply a v2 lane. Blank templates SHALL contain no preselected lane.

#### Scenario: An automatic lane is recorded
- **WHEN** planning selects medium risk without the user passing `--fast`
- **THEN** metadata records medium and its evidence-based reason instead of implying full review

#### Scenario: A legacy plan is read
- **WHEN** it has only the old fast marker
- **THEN** it is shown as legacy fast with no invented new review approval

### Requirement: High-risk guard refuses the fast lane

Planning MAY automatically choose low/medium/high from proposal evidence. High-risk categories
SHALL remain auth, migrations, destructive operations, public API changes, build config or
shader pipeline changes, and engine modules. Uncertain risk SHALL use high. High risk or explicit
`--deliberate` SHALL use planner, architect, critic and pre-mortem; `--fast` SHALL not override
them. The category list SHALL remain single-source. Scope changes MAY escalate review intensity.

#### Scenario: Migration refuses requested fast review
- **WHEN** `--fast` is requested for migration work
- **THEN** the reason is stated and full deliberate review is used

#### Scenario: Simple reversible work selects low risk
- **WHEN** a single-file task has known implementation and explicit acceptance without high risk
- **THEN** direct work may be selected under user authorization with independent final verification

### Requirement: Documented as a stage-table row

The core working agreement and English README SHALL document automatic risk lanes, explicit
fast/deliberate overrides and unchanged explicit `--go` handoff. Other README variants SHALL
replace conflicting lane claims with a concise English compatibility note linking the canonical
English policy; a full translation rewrite is not required. Generated host blocks SHALL match
the source policy and `build --check` SHALL pass.

#### Scenario: Generated hosts contain current lane policy
- **WHEN** build runs after source documentation changes
- **THEN** both host blocks describe automatic lanes and retain high-risk full review

#### Scenario: A reader opens another README language
- **WHEN** an older translation is inspected
- **THEN** it has no contradictory user-only fast claim and links to the current English policy

### Requirement: `--go` continues into execute through the goal handoff

`--go` SHALL require explicitly supplied `--fast`; automatic medium selection alone SHALL NOT
enable execution. High-risk or deliberate refusal SHALL also refuse automatic continuation.
Valid explicit fast/go SHALL invoke the execute skill after planning approval, preserving its
native goal handoff and fixed final gate. Claude SHALL pause for its existing `/goal` response;
Codex SHALL retain `get_goal`/`create_goal`. Execute alone SHALL arm session activity before task
work. `--team`/`--worktree` SHALL remain unavailable via go; tasks.md remains the progress ledger.

#### Scenario: Explicit fast/go continues correctly
- **WHEN** an authorized non-high-risk fast/go plan is approved
- **THEN** execute is invoked through its normal host goal protocol before the task loop

#### Scenario: Automatic medium does not imply go
- **WHEN** medium was automatically chosen and no explicit fast/go was supplied
- **THEN** planning stops at its handoff with no execution activity lease

#### Scenario: Go lacks explicit fast
- **WHEN** `mf-plan --go` is requested without `--fast`
- **THEN** it reports that explicit fast is required and does not enter execute
