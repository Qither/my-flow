## Context

Plan mode: fast (one critic pass, no architect).

Reproduced fault (this session, against `hooks/completion-guard.mjs` as it is): with a
scratch project holding two unticked tasks and `spec stage demo execute` just written, the
verbatim handoff message (`Paste this ... /goal Complete every unchecked task ... Done only
when ...`) makes the hook return `decision: block` with `[my-flow execute-guard]`.

Three facts drive the design:

- `src/skills/execute.md:21-22` (Load step 4) runs `{{CALL:spec}} stage <name> execute`
  before the section-2 handoff at `:37-46`, so the guard is armed while the skill waits.
- `hooks/completion-guard.mjs:44-46` defines `COMPLETION_CLAIM_RE`; `:71-72` allows only
  when the message is empty or has no claim. The goal statement (`src/skills/execute.md:29-33`)
  contains `Complete` and `Done`, which match `\bcomplete[sd]?\b` and `\bdone\b`.
- `src/skills/execute.md:47-49` and `src/skills/mf-plan.md:95-106` make `--fast --go` skip
  the handoff. `specs/mf-plan-fast/spec.md` requirement "`--go` continues into execute
  without the goal stop" records that; the user now wants the handoff on for every entry.

Build pipeline: `src/**` is the only source; `node scripts/build.mjs` renders
`skills/*/SKILL.md`, `codex/skills/*/SKILL.md`, `claude/CLAUDE.block.md`,
`codex/AGENTS.block.md`; `--check` fails when the rendered files are stale. The live hook in
this session is the plugin cache copy at
`~/.claude/plugins/cache/my-flow/my-flow/0.1.0` (installed_plugins.json, commit 44b1cb2),
so hook edits reach a live session only after `claude plugin update my-flow@my-flow`.

## Goals / Non-Goals

**Goals:**

- Every entry into `execute` on Claude offers the `/goal` handoff and waits, unless a goal
  is already active for the change or the user explicitly declines.
- The execute-guard is never armed while `execute` is waiting for the user's `/goal`.
- The Stop hook never blocks the handoff message, whatever the state file says.
- `mf-plan --fast --go` reaches `execute` through its normal handoff.

**Non-Goals:**

- Changing `COMPLETION_CLAIM_RE`, the fake-completion scan, the TTL, or the opt-out env.
- Changing the Codex goal flow or the planning half of the fast lane.
- Touching `mf-verify`, `spec.mjs`, the dashboard, or the agents.

## Decisions

- **D1. Handoff is the default; only two exits remain.** In the Claude block of
  `src/skills/execute.md` section 2, drop the sentence "Entering from `mf-plan --fast --go`
  ... counts as the user declining the goal ..." (`:47-49`). Keep "a `/goal` is already
  active" and "skip the goal" as the only ways past the stop. Alternative considered: keep
  `--go` goal-less and only fix the hook. Rejected because the user asked for the goal by
  default on every execution, and a goal-less loop is exactly what produced the bad runs.
- **D2. Arm the guard when the task loop starts.** Delete Load step 4 (`:21-22`) and make
  the first step of `## 3. Task loop` "Run `{{CALL:spec}} stage <name> execute` once before
  task 1 (this arms the Stop-hook execute-guard); never edit the state file by hand." The
  per-task refresh in loop step 3 stays. Load keeps three steps; nothing else in the file
  refers to "step 1.4" except the sentence removed in D1. Alternative: keep step 1.4 and rely
  on D3 alone. Rejected: a guard armed while waiting for the user is wrong by construction,
  and D3 is only a defence for stale state from a previous run in the same TTL window.
- **D3. Hook exemption for the handoff line.** In `hooks/completion-guard.mjs`, right after
  `COMPLETION_CLAIM_RE`, add `const GOAL_HANDOFF_RE = /^\s*\/goal\s+\S/m;` and change the
  allow line (`:72`) to `if (!message || GOAL_HANDOFF_RE.test(message) ||
  !COMPLETION_CLAIM_RE.test(message)) allow();`. The exemption sits before both rules
  because a handoff is not a completion claim for either. A `/goal` mention inside a
  sentence (backticks, mid-line) does not match, so a real claim that happens to mention
  the goal is still blocked. Update the header comment to mention the exemption.
