## Why

`execute` is supposed to hand the session goal to the user (print `/goal <statement>`, stop,
wait for "continue") and only then start task 1. In practice the run is regularly derailed at
exactly that stop, so the user ends up with executions that never had a `/goal`.

The cause was reproduced against the current hook: `execute` Load step 4 runs
`spec stage <name> execute` **before** the goal handoff, which arms the Stop-hook
execute-guard. The handoff message then quotes the goal statement, which contains the words
"Complete every unchecked task ..." and "Done only when ...". The guard's completion-claim
regex matches those words, `tasks.md` still has unticked tasks, so the hook returns
`decision: block` with "continue with the next task". The model obeys and starts task 1
without a goal, or loops on the stop. Feeding the verbatim handoff message to
`hooks/completion-guard.mjs` with a fresh execute state reproduces the block every time.

On top of that, `mf-plan --fast --go` was defined a day ago to skip the goal handoff
altogether. The user now wants the opposite default: whenever a change is executed, the
`/goal` handoff is on, including runs entered from `--fast --go`.

## What Changes

1. **Goal handoff is the default for every entry into `execute`.** The `--fast --go` clause
   that counts as "the user declined the goal" is removed. Only an already-active `/goal`
   for this change or an explicit decline ("skip the goal") skips the handoff. Codex is
   unchanged (`get_goal` / `create_goal`).
2. **The execute-guard arms only when the task loop starts.** `spec stage <name> execute`
   moves from Load step 4 to the first step of the task loop, so the guard is never armed
   while `execute` is waiting for the user's `/goal`. The per-task refresh stays.
3. **The Stop hook never treats the goal handoff as a completion claim.** A last message
   containing a line that starts with `/goal ` is allowed before the completion-claim regex
   runs. This is the defence for the case where the state file is still fresh from an
   earlier run in the same 12-hour window.
4. **`mf-plan --go` continues into `execute` through the normal handoff.** It no longer runs
   `spec stage` itself, no longer prints the goal as a "standing instruction", and no longer
   skips the goal stop; it invokes the `execute` skill, which pauses once for the `/goal`
   paste and then runs to the Run report.
5. **Documentation and specs.** `src/core/core.md`, all eight READMEs, the `mf-plan-fast`
   spec (the `--go` requirement) and a new `execute-goal` spec describe the new default.

## Non-Goals

- No change to the completion-claim regex itself, to the fake-completion scan (rule 2), or
  to the 12-hour TTL.
- No attempt to set `/goal` from a skill or hook; Claude Code does not allow it.
- No change to the fast lane's planning half (`--fast` guard, one critic pass, marker).
- No change to the Codex goal flow (`get_goal` / `create_goal` / `update_goal`).
- No change to `mf-verify`, `spec.mjs`, the dashboard, or the agent prompts.

## Decision Boundaries

The agent may decide alone:

- Exact wording of the skill text, the hook comment, the handoff record line, and the
  README sentences in each language.
- The exact regex used to recognise the handoff line, as long as it requires `/goal` at the
  start of a line.
- Where inside the task loop the first `spec stage` call is placed.

Needs the user:

- Any change to the completion-claim regex, the TTL, or the opt-out env variables.
- Reintroducing any path that runs tasks without offering the `/goal` handoff.

## Capabilities

### New Capabilities

- `execute-goal`: the goal handoff on every entry into `execute`, the arming point of the
  execute-guard, and the Stop hook's handoff exemption.

### Modified Capabilities

- `mf-plan-fast`: the `--go` requirement no longer skips the goal stop.

## Impact

- `src/skills/execute.md` (Load step 4, Claude block of section 2, task loop step),
  `src/skills/mf-plan.md` (`## Continue into execute (--go)` section),
  `src/core/core.md` (loop-authority bullet), `hooks/completion-guard.mjs`,
  `test/completion-guard.test.mjs`.
- README in all eight languages: the loop-authority paragraph (`:118`) and the `execute`
  skill-table row (`:153`).
- Generated outputs via `node scripts/build.mjs`: `skills/execute/SKILL.md`,
  `skills/mf-plan/SKILL.md`, `codex/skills/my-flow-execute/SKILL.md`,
  `codex/skills/my-flow-mf-plan/SKILL.md`, `claude/CLAUDE.block.md`, `codex/AGENTS.block.md`.
- Installed surfaces: the Claude plugin cache (`claude plugin update my-flow@my-flow`) and
  `~/.claude/CLAUDE.md` (via `node scripts/install.mjs claude`).

## Success Criteria

1. Feeding the verbatim `/goal` handoff message to `hooks/completion-guard.mjs` with a
   fresh `stage: execute` state and unticked tasks returns `{}`; a plain completion claim in
   the same state is still blocked. Both are covered by `npm test`.
2. `src/skills/execute.md` contains no `--fast --go` clause, its Load section contains no
   `spec stage` call, and the task loop's first step is the `spec stage <name> execute` call.
3. `src/skills/mf-plan.md`'s `--go` section contains no `spec stage`, no "standing
   instruction", and no "goal stop is skipped"; the Claude block invokes the execute skill
   through the Skill tool.
4. `node scripts/build.mjs --check` exits 0 and `npm test` is green.
5. No README or core block still says that `--fast --go` skips the `/goal` stop.
6. An independent `mf-verify` report under `.my-flow/verify/` says `Verdict: PASS`.
