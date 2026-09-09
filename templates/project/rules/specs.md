---
paths:
  - "specs/**"
  - "changes/**"
---

# Intent files (specs/ and changes/)

- `changes/<name>/proposal.md`: Why, What Changes, Non-Goals, Decision Boundaries,
  Capabilities, Impact, Success Criteria. Motivation only; no implementation detail.
- `changes/<name>/design.md` must contain `## Do-Not-Touch` and `## Rebuild / Re-run After Change`,
  each filled in or explicitly "none, because ...". Add `## File Ownership` only when a team
  will execute the change.
- `changes/<name>/tasks.md` lines are strictly `- [ ] N.M <task> and verify <observable check>`.
  Tick a box only after that task's verification passed. No prose progress notes elsewhere.
- Spec files use `### Requirement:` with at least one `#### Scenario:` (exactly four hashes)
  containing `- **WHEN**` / `- **THEN**` lines. Delta specs under `changes/<name>/specs/` use
  `## ADDED|MODIFIED|REMOVED Requirements`; MODIFIED carries the full requirement block.
- Never edit files under `changes/archive/`. `specs/` changes only through `spec archive`;
  abandoned changes (`spec abandon`, archived as `<date>-<name>-abandoned/`) never merge.
  Keep the `<!-- via: ... -->` line under each requirement; `spec archive` maintains it.
