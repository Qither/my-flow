# specs/ and changes/ - the intent layer

This layout borrows OpenSpec's structure without depending on any tool. my-flow's `spec`
helper (`new / status / validate / archive`) handles the mechanics.

```
specs/<capability>/spec.md               current truth: requirements + scenarios
changes/<name>/proposal.md               why, what, non-goals, decision boundaries
changes/<name>/design.md                 how; MUST contain "## Do-Not-Touch" and
                                         "## Rebuild / Re-run After Change"
changes/<name>/tasks.md                  ordered checklist; the ONLY progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<YYYY-MM-DD>-<name>/     archived changes (deltas merged into specs/)
changes/.templates/                      templates used by `spec new`
```

## Spec format

```markdown
# <capability> Specification

## Purpose
One paragraph on what this capability covers.

## Requirements

### Requirement: <name>
The system SHALL ... (use SHALL / MUST for normative statements)

#### Scenario: <name>
- **WHEN** <condition>
- **THEN** <expected outcome>
```

Rules: every requirement has at least one scenario; scenarios use exactly four hashes;
delta files put full requirement blocks under `## ADDED Requirements` (new),
`## MODIFIED Requirements` (full replacement block), or `## REMOVED Requirements`
(name only, with a `**Reason**`). Write specs only for behavior a change adds or modifies
(delta-first); `specs/` fills in as changes are archived.

## Lifecycle

`interview` writes proposal.md -> `plan` writes design.md + tasks.md (+ delta specs) ->
`run` ticks tasks -> `verify` produces a PASS report -> `spec archive <name>` merges the
deltas into `specs/` and moves the change to `changes/archive/`.
