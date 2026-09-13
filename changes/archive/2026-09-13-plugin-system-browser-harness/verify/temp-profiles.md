# temp-profiles — independent verification, fourth pass

## Verification Report

Change: `changes/temp-profiles` (repo `my-flow-browser`, MB).
Supersedes `.my-flow/verify/temp-profiles-2026-09-12T14-22-40Z.md`.

### Verdict: PASS

Every success criterion, every spec scenario, every ticked task's verification clause,
`## Do-Not-Touch` and `## Rebuild / Re-run After Change` hold, with fresh evidence below. The
version type hole is closed and I could not reopen it from any JSON shape.

I am changing the verdict because the reasons for the previous three FAILs are gone, not because
the list of open items is empty. The earlier FAILs rested on live defects — an audit record
asserting an isolation the run did not have, then a whole credential printing from `doctor`.
Both are fixed and re-measured. What remains is bookkeeping outside this change's criteria, and
one factual correction to a claim in your message. Those are conditions on 8.4, listed at the
end, not grounds to withhold a verdict the evidence supports.

---

### Evidence (command -> result)

```
npm test
  -> ℹ tests 323 / ℹ suites 0 / ℹ pass 323 / ℹ fail 0 / ℹ cancelled 0 / ℹ skipped 0 / ℹ todo 0
     ℹ duration_ms 353470.94      grep -c "^✖\|not ok" -> 0      (exit 0)

node scripts/cli.mjs doctor -> ... temp profiles: 0 swept                        EXIT=0
node scripts/cli.mjs audit  -> destinations: 17 / only loopback destinations: no
                               report: network-2026-09-12T14-37-18-235Z.md       EXIT=0
```

**The change's own code is byte-identical to what I verified in pass two**, which is what lets
that pass's browser evidence stand without re-running it — a hash is a stronger link than a
repeated measurement:

```
driver/session.mjs  d108ea485c018f40   driver/chromium.mjs 651e25c03b420e8e
gateway/gateway.mjs 47344fd29e3834db   gateway/policy.mjs  23a37eba15d1ad3c
gateway/audit.mjs   afbbaf8d30383a77   driver/actions.mjs  c3fc7ad546665b34
server/tools.mjs    d275fcf6d9355007   scripts/cli.mjs     814a2ac4aac3cec4

47 baseline hashed files | changed but NOT in ledger: (none)
```

**Criterion 2 re-measured fresh this pass** rather than inherited:

```
cookiesForAllowlist, 16 adversarial cases -> mismatches: 0
  sub.example.com under ['example.com']        dropped
  .example.com     under ['example.com']       dropped
  .example.com     under ['.sub.example.com']  dropped
  notexample.com / .notexample.com / .xample.com under ['.example.com']  dropped
  example.com. (trailing dot), '' , null       dropped
  .sub.example.com / evil.example.com under ['.example.com']  kept
taskId uniqueness over 5000 -> 5000 distinct
```

#### The version hole — closed, and I could not reopen it

```
version = ARRAY          ok  unknown version ["[secret:api-key]"], expected 1
version = OBJECT         ok  unknown version {"apiKey":"[secret:api-key]"}, expected 1
version = nested array   ok  unknown version [["[secret:api-key]"]], expected 1
version = deep object    ok  unknown version {"a":{"b":["[secret:api-key]"]}}, expected 1
version = string         ok  unknown version "[secret:api-key]", expected 1
version = number 2       ok  unknown version 2, expected 1
version = true           ok  unknown version true, expected 1
version = null           ok  unknown version null, expected 1
version absent           ok  unknown version undefined, expected 1
protocol = ARRAY         ok  provider "p" is missing `protocol`
provider name            ok  provider "[secret:api-key]" is not an object
ordinary name            ok  provider "cheap" is missing `protocol`
```

and through the surface a person actually reads, exit 0 in every case:

```
node scripts/cli.mjs doctor  (four planted gateway.json files)
  -> gateway table: configured, unusable: unknown version ["[secret:api-key]"], expected 1
  -> gateway table: configured, unusable: unknown version {"apiKey":"[secret:api-key]"}, expected 1
  -> gateway table: configured, unusable: provider "[secret:api-key]" is not an object
  -> gateway table: configured, unusable: unknown version 2, expected 1
```

Deep nesting was the case I most expected to slip, since redaction after serialisation has to
survive arbitrary structure; it does, because the detector runs on the serialised text rather
than on a walked value. `unknown version 2` is preserved, so your numeric regression stays fixed.

#### The unlogged-edits checker

