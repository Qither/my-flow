---
name: spec
description: Manage the intent layer (specs/ and changes/) with no external tool - create a change from templates, show status, validate structure, or archive a finished change and merge its delta specs.
argument-hint: "new <name> | status [name] | validate [name] | archive <name>"
---

# Spec helper

Input: {{ARGS}}

All mechanics are in the `spec.mjs` script; run it and relay its output. Layout and format
are documented in `specs/README.md` (created by `my-flow init`).

<!-- MY-FLOW:CLAUDE -->
```
node "${CLAUDE_PLUGIN_ROOT}/scripts/spec.mjs" <subcommand> [args] [--json]
```
<!-- /MY-FLOW:CLAUDE -->
<!-- MY-FLOW:CODEX -->
```
node "{{MYFLOW_ROOT}}/scripts/spec.mjs" <subcommand> [args] [--json]
```
<!-- /MY-FLOW:CODEX -->

## new <name>

Creates `changes/<name>/{proposal,design,tasks}.md` from `changes/.templates/` (or the
plugin templates) and sets `.my-flow/state/current-change.json` to stage `new`. Name must be
kebab-case. Then continue with {{CALL:interview}} or {{CALL:blueprint}}.

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
Fix every error before handing off; report warnings.

## archive <name>

Refuses unless every task is ticked and a PASS report exists under `.my-flow/verify/`
(`--force` overrides; say so explicitly if you use it). Merges delta specs into
`specs/<capability>/spec.md` (ADDED appends, MODIFIED replaces the block, REMOVED deletes,
RENAMED is reported for manual handling) and moves the change to
`changes/archive/<date>-<name>/`. Review the merge log and the resulting spec diff.
