## ADDED Requirements

### Requirement: Context packets are selective and versioned

Context packets SHALL be derived from current authoritative artifacts and contain global
constraints, complete acceptance index, relevant dependency closure and source digests. Repeated
reviews SHALL receive changed blocks and unresolved findings with access to original sources.
The final verifier SHALL receive all required criteria and run fresh independent checks.

#### Scenario: A narrow task receives its dependencies
- **WHEN** a packet is requested for a task with prerequisites and design references
- **THEN** it contains those blocks and full global constraints without duplicating unrelated prose

#### Scenario: Inputs changed since the previous review
- **WHEN** a packet's stored input digest no longer matches authoritative content
- **THEN** stale material is identified and regenerated before reuse

### Requirement: Usage accounting preserves unknowns and excludes double counting

Usage records SHALL identify change, stage, attempt, actor and measurement source. Failed and
abandoned attempts SHALL be included. Unavailable metrics SHALL remain unknown. Inclusive parent
usage SHALL NOT be summed again with children; cached input is a subset of input. No quota or
character count SHALL be presented as measured task token consumption.

#### Scenario: A parent includes its children's tokens
- **WHEN** imported records contain inclusive parent usage and child usage
- **THEN** reports separate scopes and do not add both into the same total

#### Scenario: Usage is unavailable
- **WHEN** a host exposes no task metrics
- **THEN** fields remain unknown and no token-saving percentage is inferred
