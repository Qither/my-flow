---
name: spec
description: "Manage the intent layer (specs/ and changes/) with no external tool - create a change from templates, show status (stale, overlap and audit warnings), validate structure, set the current stage, archive a finished change and merge its delta specs, or abandon a change without merging."
argument-hint: "new <name> | status [name] [--stale-days n] | validate [name] | archive <name> | abandon <name> [--reason \\\"...\\\"] | stage <name> <stage>"
allowed-tools: "Read Grep Glob Bash(node:*) Write"
---

# Spec helper

Input: $ARGUMENTS

All mechanics are in the `spec.mjs` script; run it and relay its output. Layout and format
are documented in `specs/README.md` (created by `my-flow init`).

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/spec.mjs" <subcommand> [args] [--json]
```

## new <name>

Creates `changes/<name>/{proposal,design,tasks}.md` from `changes/.templates/` (or the
plugin templates) and sets `.my-flow/state/current-change.json` to stage `new`. Name must be
kebab-case. Then continue with /my-flow:interview or /my-flow:mf-plan.

## status [name]

Lists active changes with ticked / total tasks, artifact state (missing / empty / done),
delta spec count, and which change is current. Summarize in one line per change, then relay
every warning line printed after the rows (JSON: top-level `warnings`):
- `[stale <n>d]` on a row: unfinished and nothing under `changes/<name>/` modified for
  `--stale-days` days (default 14, or `MY_FLOW_STALE_DAYS`). A fully ticked change is never
  stale. Ask whether to resume it or `abandon` it.
- `state: current change "<name>" ...`: the state file names a change that is stale or gone
  (silent once the stage is `archived`).
- `overlap: <cap> "<Req>" in changes a (MODIFIED) and b (REMOVED)`: two active changes carry a
  delta for the same requirement (ADDED / MODIFIED / REMOVED by heading, RENAMED by its FROM
  line). Reporting only; decide which change lands first.
- `audit suggested: <cap> (<n> merges since last audit)`: `MY_FLOW_AUDIT_EVERY` (default 5)
  archived deltas for that capability since the last archived or abandoned `*audit-<cap>`
  change. Run /my-flow:mf-audit.

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
- overlap with another active change's delta (same capability, same requirement name) is a
  warning naming the other change and its section kind, never an error.
Fix every error before handing off; report warnings.

## archive <name>

Refuses unless every task is ticked and a PASS report exists under `.my-flow/verify/`
(`--force` overrides; say so explicitly if you use it). Merges delta specs into
`specs/<capability>/spec.md` (ADDED appends, MODIFIED replaces the block, REMOVED deletes,
RENAMED is reported for manual handling) and moves the change to
`changes/archive/<date>-<name>/`. Every ADDED or MODIFIED block receives one provenance line
`<!-- via: <date>-<name> -->` directly under its heading (older markers in the block are
dropped), so each requirement points back to the archived change that produced it. Review the
merge log and the resulting spec diff.

## abandon <name> [--reason "..."] [--force]

The third exit for a change that will not be finished: dropped after interview, superseded,
or parked for good. Requires an `## Abandoned` section with a `**Reason**:` line in
`proposal.md` (`--reason` appends it). Moves the change to
`changes/archive/<date>-<name>-abandoned/` and merges nothing, so `specs/` is untouched.
Refuses a fully ticked change (that is an `archive`) unless `--force`. Second use: recording a
clean audit so the `audit suggested` nudge clears without inventing work:
```
spec new audit-<cap>
spec abandon audit-<cap> --reason "audit clean, no findings"
```

## stage <name> <stage>

Writes `.my-flow/state/current-change.json` as `{change, stage, updated}` with a fresh
timestamp. Stages: `new`, `interview`, `mf-plan`, `execute`, `done`, `archived`. The change
must exist (`changes/<name>/` or `docs/changes/<name>.md`); `--force` overrides. Always use
this instead of editing the file by hand: the Stop hook's execute-guard only fires while
`stage` is `execute` and `updated` is younger than 12 hours (`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`),
so /my-flow:execute re-runs `stage <name> execute` after each ticked task and
`stage <name> done` after the final gate.
