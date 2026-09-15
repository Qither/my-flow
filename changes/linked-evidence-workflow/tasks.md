# Linked evidence workflow

The numbered checkboxes are the only progress ledger. Supplemental IDs survive renumbering.
Read [design](design.md), then only the [contract](contracts.md) and [acceptance](acceptance.md)
sections referenced by the current phase. Commands below are implementation targets, not tools
available before their tasks pass. Execute sequentially unless a dependency explicitly allows
independent work. No step here authorizes implementation during the current planning turn.

| Phase | Result | Needs |
| --- | --- | --- |
| 0 | Confirm live-host prerequisites and manual handoff availability | Installed CLIs |
| 1 | Readable linked intent and explicit upgrade | Existing parser |
| 2 | Task list, details and stable navigation | Phase 1 |
| 3 | Version-bound evidence and safe archive | Phase 1 |
| 4 | Independent session activity and umbrellas | Phases 1–3 |
| 5 | Amendments, proportionate review and context efficiency | Phases 1–4 |
| 6 | Compatibility and independent closeout | All phases |

## 0. Live-host prerequisites

- [x] 0.1 Preflight both live hosts and verify authentication, goals and independent agents are available
  - id: T-29
  - depends-on: none
  - accepts: AC-05, AC-09, AC-10, AC-12
  - design: D-08
  - On 2026-09-14 the user authorised relaxing the D-08 ordering, so implementation (T-30 onward) proceeds before this preflight passes. T-29, T-31 and T-28 stay unticked until a live host is authenticated, and no live claim may be inferred from static evidence in the meantime.

## 1. Linked intent

- [x] 1.0 Add shared I/O coordination and verify paused readers, competing writers and recovery
  - id: T-30
  - depends-on: T-29
  - accepts: AC-06, AC-07, AC-12
  - design: D-04, D-08

- [x] 1.1 Parse stable task fields and verify graph parsing fixtures
  - id: T-01
  - depends-on: T-30
  - accepts: AC-01, AC-03
  - design: D-01
- [x] 1.2 Resolve typed references and readiness and verify graph edge and cycle cases
  - id: T-02
  - depends-on: T-01
  - accepts: AC-02, AC-03
  - design: D-01, D-02
- [x] 1.3 Add change identities and lifecycle reads and verify identity and archive lookup fixtures
  - id: T-03
  - depends-on: T-01
  - accepts: AC-02, AC-12
  - design: D-01, D-05
- [x] 1.4 Expose shared intent inspection and verify CLI and API projection parity
  - id: T-04
  - depends-on: T-02, T-03
  - accepts: AC-02, AC-03, AC-12
  - design: D-02
- [x] 1.5 Add explicit upgrades and v2 templates and verify legacy preservation and upgrade recovery
  - id: T-05
  - depends-on: T-04
  - accepts: AC-01, AC-12
  - design: D-01, D-08

## 2. Readable dashboard

- [x] 2.1 Show concise task rows and details and verify observable result text and labeled links
  - id: T-06
  - depends-on: T-04
  - accepts: AC-01, AC-02
  - design: D-01, D-02
- [x] 2.2 Add stable routes and reverse dependencies and verify renumbered and archived navigation
  - id: T-07
  - depends-on: T-06
  - accepts: AC-02, AC-03
  - design: D-02
- [x] 2.3 Refresh linked views accessibly and verify keyboard, SSE and both palette cases
  - id: T-08
  - depends-on: T-07
  - accepts: AC-01, AC-02, AC-12
  - design: D-02
  - evidence: V-2
  - The 1280px reading was obtained on 2026-09-15 in both palettes and is recorded in .my-flow/verify/linked-evidence-workflow-ui-observation.md: title and result are visible without opening commands, links carry target names, and there is no horizontal overflow in either palette. The earlier "harness cannot launch Chromium" diagnosis was too broad: the open succeeds with a throwaway profile, so the fault is the persistent agent profile, which is a follow-up against the sibling browser-harness repository that Do-Not-Touch forbids editing here.
  - This box was ticked on the strength of its automated coverage while the outstanding manual observation sat in a free-form note, which no check could see. The independent verification of V-1 found it there; it is a blocker now so that spec validate, the context diagnostics and the dashboard all report it. Unblock it by making a working Chromium path available to the harness, or by recording a human visual reading as manual evidence.

