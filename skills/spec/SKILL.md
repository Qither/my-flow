---
name: spec
description: "Thin helper around the OpenSpec change structure - show status, validate, or create a new change directory from templates (works without the openspec CLI)."
argument-hint: "status [name] | validate | new <name> | archive <name>"
allowed-tools: "Read Grep Glob Bash(openspec:*) Write"
---

# Spec helper

Input: $ARGUMENTS

Locate the OpenSpec root: `openspec/` in the current project. If it is missing and the
subcommand is not `new`, say so and suggest `my-flow init` or `openspec init`.

## status [name]

- With the `openspec` CLI: `openspec list --json` and, for the active or named change,
  `openspec status --change <name> --json`. Summarize as: change, artifacts and their state
  (ready / blocked / done), ticked vs total tasks.
- Without the CLI: list `openspec/changes/*/` (excluding `archive/`), and count `- [x]` vs
  `- [ ]` in each `tasks.md`.
- Also read `.my-flow/state/current-change.json` and report the current stage.

## validate

- With the CLI: `openspec validate --all --strict --json`; report errors with file and line.
- Without the CLI, check by hand: `design.md` has `## Do-Not-Touch` and
  `## Rebuild / Re-run After Change`; `tasks.md` lines match `- [ ] N.M ...`; every spec
  requirement has at least one `#### Scenario:` with WHEN / THEN.

## new <name>

- With the CLI: `openspec new change <name>`, then overwrite `design.md` with the my-flow
  template so the two required sections exist.
- Without the CLI: create `openspec/changes/<name>/{.openspec.yaml,proposal.md,design.md,tasks.md}`
  from the my-flow templates (`templates/openspec/`). `.openspec.yaml` content:
  `schema: spec-driven`, `created: <YYYY-MM-DD>`, `skip_specs: true` until capabilities are listed.
- Write `.my-flow/state/current-change.json` with stage `new`.

## archive <name>

- Refuse unless every box in `tasks.md` is ticked and a PASS report exists under
  `.my-flow/verify/`.
- With the CLI: `openspec archive <name> --yes`. Without: move the directory to
  `openspec/changes/archive/<YYYY-MM-DD>-<name>/` and remind the user to merge delta specs
  into `openspec/specs/` by hand.
