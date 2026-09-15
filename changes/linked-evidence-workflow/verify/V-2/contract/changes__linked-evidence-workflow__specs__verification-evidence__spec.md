## ADDED Requirements

### Requirement: Independent evidence is bound to immutable inputs

Each final verification attempt SHALL capture implementation, acceptance and required environment
inputs before an independent verifier runs checks. Its original report, coverage, provenance and
digests SHALL persist inside the change. Every required evidence mode SHALL be VERIFIED for
PASS. Imported history or writer self-tests SHALL NOT qualify as a fresh independent final pass.

#### Scenario: Static evidence cannot prove live behavior
- **WHEN** a required live criterion has only a static instruction-text check
- **THEN** the result is INCOMPLETE and cannot qualify for verified archive

#### Scenario: Writer drift invalidates the attempt
- **WHEN** included source or acceptance content changes during verification
- **THEN** the ending digest differs and the attempt cannot report an eligible PASS

### Requirement: Latest attempts and bookkeeping have distinct semantics

The latest reserved attempt SHALL control closeout eligibility through a durable monotonic
high-water/head record outside attempt directories. Reservation SHALL precede directory creation;
missing head metadata or a missing latest directory SHALL block older PASS fallback.
Bookkeeping-only changes SHALL NOT alter the verified target; report integrity and all required
task completion SHALL still be checked. Archived links SHALL expose the captured target text.

#### Scenario: A new failed attempt supersedes an older PASS
- **WHEN** an older attempt passed and the latest started attempt fails or has no result
- **THEN** archive refuses to reuse the older PASS

#### Scenario: Final bookkeeping preserves the target
- **WHEN** only report artifacts, final checkbox state, evidence links or archive location change
- **THEN** the implementation and acceptance digests remain equal and old captured text is readable

#### Scenario: The newest directory is entirely missing
- **WHEN** an attempt has been reserved and its directory is absent after interruption or deletion
- **THEN** its durable head still prevents reuse of every older PASS
