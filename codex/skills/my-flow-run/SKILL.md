---
name: my-flow-run
description: "Execute a planned change task by task with tasks.md as the only progress ledger, wrapped in a native goal, ending with the fixed final quality gate. Use when tasks.md has unchecked boxes."
argument-hint: "<change-name> [--team] [--worktree]"
---

# Run

Execute `openspec/changes/<name>/tasks.md` to completion. `run` never redesigns; if the
design turns out wrong, stop, say so, and go back to $my-flow-plan.

Input: {{ARGUMENTS}}

## 1. Load

1. Read `tasks.md`, `design.md`, `proposal.md`. List the pending tasks in order.
2. Re-read `## Do-Not-Touch` and `## Rebuild / Re-run After Change`. These are hard rules for
   the whole run.
3. `git status --short --branch`. If the tree is dirty with unrelated work, tell the user
   before continuing.
4. Write `.my-flow/state/current-change.json` with stage `run`.

## 2. Goal statement

Compose one statement (under 4000 characters):

```
Complete every unchecked task in openspec/changes/<name>/tasks.md, in order, under the
constraints of design.md: never modify anything listed in Do-Not-Touch; after each task run
the Rebuild / Re-run steps that apply to it. Tick a box only after that task's own
verification passed. Done only when every box is ticked, the final gate has run in order
(verify, cleanup, re-verify, independent review), and the verification report says PASS.
```

Call `get_goal`. If no goal is active, call `create_goal` with the statement above. If a
different goal is active, tell the user and stop; do not stack goals. If a stale completed
goal blocks creation, ask the user to clear it in the UI.

Run this skill only because the user explicitly invoked it; the default Codex role in this
workflow is advisor, not executor. `--team` is not supported here; suggest running the
change in Claude Code instead.

## 3. Task loop

For each pending task, in order:

1. Implement the smallest change that satisfies the task, following patterns already in the
   codebase.
2. Run the task's own verification phrase (the "and verify ..." part). If the task touches
   anything listed in Rebuild / Re-run, run those steps now.
3. Only if the check passed: tick the box in `tasks.md`. Optional commit
   `feat(<name>): <task id> <summary>`.
4. If the check failed twice with materially different approaches, record the blocker under
   the task in `tasks.md` (`  - blocked: <reason>`) and continue with independent tasks.
   Never tick a blocked task.

## 4. Final gate (fixed order)

1. Targeted verification of the whole change: build, tests, and every Rebuild / Re-run step.
2. Cleanup of your own diff only: dead code, debug output, stray TODOs, `.only` / `.skip`,
   commented-out blocks. Do not touch code outside the diff.
3. Re-run step 1.
4. Independent review: run $my-flow-verify <name> in a separate context. Optionally
   $my-flow-ask for a cross-model review of the diff.
5. Only if the report says PASS: declare done. Tick any remaining meta task, set state to
   `done`, and suggest `openspec archive <name>`.

After step 5, and only then, call `update_goal` with status `complete`.

## Report (always the last thing you print)

```
## Run report
Change: <name>   Tasks: n/m ticked   Blocked: <ids or none>
Rebuild / Re-run executed: <list>
Verification: PASS | FAIL | INCOMPLETE (.my-flow/verify/<file>)
Next: openspec archive <name> | fix blockers | $my-flow-plan <name> (design change needed)
```
