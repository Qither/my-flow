---
name: execute
description: Execute a planned change task by task with tasks.md as the only progress ledger, wrapped in a native goal, ending with the fixed final quality gate. Use when tasks.md has unchecked boxes or the user says "run the change". (Distinct from the built-in run skill, which launches the app.)
argument-hint: "<change-name> [--team] [--worktree]"
---

# Execute

Work through `changes/<name>/tasks.md` to completion. `execute` never redesigns; if the
design turns out wrong, stop, say so, and go back to {{CALL:mf-plan}}.

Input: {{ARGS}}

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

<!-- MY-FLOW:CLAUDE -->
Skills cannot set the session goal, so hand it to the user and wait. Print exactly:

```
Paste this to keep the session on task, then say "continue":
/goal <the statement above>
```

Then STOP and wait. Do not start task 1 until the user replies. If the user says a `/goal`
is already active for this change, or explicitly declines ("skip the goal"), continue
without it. Keep one loop authority per session: never ask for a second `/goal`. This
handoff is the default for every entry into `execute`, including a run that arrived from
`{{CALL:mf-plan}} --fast --go`; it pauses once for the paste.

Backstop: while the change is in stage `execute`, the my-flow Stop hook blocks a message
that claims completion ("done", "implemented", ...) while `tasks.md` still has unticked,
unblocked tasks, listing what remains. Plain answers and questions to the user are never
blocked. This is a safety net for a forgotten `/goal`, not a replacement for it. The state
expires 12 hours after its last `updated` timestamp (`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`
overrides), which is why the task loop refreshes it; the hook stops entirely when the
stage becomes `done` (step 4.5) or the user sets `MY_FLOW_SKIP_HOOKS=execute-guard`.

`--team`: only when `design.md` has `## File Ownership` with two or more disjoint groups.
Describe the teammates in natural language (one per ownership group, each told which
files it owns and which tasks are its), share this tasks.md, and forbid edits outside
owned files. On Windows the team runs in-process. One team per session.

`--worktree`: if not already in a worktree, tell the user to restart with
`claude -w <name>` and stop. For isolated sub-tasks, give a subagent `isolation: worktree`.
<!-- /MY-FLOW:CLAUDE -->
<!-- MY-FLOW:CODEX -->
Call `get_goal`. If no goal is active, call `create_goal` with the statement above. If a
different goal is active, tell the user and stop; do not stack goals. If a stale completed
goal blocks creation, ask the user to clear it in the UI.

Run this skill only because the user explicitly invoked it; the default Codex role in this
workflow is advisor, not executor. `--team` is not supported here; suggest running the
change in Claude Code instead.
<!-- /MY-FLOW:CODEX -->

## 3. Task loop

Run `{{CALL:spec}} stage <name> execute` once before task 1; this writes
`.my-flow/state/current-change.json` with a fresh `updated` timestamp and arms the Stop-hook
execute-guard. Never edit that file by hand.

For each pending task, in order:

1. Implement the smallest change that satisfies the task, following patterns already in the
   codebase.
2. Run the task's own verification phrase (the "and verify ..." part). If the task touches
   anything listed in Rebuild / Re-run, run those steps now.
3. Only if the check passed: tick the box in `tasks.md`, then run
   `{{CALL:spec}} stage <name> execute` to refresh the state timestamp. Optional commit
   `feat(<name>): <task id> <summary>`.
4. If the check failed twice with materially different approaches, record the blocker under
   the task in `tasks.md` (`  - blocked: <reason>`) and continue with independent tasks.
   Never tick a blocked task.

## 4. Final gate (fixed order)

1. Targeted verification of the whole change: build, tests, and every Rebuild / Re-run step.
2. Cleanup of your own diff only: dead code, debug output, stray TODOs, `.only` / `.skip`,
   commented-out blocks. Do not touch code outside the diff.
3. Re-run step 1.
4. Independent review: run {{CALL:mf-verify}} <name> in a separate context. Optionally
   {{CALL:ask}} for a cross-model review of the diff.
5. Only if the report says PASS: declare done. Tick any remaining meta task, run
   `{{CALL:spec}} stage <name> done` (this releases the Stop-hook backstop), and suggest
   `{{CALL:spec}} archive <name>`.

<!-- MY-FLOW:CODEX -->
After step 5, and only then, call `update_goal` with status `complete`.
<!-- /MY-FLOW:CODEX -->

## Report (always the last thing you print)

```
## Run report
Change: <name>   Tasks: n/m ticked   Blocked: <ids or none>
Rebuild / Re-run executed: <list>
Verification: PASS | FAIL | INCOMPLETE (.my-flow/verify/<file>)
Next: {{CALL:spec}} archive <name> | fix blockers | {{CALL:mf-plan}} <name> (design change needed)
```
