# specs/ and changes/ - the intent layer

This layout borrows OpenSpec's structure without depending on any tool. my-flow's `spec`
helper (`new / status / validate / abandon / archive / stage`) handles the mechanics, and a
change that has been upgraded to linked intent adds `inspect / lane / review / finding / amend /
evidence / baseline / conflicts / context / usage / session / recover` on top of them.

```
specs/<capability>/spec.md               current truth: requirements + scenarios
changes/<name>/proposal.md               why, what, non-goals, decision boundaries
changes/<name>/design.md                 how; MUST contain "## Do-Not-Touch" and
                                         "## Rebuild / Re-run After Change"
changes/<name>/tasks.md                  ordered checklist; the ONLY progress ledger
changes/<name>/specs/<capability>/spec.md  delta: ## ADDED | MODIFIED | REMOVED Requirements
changes/archive/<YYYY-MM-DD>-<name>/     archived changes (deltas merged into specs/)
changes/archive/<YYYY-MM-DD>-<name>-abandoned/  abandoned changes (deltas never merged)
changes/.templates/                      templates used by `spec new`
```

After `spec upgrade <name> --apply`, that change also has:

```
changes/<name>/acceptance.md             ### AC-01 criteria: evidence-mode, required, checks
changes/<name>/change.json               stable UUID, lifecycle metadata, recorded review lane
changes/<name>/reviews/ findings/ amendments/ verify/ usage/   immutable records, one per event
```

and its tasks carry indented `id`, `depends-on`, `accepts`, `design` and `evidence` fields, so
the order comes from the declared dependencies rather than from the numbering. The upgrade is
explicit and one-way per change: a change you never upgrade keeps working exactly as before,
and archived changes are never rewritten.

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

`interview` writes proposal.md -> `mf-plan` writes design.md + tasks.md (+ delta specs) ->
`execute` ticks tasks -> `mf-verify` produces a PASS report -> `spec archive <name>` merges the
deltas into `specs/` and moves the change to `changes/archive/`. A change that will not be
finished leaves through `spec abandon <name> --reason "..."` instead: it lands in
`changes/archive/<date>-<name>-abandoned/` and nothing is merged.

## Provenance and upkeep

Every requirement `spec archive` adds or replaces gets one line directly under its heading,
`<!-- via: <YYYY-MM-DD>-<name> -->`, pointing at the archived change that produced it. `spec status`
marks unfinished changes nobody has touched for 14 days as `[stale Nd]`, warns when two active
changes carry a delta for the same requirement, and suggests `mf-audit <capability>` after five
merges into a capability. A clean audit is recorded with `spec new audit-<cap>` followed by
`spec abandon audit-<cap> --reason "audit clean, no findings"`.
