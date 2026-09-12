## Purpose

The session goal in `execute` on Claude Code: the `/goal` handoff that every entry into
`execute` offers, the point at which the Stop-hook execute-guard is armed, and the hook's
exemption for the handoff message itself.

## ADDED Requirements

### Requirement: Execute hands off the session goal on every entry

On Claude, `execute` SHALL compose the goal statement, print the "Paste this ... /goal
<statement>" block and stop before task 1, on every entry into the skill, including a run that
arrived from `mf-plan --fast --go`. The only two ways past the stop SHALL be the user stating
that a `/goal` is already active for this change and the user explicitly declining ("skip the
goal"). The skill SHALL NOT treat any flag or entry path as an implicit decline, and SHALL never
ask for a second `/goal` in one session. On Codex the goal SHALL still be created through
`get_goal` / `create_goal` as before.

#### Scenario: Run entered from the fast lane pauses for the goal
- **WHEN** the user invokes `mf-plan --fast --go <name>` on Claude and the fast lane hands
  over to `execute`
- **THEN** the transcript contains the `Paste this` block with a `/goal` line once, the run
  stops until the user replies, and task 1 is not started before that reply

#### Scenario: Explicit decline still works
- **WHEN** the user replies "skip the goal" (or states that a `/goal` is already active)
- **THEN** `execute` continues into the task loop without printing the block again

### Requirement: Execute-guard is armed when the task loop starts

`execute` SHALL run `spec stage <name> execute` for the first time as the first step of its
task loop, after the goal handoff has been answered, and SHALL NOT run it in its Load section.
The per-task refresh after each ticked task SHALL stay. As a result the state file SHALL NOT
say `stage: execute` with a fresh timestamp while `execute` is waiting for the user's `/goal`
in a run that started from a non-execute stage.

#### Scenario: State is not armed while waiting
- **WHEN** `execute <name>` has printed the goal handoff and is waiting, and the previous
  stage of that change was `mf-plan`
- **THEN** `.my-flow/state/current-change.json` still reports the previous stage, and it
  reports `stage: execute` only after the user's reply, before task 1 is implemented

#### Scenario: Skill text carries the order
- **WHEN** `src/skills/execute.md` is read
- **THEN** its `## 1. Load` section contains no `spec ... stage` call and its `## 3. Task loop`
  section contains the `stage <name> execute` call twice (once before task 1, once as the
  per-task refresh)

### Requirement: Stop hook ignores the goal handoff message

`hooks/completion-guard.mjs` SHALL treat a last assistant message that contains a line
beginning with `/goal ` followed by text as a goal handoff, and SHALL allow it (`{}`) before
either rule runs, even though the goal statement contains words such as "Complete" and
"Done" and even when the state file is fresh and `tasks.md` has unticked tasks. A message
that only mentions `/goal` inside a sentence SHALL NOT be exempt.

#### Scenario: Handoff message is allowed
- **WHEN** the state file says `stage: execute` with a fresh timestamp, `tasks.md` has
  unticked unblocked tasks, and the last assistant message is `Paste this to keep the session
  on task, then say "continue":` followed by a line starting `/goal Complete every unchecked
  task ... Done only when ...`
- **THEN** the hook prints `{}`

#### Scenario: Mid-sentence mention is still a claim
- **WHEN** the same state holds and the last assistant message is `All tasks are done; the
  /goal was active throughout.`
- **THEN** the hook prints a `decision: block` whose reason starts with
  `[my-flow execute-guard]`
