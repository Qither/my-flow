## Verification Report

### Change: request-interception (uncommitted working tree), 2026-09-11T21:24:45Z

### Verdict: PASS

Produced by the read-only `my-flow:verifier` role in a fresh context (agent
`verify-request-interception-2`), relayed and saved verbatim by the `mf-verify` caller. This is
the **confirming pass**: an earlier independent pass
(`request-interception-20260911T204500Z-fail.md`) returned FAIL, and its author declined to move
on the executor's word, requiring a fresh read-only pass over the fixed code plus three
consecutive green full-suite runs. This verifier ran the suite twice itself.

### Evidence (command -> result)

- `npm test` (run 1, own execution) -> `tests 199 / pass 199 / fail 0 / cancelled 0 / skipped 0 / duration_ms 351353.9997`, exit 0.
- `npm test` (run 2, own execution) -> `tests 199 / pass 199 / fail 0 / cancelled 0 / skipped 0 / duration_ms 323255.3123`, exit 0. Group 6 and 7 tests named in the log, including `a nested disallowed frame is a hole and the tab stays usable (task 7.1, SC1)` and `every disallowed-host fixture serves nothing while the tab stays readable (task 7.2, SC2)`.
- `node ".../my-flow/scripts/spec.mjs" validate request-interception --root ...my-flow-browser` -> `ok   request-interception`, `1 passed, 0 failed`, exit 0. One warning only: the `Audit record` requirement is also MODIFIED by the unrelated `extension-bridge` change.
- `node scripts/cli.mjs browser audit --scenario fixture` re-run by the verifier against the current code under a temp `MY_FLOW_HOME` -> exit 0, `only loopback destinations: no`. Every `node fetch` / `node net.connect` / `node websocket` row is `127.0.0.1`; all eight non-loopback rows are `via proxy` and were refused (`proxy: refused www.google.com:443` and so on). This reproduces the archived report and confirms the note under task 8.2.
- Fake-completion grep (`grep -anE "TODO|FIXME|XXX|test\.skip|\.only\(|not implemented|placeholder|HACK|console\.log"`) over all twelve changed source, test and doc files -> no matches.
- `grep -R MY_FLOW_BROWSER_NO_INTERCEPTION server/ gateway/ driver/actions.mjs` -> nothing (exit 1). The only read is `driver/session.mjs:193`, inside `start`, from `process.env`.
- `grep -c setBypassServiceWorker driver/session.mjs` -> `0`. `grep -c " pending:" changes/request-interception/design.md` -> `0`.

### Criteria

| id | status | evidence |
|---|---|---|
| First-pass item 1, settle helper | VERIFIED | `framesSettled` at `test/regression.test.mjs:1768` is bounded at 5000 ms, returns the frame list on timeout so every assertion still runs, and reads only `driver.session.frameUrls`, which sends `Page.getFrameTree` and writes no audit line and drains no counter. The t=0 deny test at `:1622` acquires no settle call and still asserts `deny` on read, screenshot, observe and extract. `README.md:105-107` tells a caller a read in the first instant after `browser_open` can be refused and to retry. |
| First-pass item 2, `UNARMED` guards | VERIFIED | `driver/session.mjs:583` now reads `if (arm && settled[1]?.status === 'rejected' && childType === 'iframe' && childTargetId && live.has(childTargetId))`. `settled[1]` is `Fetch.enable` whenever `arm` is true. That async block is the only post-await write into `live`, `blockedFrames`, `frameHistory` or `blockedCounts`; every other write is synchronous inside the message handler. |
| First-pass item 3, audit-line counting | VERIFIED | `test/e2e.test.mjs:107` filters `r.kind !== 'blocked'` and asserts blocked lines name host and type and carry no `tool` or `decision`. This matches the MODIFIED requirement, which says blocked lines are excluded from the one-line-per-call count. Call records carry no `kind` field, so the filter keeps all of them. No other suite assertion counts raw audit lines: the audit, policy and observe counts are unit-level with injected drivers or their own root, and the security and regression counts are `>=` or `> 0`. |
| First-pass item 4, minors | VERIFIED | `blockedFields` at `driver/actions.mjs:468` always returns `blockedSinceLastCall`, `0` included, asserted at `test/driver.test.mjs:491`. The spec's `chrome-extension:` clause matches `#judgePaused`. `readDecisionIsARace` is named and justified at `test/regression.test.mjs:1828`. Task 3.4's browser test asserts `offlimits.served` is empty after `browser_tabs new` to `frame.html`. |
| Tasks 1.1 through 7.6, 8.1, 8.2 | VERIFIED | All 29 ticked boxes have a passing test or a reproduced grep. 8.3 is this report. |

### Criteria (remainder)

