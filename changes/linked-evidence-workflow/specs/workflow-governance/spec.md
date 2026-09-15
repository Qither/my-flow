## ADDED Requirements

### Requirement: Amendments preserve authority and affected scope

Plan amendments SHALL retain original and revised contracts, rationale, evidence, affected IDs
and review authority. Equivalent check changes SHALL receive independent review; changing
guarantees SHALL require a scope decision within the user's authorization. Unreviewed changes
to canonical contract text SHALL invalidate approval. Pending candidates SHALL leave the approved
canonical contract executable for unaffected tasks and allow their existing lease refresh.
Propose/apply SHALL explicitly reopen affected checked tasks and descendants in tasks.md;
pending holds SHALL override incorrectly checked boxes. Only reviewed apply publishes candidate
semantics; cancel SHALL retain the original contract without restoring unchecked claims.

Approval eligibility SHALL accept direct current-digest lane review or a valid applied-amendment
chain from an eligible base. Each link SHALL bind exact old/new digests and required authority.
Authorized locator/equivalent links MAY inherit the base's unaffected design approval; changed
risk or trust boundary SHALL require fresh full review. Evidence still requires fresh checks.

#### Scenario: An equivalent check is corrected
- **WHEN** a documented unavailable command is replaced by an independently reviewed equivalent
- **THEN** the amendment preserves the guarantee and records which evidence must be refreshed

#### Scenario: An implementation cannot meet a guarantee
- **WHEN** the executor proposes removing that guarantee merely because checks fail
- **THEN** it remains required until an authorized scope decision and reviewed amendment exist

#### Scenario: A pending correction does not block independent work
- **WHEN** A and descendant B are held for candidate review while C is unrelated
- **THEN** A/B are unchecked and held, C may complete using approved text, and its lease refresh succeeds

#### Scenario: Apply preserves work completed during review
- **WHEN** C is checked after a candidate was proposed and the reviewed candidate is applied
- **THEN** C stays checked while affected A/B remain reopened under the new contract

#### Scenario: An equivalent correction inherits high-lane design approval
- **WHEN** an eligible high-lane base receives an authorized applied equivalent-check amendment
- **THEN** stage execute and evidence begin accept its exact new digest without repeating unaffected design review

#### Scenario: An amendment chain lacks authority
- **WHEN** a link has a mismatched predecessor digest or missing required reviewer/scope authority
- **THEN** both stage execute and evidence begin reject inherited approval

### Requirement: Repeated causes trigger design review

After two materially different approaches fail from the same identified cause, execution SHALL
pause the affected tasks and descendants and request design review before another local patch.
Only decisions beyond existing authorization SHALL be escalated to the user.

#### Scenario: Independent work remains possible
- **WHEN** repeated cause F-1 blocks A and dependent B while C is independent
- **THEN** A and B wait for review and C remains runnable
