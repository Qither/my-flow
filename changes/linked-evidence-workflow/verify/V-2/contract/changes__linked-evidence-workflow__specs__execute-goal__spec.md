## MODIFIED Requirements

### Requirement: Execute-guard is armed when the task loop starts

Execute SHALL bind/refresh its resolved session with `spec stage <name> execute` only as the
task loop starts after the existing goal handoff, not while loading or waiting for the user.
The same session SHALL be refreshed after each verified task tick and released at done. Session
identity SHALL follow shared resolution rules; explicit legacy/simple fallback remains supported.
Goal creation, one-goal authority and Stop-hook goal-line exemption SHALL remain unchanged.

#### Scenario: Waiting does not arm activity
- **WHEN** execute has printed a required goal handoff and has not received the response
- **THEN** no new execute lease is written and prior lifecycle remains visible

#### Scenario: Task progress refreshes the correct session
- **WHEN** session A verifies and ticks a task while session B works elsewhere
- **THEN** A's lease is refreshed and B's binding remains unchanged

#### Scenario: The goal handoff remains exempt
- **WHEN** the final assistant message contains the execute goal handoff line
- **THEN** the completion hook does not treat the quoted goal as a completion claim
