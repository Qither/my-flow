## Verification Report

### Verdict: INCOMPLETE

The L03 risk prompt is approved unchanged and is safe to paste. It correctly tests automatic medium-risk selection; adding `--fast` to the medium case would invalidate that test.

### Evidence

- `Get-FileHash l03-risk-prompt.txt` → SHA-256 `b72b183a5ba6248495b8c81dd148e17ee11ae61e372eee1a9ca4356a326e29f6`.
- Candidate inventory verification → `146/146` files match; digest `2aea0b0c7f984e9dfaa67473430603b71fc38631fd8caad108f73cdb2ca45ce6`.
- Candidate/runtime comparison → only `codex/hooks.template.json` and `hooks/hooks.json` differ, as declared.
- `spec validate medium/high` in both workspaces → all four validations pass.
- `spec lane status medium/high` → neither fixture has a lane or approval recorded.
- Runtime lane checks:
  - Medium multi-file fixture → automatic `medium`, critic required, implementation unauthorized.
  - High public API fixture with `--fast` → `high`, fast refused, planner/architect/critic required, implementation unauthorized.
- `git status --short`:
  - Claude HEAD `56128281cbfbbeaaff6f74970af10f1a60136aaf`
  - Codex HEAD `403925ffab5d11ad1a08afd5fcc589ec32babd6e`
  - Both modify only `changes/medium/change.json`.
- `git diff --check` → clean apart from informational LF/CRLF warnings.
- Placeholder/skip scan outside fixture change records → zero hits.
- Baseline fixture tests:
  - Medium: both label checks fail with `Left pending` and `Right pending`.
  - High: default text compatibility passes; JSON behavior fails.
  - These expected failures confirm planning has not implemented either change.
- Installed Codex planner, architect, critic, and verifier files hash-match the runtime candidate.

### Criteria

| Criterion | Status | Evidence |
|---|---|---|
| AC-04 | MISSING | Amendment/repeated-cause live scenarios have not run. |
| AC-05 | PARTIAL | Candidate isolation and role assets verified; live independent-verifier scenarios remain. |
| AC-09 | PARTIAL | Both sessions have valid `mf-plan` leases and no execute lease; goal scenarios and unrelated-goal fixture remain. |
| AC-10 | PARTIAL | Runtime lane engine returns the required roles, but the installed planning skill contradicts the automatic-medium contract. No live role sequence yet. |
| AC-12 | PARTIAL | Candidate inventory, runtime differences, fixture validation, and clean implementation state verified. Broad final checks remain deferred. |
| AC-01–03, AC-06–08, AC-11 | MISSING | Outside this bounded pre-observation pass. |

### Before-state

- `medium`: stage `mf-plan`, revision 2, review `null`, evidence head `null`, task unchecked.
- `high`: stage `new`, revision 1, review `null`, evidence head `null`, task unchecked.
- Both session leases point to `medium` at `mf-plan`; no execute lease exists.
- Global current-change pointers still say `verify/new`, but the prompt explicitly names `medium` and `high`.
- No implementation or test file differs from either fixture repository’s HEAD.

### Blockers and gaps

The frozen candidate’s host instructions still say ordinary `mf-plan` always runs planner → architect → critic and that only user-provided `--fast` uses main-context drafting plus critic. This contradicts:

- `specs/mf-plan-fast/spec.md`: automatic medium must use main-context drafting and a critic.
- Design D-07: medium uses a main-context short plan plus critic.
- The runtime lane engine, which correctly says medium requires only a critic.

This is a likely AC-10 blocker that the live observation should expose. The prompt must remain unchanged so the test stays valid.

The recorded `risk-before` checkpoint also reports `.my-flow/models-state.json` changed in the real home. That change needs attribution or resolution before an AC-12 final claim.

The remaining goal, amendment, and verifier scenarios are unobserved; the unrelated-goal fixture and independent verify baseline are not yet prepared. Broad tests remain intentionally deferred until live scenarios finish.

### Recommendation

Paste the approved prompt unchanged into both existing hosts and record actual delegation events. Treat any medium planner or architect invocation as a failed L03 outcome, even if the host’s final prose claims the medium lane passed.
