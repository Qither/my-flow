## T-31 Verification Report

### Verdict: PASS

**T-31 can be ticked.** All L-02 candidate-setup requirements are now verified.

### Evidence

- Current candidate inventory: digest `2aea0b0c7f984e9dfaa67473430603b71fc38631fd8caad108f73cdb2ca45ce6`, 146 files.
- Source → candidate: 0 mismatches.
- Runtime: only the two declared hook-manifest overlays differ; 0 unexpected mismatches.
- Monitored real-home state from the clean checkpoint through `t31-ready`: 0 changes.
- Source suite log: 552 passed, 0 failed/skipped/todo.
- Both host workspaces are separate, clean Git roots with matching medium/high/amend/verify fixtures.
- Claude:
  - `medium → mf-plan` used environment session `44e66242-81f0-43f7-bdf5-ef87b367209b`.
  - Ordinary child role is `my-flow:verifier`; Write/Edit are absent.
  - Its native Read returned exactly `LIVE_FIXTURE_READY\n`.
- Codex:
  - `medium → mf-plan` used environment session `8cbc2081-a9f4-4e4e-b4a1-1e16af28c2ea`.
  - Session is live and unambiguous; `goal` remained null.
  - Native verifier’s original command completed with exit 0 and returned `LIVE_FIXTURE_READY\n\r\n`.
- Native SessionStart and Stop events passed through the installed Claude and Codex wrappers. This also resolves the earlier Codex shim fallback caveat.
- The earlier generic Claude teammate result is superseded by the correctly dispatched ordinary `my-flow:verifier`.
- The disclosed real `models-state.json` mutation predates the candidate host launch and current digest. The repaired current-target interval is clean.

### Criterion impact

T-31’s contributions to **AC-05, AC-09, AC-10, and AC-12 are VERIFIED**.

Risk selection, goal handoff, amendment, and final-verifier scenarios belong to L-03/T-28. They are not T-31 requirements. The overall change remains **INCOMPLETE** pending T-28.