```
bash changes/temp-profiles/unlogged-edits.sh
  -> no unlogged edits: every source file newer than the baseline is named by the ledger
     EXIT=0
```

It is the right instrument and it lives in the right place — under `changes/temp-profiles/`
rather than `scripts/`, so the shipped surface gains nothing, consistent with what 8.2 decided
for `baseline-hash.sh`. Reading the ledger's path field instead of guessing by directory prefix
is correct, and the note recording that false positive is worth keeping.

One blind spot, and it is the same pattern the script exists to break. The `find` allow-lists
extensions — `.mjs .js .json .md .sh` — so a file outside that list is invisible however it
changes. Thirteen in-scope files are not covered:

```
test/fixtures/pages/{auto,download,injection,links,login,page2,payment,popup}.html
scripts/approve.ps1
LICENSE  .gitignore  changes/archive/.gitkeep  specs/.gitkeep
```

The eight fixture pages are the ones that matter: they are the inputs the entire browser suite
asserts against, editing one silently changes what every one of those tests proves, and neither
the baseline (which does not hash them) nor the chain check (no ledger line) nor this checker
would see it. An extension allow-list reintroduces exactly the "remember to add it" dependency
the script's own header says it removes — one level down, which is the shape this change keeps
meeting. Inverting it, so the scan takes everything and excludes by directory the way the `case`
statement already does, removes the class rather than another member of it.

Minor, same file: `grep -qx "$f"` treats the path as a regex, so `.` matches any character.
`grep -qxF` is the fixed-string form. Contrived to exploit, one character to fix.

---

### Criteria (all VERIFIED)

| id | evidence |
|---|---|
| 1. Task runs in `tmp-<taskId>/`, exists while it runs | Pass-two transition matrix (7 transitions) and both MCP repros, linked to now by identical hashes for all eight source files. |
| 2. Seeding filtered by the task's allowlist | Re-measured this pass: 16 adversarial cases, 0 crossings. Pass-one MCP run: `copied:1, dropped:2`. |
| 3. Daily profile refused as a seed source, no file read | Refusal in `gateway.mjs` before the driver; case plus its control pass in the 323. |
| 4. Directory gone at task end, no seeded cookies afterwards | Matrix C/D: `destroyed.ok:true`, prior directory gone, only the live one remains. |
| 5. Abandoned `tmp-*` swept at next start | Pass-one planted-directory run through `doctor`: `leaked:`, `swept:`, `1 swept`, exit 0. |
| 6. Non-temporary sessions behave as today | Matrix E short-circuits with no new browser; 323/323; plain-task records carry none of the new fields; zero deleted lines in the three shared test files. |
| 7. Audit names the profile each call ran in, never a cookie | Pass-two MCP records, corroborated by `Agent-Work` appearing on disk; eight cookie needles absent from the whole audit file. |
| 8. `npm test` passes, nothing skipped | 323/323/0, and the guard is proved to fire: 12 pass / 16 skip under `MY_FLOW_BROWSER_SKIP_BROWSER=1`. |

Every `#### Scenario:` in `changes/temp-profiles/specs/**`: VERIFIED. `specs/**`: untouched,
correct until 8.4. `## Do-Not-Touch`: holds across all 47 baseline files, plus `PROFILE_NAMES`,
the twelve tools, the policy table and the Chromium flag set. `## Rebuild / Re-run After
Change`: all three re-run above. `### Spike results`: three lines, all recorded, none `pending`.
`tasks.md`: 32 ticked, 8.3 and 8.4 open, correct — and **8.2's chain-continuity clause scopes to
shared files, and all fourteen verify head to tail.** That is the distinction that decides this
verdict: the two ledger entries with notes are cross-change files that clause never covered.

The `#endTask` gap is recorded under 5.2, carries the reasoning, and credits the correction I
made to my own earlier phrasing. It also notes `doctor`'s `leaked:` line as the durable operator
surface — which task 6.3 built deliberately for exactly this, and which I under-credited in pass
two when I called stderr the only report. The tension is on the record. That item is closed.

### Your question: neither half is a blocker, and I am revising one of them

**Recording the repair in `changes/model-gateway/`: work for the owning change, not a blocker
here.** It is genuinely worth doing — `model-gateway` will be verified one day against a
`gateway/gateway-config.mjs` that three repairs changed, and without a record its verifier sees
a file altered by an unknown hand. But blocking one change's archive on another change's
bookkeeping is the wrong dependency, and the cross-change ledger line plus `unlogged-edits.sh`
already make the edit discoverable from this side.

