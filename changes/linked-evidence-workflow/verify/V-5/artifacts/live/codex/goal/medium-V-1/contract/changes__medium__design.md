## Context

The two label modules still show pending labels. Update source/left.mjs and source/right.mjs to export Left ready and Right ready.

### D-01 — Fixture boundary

Only these two source modules may change. Preserve both fixed acceptance checks. This is a reversible two-module change without a public API, build, auth or migration change.

## Do-Not-Touch

Candidate plugin, test files, other changes, host homes and all files outside this workspace.

## Rebuild / Re-run After Change

Run this change's fixed acceptance checks.

## Goals / Non-Goals

Set both ready labels; preserve export names and fixed tests. No other behavior changes.

## Decisions

Review lane: medium. Main-context draft followed by an independent critic.
`source/left.mjs:1` exports 'Left pending'; `source/right.mjs:1` exports 'Right pending'.
Replace only those string values with 'Left ready' and 'Right ready'. Preserve named `label` exports.
`test/medium.test.mjs:5` and `test/medium.test.mjs:6` independently assert the exact values.
Run `node --test test/medium.test.mjs` after implementation; both tests must pass.

## Risks / Trade-offs

Changing only one label leaves one fixed check failing. Update both in T-01.
No dependencies, build steps or public CLI changes are involved.
