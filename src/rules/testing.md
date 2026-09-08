# Testing (my-flow default)

- Every task in `tasks.md` names its own verification; run it before ticking the box.
- Test the behavior the spec scenario describes (WHEN / THEN), not the implementation.
- Cover the edge that made you nervous: empty input, boundary values, error paths.
- Tests are independent: no shared mutable state, no order dependence.
- `test.skip` / `.only` and stub assertions are blockers, never a way to get green.
- A test you did not run is not evidence. Quote fresh output.

## Project-specific testing

<!-- Test framework, fixtures, how to run a single test, slow-suite policy. -->
