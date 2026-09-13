# Independent verification: `model-gateway` (second pass)

Repository: `H:/CommonProject/workflow/VibeCoding/my-flow-browser` (MB)
Date: 2026-09-13, 07:54Z
Supersedes: `.my-flow/verify/model-gateway-2026-09-13T07-28-56Z.md` (FAIL)
Context: an independent verifier that did not write this code. Every number below was measured
in this session. Nothing was taken from the hand-off note; each of its five claims was re-tested
against the tree, and one of them turned out to be incomplete in a way that matters.

### Verdict: PASS

The blocker is genuinely fixed — confirmed three ways, including by reverting the fix myself and
watching the new test fail. The 9.4 re-base is correct: I checked all nine `<` lines
individually and **none is a loss of a sibling's text**.

Two things are recorded below that are not blockers but should not be lost:

- a real coverage hole on the `.catch` exit, located by per-exit mutation (the behaviour there
  is correct; nothing would catch it regressing);
- a **cross-change hazard that must be settled before either sibling archives**:
  `extension-bridge`'s `Audit record` block has *not* been re-based, and archiving it after
  `model-gateway` would erase both temp-profiles' and model-gateway's contributions.

---

## 1. The blocker is fixed

### The fix

`gateway/llm-server.mjs:251` captures the id once, beside `started`, and all three exits read the
capture:

```js
const requestCallId = currentCallId;   // :251, inside req.on('end')
...
callId: requestCallId,                 // :258 finish, :312 .then, :329 .catch
```

`currentCallId` is now assigned at `:185` and `:362` and **read exactly once**, at `:251`. I
grepped for every occurrence; no path reads the live variable any more.

### Confirmed by re-running the three probes that produced the FAIL

Same scratch probes as last pass, unchanged, against the current tree:

| Probe | Before | Now |
|---|---|---|
| 1 — tag under `setCurrentCall(null)` then `'CALL-B'` | event drained under **CALL-B** | drained under **CALL-A**, `CALL-B` empty |
| 2b — reply lands **between** the two calls | swept line `callId=null` | swept line carries **call one's id** (`3fdc8a1b…` = call one's record) |
| 2 — reply lands **during** the next call | model line before **call two's** record, carrying call two's id | swept after the last record, carrying **call one's id**; no model line before call two's record |

Both arrival windows now match the delta spec's *A late model event is never attributed to the
following call* and *A model line left over at session close has no call to precede*, on the real
server rather than on a stub.

### The happy path is unaffected

Re-ran my end-to-end probe (real Stagehand, real Chromium, real lazy gateway, schema-aware fake
provider):

```
browser_extract -> allow     fields: {"heading":"value-for-heading"}
RECORD  tool=browser_open    decision=allow   route=-     callId=7fa79937-...
model   tool=-               decision=routed  route=fake  callId=4cf2edc2-...
model   tool=-               decision=routed  route=fake  callId=4cf2edc2-...
RECORD  tool=browser_extract decision=allow   route=-     callId=4cf2edc2-...
provider endpoint in audit? false
```

Two model lines immediately before their own call's record, all three sharing one `callId`, a
call that made no model request still carrying its own distinct id, no endpoint in the file.

### The capture point is correct, with one bounded caveat

The capture sits in `req.on('end')`, next to `started`, so it is taken when the body is complete
rather than when the headers arrive. The two are the same instant for every request the harness
actually makes, and the window between them is a loopback body upload. It is not literally zero
for an 8 MiB vision body, and the strictly tighter point is the `createServer` callback — where
`started` arguably belongs too. I am not raising this as a defect: no caller can reach that
window today (`browser-vision` is unreachable from any tool by construction), and the fix as
written closes every reachable case. Worth a sentence in the code if anyone revisits it.

---

## 2. I reverted the fix myself, as asked

**Full revert** — all three `requestCallId` reads back to `currentCallId`:

```
mutated occurrences: 3
✖ the real gateway stamps a model event with the call that made the request,
  not the one current when the provider answers (13.0388ms)
ℹ tests 86   ℹ pass 85   ℹ fail 1   ℹ skipped 0
```

Exactly one failure, and it is the right test. The stub test at `:1943` passes throughout, which
confirms last pass's diagnosis rather than resting on it: the stub could never have caught this.

`gateway/llm-server.mjs` was restored from a byte backup and verified —
`md5 a7fa950ba26dceb13968c4d80e916ca9` before and after, on every mutation below as well. The
tree is exactly as I found it.

---

