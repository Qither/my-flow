# Disposable live workflow inputs

Copy these inputs into each host's isolated workspace using the candidate CLI to create
the corresponding changes. These are baseline programs and fixed acceptance checks, not
completed implementations. They do not authenticate hosts or attest to native agent events.

| Change | Baseline | Requested behavior |
| --- | --- | --- |
| medium | Both label checks fail | Set the two exported labels to Left ready / Right ready |
| high | Text output passes; JSON output fails | Add --json while retaining default text output |
| amend | A, B and C checks pass | Independently review an equivalent check for A; hold A and B while C completes |
| verify | Automated answer check passes | Old automated evidence alone must not satisfy a newly required native-verifier observation |

For amendment F-1, the supplied failed approaches are changing the consumer's wording
and rerunning the unchanged original check. Both leave the same check-contract mismatch.
They are scenario inputs, not claims about actions performed in the core repository.
The equivalent check is `node scripts/check-a.mjs`, replacing the A-only Node test.

For the verify scenario, create and independently verify the initial automated-only
contract, then add the required live criterion before invoking the host's verifier.
Do not manufacture a real independent PASS record. Native invocation logs and user goal
responses are collected during the live run, never seeded by these files.
