# Resume evidence — 2026-09-15

Executor: Codex task `01a0a276-46da-7a73-9717-61b3e1236541`.
This is an observation record; `tasks.md` remains the only progress ledger.

## Execution handoff

The initial stage command refused with `execute-lease-held`, naming session
`381a7dc5-3291-4963-ab93-00e058cccc09`. The user confirmed that session had stopped and
authorised this task to take over. `spec stage linked-evidence-workflow execute --session
01a0a276-46da-7a73-9717-61b3e1236541 --force` then succeeded. Existing implementation edits
were retained.

## Isolated authentication and capability preflight

The original fixture still exists at
`C:/Users/qiujm/AppData/Local/Temp/claude/H--CommonProject-workflow/2feed332-3566-4984-8dad-fded755a64da/scratchpad/live-preflight`.

The saved `childenv.mjs` and `scheduler-recorder.mjs` contained literal newlines inside
single-quoted JavaScript strings. Their scratch-only repairs use `\n`; `node --check`
now succeeds. New scratch helpers `auth-entry.mjs`, `auth-visible.ps1` and
`preflight-resume.mjs` reuse the fixture's complete four-variable child environment.
All resolved output homes and the scheduler recorder are checked inside that fixture.
No credential file was copied or read by the executor. Login output is shown directly
to the user, not saved as evidence.

The installed CLIs' help confirmed `claude auth login`, `claude auth status`,
`codex login`, `codex login status`, `--device-auth`, and the Codex `-c` override.
Two visible PowerShell terminals were launched for the user's own browser authorization.
Codex login used file credential storage in the disposable home only.

- Codex login exited 0. `codex login status` under the same child environment reported
  `Logged in using ChatGPT`.
- The fresh non-secret real-home configuration fingerprint comparison returned
  `{"changed":[],"count":0}` after that login.
- Codex preflight run `01a0a292-5b66-7fe3-b4e0-72952e57b094` exited 0 and reported
  `HOST_READY`, but its verifier did not obtain the sentinel: automatic policy review
  rejected `Get-Content -LiteralPath fixture.txt -Raw` with `blocked by policy`.
  An exit code of 0 is not a passing capability preflight.
- Claude login exited 0; its isolated `auth status` returned `loggedIn: true` and
  `authMethod: claude.ai`. The second non-secret real-home comparison again found no changes.
- Claude print-mode preflight `11a83256-cbbd-4f0c-a2df-2c0677a1465a` returned HOST_READY,
  actually invoked one native `my-flow:verifier`, and returned the exact fresh sentinel
  `HOST_PREFLIGHT_bafc073f-7592-4922-be95-893cd7440d03`. The result's subagent statistics
  report one spawned and completed verifier, zero failures and zero permission denials.
  The host also reported writing a plan-mode scratch file despite the no-edit prompt;
  this is a recorded deviation, not a claim of a completely unchanged fixture.
- Print-mode absence of goal tools does not establish absence of the interactive `/goal`
  command. A fresh interactive startup still required first-run setup. The user-facing
  `claude-interactive-visible.ps1` opens that setup and asks the user to inspect `/help`
  without creating a goal. The user then supplied the live `/help` output:
  `Goal / No goal set / /goal <condition> to set one`. This is user-observed evidence
  of the interactive goal surface, not an agent-created goal.

An independent architect inspected the Codex raw transcript. The parent rollout
`rollout-2026-09-15T08-58-15-01a0a292-5b66-7fe3-b4e0-72952e57b094.jsonl`, under fixture
`homes/codex/sessions/2026/09/15/`, records actual `collaboration.spawn_agent` at line 13,
child identity at line 15, and `get_goal`/`goal: null` at lines 19/21. These native events
were omitted from the exec JSON stream. The child rollout
`rollout-2026-09-15T08-58-27-01a0a292-87e2-7a33-ba85-7955d339e910.jsonl` records
`approval_policy: never`, `sandbox_policy: read-only` at line 15, the read command at
line 20 and policy rejection at line 22. There is no pending approval to approve and
no recorded rule that explains the rejection. No alternate route retried the rejected read.

