## ADDED Requirements

### Requirement: Session bindings are separate from change lifecycle

V2 lifecycle SHALL be durable per change; session activity SHALL use separate expiring scratch
leases. Explicit session identity SHALL take precedence over compatibility fallbacks. A known
unbound session SHALL NOT inherit another session's current change. Ambiguous unidentified
sessions SHALL be diagnosed instead of overwriting a binding. Goal semantics SHALL remain intact.

#### Scenario: Two sessions operate independently
- **WHEN** two session identities bind different changes and one refreshes its lease
- **THEN** the other binding and lifecycle are unchanged

#### Scenario: Scratch is lost
- **WHEN** session scratch files disappear
- **THEN** durable lifecycle and evidence remain readable and no live session lease is invented

#### Scenario: A candidate amendment is pending
- **WHEN** the existing session refreshes its execute lease while an unrelated task runs on approved text
- **THEN** the lease refresh succeeds without approving or publishing the pending candidate

### Requirement: Umbrella integration is independent of child completion

Umbrellas SHALL store child identities and prerequisites, derive current child states and
preserve separate integration criteria. Unavailable external repositories SHALL remain unresolved.
Completed children SHALL NOT automatically complete umbrella tasks or integration acceptance.

#### Scenario: Children finish but integration fails
- **WHEN** all children are complete but the combined-system check fails
- **THEN** the umbrella cannot pass verification or verified archive

#### Scenario: An external child cannot be resolved
- **WHEN** a child references an unavailable configured repository alias
- **THEN** reading identifies it as unresolved and integration verification remains incomplete
