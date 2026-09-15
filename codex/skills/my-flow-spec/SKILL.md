---
name: my-flow-spec
description: "Manage the intent layer (specs/ and changes/) with no external tool - create a change from templates, show status (stale, overlap and audit warnings), validate structure, set the current stage, archive a finished change and merge its delta specs, or abandon a change without merging."
argument-hint: "new <name> | status [name] [--stale-days n] | validate [name] | archive <name> | abandon <name> [--reason \\\"...\\\"] | stage <name> <stage>"
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
  change. Run $my-flow-mf-audit.

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

## lane select|set|status <name>

The risk lane and the reviews it requires. `select` reads the judgement plus the `--fast` /
`--deliberate` / `--go` flags and prints the lane with its reasons and refusals, recording
nothing; `set --lane <low|medium|high> --reason "<why>"` records it (escalation is free, a
downgrade needs `--force`); `status` says whether the current contract digest is approved for
its lane, directly or through a chain of applied amendments, and exits 1 while it is not.
A change with no recorded lane is undeclared and keeps working exactly as it did.

Order matters once: `spec baseline <name>` writes `spec-base.json`, which is part of the
contract, so capture the baseline **before** the reviews. Capturing it afterwards moves the
digest out from under them and the lane falls back to unapproved.

## review record <name> --file <json>

One immutable review record with the contract digest it reviewed, kept under
`changes/<name>/reviews/R-<id>/` beside a snapshot of that text. A review names both the
reviewer and the writer, and is marked independent only when they differ.

## finding record|resolve|status <name>

A repeated root cause. Two materially different failed approaches make the next attempt wait
for a design review; `record` writes the blocker under the tasks the cause defeated and exits
1, leaving every independent task runnable and every ticked box ticked. `resolve` needs the
architect, planner or critic review that chose the remedy.

## amend propose|apply|cancel|status <name>

A staged change to the approved contract. `propose` records the old and candidate text with
their digests and holds the affected tasks; `apply` publishes it once the authority its type
requires is on record (`locator`: executor authority, `equivalent-check`: an independent
critic OKAY, `scope`: explicit user authority plus the new lane's review) and reopens the
affected boxes with their evidence links dropped; `cancel` releases the hold and restores
nothing. The manifest is never an amendment target: a risk lane change needs fresh review.

## evidence begin|record|cancel|status <name>

A verification attempt bound to exact inputs. `begin` captures the implementation inventory and
the contract, reserves the next attempt number durably, and refuses while an amendment is
pending or the lane has not approved the contract. `record` stores an immutable result and
report. `status` reports the durable head and whether it makes the change archivable.

## context <name> [--task T-01] [--since <digest>]

The derived context packet, written to `.my-flow/context/` and never to the change. It carries
the constraints and the complete criteria index in full, plus the selected task with its
prerequisite closure, the blocks it references, hashed file locators and open findings. Without
`--task` it is the final verifier's packet. `--since` compares the previous packet's inputs, not
timestamps, and reports what changed.

## usage <name> | usage import <name> --file <json>

Measured usage keyed by the source event id, imported once and never re-counted. A field the
source did not report stays unknown; totals with an unknown in them are reported as unknown,
self-scoped and inclusive records are never added together, and cached input tokens are a
subset of the input tokens rather than an addition. No price, no quota, no estimate.
`--compare <a,b> [--risk low|medium|high]` adds a comparison against other changes that names
its sample and everything absent from it, and states no saving.

## session new|show|release|recover <key>

The session lease that keeps two sessions in one repository from claiming the same change.

## stage <name> <stage>

Writes `.my-flow/state/current-change.json` as `{change, stage, updated}` with a fresh
timestamp. Stages: `new`, `interview`, `mf-plan`, `execute`, `done`, `archived`. The change
must exist (`changes/<name>/` or `docs/changes/<name>.md`); `--force` overrides. Always use
this instead of editing the file by hand: the Stop hook's execute-guard only fires while
`stage` is `execute` and `updated` is younger than 12 hours (`MY_FLOW_EXECUTE_GUARD_TTL_HOURS`),
so $my-flow-execute re-runs `stage <name> execute` after each ticked task and
`stage <name> done` after the final gate.
