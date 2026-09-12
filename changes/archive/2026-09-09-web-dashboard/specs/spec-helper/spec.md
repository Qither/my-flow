# spec-helper Specification (delta)

## ADDED Requirements

### Requirement: Shared status and validate library

The status and validate logic SHALL live in a library module under `scripts/lib/`, consumed by
both `scripts/spec.mjs` and any other in-process caller such as the dashboard server, so that a
single definition produces both surfaces. The library SHALL be usable inside a long-lived
process: every function SHALL take the project root as an explicit argument, SHALL NOT read
`process.argv`, SHALL NOT call `process.exit`, and SHALL NOT retain state between calls, so that
two calls separated by an edit on disk return different results. The status and validate entry
points SHALL each return both the JSON value and the exact text the CLI prints, from one code
path, so the two renderings cannot diverge. The observable behavior of `spec status` and
`spec validate` SHALL be unchanged: identical text, identical JSON, identical exit codes.

#### Scenario: The CLI output is unchanged by the extraction
- **WHEN** `spec status`, `spec status --json`, `spec validate` and `spec validate --json` are
  run against a project before and after the logic moves into the library
- **THEN** each pair of outputs is byte-identical and each pair of exit codes is equal, and the
  pre-existing test suite passes without modification

#### Scenario: A second caller gets the same values as the CLI
- **WHEN** an in-process caller invokes the library's status entry point for a project root and
  `spec status --json` is run against the same root
- **THEN** the library's JSON value and the parsed CLI output are deeply equal

#### Scenario: Repeated calls in one process see fresh state
- **WHEN** the library's status entry point is called, a delta spec is then added on disk that
  creates an overlap with another active change, and the entry point is called again in the same
  process
- **THEN** the second call reports the new overlap warning, because the overlap index is
  computed per call rather than cached for the life of the process

#### Scenario: The library never terminates its caller
- **WHEN** the library is called for a project whose `changes/` directory is missing, or for a
  change name that does not exist
- **THEN** it returns a value describing that situation and the calling process stays alive,
  rather than exiting or throwing