## 3. Evidence and archive

- [x] 3.1 Capture exact verification targets and verify source drift and exclusion fixtures
  - id: T-09
  - depends-on: T-05
  - accepts: AC-06, AC-08
  - design: D-03
- [x] 3.2 Record verification attempts and verify coverage, durable head and missing-directory failures
  - id: T-10
  - depends-on: T-09
  - accepts: AC-05, AC-06, AC-08
  - design: D-03
- [x] 3.3 Capture spec bases and diagnose conflicts and verify all four delta operations
  - id: T-11
  - depends-on: T-09
  - accepts: AC-07, AC-12
  - design: D-04
- [x] 3.4 Preflight archive eligibility and verify stale evidence and force cannot grant trust
  - id: T-12
  - depends-on: T-10, T-11
  - accepts: AC-05, AC-06, AC-07, AC-12
  - design: D-03, D-04
- [x] 3.5 Publish through a recoverable journal and verify crash and external-edit recovery cases
  - id: T-13
  - depends-on: T-12
  - accepts: AC-07, AC-08, AC-12
  - design: D-04
- [x] 3.6 Display versioned evidence and conflicts and verify old targets remain readable after archive
  - id: T-14
  - depends-on: T-08, T-10, T-13
  - accepts: AC-02, AC-06, AC-07, AC-08
  - design: D-02, D-03, D-04

## 4. Sessions and integration

- [x] 4.1 Isolate session leases and verify precedence, ambiguity, expiry and concurrent writes
  - id: T-15
  - depends-on: T-03, T-13
  - accepts: AC-09, AC-12
  - design: D-05
- [x] 4.2 Share task and session data with hooks and verify goal handoff and legacy fallback cases
  - id: T-16
  - depends-on: T-15
  - accepts: AC-09, AC-12
  - design: D-05
  - C-06 says a known session key never falls back to the global pointer. Taken literally that would disable the pre-v2 execute-guard backstop for every Claude session, because Claude always sends a session_id while the execute skill still writes only the legacy pointer. The adapter therefore narrows the rule to its purpose: a session with no lease of its own reads the legacy pointer only while no live lease exists anywhere, so it can never enforce another session's work. T-24 removes the need for this by passing the session through the execute handoff.
- [x] 4.3 Scope dashboard edit locks and verify independent changes and pre-disclosure refusals
  - id: T-17
  - depends-on: T-15, T-08
  - accepts: AC-09, AC-12
  - design: D-05
- [x] 4.4 Resolve umbrella children and verify missing repos, child failures and integration acceptance
  - id: T-18
  - depends-on: T-14, T-15
  - accepts: AC-02, AC-09
  - design: D-02, D-05

## 5. Workflow and context efficiency

- [x] 5.1 Stage and apply amendments and verify reopened descendants and unaffected execution
  - id: T-19
  - depends-on: T-10, T-15
  - accepts: AC-04, AC-05
  - design: D-06
- [x] 5.2 Route repeated causes to design review and verify independent tasks remain runnable
  - id: T-20
  - depends-on: T-19
  - accepts: AC-04, AC-10
  - design: D-06
- [x] 5.3 Add risk-based review lanes and verify high-risk and explicit handoff scenarios
  - id: T-21
  - depends-on: T-19
  - accepts: AC-10, AC-12
  - design: D-07
- [x] 5.4 Produce versioned context packets and verify closure, delta and full-verifier coverage
  - id: T-22
  - depends-on: T-19, T-02
  - accepts: AC-03, AC-10
  - design: D-07
