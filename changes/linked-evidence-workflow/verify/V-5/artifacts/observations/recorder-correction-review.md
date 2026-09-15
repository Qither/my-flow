# Recorder correction

V-4 was immutably recorded FAIL before source edits. The independent architect confirmed
the live recorder rejection violates C-04 and the verifier's mandatory design-constraint checks.
This does not invalidate the actual supplemented native fixture PASS.

Agreed allowed overall verdicts (required coverage remains unchanged):

| Required coverage | Allowed overall verdict |
|---|---|
| PASS | PASS, INCOMPLETE, FAIL |
| INCOMPLETE | INCOMPLETE, FAIL |
| FAIL | FAIL |

Before the fix, the new focused regression ran 11 cases: 8 passed, 3 failed, reproducing the
conservative verdict rejection. After the fix, the entire evidence suite passed 82/82;
full source suite passed 566/566. No skipped/todo tests. Logs: recorder-verdict-before.log,
recorder-verdict-targeted.log, recorder-verdict-full.log. Build/check/validate passed.

Independent architect review after patch, verbatim:

## Verdict: CLEAR

The inspected implementation matches the agreed severity matrix.

## Evidence (path:line)

- `scripts/lib/evidence.mjs:550–553` rejects unknown verdicts, preserves required FAIL precedence, and refuses PASS when required coverage is INCOMPLETE.
- `scripts/lib/evidence.mjs:555–561` retains report agreement and independent provenance for PASS.
- `test/evidence.test.mjs:476–502` covers all nine combinations, unchanged criterion statuses, verbatim reports, authoritative head verdicts, blocked non-PASS closeout, and immutable recorded attempts.
- `test/evidence.test.mjs:505–513` covers unknown verdicts and confirms optional PARTIAL observations do not automatically become mandatory.

## Antithesis

Automatically treating every extra observation as mandatory would enlarge acceptance requirements. This patch avoids that: the verifier explicitly supplies the overall verdict, while required coverage remains its minimum severity.

## Tension and synthesis

The recorder now preserves conservative independent verdicts without permitting unsupported PASS or weakening required contradictions. No further code changes are required by this bounded review.

I inspected current files only; I did not rerun tests or verify the reported test logs.
