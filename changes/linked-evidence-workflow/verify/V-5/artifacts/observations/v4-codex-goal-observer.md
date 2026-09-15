# V-4 Codex goal execution

Independent source: native `/root/v3_live_observer`; bounded result preserved verbatim.

Codex goal phase bounded verdict: PASS. Native chronology is complete: 06:07:12 `get_goal` => null; 06:07:25 `create_goal` returns one active goal, then sequential `stage medium execute` binds a82457bc… before sources (still pending in that output); 06:07:34 only the two label patches, initial test gets spawn EPERM; approved identical retry 06:07:43 => 2/2; 06:08:23 task tick, stage refresh, gate test/cleanup/retest all succeed; sandbox evidence begin fails, approved retry opens V-1 at 06:09:03 (impl b57e7fca… contract 5ab87c…); native /root/medium_execute_verifier runs independently. Its first INCOMPLETE report is preserved in scratch; `evidence record --attempt 1` is rejected syntactically, then `--attempt V-1` is rejected with verdict-mismatch. After a same-agent supplemental read of native history/current hashes (no test rerun), PASS is recorded once at 06:16:09. V-1 result/report creation and last-write are both 06:16:09, result qualified true/originProblems empty; no prior closed result was overwritten. Stage is done and native `update_goal complete` succeeds at 06:26:57. Tracked high proposal/design/tasks/acceptance/change hashes exactly equal goal-v4-before snapshots. That snapshot does not cover untracked high lanes/reviews/spec/delta, so do not claim full prehash; native write chronology contains no high-path mutation, and their mtimes predate execute. Preserve one mechanism observation: the truthful initial INCOMPLETE was rejected because requiredCriteria contained only AC-01 and the extra Do-Not-Touch PARTIAL did not affect computed verdict. The supplement actually closed that gap, so final PASS is supported, but the recorder’s treatment of non-AC final constraints merits separate AC-05 semantics review.

Parent follow-through: `read-medium-status.mjs` independently reads both original hosts as
V-1 closed PASS and eligible for verified archive. Neither fixture was archived.
The unrelated-goal fixture was prepared separately and launched through
codex-goal-conflict-entry.mjs using the same authenticated isolated home. This next scenario
has no permission to edit the completed original workspaces or their evidence.
The constraint-gap recorder concern was sent to the independent architect for a bounded
contract/code semantics review; no source change or whole-test replay has been made.
