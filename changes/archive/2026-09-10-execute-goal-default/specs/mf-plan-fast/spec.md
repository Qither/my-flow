## REMOVED Requirements

### Requirement: `--go` continues into execute without the goal stop

**Reason**: The user wants the `/goal` handoff on for every execution. Skipping the stop left
`--go` runs without a goal, and the "standing instruction" print combined with the early
`spec stage` call was the same message shape that the Stop hook blocked. Replaced by the
requirement "`--go` continues into execute through the goal handoff" below; the
capability-level scenarios about `--go` without `--fast` and `--fast` with `--deliberate`
move there unchanged.

**Migration**: none for users; a `--go` run now pauses once for the `/goal` paste instead of
starting task 1 immediately.

## ADDED Requirements

### Requirement: `--go` continues into execute through the goal handoff

`--go` SHALL be valid only together with `--fast`. After the handoff has printed, `mf-plan`
SHALL continue into the `execute` flow for the same change in the same conversation, and
SHALL NOT run `spec stage <name> execute` itself nor print the goal statement as a standing
instruction. The task loop and the final gate SHALL come from the `execute` skill's own text
and SHALL NOT be restated or recalled: on Claude the fast lane SHALL invoke
`my-flow:execute <name>` through the Skill tool and follow the loaded text including its
`/goal` print-and-stop, recording the hand-over with the line
`Continuing into execute (--go): goal handoff applies.`; on Codex it SHALL follow
`$my-flow-execute` by reference with `get_goal` / `create_goal` running normally. `execute`
itself arms the Stop-hook execute-guard before task 1. Nothing else in `execute` SHALL
change, and `tasks.md` SHALL remain the only progress ledger. `--team` and `--worktree`
SHALL NOT be reachable through `--go`; when the user wants either, the fast lane SHALL stop
after the handoff and point at `execute <name>`.

#### Scenario: Fast planning runs into execute and pauses once for the goal
- **WHEN** the user invokes `mf-plan --fast --go <name>` on a change that passes the guard
- **THEN** the transcript contains the hand-over line, then exactly one `Paste this` block
  with a `/goal` line, the run waits for the user, and after the reply
  `.my-flow/state/current-change.json` reports stage `execute` and the first task of
  `tasks.md` is implemented, verified and ticked

#### Scenario: `--go` without `--fast` is refused
- **WHEN** the user invokes `mf-plan --go <name>` without `--fast`
- **THEN** `mf-plan` prints one line saying `--go` requires `--fast`, does not enter the execute
  flow, and plans the change in the full mode

#### Scenario: `--fast` together with `--deliberate` is refused
- **WHEN** the user invokes `mf-plan --fast --deliberate <name>`
- **THEN** `mf-plan` prints one line in the same wording as the high-risk guard saying
  `--deliberate` wins, and plans the change in the full mode with the pre-mortem and the test
  plan

#### Scenario: The completion backstop stays armed during the task loop
- **WHEN** a `--go` run has passed the goal handoff, `execute` has run `spec stage <name>
  execute`, and a message claims completion while `tasks.md` still has unticked, unblocked
  tasks
- **THEN** the Stop hook blocks that message and lists the remaining tasks
