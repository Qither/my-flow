## Why

Exercise reviewed equivalent-check amendments with A -> B and independent C. The implementation is already correct; preserve each readiness guarantee.

## What Changes

Exercise reviewed equivalent-check amendments with A -> B and independent C. The implementation is already correct; preserve each readiness guarantee.

## Non-Goals

No changes to the candidate plugin, host configuration, other fixture changes, or external files.

## Decision Boundaries

Replace only A's verification command with node scripts/check-a.mjs through a staged equivalent-check amendment. While review is pending, hold A/B and continue only C. Request design review after the two supplied F-1 failures before a third patch.
