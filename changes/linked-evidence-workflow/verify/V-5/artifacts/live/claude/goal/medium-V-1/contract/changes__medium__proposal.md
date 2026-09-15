## Why

The two label modules still show pending labels. `source/left.mjs:1` exports `'Left pending'`
and `source/right.mjs:1` exports `'Right pending'`, while the fixed acceptance test
`test/medium.test.mjs:5-6` requires `'Left ready'` and `'Right ready'`, so the suite fails.

## What Changes

Update `source/left.mjs` and `source/right.mjs` so their `label` exports are `Left ready` and
`Right ready`. Nothing else changes.

## Non-Goals

No changes to the candidate plugin, host configuration, other fixture changes, the test files,
or external files.

## Decision Boundaries

Only these two source modules may change. Preserve both fixed acceptance checks. This is a
reversible two-module change without a public API, build, auth or migration change.

## Success Criteria

`node --test test/medium.test.mjs` passes both cases (2 pass / 0 fail / 0 skipped), and the
diff touches only `source/left.mjs` and `source/right.mjs`.
