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

- [ ] 0.1 Preflight both live hosts and verify authentication, goals and independent agents are available
  - id: T-29
  - depends-on: none
  - accepts: AC-05, AC-09, AC-10, AC-12
  - design: D-08
  - blocked: both disposable host profiles are unauthenticated (Claude "Not logged in", Codex 401); L-01.4 goal and subagent evidence cannot be observed until the user logs in to the fixture CLAUDE_CONFIG_DIR and CODEX_HOME. Fixture, installer isolation, temporary feature enablement and the unchanged real-home fingerprint are recorded in .my-flow/verify/linked-evidence-workflow-preflight.md
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
  - Keyboard focus, live refresh and the palette contract are covered by automated checks. AC-01 also asks for a visual reading at 1280px and 390px in both palettes; the my-flow browser harness could not launch Chromium (no DevTools port), so that manual observation is still outstanding and must be obtained before the final verification.

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
- [ ] 6.2 Prepare disposable live fixtures and verify built plugins, session propagation and host isolation
  - id: T-31
  - depends-on: T-25, T-29
  - accepts: AC-05, AC-09, AC-10, AC-12
  - design: D-08
- [ ] 6.3 Upgrade this plan explicitly and verify reviewed v2 contract, baseline and stage refresh
  - id: T-32
  - depends-on: T-31, T-19, T-13, T-15
  - accepts: AC-04, AC-06, AC-09, AC-12
  - design: D-08
- [ ] 6.4 Exercise the complete linked workflow and verify acceptance scenarios in isolated fixtures
  - id: T-26
  - depends-on: T-32
  - accepts: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12
  - design: D-01, D-02, D-03, D-04, D-05, D-06, D-07, D-08
- [ ] 6.5 Clean the change and rerun required checks and verify the final diff and rebuild evidence
  - id: T-27
  - depends-on: T-26
  - accepts: AC-12
  - design: D-08
- [ ] 6.6 Obtain independent verification and verify fresh PASS evidence including both live hosts
  - id: T-28
  - depends-on: T-27
  - accepts: AC-01, AC-02, AC-03, AC-04, AC-05, AC-06, AC-07, AC-08, AC-09, AC-10, AC-11, AC-12
  - design: D-03, D-08
  - kind: closeout