**The baseline addendum: do not do it, and that is me correcting pass two's advice.** I said
"add the file's pre-edit hash to a baseline addendum so the head anchors". That was wrong on
reflection. The baseline is a dated snapshot — "captured 2026-09-12T11:06:27Z" — and writing
hashes into it after the fact makes it no longer a record of that moment, which costs more than
the anchor is worth. It is also unnecessary for `gateway/gateway-config.mjs`: its first ledger
line records `before=5d036aeb…`, measured at the time, so its head *is* anchored to a real
measurement, just not to the baseline. For `test/gateway-llm.test.mjs` no pre-edit hash exists
or ever will, and `after=` alone is the honest record. What those two need is what you already
did for unanchored heads — classification, so a checker distinguishes "head anchored by its own
first `before`" from "head unmeasurable, cross-change" and fails on anything that is neither.
Note that an `after=`-only line is silently skipped by any parser requiring both fields, mine
included, so it needs to be classified rather than merely tolerated.

### Blockers and gaps

No blockers.

**C1 (condition on 8.4, one line). The `gateway/gateway-config.mjs` chain still has one
unclaimed window**, and this corrects your message rather than reporting something new. You
wrote that B3's third instance is logged "including the `String(v)` → `typeof` follow-up edit
that had no line". The line that was added covers the *version* fix, a later edit:

```
line 41  before=5d036aeb3415…  after=0b81f799d9f6…   parse-branch leak
line 42  before=0b81f799d9f6…  after=ef57a2098bd0…   five further positions
         ── ef57a2098bd0… → 6f02344abe51… is claimed by no line ──
line 44  before=6f02344abe51…  after=629de9b672aa…   the version type guard
```

The tail is now correct (`629de9b672aa…` == the file's hash), and `test/gateway-llm.test.mjs`
is logged with a matching tail, so both files' current states are accounted for. Only the middle
window is missing. This is not a behavioural risk — I verified the file's current behaviour by
direct measurement across twelve JSON shapes rather than by trusting the ledger — but it is one
line, and it is outside 8.2's clause only by scope.

**C2 (condition on 8.4). `unlogged-edits.sh`'s extension allow-list**, per the thirteen files
above. Invert the filter.

**C3 (condition on 8.4, one word). A dropped token in a code comment.**
`gateway/gateway-config.mjs:55` reads `//  is deliberately NOT used for the version` — the
subject is missing, almost certainly a backtick-quoted `` `safe` `` eaten by shell command
substitution during the edit. The rest of the block is intact and the lesson it records is
right. Worth naming beyond the typo: the same mechanism silently removes content from *code* as
easily as from a comment, and nothing here would have caught it. I scanned the five files edited
this session for the same signature; this is the only instance.

**C4 (condition on 8.4). `tasks.md` still carries no record of the four post-gate code
repairs** — the idempotency guard, the skip guards, the three-stage redaction repair, and the
new checker. The `#endTask` decision is recorded well; these are not. The working agreement
makes `tasks.md` the progress ledger and calls `.my-flow/` disposable, and right now the only
durable trace of these repairs is the code comments, which are good but do not say a gate found
them.

**G2 (gap, unchanged). Sweep liveness is pid-only.** Leaks rather than over-deletes.

**G3 (gap, unchanged, with evidence). `chromeCount()` is machine-global** and was observed
failing `42 !== 41` at `test/temp-profiles.test.mjs:600` under concurrent Chrome.
`session.spawned === 0` on the line above already carries the claim. Delete it.

**G5 (observation, unchanged). `seedCookies` shadows its own `cdp` parameter.** Behaviour is
correct; it reads as a bug.

**Accepted limit, not a finding.** `redact` recognises eight shapes, so a secret in none of them
still passes whole into a reason. That is consistent with the audit and is the reason the
structural answer — not interpolating user-supplied values at all — stays stronger than
redaction, if `model-gateway` opens this file again.

### Recommendation

**Archive it**, after four small things, none of which touches temp-profiles' code: one ledger
line (C1), invert the checker's filter (C2), one word in a comment (C3), and write the 8.3
outcome into `tasks.md` (C4). Delete the `chromeCount()` line (G3) while you are in that file.

Then run 8.4's re-base and `spec archive temp-profiles`. Hand `model-gateway` the record of the
three `gateway/gateway-config.mjs` repairs and the guard-input lesson; that change owns the file
and should carry both.

The change has been sound since pass two. Three passes of this were the gate around it catching
up with it, which is what the gate is for.