- **D4. `--go` delegates the goal to `execute`.** Rewrite `src/skills/mf-plan.md:93-111`:
  shared prose says "Valid only with `--fast` and only after the handoff has been printed.
  Continue into `{{CALL:execute}} <name>` for the same change: it composes the goal, hands it
  off as it always does, arms the execute-guard before task 1, and ends with its Run report.
  `--team` and `--worktree` are unavailable here ... (unchanged)". The Claude block says
  "Invoke `my-flow:execute <name>` with the Skill tool and follow the loaded text, including
  its section-2 goal stop; never paraphrase it. Record the hand-over with one line:
  `Continuing into execute (--go): goal handoff applies.`" The Codex block says "Follow
  `{{CALL:execute}} <name>` by reference from its Load steps through the final gate, with
  `get_goal` / `create_goal` running normally." No `spec stage` call, no "standing
  instruction" sentence remains in that section.
- **D5. Docs say the same thing in one sentence.** `src/core/core.md:74-76` gains "for every
  run, including one entered from `mf-plan --fast --go`" after "waits for the user to paste
  it". Each README replaces the "Exception: ... skips the `/goal` stop ..." sentence at
  `:118` with one saying a run entered from `mf-plan --fast --go` also pauses once for the
  `/goal` paste, and replaces "which skips the `/goal` stop" at `:153` with "which also
  pauses for the `/goal` paste", in that file's language.
- **D6. Specs.** New capability `execute-goal` (ADDED: handoff on every entry; guard armed
  at task-loop start; hook ignores the handoff). In `mf-plan-fast`, REMOVE "`--go` continues
  into execute without the goal stop" (with a Reason) and ADD "`--go` continues into execute
  through the goal handoff"; the merge cannot rename, so remove-plus-add keeps `specs/`
  truthful after archive. The merge only touches requirement blocks, so the capability's
  `## Purpose` paragraph ("without the interactive `/goal` stop") is corrected directly in
  `specs/mf-plan-fast/spec.md` by a task of this change; that one sentence is the only
  edit under `specs/`.

## Risks / Trade-offs

- `--go` now pauses once. That is the user's explicit request; the record line makes the
  pause visible in the transcript.
- The plugin cache lags this checkout. Until `claude plugin update` runs, a live session
  still uses the old hook; D2 alone already prevents the block in that window because the
  new skill text never arms the guard before the stop.
- Skills load at session start, so the session running this change sees the old
  `execute` text; the run applies D2's order by hand and says so.
- Stale state from an earlier run (same TTL window) can still be `stage: execute` when a
  new `execute` starts; D3 covers that case.

## Do-Not-Touch

- `hooks/session-context.mjs`, `hooks/lib/stdin.mjs`, `scripts/**`, `web/**`, `agents/**`,
  `templates/**`, and every file under `specs/` except the `## Purpose` paragraph of
  `specs/mf-plan-fast/spec.md` (D6); requirement changes go through the delta specs under
  `changes/execute-goal-default/specs/`.
- `src/skills/{interview,mf-verify,mf-audit,ask,learn,spec,dashboard}.md`.
- Rendered files under `skills/`, `codex/`, `claude/` are never edited by hand; only
  `node scripts/build.mjs` writes them.
- `COMPLETION_CLAIM_RE`, `BLOCKER_PATTERNS`, and the TTL logic in `completion-guard.mjs`.

## Rebuild / Re-run After Change

- After any edit under `src/`: `node scripts/build.mjs`, then `node scripts/build.mjs --check`.
- After any edit to `hooks/completion-guard.mjs` or `test/`: `npm test`.
- After the build: `node scripts/install.mjs claude` (refreshes `~/.claude/CLAUDE.md`) and
  `claude plugin update my-flow@my-flow` so the live hook and skills match this checkout;
  on Codex, `node scripts/install.mjs codex`.
- After writing delta specs: `node scripts/spec.mjs validate execute-goal-default`.
