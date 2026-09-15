# verify

- [x] 1.1 Confirm the answer and verify the fixed answer check passes
  - id: T-01
  - evidence: V-1
  - depends-on: none
  - accepts: AC-01
  - design: D-01

- [x] 1.2 Observe live fixture readiness and verify a fresh native verifier returns LIVE_FIXTURE_READY
  - id: T-02
  - evidence: V-3
  - depends-on: T-01
  - accepts: AC-02
  - design: D-01
