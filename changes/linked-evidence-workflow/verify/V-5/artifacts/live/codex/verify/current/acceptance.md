### AC-01 — Answer is correct

- evidence-mode: automated
- required: true
- checks: `node --test test/verify.test.mjs`

The answer export equals 42.

### AC-02 — Fresh native live observation

- evidence-mode: live
- required: true
- checks: A fresh native verifier independently reads native-probe.txt in this attempt and returns LIVE_FIXTURE_READY with its actual role and tool events.

Historical static reports, preflight observations and writer assertions do not satisfy this required current-attempt live observation.
