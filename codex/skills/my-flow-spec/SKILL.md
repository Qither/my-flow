---
name: my-flow-spec
description: "Manage the intent layer (specs/ and changes/) with no external tool - create a change from templates, show status, validate structure, set the current stage, or archive a finished change and merge its delta specs."
argument-hint: "new <name> | status [name] | validate [name] | archive <name> | stage <name> <stage>"
---

# Spec helper

Input: {{ARGUMENTS}}

All mechanics are in the `spec.mjs` script; run it and relay its output. Layout and format
are documented in `specs/README.md` (created by `my-flow init`).

```
node "{{MYFLOW_ROOT}}/scripts/spec.mjs" <subcommand> [args] [--json]
```

## new <name>

Creates `changes/<name>/{proposal,design,tasks}.md` from `changes/.templates/` (or the
plugin templates) and sets `.my-flow/state/current-change.json` to stage `new`. Name must be
kebab-case. Then continue with $my-flow-interview or $my-flow-mf-plan.

## status [name]

Lists active changes with ticked / total tasks, artifact state (missing / empty / done),
delta spec count, and which change is current. Summarize in one line per change.

## validate [name]

Structural checks, exit 1 on errors:
- proposal / design / tasks exist; design has `## Do-Not-Touch` and
  `## Rebuild / Re-run After Change`; proposal has Non-Goals and Decision Boundaries (warning).
- tasks lines match `- [ ] N.M ... and verify ...`.
- spec files: every `### Requirement:` has a `#### Scenario:` (four hashes) with WHEN / THEN;
  delta files have an ADDED / MODIFIED / REMOVED section.
- delta vs main spec: MODIFIED and REMOVED requirements must exist in `specs/<capability>/spec.md`
  (error); REMOVED needs a `**Reason**:` line (error) and a `**Migration**:` line (warning);
  ADDED must not already exist (warning: use MODIFIED); RENAMED FROM must exist and is never
  merged automatically.
Fix every error before handing off; report warnings.

## archive <name>

Refuses unless every task is ticked and a PASS report exists under `.my-flow/verify/`
(`--force` overrides; say so explicitly if you use it). Merges delta specs into
`specs/<capability>/spec.md` (ADDED appends, MODIFIED replaces the block, REMOVED deletes,
RENAMED is reported for manual handling) and moves the change to
`changes/archive/<date>-<name>/`. Review the merge log and the resulting spec diff.

## stage <name> <stage>

Writes `.my-flow/state/current-change.json` as `{change, stage, updated}` with a fresh
timestamp. Stages: `new`, `interview`, `mf-plan`, `execute`, `done`, `archived`. The change
must exist (`changes/<name>/` or `docs/changes/<name>.md`); `--force` overrides. Always use
this instead of editing the file by hand: the Stop hook's execute-guard only fires while
`stage` is `execute` and `updated` is younger than 12 hours (`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`),
so $my-flow-execute re-runs `stage <name> execute` after each ticked task and
`stage <name> done` after the final gate.