## 3. Your coverage question, answered by per-exit mutation

You asked whether the new test covers the second arrival window (the sweep-at-close, `callId:
null` case). Rather than reason about it, I reverted each exit **on its own** and ran the suite:

| Reverted exit | Result | Meaning |
|---|---|---|
| `:258` `finish` (refusals) | **86 pass, 0 fail** | uncovered — but `finish` is called synchronously inside the `end` handler, so `currentCallId` cannot have moved. Capture and live read are equivalent here. **No test needed.** |
| `:312` `.then` (success) | **85 pass, 1 fail** | covered by the new test |
| `:329` `.catch` (async provider failure) | **86 pass, 0 fail** | **genuinely uncovered, and genuinely racy** |

**On the null window specifically: not directly exercised, but adequately guarded.** Both arrival
windows hinge on the single read at `:312`; a regression that reintroduced a live read is caught
by the new test whichever window a user happens to hit. And the audit-level half of the scenario —
that the sweep writes the leftover after the last record with the originating id — *is* asserted,
by the stub test at `:1943`, which drives the real `Gateway.close()`. The two tests are complete
together even though neither is complete alone. **I would not add a second test for that window.**

**The gap that is real is a different axis: the `.catch` exit.** A provider that fails *slowly* —
a timeout, an unreachable host after a delay, a bad reply — lands asynchronously exactly like a
success, so it races with `setCurrentCall` in precisely the same way. The shipped behaviour there
is correct; I checked it rather than assuming:

```
http status: 502
drain CALL-B: []
drain CALL-A: [{"callId":"CALL-A", ..., "reason":"the provider answered 500",
                "outcome":"error","status":500}]
```

(That probe also incidentally confirms the provider's own body is not echoed: the fake answered
`nope`, the reason says `the provider answered 500`.)

So: **one assertion on the `.catch` path would close the last hole.** The cheapest version is to
give the existing regression test a sibling where the held provider answers 500 instead of 200 and
assert the event still drains under `call-one`. Not a blocker — the behaviour is right today, and
this is guard depth, not correctness.

---

## 4. The 9.4 re-base — all nine `<` lines, individually

`cur = 52`, `delta = 78`, both anchored exactly on `### Requirement: Audit record`, so the
empty-extraction floor task 9.4 specifies is satisfied and the comparison is real. Your count of
9 is right. Here is each one.

| # | Dropped line | Verdict |
|---|---|---|
| 1 | `<!-- via: 2026-09-12-temp-profiles -->` → `<!-- via: 2026-09-12-request-interception -->` | **Harmless.** `spec.mjs:90-93` `stampVia` **strips every via marker in the block** and inserts one naming the archiving change — its own comment says "a MODIFIED delta is often a copy of the current block, old marker included". Both ADDED and MODIFIED go through it (`:108`, `:113`). The stale marker is overwritten at archive. |
| 2 | `...masked values SHALL never be written. Lines carrying \`kind: "blocked"\` (one per tab,` | **Reword.** Split into three lines; `masked values SHALL never be written.` and the `kind: "blocked"` clause both survive verbatim, with the generic rule inserted between them. |
| 3-5 | `and \`urlHost\`, and no \`tool\` or \`decision\`) are not call records: they SHALL be excluded from the / one-line-per-call count, SHALL be written by the gateway immediately before the record of the call / that carried them, and SHALL never appear for a call whose tab refused nothing.` | **Reword, nothing lost.** The "not call records / excluded from the count / no `tool` or `decision`" clause is hoisted verbatim into the new generic `Lines carrying a \`kind\`` rule; "SHALL be written by the gateway immediately before the record of the call that carried them, and SHALL never appear for a call whose tab refused nothing" is preserved word for word. |
| 6-7 | `- **THEN** the day's file has seven new lines, each parsing with the required fields and / \`decision: "allow"\`` | **Reword + addition.** Becomes "seven new lines carrying no `kind`, each parsing with the required fields, each carrying a `callId`, and `decision: "allow"`". Strictly stronger. |
| 8 | `call's own record, the lines with a \`decision\` still number one per call, and a call on a tab` | **Reword.** `the lines with a \`decision\`` → `the lines with no \`kind\``, the same set under the generic rule and exactly the filter task 5.6 put into `test/e2e.test.mjs:107`. |
| 9 | a blank line | **Whitespace.** The current block carries a *double* blank at lines 39-40; the delta normalises it to one. No text. |

**None of the nine is a loss of a sibling's text.** Confirmed independently three ways:

