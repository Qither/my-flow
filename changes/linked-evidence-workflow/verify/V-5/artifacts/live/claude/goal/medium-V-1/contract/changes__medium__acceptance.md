### AC-01 — Both labels are ready

- evidence-mode: automated
- required: true
- checks: `node --test test/medium.test.mjs`

WHEN `node --test test/medium.test.mjs` runs from the workspace root,
THEN both cases pass: `label` from `source/left.mjs` equals `Left ready` and `label` from
`source/right.mjs` equals `Right ready`, with 2 passing tests and 0 failing, skipped or
todo tests.
