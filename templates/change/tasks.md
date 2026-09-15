## 1. <!-- Task Group Name -->

- [ ] 1.1 <!-- task --> and verify <!-- observable check -->
  - id: T-01
  - depends-on: none
  - accepts: AC-01
  - design: D-01
- [ ] 1.2 <!-- task --> and verify <!-- observable check -->
  - id: T-02
  - depends-on: T-01
  - accepts: AC-01

## 2. <!-- Task Group Name -->

- [ ] 2.1 <!-- task --> and verify <!-- observable check -->
  - id: T-03
  - depends-on: T-02
  - accepts: AC-02

## 3. Final gate

- [ ] 3.1 Targeted verification of the whole change (build, tests, Rebuild / Re-run steps)
  - id: T-04
  - depends-on: T-03
- [ ] 3.2 Cleanup of own diff only, then re-verify
  - id: T-05
  - depends-on: T-04
- [ ] 3.3 Independent verification report says PASS (.my-flow/verify/)
  - id: T-06
  - depends-on: T-05
  - kind: closeout
