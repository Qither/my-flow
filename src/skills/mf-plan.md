---
name: mf-plan
description: Consensus planning for a change - planner drafts design.md and tasks.md, architect and critic review in sequence until approved. Use for multi-file changes, anything touching build config, shaders, engine modules, migrations, or auth, or when the user says "plan this change". (Distinct from the built-in /plan mode.)
argument-hint: "<change-name | free text> [--deliberate] [--fast [--go]]"
---

# mf-plan (consensus plan)

Produce `design.md` and `tasks.md` for one change, reviewed to consensus. Planning only:
this skill never edits source files.

Input: {{ARGS}}

## Inputs

- A change name: load `changes/<name>/proposal.md`.
- Free text: create the change with `{{CALL:spec}} new <name>` and write a short
  `proposal.md` inline first (Why / What Changes / Non-Goals / Decision Boundaries / Success
  Criteria). Do not start an interview here; if the text is too vague to write those
  sections, stop and suggest {{CALL:interview}}.
- `--deliberate`: add a three-scenario pre-mortem and an explicit test plan
  (unit / integration / end-to-end / observability). Auto-enabled for the
  `High-risk categories` section below.
- `--fast`: the fast lane (`## Fast lane (--fast)` below): same artifacts, one critic pass,
  no drafting role, no architect. Only the user passes it; the model never selects it and may
  only suggest it in a handoff. Refused for the `High-risk categories`, and refused
  together with `--deliberate` (`--deliberate` wins).
- `--go`: only together with `--fast`; after the handoff, continue straight into the execute
  flow (`## Continue into execute (--go)` below). `--go requires --fast`: without it, print
  one line `--go requires --fast; planning in full mode.` and continue in full mode.

## High-risk categories

auth, migrations, destructive operations, public API changes, build config or shader
pipeline changes, engine modules. Judged from the proposal text and the paths it names (a
judgement call, no keyword matcher). This single list drives both `--deliberate` (auto-enabled)
and the `--fast` guard (refused), so adding or removing a category moves both flags together.

## Boundary

Writes only under `changes/<name>/` and `.my-flow/`. Ask the user only when a decision
would change the task breakdown; look everything else up.

## Steps

1. Load `proposal.md`, related `specs/**/spec.md`, project `CLAUDE.md` / `AGENTS.md`.
2. **Planner** drafts. Delegate to the `planner` role with the proposal and the paths it
   touches. Expected output: PLAN-DR header (Principles 3-5, Decision Drivers top 3, Viable
   Options >= 2 or explicit invalidation), `design.md`, `tasks.md`.
3. **Architect** reviews (read-only). Give it the draft. Expected: `CLEAR | WATCH | BLOCK`,
   evidence with `path:line`, antithesis, tension, required changes. Wait for it to finish.
4. **Critic** reviews (read-only). Give it the draft plus the architect verdict. Expected:
   `OKAY | REJECT`, simulated tasks, at most five fixes. Wait for it to finish.
5. On `BLOCK` or `REJECT`: apply the fixes through the planner and repeat steps 3-4.
   Maximum three iterations. After two failed iterations, offer {{CALL:ask}} as a
   tie-breaker. If still not approved, present the best version and the open findings; do
   not pretend consensus.
6. Write the artifacts. Add delta specs under `changes/<name>/specs/<capability>/spec.md`
   only if the proposal lists capabilities (ADDED / MODIFIED / REMOVED requirements with
   WHEN / THEN scenarios). Run `{{CALL:spec}} validate <name>` and fix every error.
7. Run `{{CALL:spec}} stage <name> mf-plan` to record the current stage.

<!-- MY-FLOW:CLAUDE -->
Delegation: use the Agent tool with `subagent_type` set to `my-flow:planner`,
`my-flow:architect`, `my-flow:critic`. Run the three sequentially, never in one batch; each
reviewer must see the previous output.
<!-- /MY-FLOW:CLAUDE -->
<!-- MY-FLOW:CODEX -->
Delegation: spawn the native subagents `planner`, `architect`, `critic` one at a time, in
that order; each reviewer must see the previous output. Never batch them in parallel.
<!-- /MY-FLOW:CODEX -->

## Fast lane (--fast)

Same artifacts and the same downstream flow, with the review cut to one pass. In order:

1. Guard. If the proposal or free text touches a `High-risk categories` entry, print one
   line `--fast refused: <category>; planning in full mode.` and continue at `## Steps`. If
   `--deliberate` was also given, print `--fast refused: --deliberate wins; planning in full
   mode.` and continue at `## Steps` with `--deliberate`.
2. Author in this context. Read the files the proposal names and cite `path:line`. For free
   text, write `proposal.md` inline as `## Inputs` requires. Write `design.md` with the
   required sections and, as the first line under `## Context`, exactly
   `Plan mode: fast (one critic pass, no architect).` Write `tasks.md` in the strict format.
   No PLAN-DR header, no drafting delegation, no second reviewer.
3. One review. Delegate once to the read-only `critic` role with the draft. Expected:
   `OKAY | REJECT`, simulated tasks, at most five fixes. Wait for it to finish.
4. On `REJECT`: apply the fixes yourself, once. There is no second review; list every finding
   you did not fix under `Remaining findings:` in the handoff.
5. Delta specs, `{{CALL:spec}} validate <name>` and `{{CALL:spec}} stage <name> mf-plan`
   exactly as in steps 6-7 of the full mode.

## Continue into execute (--go)

Valid only with `--fast` and only after the handoff has been printed. Continue into
`{{CALL:execute}} <name>` for the same change: it composes the goal, hands it off as it
always does, arms the execute-guard before task 1, and ends with its Run report. `--team`
and `--worktree` are unavailable here: if the user wants either, stop after the handoff and
point at `{{CALL:execute}} <name>` instead.

<!-- MY-FLOW:CLAUDE -->
Invoke `my-flow:execute <name>` with the Skill tool and follow the loaded text, including
its section 2 goal stop (print the `/goal` block once and wait for the user's reply). Never
paraphrase the execute skill from memory. Record the hand-over with one line:
`Continuing into execute (--go): goal handoff applies.`
<!-- /MY-FLOW:CLAUDE -->
<!-- MY-FLOW:CODEX -->
Follow `{{CALL:execute}} <name>` by reference from its Load steps through the final gate,
with `get_goal` / `create_goal` running normally.
<!-- /MY-FLOW:CODEX -->

## Required content

`design.md` sections: `## Context`, `## Goals / Non-Goals`, `## Decisions`,
`## Risks / Trade-offs`, `## Do-Not-Touch`, `## Rebuild / Re-run After Change`,
`## File Ownership` (only when a team will execute; two or more disjoint groups).

`tasks.md` format, strictly:

```
## 1. <Group>
- [ ] 1.1 <task> and verify <observable check>
- [ ] 1.2 ...
```

## Handoff (always the last thing you print)

```
## Handoff
Change: changes/<name>   Review: architect CLEAR|WATCH, critic OKAY (iteration n)
Remaining findings: <fast lane only, and only when a critic finding was left unfixed>
Rebuild / Re-run: <echo the list from design.md>
Next: {{CALL:execute}} <name>
```

In the fast lane the `Review:` field reads `Review: fast (critic OKAY|REJECT-fixed, no architect)`.
