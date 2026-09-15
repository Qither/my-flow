# V-5 history and negative verifier phase

Native independent observer `/root/v3_live_observer` confirmed PASS for both history
supplements and both static-only final-verifier phases by inspecting existing events/files.

History: 9/9 old V-1 files rehashed with zero mismatches per host. Apply removed A's prior
evidence link; B had no prior link and is reported honestly as such. C stays checked with
its V-1 link. Captured old acceptance names amend-a.test.mjs; current acceptance names
scripts/check-a.mjs. Exact old/current digests differ as expected; read-only archivePreflight
blocks with unfinished-tasks and contract-drift. Original native runs supply role-ordering
and pending-C evidence; the supplement supplies only history retention/invalidation.

Claude verify V-2 request: 441cf7a9e5504370ca8c0a462849ea31611136fe0b266c6cba5ca6922c356f29.
Codex verify V-2 request: 1a0ee846d03f3ef2823970f29bd1af3a3aaec32bbac6de54e3001c46870b6b5c.
Both heads are closed independent INCOMPLETE. AC-01 was freshly run and passed 1/1;
AC-02 is MISSING without live modes. T-02 remains unchecked. Original V-1 files are immutable.
Claude's configured ordinary verifier omitted named-team/background arguments and had no
native-probe content-read events. Codex's native verify_ac01_only also did not perform the
live read. Opaque hashing/existence was not substituted for live observation.

Evidence boundary: these V-2 cases prove durable required-live MISSING and old-PASS rejection.
They do not by themselves exercise the former computed-PASS/conservative-INCOMPLETE defect.
That correction is supported separately by the nine-case severity-floor regression (three
pre-fix failures), post-fix evidence 82/82, candidate 11/11, full independent 566/566 and
source/architect review.

Remaining positive phase must open a new attempt, use a new native verifier for actual
current-workspace probe content and a fresh AC-01 check, preserve V-1/V-2, and only tick T-02
after observed success. The full before snapshot is observations/live/verify-live-v5-before
inside the isolated fixture (90 Claude / 89 Codex nonignored files).