Raw non-auth preflight evidence: fixture `observations/resume-codex-preflight.stdout.txt`,
`.stderr.txt` and `resume-codex-preflight-input.json`. Non-secret fingerprint evidence:
`observations/resume-real-homes-before.json` and `resume-real-homes-after.json`.

## UI observations and correction

`browser_open` with `headless: false, temporary: true` succeeded. After the user approved
`Emulation.setDeviceMetricsOverride`, the actual viewport was 390 x 844 CSS pixels.
The original sidebar consumed 220px and the remaining content overflowed horizontally.
See `linked-evidence-390-before.png` in this directory.

The initial production edit in this resume pass was the narrow-screen media block in
`web/app.css`: the navigation sits above content at widths up to 700px, navigation links
use three columns, long content wraps, and the progress bar can shrink.

The user-approved CSS refresh and DOM measurement returned:

```json
{"viewport":{"width":390,"height":844},"clientWidth":370,"scrollWidth":370,"theme":"system","overflowing":[]}
```

The 20px difference is the existing page scrollbar. The screenshot shows the system dark
palette. Saved screenshots: `linked-evidence-390-dark-after.png` and
`linked-evidence-1280-dark-after.png`.
The older UI observation file called its desktop measurement 1280px, but explicitly records
1264px; that historical reading is not exact 1280px evidence.

### Fresh disposable UI fixture observations

The current source server serves the isolated root
`C:/Users/qiujm/AppData/Local/Temp/my-flow-ui-resume-xC5KA3` at
`http://127.0.0.1:63360/`. Its reproducible setup is `ui-resume-fixture.mjs` in this
directory. Stable fixture identity: `97285860-ba03-400a-9963-4bd8dfe6fa09`.
Native keyboard/viewport operations were observed through the Codex in-app browser.

| Fixture | Palette | innerWidth | clientWidth | scrollWidth |
| --- | --- | ---: | ---: | ---: |
| concise v2 / unknown dependency / missing evidence | light | 390 | 370 | 370 |
| concise v2 / unknown dependency / missing evidence | dark | 390 | 370 | 370 |
| concise v2 / unknown dependency / missing evidence | light | 1280 | 1260 | 1260 |
| concise v2 / unknown dependency / missing evidence | dark | 1280 | 1260 | 1260 |
| long legacy task | light | 390 | 370 | 370 |
| long legacy task | dark | 390 | 370 | 370 |
| long legacy task | light | 1280 | 1260 | 1260 |
| long legacy task | dark | 1280 | 1260 | 1260 |

All concise task actions and completion results were visible with `details.open: false`.
At 390px the panel's actual bounds were x=16, width=338, right=354; the page client width
was 370. No element in main/navigation exceeded that width. Full-page native screenshots
of the light fixture were emitted in this task's browser observations. One in-app screenshot
appeared cropped at its right edge, so the table reports direct DOM dimensions, not inferred
dimensions from that image.

Keyboard observations: native Enter on T-01 exposed named AC-01/D-01/T-02 links, with
active SUMMARY and `:focus-visible` true. Native Enter on the named AC-01 link navigated to
the stable acceptance URL; browser Back returned to the change URL. Typing `l`/`d` then
Enter in the theme combobox selected light/dark, with focus on `theme-trigger`.
An attempted separate Tab sequence encountered a refreshed, collapsed disclosure; it is
not recorded as a successful tab-order check. After a settled navigation, focus was observed
on BODY rather than the heading; final review should assess this against the keyboard requirement.

SSE observations, without browser reload:

1. Changed T-01 from `1.1 Read the task title` to `4.7 Read the refreshed task title` in the
   disposable ledger. The visible row updated; T-01 identity and its named links remained.
   Connection was `live`, hash stayed `#/changes/ui-reading`, focus stayed on `theme-trigger`.
2. On the stable AC-01 URL, renamed its title to `Refreshed completion conditions`.
   Its visible heading updated while the URL and live connection stayed unchanged.
3. Moved only the disposable change directory inside its own root to
   `changes/archive/2026-09-15-ui-reading`. The unchanged stable acceptance URL showed
   `archived`, the new file path and the renamed task in its reverse links. This was a
   relocation/resolver test, not a claim of verified archive publication.

The in-app browser viewport override was reset after these observations.

### Keyboard failure diagnosed and repaired

