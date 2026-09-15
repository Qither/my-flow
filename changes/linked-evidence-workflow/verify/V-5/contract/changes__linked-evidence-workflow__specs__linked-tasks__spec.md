## ADDED Requirements

### Requirement: Stable task identities and typed relationships

V2 changes SHALL keep completion in Markdown checkboxes with stable task IDs independent of
title and numbering. Explicit prerequisites SHALL determine readiness and reverse edges.
Acceptance, design and evidence references SHALL resolve by type and change identity.
Missing dependency declarations SHALL remain unknown rather than inferred from sequence.

#### Scenario: Reordering preserves meaning
- **WHEN** tasks with stable IDs are renamed or renumbered
- **THEN** their dependency edges and typed links still reach the same tasks

#### Scenario: Legacy order does not invent a dependency
- **WHEN** a legacy task has no prerequisite declaration
- **THEN** its dependency state is unknown and ordinary Markdown remains readable

### Requirement: Graph diagnostics identify actionable locations

The shared parser SHALL reject duplicate IDs, unresolved required references, dependency cycles
and invalid v2 metadata with source locations. A changed disk input SHALL be reflected on the
next CLI or API read. Completion SHALL NOT be inferred from prerequisite completion.

#### Scenario: A fork joins only after both prerequisites
- **WHEN** task D explicitly depends on B and C and C is incomplete
- **THEN** D is waiting with C named, and B and C both show D as a successor

#### Scenario: A cycle is diagnosed
- **WHEN** A depends on B and B depends on A
- **THEN** validation identifies both task IDs and their source locations
