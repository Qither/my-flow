## Context

`source/left.mjs:1` exports `const label = 'Left pending'` and `source/right.mjs:1` exports
`const label = 'Right pending'`. The fixed acceptance test `test/medium.test.mjs:5-6` asserts
those exports equal `'Left ready'` and `'Right ready'`, so the suite fails today. A grep over
the workspace shows `test/medium.test.mjs:3-4` is the only importer of either module, so no
CLI or other consumer observes these strings (`cli.mjs:1` is unrelated and untouched).

### D-01 — Fixture boundary

Only these two source modules may change. Preserve both fixed acceptance checks. This is a
reversible two-module change without a public API, build, auth or migration change.

## Goals / Non-Goals

Goals:

- `source/left.mjs` exports `label === 'Left ready'`.
- `source/right.mjs` exports `label === 'Right ready'`.
- `node --test test/medium.test.mjs` passes both cases with no skipped or filtered test.

Non-Goals:

- No change to the candidate plugin, host configuration, other fixture changes, or any file
  outside this workspace.
- No change to `test/medium.test.mjs` — the acceptance assertions are fixed and the
  implementation moves to meet them, never the reverse.
- No refactor of the module shape: the export stays a single named `label` string constant.

## Decisions

### D-02 — Edit the string literal in place

Each module is a one-line named export. Replace only the string literal, keeping the
`export const label = '...'` form at `source/left.mjs:1` and `source/right.mjs:1`. Rejected
alternative: introducing a shared constants module, which would add a file the proposal's
decision boundary forbids and change the import graph the test depends on.

### D-03 — Both modules land in one task

`test/medium.test.mjs` is a single acceptance command covering both exports, so splitting the
edit into two tasks would leave the first one unverifiable on its own. T-01 edits both files
and is verified by the one command in AC-01.

## Risks / Trade-offs

- Typo or casing drift in the literal (`Left Ready` vs `Left ready`) would pass a human read
  but fail the assertion. Mitigated because AC-01 is an exact `assert.equal` on both strings.
- Editing the wrong module (left value into right) still leaves a one-line diff that looks
  plausible; AC-01 asserts both sides separately, so a swap fails.
- The change is fully reversible: `git checkout -- source/left.mjs source/right.mjs` restores
  both literals.

## Do-Not-Touch

Candidate plugin, test files (`test/`), other changes under `changes/`, host homes and all
files outside this workspace. `cli.mjs`, `scripts/` and `source/a.mjs`, `source/b.mjs`,
`source/c.mjs`, `source/answer.mjs` are outside this change.

## Rebuild / Re-run After Change

- `node --test test/medium.test.mjs` — this change's fixed acceptance check. No build, cook
  or cache step exists in this workspace.