The previously observed disclosure collapse and BODY focus were genuine read-feedback
effects. Each locked API read created/deleted `changes/.transactions/intent.lock`;
the watcher broadcast those paths and triggered another client read. A fresh native watch
captured repeated lock create/change/delete events without a source edit. Both new
SSE regressions failed before the fix (`resume-sse-regression-before.log`).

`scripts/dashboard.mjs` now excludes transient lock/server-state files and their synthetic
container entries from metadata snapshots while traversing actual journal children. It
compares snapshots once per notification burst, including coarse directory-only events;
polling uses the same filtered path/type/file-metadata representation. Journal create/delete
and task writes remain observable. `web/app.mjs` recognises ancestor-directory events and
routes file-editor updates through its existing in-place update branch.

The server was restarted against the final candidate. Fresh browser checks then observed:

- T-01 stayed expanded across subsequent calls and a separate read-only API request.
- Tab from T-01 SUMMARY focused `AC-01 — Refreshed completion conditions` with the correct href.
- Enter followed that link; the settled active element was H1 with text `AC-01`.
- Browser Back restored the `ui-reading` page.
- Both palettes were remeasured at 390/1280 after the fix with the same zero-overflow
  dimensions above, and all task details were closed during the task readability reading.

The independent architect reviewed this remedy as within the existing T-08 boundary.
Targeted dashboard/UI/style suites passed 98/98, including native-watch, coarse-event and
forced-polling regression coverage (`resume-ui-sse-tests.log`).

### Honest blockers versus a frozen test

`test/workflow.test.mjs` formerly required T-29/T-31/T-28 to remain unchecked and to say
`unauthenticated` forever. The second full run failed that assertion after authentication
actually succeeded. Independent review approved replacing it with an assertion that each
live-host task links to a **required** criterion declaring live evidence. Existing tests
still forbid ticking blocked tasks and reject static-only evidence for a live criterion.
The corrected workflow suite passed 56/56 (`resume-workflow-recheck.log`).

### Isolation caveat after the longer run

Both immediate post-login fingerprint comparisons found no changes. A later comparison
found one changed non-secret file, real-home `.my-flow/models-state.json` (last-write time
2026-09-15 09:12:38 local). The origin has not been established; the executor did not restore
or edit that file. Do not claim that the entire longer verification interval left every
monitored home path unchanged. All other watched configuration paths matched the initial
fingerprints. This caveat is supplied to independent verification.

## Fresh checks after the CSS correction

- `node --test test/styles.test.mjs test/ui.test.mjs test/markdown.test.mjs`: 59 passed,
  0 failed, 0 skipped (`resume-ui-tests.log`).
- `node scripts/build.mjs`: build complete, no generated changes.
- `node scripts/build.mjs --check`: generated files current.
- `node scripts/spec.mjs validate linked-evidence-workflow`: 1 passed, 0 failed.
- `npm test`: 546/547 passed; the `models.test.mjs` launchCheck timing assertion failed
  at about 1045ms (`resume-full-tests.log`).
- `node --test test/models.test.mjs`: isolated retry 21/21 passed
  (`resume-models-recheck.log`). This does not erase the earlier full-suite failure.
- `git diff --check`: no whitespace errors at the time checked.
- First complete final-gate run after the fixes: 550/550 passed, no failures/skips/TODOs
  (`resume-final-gate-1.log`). The earlier two failed runs remain recorded above.
- Cleanup removed an unnecessary export from the new internal path-matching helper;
  `git diff --check` was clean. The second complete run after cleanup also passed
  550/550 with no failures/skips/TODOs (`resume-final-gate-2.log`). Build/check and
  structural validation passed again before that run.

## Independent final attempt

V-2 was opened after the final source edit and the two required gate passes. Its implementation
digest is `1d98c74b544db902dced78cee4fe38868b0f319e58c6080f44d5f015b31a416f` and contract
digest is `fe714caad44fce5b6c93c4b524a94c850a58387b13e484ee5d434bd05d52c399`.
Native verifier `/root/final_verify_v2` receives the full final-verifier packet and must run
its own checks. No final verdict is inferred from the executor's successful tests.

No final PASS is claimed. A final version-bound independent verification must follow
completion of the outstanding observations and fresh required checks.
