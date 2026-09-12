## Purpose

The fast lane of `mf-plan`: a user-selected single-context planning mode that produces the same
change artifacts with one critic review instead of the planner / architect / critic loop, the
guard that refuses it for high-risk work, and the `--go` hand-over that continues straight into
the execute flow without the interactive `/goal` stop.

## ADDED Requirements

### Requirement: Fast lane produces the full artifact set with one critic pass

`mf-plan --fast <change-name | free text>` SHALL be planned by the main conversation: it reads the
files the proposal names and writes `proposal.md` (free-text input only), `design.md`, `tasks.md`
and any delta specs itself. It SHALL NOT delegate to the `planner` or `architect` roles and SHALL
NOT emit a PLAN-DR header. It SHALL run exactly one read-only `critic` review of the draft. On
`OKAY` planning ends; on `REJECT` the main conversation SHALL apply the fixes once, SHALL NOT run
a second review, and SHALL list every finding it did not fix in the handoff. The artifacts SHALL
keep the shape the full mode produces, so that `spec validate`, `execute`, `mf-verify` and
`spec archive` need no change, and `design.md` SHALL contain the required sections including
`## Do-Not-Touch` and `## Rebuild / Re-run After Change`.

#### Scenario: Fast planning of a concrete change
- **WHEN** the user invokes `mf-plan --fast <name>` on a change whose `proposal.md` names its
  files and its acceptance checks, and no high-risk category applies
- **THEN** exactly one subagent runs and it is the `critic`, no `planner` and no `architect`
  subagent runs, `changes/<name>/design.md` and `changes/<name>/tasks.md` exist,
  `design.md` contains no `PLAN-DR` heading, and `node scripts/spec.mjs validate <name>` exits 0

#### Scenario: Critic rejects the fast draft
- **WHEN** the single `critic` review returns `REJECT`
- **THEN** the main conversation applies the fixes once, runs no further review, and the handoff
  reads `Review: fast (critic REJECT-fixed, no architect)` followed by a `Remaining findings:`
  line whenever a finding was left unfixed

### Requirement: `Plan mode: fast` marker in design.md

A change planned by the fast lane SHALL record it in `changes/<name>/design.md` as the first line
under `## Context`, in the form `Plan mode: fast (one critic pass, no architect).`. The full mode
SHALL write no marker, so the absence of the line means the change was planned with the full
planner / architect / critic loop. `templates/change/design.md` SHALL NOT carry the line.

#### Scenario: Marker is present after a fast run and absent after a full run
- **WHEN** `design.md` has been written by `mf-plan --fast`
- **THEN** `grep -c "Plan mode: fast" changes/<name>/design.md` prints 1, and the same grep over
  a change planned without `--fast` prints 0

#### Scenario: The template is unchanged
- **WHEN** `node scripts/spec.mjs new <name>` creates a change
- **THEN** the new `design.md` contains no `Plan mode:` line and the golden template render test
  in `test/markdown.test.mjs` still passes

### Requirement: High-risk guard refuses the fast lane

`--fast` SHALL be honoured only when the user passes it; the model SHALL NOT select it on its own
and MAY only suggest it in a handoff. When the proposal or the free text touches any of the
high-risk categories (auth, migrations, destructive operations, public API changes, build config
or shader pipeline changes, engine modules), `mf-plan` SHALL refuse `--fast`, SHALL state the
matching category in one line, and SHALL continue planning in the full mode. The category list
SHALL exist once in the skill and SHALL be the same list that auto-enables `--deliberate`.

#### Scenario: Migration request is refused
- **WHEN** the user invokes `mf-plan --fast` on a request that adds a database migration
- **THEN** the reply prints a single line naming migrations as the reason `--fast` was refused,
  the fast lane is not used, and planning continues through the `planner`, `architect` and
  `critic` roles

#### Scenario: One list serves both flags
- **WHEN** `src/skills/mf-plan.md` is read
- **THEN** the category list appears exactly once, and both the `--deliberate` input line and the
  `--fast` guard reference that one section

### Requirement: `--go` continues into execute without the goal stop

`--go` SHALL be valid only together with `--fast`. After the handoff has printed, `mf-plan` SHALL
run `spec stage <name> execute`, SHALL print the execute goal statement once as a standing
instruction without stopping, and SHALL then run the `execute` flow for the same change in the
same conversation: its Load steps, its task loop, its final gate, and its Run report. The task
loop and the final gate SHALL come from the `execute` skill's own text and SHALL NOT be restated
or recalled: on Claude the fast lane SHALL invoke `my-flow:execute <name>` through the Skill tool
and follow the loaded text; on Codex it SHALL follow `$my-flow-execute` by reference. On Claude
the `/goal` print-and-stop SHALL be skipped, with the Stop-hook execute-guard as the only
backstop; on Codex the goal SHALL still be created as the `execute` skill describes. Nothing else
in `execute` SHALL change, and `tasks.md` SHALL remain the only progress ledger. `--team` and
`--worktree` SHALL NOT be reachable through `--go`; when the user wants either, the fast lane
SHALL stop after the handoff and point at `execute <name>`.

#### Scenario: Fast planning runs straight into task 1
- **WHEN** the user invokes `mf-plan --fast --go <name>` on a change that passes the guard
- **THEN** the transcript contains no `Paste this` prompt and no pasted `/goal` command, the goal
  statement appears once as a standing instruction, the `execute` skill text was loaded rather
  than paraphrased, `.my-flow/state/current-change.json` reports stage `execute` for that change,
  and the first task of `tasks.md` is implemented, verified and ticked

#### Scenario: `--go` without `--fast` is refused
- **WHEN** the user invokes `mf-plan --go <name>` without `--fast`
- **THEN** `mf-plan` prints one line saying `--go` requires `--fast`, does not enter the execute
  flow, and plans the change in the full mode

#### Scenario: `--fast` together with `--deliberate` is refused
- **WHEN** the user invokes `mf-plan --fast --deliberate <name>`
- **THEN** `mf-plan` prints one line in the same wording as the high-risk guard saying
  `--deliberate` wins, and plans the change in the full mode with the pre-mortem and the test
  plan

#### Scenario: The completion backstop stays armed
- **WHEN** a `--go` run reaches a message claiming completion while `tasks.md` still has
  unticked, unblocked tasks
- **THEN** the Stop hook blocks that message and lists the remaining tasks, because the stage
  written before the hand-over is `execute`

### Requirement: Documented as a stage-table row

The stage table in `src/core/core.md` and in all eight READMEs SHALL carry the row
`Concrete, multi-file, design already clear -> mf-plan --fast [--go] -> execute -> mf-verify`,
the skill table SHALL show the `[--fast [--go]]` flags with a one-sentence description of the
lane, and the comparison between the flow skills and the built-ins SHALL mention it. The rendered
`claude/CLAUDE.block.md` and `codex/AGENTS.block.md` SHALL contain the new row.

#### Scenario: Rendered core block documents the fast lane
- **WHEN** `node scripts/build.mjs` has run
- **THEN** `claude/CLAUDE.block.md` and `codex/AGENTS.block.md` each contain the fast-lane stage
  row once, `node scripts/build.mjs --check` exits 0, and `npm test` is green

#### Scenario: Every README mentions the lane
- **WHEN** the eight `README*.md` files are checked
- **THEN** each one contains `--fast` in its stage table, its `mf-plan` skill row and its
  built-in comparison, and each one mentions `--go`
