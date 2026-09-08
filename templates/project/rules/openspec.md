---
paths:
  - "openspec/**"
---

# OpenSpec change files

- `proposal.md`: Why, What Changes, Non-Goals, Decision Boundaries, Capabilities, Impact,
  Success Criteria. Motivation only; no implementation detail.
- `design.md` must contain `## Do-Not-Touch` and `## Rebuild / Re-run After Change`, each
  filled in or explicitly "none, because ...". Add `## File Ownership` only when a team will
  execute the change.
- `tasks.md` lines are strictly `- [ ] N.M <task> and verify <observable check>`. Tick a box
  only after that task's verification passed. Do not add prose progress notes elsewhere.
- Spec files use `### Requirement:` with at least one `#### Scenario:` (exactly four hashes)
  containing `- **WHEN**` / `- **THEN**` lines. Delta specs use
  `## ADDED|MODIFIED|REMOVED Requirements`; MODIFIED carries the full requirement block.
- Never edit files under `openspec/changes/archive/`.