- temp-profiles' contribution produces **zero** `<` lines — its `tempProfile`/`seededFrom`/
  `seeded` paragraph and both its scenarios are byte-identical in the delta (10 matches for those
  three tokens).
- every `#### Scenario:` heading in the current block is present in the delta (5 of 5 `OK`), and
  the delta adds 2.
- the `kind:` token set grows and never shrinks: current `{blocked}`, delta `{blocked, model}`.

**I also checked the block 9.4 does not mention.** The second MODIFIED requirement, *Model path
refuses without a gateway*, is stale-prone for the same reason. It is clean: `cur = 20`,
`delta = 46`, **zero `<` lines** — a pure superset — and no sibling change modifies it.

`spec validate model-gateway` → `ok`, exit 0, with the expected overlap warning.

---

## 5. Cross-change hazard — this must be settled before either sibling archives

`design.md:137-138` says the user directed both changes to archive, "each running its own task
9.4 re-base against the then-current spec first so neither sibling's requirements are lost."
`model-gateway` has done its half. **`extension-bridge` has not**, and the consequence is
measured:

```
extension-bridge  changes/extension-bridge/specs/browser-harness/spec.md  "Audit record" block
  49 lines
  callId mentions                  : 0
  tempProfile / seededFrom mentions: 0
  scenarios: One record per call | Unsafe payload | Blocked lines
             | The granted target is on every record | A grant transition is an event line

  MISSING #### Scenario: A temporary task's records name its profile and its source
  MISSING #### Scenario: An ordinary task's records gain none of the new fields
  MISSING #### Scenario: Model lines sit beside call records without counting as calls
  MISSING #### Scenario: A model line left over at session close has no call to precede
```

Because `mergeDelta` **replaces** a MODIFIED block wholesale (`spec.mjs:111-114`), archiving
`extension-bridge` after `model-gateway` would delete temp-profiles' entire contribution *and*
model-gateway's — the `kind: "model"` paragraph, the appended `callId` call-record sentence, the
generic `kind` rule and both new scenarios. Archiving it *before* `model-gateway` is no better:
`model-gateway`'s delta, re-based this morning onto the 52-line block, does not yet carry
extension-bridge's `grantedTarget` sentence or its two scenarios, so it would erase those instead.

This is not `model-gateway`'s defect — task 9.4's own text says a sibling re-basing after this
change archives is outside any task it can carry — and it does not affect this verdict. But
**whichever sibling archives second must re-base first**, and if the two are archived back to
back the second re-base has to happen *between* them, against the spec as it stands at that
moment. The `spec validate` overlap warning is the standing signal for exactly this.

---

## 6. The reworded clauses, re-judged

- **9.2 — now accurate.** It names `test/gateway-llm.test.mjs`, `test/e2e.test.mjs` and
  `test/generate.test.mjs`, and records why the third was added. Re-measured against the tree:
  `git status --porcelain test/` lists the same twelve entries, those three are this change's, and
  the other nine attribute to `extension-bridge` (`bridge`, `cdprelay`), `temp-profiles`, and
  `harness-core` / `request-interception`. The placeholder grep over `gateway/ llm/ test/
  scripts/cli.mjs scripts/spikes/gateway-*.mjs` is **empty**. No new test file was added — the
  regression test lives inside `gateway-llm.test.mjs`.
- **7.3 and 9.1 — still true, re-measured fresh this pass.** `node scripts/cli.mjs audit` →
  report `network-2026-09-13T07-53-28-515Z.md`. The scenario printed `model gateway port: 59417`
  and the **network log itself** (`.jsonl`, which is what the clause names, not the rendered
  report) carries **3 rows** of `"host":"127.0.0.1","port":59417`. All 20 destinations, 8 outside
  loopback, and a filter for any non-loopback line *not* marked `refused by the audit proxy`
  returns nothing. `only loopback destinations: no`, as the delta spec already says it must be;
  output preserved unedited. `node scripts/cli.mjs doctor` prints `gateway: managed loopback
  (lazy)` and `gateway table: configured, 2 routes (browser-vision, browser-extract)` — no
  endpoint, key, model name or provider name.
- **9.3 — still true**, and discharged by section 7.
- Nothing in any of the four now asserts something untrue.

---

## 7. D1 row 4, by name

Unchanged since my last pass, and my reading is unchanged, so I will not re-argue it — only
record the state task 9.3 requires this report to name.

