# Planning-policy correction review

Independent reviewer: native `/root/v3_live_observer`.
The following is its final bounded re-review, preserved verbatim. It is not a whole-change PASS.

## Verification Report

### Verdict: CLEAR

### Evidence

- `node --test test/workflow.test.mjs` → **60/60 passed**, zero skipped/todo.
- `node scripts/build.mjs --check` → generated files are current.
- All seven localized READMEs place the compatibility note at line 12, after `</p>` at line 10.
- The test now asserts the note occurs after the closing navigation paragraph.
- Generated Claude and Codex planning skills match the corrected source ordering.

### Criteria

| Criterion | Status |
|---|---|
| Localized compatibility link placement | VERIFIED |
| Complete contract before review | VERIFIED |
| Baseline and validation before review | VERIFIED |
| Current context and digest before reviewers | VERIFIED |
| Re-preparation after medium fixes | VERIFIED |
| Fresh planner DRAFT after high-target changes | VERIFIED |
| No contract mutation during final recording | VERIFIED |

### Blockers and gaps

None in this bounded correction.

### Recommendation

Refresh the candidate and isolated homes, then continue L03. Final V3 remains **INCOMPLETE** until live observations and post-edit full verification pass.

---

Parent follow-through: full required tests after these corrections passed 555/555, zero
skips/todos, in `v3-policy-order-full.log`. Build, build --check and change validation passed.
The candidate was refreshed at 2026-09-15T03:53:35Z; old inventory and fixture identities
are preserved in `observations/pre-policy-refresh/` within the disposable candidate.
Both authenticated homes were retained. Real home non-secret fingerprints immediately before
and after this refresh are byte-identical. The old initial-baseline models-state difference
predates the test-home isolation fix; it is not a new change during this refresh.

Current canonical candidate digest:
`04347c5229fbd8b3f8a3dc1a794f4e0d5749290937066a5d5757b9cd4c40215b`.
Runtime differs only by the two recorded hook-observer manifests.
Both owned idle CLI processes were identified by exact fixture command lines before stopping;
Codex transcript ended with task_complete and Claude with completed stop/away summaries.
New logical sessions use the same authenticated profiles and sandbox settings.

New declared session identities:
- Claude: `44a33a7a-18f7-4832-9ac2-98141fe75329`.
- Codex: `a82457bc-a9ed-47e7-b593-36f0a2c887ad`.

The user has received the current-candidate T-31 probe. No L-03 prompt has been sent.
