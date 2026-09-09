---
name: my-flow-mf-audit
description: "Read-only audit of one capability spec (or all) against the code and tests - finds requirements with no implementation, behavior with no requirement, contradictions, and misplaced requirements; writes a report and hands the findings to a new change. Use when spec status suggests an audit, or when the user says \"audit the spec\"."
argument-hint: "<capability | all>"
---

# mf-audit (spec audit)

`specs/<capability>/spec.md` is the current truth, and nothing re-checks it against the code.
This skill does that check, read-only, and feeds the result back into the normal change flow.
It never edits `specs/` or `changes/archive/`; its only output is a report.

Input: {{ARGUMENTS}}

## Steps

1. Resolve the argument against the directories under `specs/` in the working directory: one
   capability, or `all` for every one of them. Stop with a message when `specs/` is missing or
   the named capability has no directory; never audit nothing silently.
2. Build the inventory from `specs/<cap>/spec.md`: every `### Requirement:` name, its
   `<!-- via: <date>-<change> -->` marker when present (the pointer back to the proposal under
   `changes/archive/<date>-<change>/`), and its scenario names.
3. Delegate the judgment, one capability per agent run, to the read-only `architect` role.
   Pass the spec path, the inventory, and the source and test roots of the project.

   The delegation prompt must override the role's loop, not only its output. State explicitly:
   "For this run there is no change, no `proposal.md`, and no `design.md`. Steps 1 and 2 of your
   loop are replaced by: read `specs/<cap>/spec.md` and, for each requirement in the inventory,
   open the source and test files that would implement it. The report template below replaces
   your output block in full, including its `## Verdict:` line. Everything else in your contract
   still applies: never judge code you have not opened, cite `path:line` for every claim,
   separate root cause from symptom, edit no file."

   Spawn the native `architect` subagent. Remind it that it must not edit files.

4. Write the returned report to `.my-flow/verify/audit-<cap>-<timestamp>.md` from this
   context (the role cannot write). Before writing, scan the returned text for any line
   matching `Verdict:`. If one is present the role fell back to its default output block:
   rewrite that line to the `### Status:` form, or send the report back for one correction
   round. The written file must contain no such line. This is what keeps an audit report from
   ever satisfying the PASS gate that `spec archive` applies to files under `.my-flow/verify/`.
5. Relay the status line, the count per section, and the suggested change name. Then:
   - DRIFT or BROKEN: the next step is `spec new <suggested-name>`, then `mf-plan` with
     REMOVED / MODIFIED / RENAMED deltas, then `execute`, `mf-verify`, and `spec archive`.
   - CLEAN: there is nothing to fix, but the audit must still be recorded or the
     `audit suggested` nudge in `spec status` fires forever. Recommend exactly:
     ```
     spec new audit-<cap>
     spec abandon audit-<cap> --reason "audit clean, no findings"
     ```
     The abandoned directory `changes/archive/<date>-audit-<cap>-abandoned/` is the record
     that an audit happened; it merges nothing and touches no spec.

## Report format

```
## Spec Audit: <capability>
### Status: CLEAN | DRIFT | BROKEN
### Inventory (requirement | via | evidence path:line)
### Unimplemented requirements
### Undocumented behavior (code or tests with no requirement)
### Contradictions
### Misplaced requirements (belongs in <capability>)
### Suggested change: <kebab-case-name>
```

`CLEAN`: every requirement traces to code and tests and the other sections are empty.
`DRIFT`: findings exist but the code still does what the spec says where they overlap.
`BROKEN`: a requirement's scenario is contradicted by the code or by another requirement.

## Hard rules

- Never edit anything under `specs/` or `changes/archive/`. Fixes go through a change:
  `spec new` -> `mf-plan` -> `execute` -> `mf-verify` -> `spec archive`.
- The suggested change name must end in `audit-<cap>` (for example `trim-audit-spec-helper`),
  so that archiving or abandoning it clears the audit nudge in `spec status`.
- `### Status:` is the only status line the report carries; a line of the form the step 4 scan
  rejects is never written to disk.
- Every finding cites the files that were opened, by `path:line`. A requirement is
  "unimplemented" only after the source and test files it would touch were actually read.
