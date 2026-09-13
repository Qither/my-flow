# Closeout verification evidence — 2026-09-13

Execution evidence collected by the primary agent. Whole-umbrella independent review is
a separate gate; the seven individual sub-change reports retain their own scope.

## Build and tests

- MF build: exit 0, no generated changes. MF check: generated files up to date.
- MF tests: 159/159 passed, zero failed/skipped/todo (16742 ms).
  Log: MF/.my-flow/verify/closeout-mf-tests.log.
- MB final independent full suite: 454/454 passed, zero failed/skipped/todo (535445 ms).
  Temp/bridge focused suite: 110/110; network audit: 5/5. See verify/extension-bridge.md.
- SF build: 3/3 successful, all cached. Extension suite: 370 passed, 10 existing todo.
  SDK unit suite: 286 passed and the same four documented Windows baseline failures.
  Serial browser suite: 20 passed, 20 baseline skipped, the same two setup failures.
  Logs: SF/.my-flow/verify/closeout-{build,sdk-unit,extension-unit,browser}.log.
  Failing unit files remain objectWrapper, packageContract, browser/factories and
  browser/localBrowser; browser setup failures remain crossVersionCompat and
  rpcClientExtensionSmoke. No previously passing base file newly failed. This applies
  the already recorded user acceptance in verify/stagehand-fork.md, not an all-green claim.
- pnpm's root package/protocol changes were verified line-ending-only and restored.
  SF status is clean on my-flow/privacy.

## Extension archive

The child reached 39/39 and received a whole-change independent PASS. Its three spec input
hashes and implementation hashes were checked against extension-bridge-prearchive.json
immediately before the normal archive command. No force flag was used.

`node scripts/spec.mjs archive extension-bridge --root ../my-flow-browser` merged the two
capabilities and moved the child to MB/changes/archive/2026-09-13-extension-bridge.
`node .my-flow/verify/closeout-spec-check.mjs post` then passed all raw-heading count/order,
duplicate rejection, full-block, unchanged-requirement, preamble, kind/scenario and exact
new provenance checks. Both archived deltas retain their original raw-byte hashes.
The active child is absent and the implementation hashes are unchanged.

Source input hashes:

- Base: 44030202ff56d5bd2df0e2e17d8fc8773b033c78e402d005271d254c9f3a4aea
- Browser delta: 9787abb7db4dbbd8b7e6b9f25f12b8ae720ade4cdb5b78a6534680aae2688b6e
- Extension delta: f8909893aa35d2632fc15f93e6cedfed74868b94cd162120b206c1d01aacb74c

Host observations, screenshots, exact audit excerpts and process checks are in the adjacent
closeout-host* artifacts. Original failed close observations are retained; new actual
headed runs prove the repaired close path and its audit context. Manual grant/revoke
evidence was independently checked on both hosts before this closeout.
