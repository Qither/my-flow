---
name: plan
description: Consensus planning - planner drafts design.md and tasks.md, architect and critic review in sequence until approved. Use for multi-file changes, anything touching build config, shaders, engine modules, migrations, or auth.
argument-hint: "<change-name | free text> [--deliberate]"
---

# Plan

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
  (unit / integration / end-to-end / observability). Auto-enable for auth, migrations,
  destructive operations, public API changes, build or shader pipeline changes.

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
7. Update `.my-flow/state/current-change.json` to stage `plan`.

<!-- MY-FLOW:CLAUDE -->
Delegation: use the Agent tool with `subagent_type` set to `my-flow:planner`,
`my-flow:architect`, `my-flow:critic`. Run the three sequentially, never in one batch; each
reviewer must see the previous output.
<!-- /MY-FLOW:CLAUDE -->
<!-- MY-FLOW:CODEX -->
Delegation: spawn the native subagents `planner`, `architect`, `critic` one at a time, in
that order; each reviewer must see the previous output. Never batch them in parallel.
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
Rebuild / Re-run: <echo the list from design.md>
Next: {{CALL:run}} <name>
```
