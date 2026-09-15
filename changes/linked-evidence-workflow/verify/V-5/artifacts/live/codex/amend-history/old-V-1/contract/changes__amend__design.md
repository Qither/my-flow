## Context

Exercise reviewed equivalent-check amendments with A -> B and independent C. The implementation is already correct; preserve each readiness guarantee.

### D-01 — Fixture boundary

Replace only A's verification command with node scripts/check-a.mjs through a staged equivalent-check amendment. While review is pending, hold A/B and continue only C. Request design review after the two supplied F-1 failures before a third patch.

## Do-Not-Touch

Candidate plugin, test files, other changes, host homes and all files outside this workspace.

## Rebuild / Re-run After Change

Run this change's fixed acceptance checks.