| id | status | evidence |
|---|---|---|
| Tasks 1.1-7.6, 8.1, 8.2 | VERIFIED | All 29 ticked boxes have a passing test or a reproduced grep behind them. 8.3 is this report. |
| Spec scenarios | 13 of 14 | Twelve ADDED scenarios plus the two new MODIFIED scenarios map to passing tests. Subresource refusal and the WebSocket gap map to the task 7.3 test; nested cross-site refusal and the hole to task 7.1; the redirect hop and every SC2 fixture to task 7.2; `browser_tabs new` arming to the task 3.4 unit and its new browser test; load-bearing to task 7.5; the worker path to task 7.6; blocked-frame marking, clearing and the unblocked-frame case to the task 4.1 unit; coalescing, the cap and the count to the task 4.3 units and the task 4.4 gateway unit; the two MODIFIED scenarios to task 7.4 and the e2e test. The shared-worker half of the measured-gaps scenario remains PARTIAL, spike-only. |
| Do-Not-Touch | VERIFIED | `git status --short` lists no change to `driver/chromium.mjs`, `audit/proxy.mjs`, `server/tools.mjs`, `gateway/policy.mjs`, `changes/.templates/` or `changes/archive/`. Tool schemas and the policy table are untouched. |
| Rebuild / Re-run | VERIFIED | Suite twice, network audit re-run by the verifier on the current code, README updated with all five required points, `spec validate` exits 0. |
| Stagehand fork | NOTED | `package.json` pins `@browserbasehq/stagehand` to `file:vendor/browserbasehq-stagehand-4.1.0-myflow.1.tgz`. Both suite runs and the audit exercised the fork. Not this change's to revert. |
| Adversarial sweep | VERIFIED | No path found where a disallowed subframe document or subresource reaches the page. |

### Adversarial findings

I probed a frame that navigates again after being marked, `blob:` / `about:` / `srcdoc` children
of a blocked frame, redirect chains, requests arriving before arming, a child session whose
arming fails, and the top-document continue rule. A blocked mark is set only on a Document
request the judge actually failed, so the frame it hides never loaded that host's document. The
mark is cleared by the next `frameStartedNavigating` or by a commit whose loader id does not
match, both of which over-refuse rather than leak. Opening a tab and creating one both arm before
`goto`, and `Fetch.enable` precedes `Target.setAutoAttach` on the page session, so no child runs
before interception is live. A subframe cannot carry the tab's main frame id, and the main frame
id is written only from page-session events.

Two non-blocking observations. A popup's refusals are counted against the opener tab's page id,
so an opener can show a hole entry for a frame that is not in its tab. The gateway skips it, so
the effect is cosmetic. And the connection factory has an await between its cache check and its
cache write, so two concurrent calls could build two connections and reset the blocked maps. That
shape predates this change, but the blocked marks are new state riding on it.

### Blockers and gaps

None blocking. Four things to record.

1. **The ADDED spec overstates the arming-failure rule.** It says a child session whose arming
   fails makes its tab report an unknown frame. After the fix, only an iframe target does. A
   service worker, shared worker, dedicated worker or nested page whose `Fetch.enable` is rejected
   is resumed with nothing recorded, and the tab reads clean. The guard itself is right, since a
   non-frame filed into the live-frame map would refuse the tab forever. Narrow the prose to frames
   before archive. Practically unreachable: a rejection on those sessions means the target is
   already gone.
2. **Shared-worker half of the measured-gaps scenario is still spike-only.** No regression test
   covers it, only the spike script and the recorded `spike worker:` line.
3. **The archived report copy predates the last driver edits.** The stored network report is
   stamped 02:15 local while the two driver files were edited at 04:27. I re-ran the audit on the
   current code and it reproduces, so the conclusion holds, but the stored copy is not the evidence
   it claims to be.
4. **The vendored Stagehand fork** contradicts this change's own Do-Not-Touch line that Stagehand
   is consumed as the pinned npm release. Both of my suite runs and my audit exercised the fork.
   Not this change's to revert.

### Recommendation

Tick task 8.3. Before `spec archive`, narrow the arming-failure sentence in the ADDED delta spec
to frames, and refresh the stored network report from a run that postdates the final driver edits.

On item 2: leave it as a recorded gap, no test needed. The user's decision already put shared
workers outside success criterion 3, the ADDED spec states the gap as a scenario, and the spike
measured it. A test would only assert that an unreachable target stays unreachable, which the
harness cannot observe from the tab's connection anyway.

### Caller's closeout

All three pre-archive recommendations were carried out after this report: the ADDED spec's
arming-failure sentence is narrowed to frames with the reason stated, the network report was
re-run so the stored copy (`request-interception-network-20260911T212924Z.md`) postdates the last
driver edit and supersedes the 181546Z copy, and item 2 is left as a recorded gap. `spec validate`
still exits 0.

### Note on the working tree

`package.json` and `package-lock.json` pin `@browserbasehq/stagehand` to
`file:vendor/browserbasehq-stagehand-4.1.0-myflow.1.tgz`, a vendored fork belonging to a
concurrent sub-change by another session sharing this checkout. It is not this change's to
revert, and it means every suite run recorded here, the verifier's included, exercised the
forked Stagehand rather than the pinned release this change's Do-Not-Touch assumes.

### Recommendation

PASS. Tick 8.3, set the stage to `done`, and archive the change.
