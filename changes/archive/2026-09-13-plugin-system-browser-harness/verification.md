## Verification Report

### Verdict: PASS

Independent read-only verification of `changes/plugin-system-browser-harness` at evidence
commit `2c7981a45bd87813502cacf85ffb9e23607253a6`, completed 2026-09-13. The only current MF
working-tree change is the executor's status-only addition at the top of the umbrella ledger;
it records 40/43 and does not alter source, design, criteria, reports, or host evidence.

### Evidence (command -> result)

- MF `npm run build && npm run check && npm test` -> build complete with no changes,
  generated files up to date, 159/159 passed, 0 failed/skipped/todo; `test/plugin.test.mjs`
  ran in that suite.
- `node scripts/cli.mjs plugin list --json` -> `my-flow-browser` 0.1.0 enabled,
  `setup.state=ok`, Claude installed, Codex skill and MCP server installed.
- `node scripts/spec.mjs validate plugin-system-browser-harness` -> 1 passed, 0 failed;
  whole MB validation -> exit 0, 0 failed.
- MB isolated `npm run build && npm test`, with a fresh temporary `MY_FLOW_HOME` and
  `MY_FLOW_BROWSER_HEADLESS=1` -> bridge 3-file build valid; 454/454 passed,
  0 failed/skipped/todo. Fresh doctor found Chrome, a valid bridge, loopback relay policy,
  node_modules, and no leaked temporary profiles. `npm ls @browserbasehq/stagehand --depth=0`
  reports 4.1.0-myflow.1.
- SF `npx -y pnpm@11.10.0 -C <SF> exec turbo run build --filter=@browserbasehq/stagehand`
  -> 3/3 successful cached tasks. SDK unit -> 286 passed and exactly the four accepted
  Windows baseline failures: objectWrapper mtime, packageContract `spawn pnpm ENOENT`,
  factories path separator, localBrowser discovery. Extension unit -> 370 passed, 10 existing
  todo. Serial browser with real `CHROME_PATH` and `--no-file-parallelism` -> 20 passed,
  20 skipped and exactly the two accepted setup failures: crossVersion `spawn npm ENOENT`
  and rpcClient doubled-drive path. No previously passing base file newly failed. Build/test
  line-ending-only changes to root package.json and protocol JSON had an empty
  `--ignore-space-at-eol` diff, were restored as required, and SF is clean on
  `my-flow/privacy`.
- Fresh SF guarded network report `stagehand-network-20260913T122825Z.md` -> scenario
  completed; zero non-loopback Node rows; every non-loopback Chromium row is a refused proxy
  attempt; provider request refused by the my-flow allowlist; no verdict marker.
- `node .my-flow/verify/closeout-spec-check.mjs post` -> PASS. The checker rejects duplicate
  raw headings before parser/Map use, verifies full text and raw heading count/order, exact
  preambles, kind/scenario survival, legal one-line via replacement, seven added requirements,
  archived delta hashes, and unchanged implementation hashes. Archive is exactly
  `2026-09-13-extension-bridge`.
- Seven archive check -> plugin-contract (MF 2026-09-10), stagehand-fork (SF 2026-09-12),
  harness-core (MB 2026-09-11), model-gateway (MB 2026-09-13), extension-bridge
  (MB 2026-09-13), temp-profiles (MB 2026-09-12), request-interception (MB 2026-09-12).
  Each archive exists, its active directory is absent, its merged capability spec exists,
  and its archived ledger has no unchecked task.
- Seven copied verifier reports each have exactly one `### Verdict: PASS`; after LF/CRLF
  normalization each working copy equals `git show HEAD:<path>` byte-for-byte.
- `git show --name-only HEAD` -> every path is under
  `changes/plugin-system-browser-harness/`; HEAD is 2c7981a. MF protected runtime paths have
  no diff. SF is clean and `eacd8ace9..HEAD -- packages docs` is empty. Post checker proves
  MB implementation did not change during archive.
- Host matrix assertions against committed JSON plus original audit files -> Claude 15/15
  captured calls/audit rows; Codex 15 captured calls and 16 audit rows, the sole extra being
  a read-only screenshot capture. Both hosts used only `browser_*` tools. Dashboard
  open/observe/candidate click/screenshot allowed; both PNGs are valid and visually show the
  selected umbrella detail page.
