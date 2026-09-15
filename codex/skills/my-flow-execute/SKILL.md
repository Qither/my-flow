---
name: my-flow-execute
description: "Execute a planned change task by task with tasks.md as the only progress ledger, wrapped in a native goal, ending with the fixed final quality gate. Use when tasks.md has unchecked boxes or the user says \"run the change\". (Distinct from the built-in run skill, which launches the app.)"
argument-hint: "<change-name> [--team] [--worktree]"
---

# Execute

Work through `changes/<name>/tasks.md` to completion. `execute` never redesigns; if the
design turns out wrong, stop, say so, and go back to $my-flow-mf-plan.

Input: {{ARGUMENTS}}

## 1. Load

1. Read `tasks.md`, `design.md`, `proposal.md`. List the pending tasks in order.
2. Re-read `## Do-Not-Touch` and `## Rebuild / Re-run After Change`. These are hard rules for
   the whole run.
3. `git status --short --branch`. If the tree is dirty with unrelated work, tell the user
   before continuing.

## 2. Goal statement

Compose one statement (under 4000 characters):

```
Complete every unchecked task in changes/<name>/tasks.md, in order, under the
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

Run `$my-flow-spec stage <name> execute` once before task 1; this writes
`.my-flow/state/current-change.json` with a fresh `updated` timestamp, binds this session to
the change and arms the Stop-hook execute-guard. Never edit that file by hand. Pass
`--session <id>` when several sessions share one repository, so each holds its own lease.

`stage execute` refuses a linked change whose contract is not executable (a task with no declared
prerequisites or no acceptance reference, a required criterion with no evidence mode or no
checks, any structural error) and, when the change records a review lane, one that lane has not
approved. `$my-flow-spec lane status <name>` says which it is. Fix either in $my-flow-mf-plan,
never by editing the contract here; `--skip-contract-gate` stages it anyway and is a decision to
record. `--force` does not waive it: that flag already means "take over a live lease".

For each pending task, in order:

1. Implement the smallest change that satisfies the task, following patterns already in the
   codebase. For a task with prerequisites or a long reference chain,
   `$my-flow-spec context <name> --task <id>` writes the derived packet to scratch: the full
   constraints, the complete criteria index, the task with its prerequisite closure, the blocks
   it references, hashed file locators and any open finding. Re-run it with
   `--since <digest>` to be told only what changed.
2. Run the task's own verification phrase (the "and verify ..." part). If the task touches
   anything listed in Rebuild / Re-run, run those steps now.
3. Only if the check passed: tick the box in `tasks.md`, then run
   `$my-flow-spec stage <name> execute` to refresh the state timestamp. Optional commit
   `feat(<name>): <task id> <summary>`.
4. If the check failed twice with materially different approaches, the cause is a design
   question, not a third patch. Record it:
   `$my-flow-spec finding record <name> --file <finding.json>` with the `cause`, the `tasks` it
   defeated and this `attempt`. It exits 1 once two materially different approaches have failed
   and writes the blocker under exactly those tasks, so every independent task stays runnable.
   A ticked box is never reopened by a finding. Resolve it only through a recorded design
   review: `$my-flow-spec finding resolve <name> --id F-1 --review R-2 --remedy "<what>"`.
   Never tick a blocked task.
5. If the remedy needs the contract itself to change, stage it instead of editing it:
   `$my-flow-spec amend propose <name> --file <candidate.json>` (`locator`, `equivalent-check`
   or `scope`) holds only the affected tasks while the approved text stays in force, and
   `$my-flow-spec amend apply <name> --id A-1` publishes it once its authority is recorded,
   reopening the affected boxes. A scope change needs the user, not a reviewer.

## 4. Final gate (fixed order)

1. Targeted verification of the whole change: build, tests, and every Rebuild / Re-run step.
2. Cleanup of your own diff only: dead code, debug output, stray TODOs, `.only` / `.skip`,
   commented-out blocks. Do not touch code outside the diff.
3. Re-run step 1.
4. Independent review: run $my-flow-mf-verify <name> in a separate context. Optionally
   $my-flow-ask for a cross-model review of the diff.
5. If a host reported what the work cost, import it rather than estimating it:
   `$my-flow-spec usage import <name> --file <event.json>`. Failed and abandoned attempts are
   imported too; a field the host did not report stays unknown and never becomes zero.
6. Only if the report says PASS: declare done. Tick any remaining meta task, run
   `$my-flow-spec stage <name> done` (this releases the Stop-hook backstop), and suggest
   `$my-flow-spec archive <name>`.

After step 6, and only then, call `update_goal` with status `complete`.

## Report (always the last thing you print)

```
## Run report
Change: <name>   Tasks: n/m ticked   Blocked: <ids or none>
Rebuild / Re-run executed: <list>
Verification: PASS | FAIL | INCOMPLETE (.my-flow/verify/<file>)
Next: $my-flow-spec archive <name> | fix blockers | $my-flow-mf-plan <name> (design change needed)
```
