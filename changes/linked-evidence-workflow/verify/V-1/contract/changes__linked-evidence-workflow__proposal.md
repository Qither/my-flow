## Why

The September 12 audit and subsequent source inspection exposed unreadable task contracts,
implicit dependencies, acceptance amendments without an owner, non-durable verification reports
unbound to tested versions, and last-writer-wins spec merges. Repeated full-document reviews
amplify token costs. The existing dashboard presents files rather than tasks and relationships.

The user requests a modification plan covering the full discussion. English is preferred for
artifacts and interface copy. This turn is planning only.

## What Changes

1. Readable tasks with stable IDs, explicit prerequisites, acceptance links, design references,
   and evidence links; Markdown remains the durable intent and progress source.
2. Task-oriented dashboard: concise list, detail, labeled links, reverse dependencies,
   readiness/blocker explanations, and navigation that survives archive.
3. Controlled acceptance amendments, explicit evidence requirements, and repeated-root-cause
   escalation, while retaining independent verification.
4. Durable verification reports bound to acceptance and implementation snapshots, avoiding
   self-invalidation when a report or final checkbox is saved.
5. Archive preflight for structure, current evidence and spec bases; explicit conflicts and
   recoverable publication instead of silent partial merges.
6. Change lifecycle separate from session activity; umbrella relationships with derived child
   state and distinct integration acceptance.
7. Risk-based review intensity, focused handoffs, delta reviews, deterministic checks, concise
   outputs, and honest usage measurements that include failed attempts.
8. Adopt jj's stable-identity/concrete-version distinction and explicit conflicts in the core;
   document a separate later jj plugin phase. Core remains usable with Git alone.
9. Specify migration for legacy task files, reports, routes, CLI/API consumers and host surfaces.

## Non-Goals

- No implementation, deployment, commits, repository conversion or jj initialization in this turn.
- No mandatory jj dependency, database/service, replacement website or general-purpose VCS.
- No shell language embedded in Markdown; reference normal scripts and tests.
- No automatic weakening of requirements, inferred dependencies from numbering, PARTIAL-to-PASS
  conversion, or claiming old evidence proves changed behavior.
- No bulk rewriting of historical archives or deleting scratch evidence.
- No automatic execution of the audit's historical cleanup list. Sibling browser runtime defects
  and stagehand maintenance are separate follow-ups, with current relevance checked first.
- No invented token measurements, guaranteed savings percentage or model pricing changes.

## Decision Boundaries

The planner may choose concise schema/file names, task grouping, reference formats, implementation
modules and checks after reading the code. Preserve the dependency-free Node core and existing
visual style. Prefer derived indices over duplicate authority.

Ask the user one question at a time only when the answer changes the task breakdown: optional jj
scope, automatic planning-lane selection, legacy migration, or sibling implementation scope.
Routine implementation decisions within the accepted boundaries do not need repeated approval.

Evidence-equivalent verification corrections may be independently reviewed within unchanged
requirements. Lowering a guarantee or expanding user-visible commitments needs an explicit scope
decision. This planning exercise itself follows the existing full review protocol.

## Capabilities

### New Capabilities

- `linked-tasks`: stable IDs, typed references, dependency validation and readiness.
- `verification-evidence`: durable version-bound reports and explicit acceptance coverage.
- `workflow-governance`: amendments, repeated-root-cause escalation and proportionate reviews.
- `workflow-sessions`: session/change separation and umbrella integration relationships.
- `context-efficiency`: selective context, delta review and usage accounting.

### Modified Capabilities

- `spec-helper`: parsing, validation, links, archive preflight, conflicts and migration.
- `dashboard`: task views, stable navigation and session-aware editing.
- `mf-plan-fast`: reconcile user-only fast mode with the agreed risk-based policy.
- `execute-goal`: retain native goal semantics while replacing global state coupling.

## Impact

Primary code anchors: `scripts/spec.mjs`, `scripts/lib/intent.mjs`, `scripts/dashboard.mjs`,
`web/app.mjs`, `web/md.mjs`, `web/app.css`, `hooks/completion-guard.mjs`,
`hooks/session-context.mjs`, `src/core/core.md`, `src/skills/`, `src/agents/`,
`templates/change/`, and existing `test/*.test.mjs`. Regenerate host outputs from source.
Documentation edits must remain proportionate; new dependencies require an explicit decision.

Audit observations are dated September 12. Current browser HEAD `9b5d2fb` has committed and
archived the formerly active work; core HEAD `6a84be8` has archived the umbrella. Avoid obsolete
cleanup tasks. Relevant unresolved runtime defects can be listed as separate follow-ups.

## Success Criteria

- AC-01: Task action and observable completion condition are readable without opening technical
  commands or historical notes; details are available through labeled links.
- AC-02: Stable links survive renumbering, title edits and archive. Explicit prerequisites drive
  reverse links and readiness; undeclared dependencies remain unknown.
- AC-03: Duplicate IDs, missing references and dependency cycles produce actionable diagnostics.
- AC-04: Amendments preserve old/new versions, reasons and review authority; affected evidence
  is invalidated without forcing unrelated tasks back to the beginning.
- AC-05: Required criteria lacking sufficient evidence prevent PASS. Static instruction checks
  and live behavior checks declare different evidence requirements.
- AC-06: Reports survive archive and bind exact acceptance/implementation inputs. New failed or
  incomplete attempts and changed inputs prevent accidental reuse of old PASS reports.
- AC-07: Archive rejects stale spec bases and invalid structure before publishing changes;
  overlapping active proposals alone do not deadlock archive.
- AC-08: Saving evidence, ticking a verified meta-task, or archive relocation does not invalidate
  an otherwise unchanged verification target.
- AC-09: Sessions do not overwrite each other's execution context. Umbrellas derive child state
  and separately verify integration.
- AC-10: Handoffs use relevant versioned context; repeat reviews focus on changes and open
  findings. High-risk work retains independent design review and final verification.
- AC-11: Available usage is attributed to change/stage/attempt, including subagents and failed
  work. Missing usage remains unknown; savings require comparable measured evidence.
- AC-12: Legacy reading, migration, API compatibility and crash recovery are specified and
  tested. Historical reports never silently acquire new trust guarantees.

## User Decisions

- Q1: Core changes first; jj plugin is a later independent phase. Confirmed by the user.
- Q2: Automatic risk-based planning lane selection is allowed; high-risk work keeps full review. Confirmed by the user.

- Q3: Preserve historical archives; explicitly upgrade legacy active changes when resumed. Confirmed by the user.
- Q4: Browser runtime fixes and stagehand maintenance are separate follow-up changes; this delivery targets my-flow core. Confirmed by the user.
- Q5: Retain live verification on both Claude and Codex; preflight prerequisites before implementation and schedule necessary manual goal handoff steps. Confirmed by the user.
