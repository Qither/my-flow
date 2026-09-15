## T-29 Independent Recheck

### Verdict: PASS

**T-29 can be ticked.** The ledger remains 29/32 because this verifier is read-only; ticking T-29 would make it 30/32.

### Evidence

- Observer marker: `HOST_PREFLIGHT_16cc9884-3df9-4ce9-8480-43528bea2220`.
- Codex parent rollout:
  - Native `get_goal` returned `goal: null`.
  - Native `spawn_agent` created verifier `/root/t29_verifier`.
  - No native or exec-wrapped `create_goal` call occurred.
- Child verifier rollout:
  - Independently ran `Get-Content -LiteralPath .\fixture.txt -Raw`.
  - Exit code 0.
  - Returned the exact observer marker; remaining bytes were only LF/CRLF terminators.
- Session metadata:
  - Session `01a0a2b6-39ff-7371-9e76-746dde96fc40`.
  - CWD remained inside the disposable Codex workspace.
  - Approval policy `on-request`, non-admin `workspace-write` sandbox.
- Existing evidence already establishes:
  - Claude authentication and exact sentinel read by a native verifier.
  - Claude interactive `/help` exposes `/goal`, with no goal set.
  - Baseline generated plugin/roles installed inside the fixture.
  - Temporary Codex `goals`, `hooks`, and `multi_agent` features enabled.
  - Shared isolation variables and scheduler recorder resolve inside the fixture.
- Fresh read-only fingerprint comparison:
  - Current nine monitored non-secret home files plus `.codex/agents/` equal `resume-real-homes-after.json`: **0 changed**.
  - Compared with the earlier before snapshot, only the already disclosed `.my-flow/models-state.json` differs. That change predates this successful Codex rerun; the rerun introduced no monitored home change.

No credential file was read, and the earlier rejected read was not retried.

### Scope impact

T-29 now satisfies its preflight contributions to AC-05, AC-09, AC-10, and AC-12. The overall change remains **INCOMPLETE** until T-31 and T-28 complete.

```json
{
  "task": "T-29",
  "verdict": "PASS",
  "canTick": true,
  "ledgerBeforeTick": "29/32",
  "ledgerAfterTick": "30/32",
  "evidence": {
    "expectedMarker": "HOST_PREFLIGHT_16cc9884-3df9-4ce9-8480-43528bea2220",
    "goalState": null,
    "nativeVerifierSpawned": true,
    "verifierReadExitCode": 0,
    "markerMatched": true,
    "createGoalCalls": 0,
    "currentVsResumeAfterHomeChanges": [],
    "currentVsResumeBeforeHomeChanges": [
      ".my-flow/models-state.json"
    ]
  },
  "criteriaImpact": {
    "AC-05": "T-29 VERIFIED",
    "AC-09": "T-29 VERIFIED",
    "AC-10": "T-29 VERIFIED",
    "AC-12": "T-29 VERIFIED"
  },
  "remainingOverallTasks": [
    "T-31",
    "T-28"
  ]
}
```