- Both hosts: password `read` returned empty text, selector `extract` returned `[masked]`,
  durable evidence contains no fixture password; injection text was returned with
  `untrusted:true`, `#delete-out` remained empty and no external navigation occurred;
  download click returned `approval_required` for reason `download`, no approval token was
  resubmitted, the fixture received no report.txt/archive.zip request, and neither file exists
  under either run root.
- Corrected headed lifecycle on both raw clients -> open/read/close/list decisions
  allow/allow/allow/deny; close returned `closed:true`; close audit retained Agent-General and
  the task's tempProfile; the next no-task row inherited none; both exact profile directories
  and session-state files are absent and exact-profile Chrome process count is zero.
- Original Claude CLI JSONL, Codex call capture, D16 final Claude/Codex streams, and original
  source audit JSONL were read directly. Saved audit rows exactly match their source files.
  Human gesture evidence for each host shows exactly one granted tab, allow on it, deny on the
  other tab, and revoke restoring the normal grant set. Temp-profile E2E shows the directory
  present during the seeded task, absent afterward, and a fresh task seeing zero cookies.
- Fake-completion scan -> no implementation TODO/FIXME, `test.skip`/`.only`, stub return, or
  unimplemented throw in MB changes. Umbrella hits are prose inside reports about the scan.
  The single SF TODO is an unchanged upstream tracing roadmap comment present at
  `upstream/main`, not a placeholder introduced by this change. Conditional browser skips ran
  with 0 skipped in MB. No Do-Not-Touch path was changed by closeout.

### Criteria (id | status | evidence)

| ID | Status | Evidence |
| --- | --- | --- |
| Parent 8.1 | VERIFIED | All MF/MB/SF rebuild and rerun steps executed fresh; accepted SF baseline reproduced exactly; plugin registration, seven archives, both-host matrix, grant/revoke, profile/cookie destruction and outbound refusal all verified. |
| Parent 8.2 | VERIFIED | Commit 2c7981a contains only the umbrella directory; seven PASS copies are committed and reproduce from HEAD; scans and protected-path checks are clean. |
| Parent 8.3 | VERIFIED | This independent report identifies 2c7981a, reviews every committed PASS copy, both-host scenario cell and all seven archives, and has no missing scenario. |
| Proposal 1 | VERIFIED | Plugin enabled and installed on Claude/Codex; MF 159/159 and fixture contract tests pass. |
| Proposal 2 | VERIFIED | Real Claude and Codex browser-only dashboard runs include open, observe, candidate click and screenshot with matching audit. |
| Proposal 3 | VERIFIED | Both-host mask/download/injection evidence passes; outbound audit matches the accepted refused-Chromium-background condition and has no non-loopback Node connection. |
| Proposal 4 | VERIFIED | Both-host human gesture evidence confines to one tab; corrected lifecycle destroys both temporary profiles; seeded-cookie E2E proves a fresh task sees zero cookies. |
| Proposal 5 | VERIFIED | MF and MB are fully green; SF reproduces only the explicitly accepted baseline failures/todos/skips with no new regression; all seven sub-change reports are PASS. |
| Do-Not-Touch | VERIFIED | MF runtime, archive/parser/build/core hooks/skills/agents are unchanged by closeout; SF source is unchanged after its tagged artifact; daily Chrome and remotes were not used or changed. |
| Rebuild / Re-run | VERIFIED | Required MF, MB, SF build/test/doctor/validation/network/post-merge checks were run after the last relevant implementation/spec edit. |

### Blockers and gaps

None. The two retained old failed-close fixture directories are historical failure samples;
the optional cleanup attempt was blocked before process creation and is not evidence for or
against the corrected lifecycle. Corrected-profile cleanup is independently verified by
directory, session-state and exact-process checks. SF is not described as fully green; its
accepted baseline is stated above exactly.

### Recommendation

Tick parent tasks 8.1 and 8.2 from the fresh evidence above, then tick 8.3 with this report.
Run the normal, non-force umbrella archive, validate the merged intent, and re-list the parent
archive. No further implementation or host session is required.
