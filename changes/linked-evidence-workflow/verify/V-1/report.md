# Verification report — linked-evidence-workflow, attempt V-1

### Verdict: INCOMPLETE

Independent pass by the read-only `my-flow:verifier` role, in a separate context from the one
that wrote the code. Contract digest `fe714caad44fce5b6c93c4b524a94c850a58387b13e484ee5d434bd05d52c399`,
implementation digest `c83c357ae117…`.

### Evidence (command -> result)

| Command | Result |
|---|---|
| `npm test` | tests 547, pass 547, fail 0, cancelled 0, skipped 0, todo 0 |
| `node scripts/build.mjs --check` | generated files are up to date (exit 0) |
| `node scripts/spec.mjs validate linked-evidence-workflow` | ok, 1 passed 0 failed |
| `node --test test/<suite>.test.mjs` × 15 | each suite isolated; 0 fail, 0 skipped, 0 todo |
| `node scripts/spec.mjs context linked-evidence-workflow` | regenerated; no open findings; 15 locators, hashes matching the files run; 2 notices, both `checked-with-unfinished-prerequisite` against the authorised hold |
| `node scripts/spec.mjs evidence status linked-evidence-workflow` | high-water 1, head V-1 open; not eligible — an unfinished attempt blocks an older PASS |
| `node scripts/spec.mjs inspect linked-evidence-workflow` | 29/32 ticked, stage execute, schema v2 |
| `git status --short -- changes/archive specs/` | empty |
| `browser_open http://127.0.0.1:4321/` | error: Chromium did not report a DevTools port within 15000 ms |
| manual read of a rendered usage comparison | unknowns named as unknown, failed attempt counted, no percentage or pricing claim |

### Criteria (id | status | evidence mode | evidence)

| ID | Status | Modes exercised | Evidence |
|---|---|---|---|
| AC-01 | PARTIAL | automated, manual | graph/markdown/ui suites pass; `tasks.md` reads correctly as plain Markdown. The declared 1280px/390px both-palette visual reading was not obtained. |
| AC-02 | PARTIAL | automated | graph/dashboard/ui suites pass. The declared manual browser observation was not exercised — Chromium would not launch. |
| AC-03 | VERIFIED | automated | graph, spec, dashboard, context suites; `spec validate` ok; context diagnostics complete. |
| AC-04 | PARTIAL | automated, static | evidence, context, workflow suites; the escalation instruction present in both host spellings and provably generated. The declared live host amendment fixture was not observed. |
| AC-05 | PARTIAL | automated, static | evidence and workflow suites; `mf-verify` carries the version-bound attempt and the four-status rule. The declared live separate-host verifier observation was not made. |
| AC-06 | VERIFIED | automated | evidence, archive, dashboard suites; `evidence status` independently shows an open head blocking an older PASS. |
| AC-07 | VERIFIED | automated | intent-io, archive, spec, dashboard suites. |
| AC-08 | VERIFIED | automated | evidence, archive suites. |
| AC-09 | PARTIAL | automated | intent-state, completion-guard, dashboard, workflow suites. The declared live host fixture was not observed. |
| AC-10 | PARTIAL | automated, static | context, workflow, models suites; lane and handoff instructions present in both host formats and in sync with `src/`. The declared live host lane/handoff fixtures were not observed. |
| AC-11 | VERIFIED | automated, manual | usage suite plus a manual review of the rendered comparison. |
| AC-12 | VERIFIED | automated, static, manual | full suite and build check clean; `changes/archive/**` and `specs/**` unmodified; README documents the new commands; temporary-home install and temporary-project init pass without touching a real home. |

### Blockers and gaps

1. **Live-host evidence absent (AC-04, AC-05, AC-09, AC-10).** A prerequisite failure, not a code
   defect. The preflight record shows a substantive failure: Claude "Not logged in" with zero
   subagents spawned, Codex repeated `401 Unauthorized`. T-29, T-31 and T-28 are unticked and carry
   `- blocked:` annotations naming exactly this. AC-10 ("unavailable host scenarios remain
   INCOMPLETE") and D-08 both anticipate it, so the contract is being honoured, not evaded.
2. **The manual dashboard observation is a second, distinct prerequisite failure (AC-01, AC-02).**
   Reproduced independently: the harness could not launch Chromium. AC-01's manual mode is only
   partly satisfied and AC-02's is not satisfied at all.
3. **One Rebuild / Re-run step did not run.** Every command step is satisfied by a fresh run. The
   step "Final UI validation uses the local dashboard in both palettes at desktop and narrow
   widths. Save browser observations and screenshots as evidence" has not been executed by anyone,
   and there are no screenshots for this change under `.my-flow/verify/`.
4. **Process observation.** T-08 is ticked while its own free-form note says required acceptance
   evidence is outstanding. Because the note is prose rather than a `- blocked:` hold, neither
   `spec validate` nor the context diagnostics surface it.

No fake completion found: no placeholder TODOs, stub returns or unimplemented throws in the diff;
zero skipped or todo tests across all 547. No Do-Not-Touch violation. Nothing was contradicted by
any check, so this is not a FAIL.

### Recommendation

Hold T-28 open; do not tick it and do not archive. The implementation evidence is strong and no
defect was found. What is missing is observation, which is what INCOMPLETE means. Two user-side
prerequisites remain: authenticate the disposable fixture profiles, and make a working Chromium
path available (or accept a human visual reading). Convert the T-08 note into a machine-visible
hold so the outstanding manual observation appears in `spec validate` and the context diagnostics
rather than only in prose under a ticked box. Then re-run as a fresh attempt once both
prerequisites are met.
