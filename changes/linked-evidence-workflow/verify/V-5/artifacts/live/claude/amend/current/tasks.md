# amend

- [ ] 1.1 Confirm A and verify A readiness
  - id: T-01
  - depends-on: none
  - accepts: AC-01
  - design: D-01
  - blocked: A-1 reopened this task and removed its evidence link; AC-01 must be re-verified under the new command `node scripts/check-a.mjs` before it can be ticked. Out of scope for this amendment-acceptance round, which was authorised to stop with A and B reopened.
- [ ] 1.2 Confirm B and verify B readiness
  - id: T-02
  - depends-on: T-01
  - accepts: AC-02
  - design: D-01
  - blocked: depends-on T-01, which A-1 reopened; AC-02 cannot be confirmed until A is re-verified under the amended contract. Out of scope for this amendment-acceptance round.
- [x] 1.3 Confirm C independently and verify C readiness
  - id: T-03
  - depends-on: none
  - accepts: AC-03
  - design: D-01