`design.md:109` still carries `Exit criterion D1 (row 4): UNMET — routing table empty by U2
(2026-09-12).` verbatim, and `design.md:131` records **MET, and the change is cleared to
archive — 2026-09-13**. That block's reasoning holds **on its own terms**, which is what it
claims: the earlier block set the condition "not archived until the user names a provider", the
user has named one, and `doctor` confirms a live two-route table without naming an endpoint, a key
or a provider — the only way this repository reads its state.

The criterion's *literal* wording ("LLM observe / extract / self-heal verified end to end with the
user-chosen routing table") is still evidenced only by direct `/llm` probes against the user's
provider (`.my-flow/verify/gateway-activation-20260913.md`), not by a `browser_extract` run. Two
of its three limbs are unreachable by construction — observe is deterministic, `selfHeal: false`.
What my probe adds is that nothing in the harness stands in the way: the same `browser_extract`
path succeeds end to end against a fake provider, so the remaining gap is purely "with the user's
own table", which only the user can close and which they effectively waived by directing archive.
I again did not run `browser_extract` against their table — it would spend their credits and send
page-derived text to their provider, which is their call, not a verifier's.

**D1 row 4 is not a reason to hold this change back.**

---

## 8. Everything else, re-measured this pass

| Check | Result |
|---|---|
| `npm test` | **450 tests, 450 pass, 0 fail, 0 skipped, 0 todo**, 510.1 s, exit 0 — the +1 is the new regression test |
| Guard order in `llm-server.mjs` | unchanged: 404 → `BAD_HOST` → `BAD_TOKEN` → 415 → 413; `routeFor` at `:277` still precedes `JSON.parse` at `:289`, so the body is never consulted for routing |
| File footprint of the fix | 379 → 385 lines: the capture plus a five-line comment. Nothing else moved |
| `llm/generate.mjs` | mtime changed but content did not — 224 lines, every step-4 landmark at the same line (`GATEWAY_NOT_LOOPBACK :157`, `fetch :164`, `EMPTY_TABLE :198`, `return await response.json() :213`). A touch, not an edit |
| New test's home isolation | uses `readWritten` → `home(t)` → `makeTmp`, reading by explicit path; `MY_FLOW_HOME` never involved, real file never read |
| `spec validate model-gateway` | ok, exit 0 |
| Operator's `gateway.json` | **never opened, grepped or echoed** in this pass. State read only through `doctor` |
| Tree left as found | `gateway/llm-server.mjs` md5 `a7fa950ba26dceb13968c4d80e916ca9` before and after all four mutations |

---

## 9. What I recommend, in order

1. **Nothing blocks the change.** Tick 9.3 on this report.
2. **Settle the archive order with `extension-bridge` before running `spec archive`** (section 5).
   Whichever goes second must re-base its `Audit record` block against the spec as it stands at
   that moment, not as it stands now.
3. **Add one assertion on the `.catch` exit** (section 3) — the held-provider test with a 500
   instead of a 200. Small, and it closes the only remaining mutation that survives.
4. Optional, already named in the ledger: make `audit/scenario.mjs`'s fake provider schema-aware,
   so the canary asserts an extraction instead of an error. My probe shows exactly what that takes —
   Stagehand asks for `Extraction ["heading"]` then `Metadata ["progress","completed"]`, and
   answering each from `response_format.json_schema.schema` is enough.

---

### Appendix: what was run

- `npm test` — 450/450, 0 skipped, 510.1 s
- Full revert of the fix + `node --test test/gateway-llm.test.mjs` → 1 failure, the right one;
  then three single-line reverts (`:258`, `:312`, `:329`) run separately; file restored and
  hash-verified after each
- `node scripts/cli.mjs audit` — report `network-2026-09-13T07-53-28-515Z.md`, kept unedited;
  gateway port cross-checked against the `.jsonl` network log
- `node scripts/cli.mjs doctor` — operator home, state only
- `node .../spec.mjs validate model-gateway --root MB`
- Block extraction and full `diff` of both MODIFIED requirements against
  `specs/browser-harness/spec.md`; scenario-heading and `kind:`-token survival checks; the same
  extraction against `changes/extension-bridge/specs/browser-harness/spec.md`
- Reading of `stampVia` / `mergeDelta` in `H:/.../my-flow/scripts/spec.mjs:84-123`
- Five scratch probes under the session scratchpad, none writing to the repository:
  `probe-callid.mjs`, `probe-audit-misattribution.mjs` (+ variant 2), `probe-catch-exit.mjs`,
  `probe-e2e-extract.mjs`