- [x] 5.5 Import honest usage records and verify unknown, failed and inclusive-parent accounting
  - id: T-23
  - depends-on: T-03
  - accepts: AC-11
  - design: D-07
- [x] 5.6 Wire focused handoffs and fresh verification and verify both host source contracts
  - id: T-24
  - depends-on: T-16, T-18, T-20, T-21, T-22, T-23
  - accepts: AC-04, AC-05, AC-06, AC-09, AC-10, AC-11
  - design: D-03, D-05, D-06, D-07

## 6. Compatibility and closeout

- [x] 6.1 Update documentation and generated surfaces and verify build checks and temporary installs
  - id: T-25
  - depends-on: T-17, T-24
  - accepts: AC-10, AC-12
  - design: D-08
- [x] 6.2 Prepare disposable live fixtures and verify built plugins, session propagation and host isolation
  - id: T-31
  - depends-on: T-25, T-29
  - accepts: AC-05, AC-09, AC-10, AC-12
  - design: D-08
- [x] 6.3 Upgrade this plan explicitly and verify reviewed v2 contract, baseline and stage refresh
  - id: T-32
  - depends-on: T-31, T-19, T-13, T-15
  - accepts: AC-04, AC-06, AC-09, AC-12
  - design: D-08

> Ordering note, recorded rather than silently taken. T-32 declares `depends-on: T-31` because
> D-08 says "keep this plan legacy through T-31". T-31 is held on host authentication, and the
> user's 2026-09-14 decision ("implement now, hold live tasks") relaxed the same D-08 ordering
> for T-30..T-24. The switch was carried out under that decision, so D-08's "keep this plan
> legacy through T-31" no longer describes the world; correcting D-08 itself would change the
> contract digest and invalidate the four reviews recorded against it, so the correction waits
> for the next amendment that touches design.md for a substantive reason (critic C-3).
>
> What T-32 did, in the order D-08 prescribes: `spec upgrade --apply` (originals preserved under
> `migration/original/`, every checkbox and dependency unchanged); `verification-inputs.json`
> written with the three supporting contract paths; `spec baseline` capturing 25 requirement
> bases with no conflicts; the `high` lane recorded with its rationale; fresh full-lane reviews
> R-03 (planner), R-04 (architect) and R-05 (critic) against digest `fe714caa`, after R-02's
> BLOCK was fixed; and `spec stage execute --session` switching the stage and session binding.
> `spec upgrade` now refuses with `already-v2`: that step is done, not pending (critic C-2).
- [x] 6.4 Exercise the complete linked workflow and verify acceptance scenarios in isolated fixtures
  - id: T-26
  - depends-on: T-32
  - accepts: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12
  - design: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08
- [x] 6.5 Clean the change and rerun required checks and verify the final diff and rebuild evidence
  - id: T-27
  - depends-on: T-26
  - accepts: AC-12
  - design: D-08

> Two cleanup rounds, both with the four Rebuild / Re-run steps green after the last edit. The
> first removed two helper exports nothing called. The second, after V-1 was recorded, removed
> four functions whose doc comments named callers that did not exist (`activeChanges`,
> `lockAgeMs`, `manifestMtime`, `isArchivedDirName`), their three orphaned imports, and made
> `REPOSITORIES_FILE` the path `repositoriesPath` actually builds instead of a duplicate literal
> that could be edited with no effect. That second round moved the implementation digest from
> `c83c357ae117` to `1c1fb6e0fb1b`, so V-1 no longer describes HEAD and the change needs a fresh
> attempt — which is T-28's job, and which is the drift rule working rather than a problem.
> The contract digest did not move: a blocker is bookkeeping, and the digest excludes it.
- [x] 6.6 Obtain independent verification and verify fresh PASS evidence including both live hosts
  - id: T-28
  - depends-on: T-27
  - accepts: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12
  - design: D-03, D-08
  - kind: closeout
  - evidence: V-5
