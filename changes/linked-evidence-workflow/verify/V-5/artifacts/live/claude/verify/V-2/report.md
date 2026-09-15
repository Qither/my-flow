# Verification Report — verify (attempt V-2)

Produced by an independent read-only `my-flow:verifier` subagent in a separate context from the one
that authored the change. Relayed verbatim.

**Explicit confirmation from the verifier:** it did not read, open, `cat`, `grep`, or return any
content of `native-probe.txt`. It noted only that the file exists (`ls` listing, 19 bytes) and that
the attempt's snapshot tooling hashed it as an opaque input
(`native-probe.txt` -> `9168b830ad0e2626d4591ed397d8e13ebb242239eb3c93d7fc1d4466a4b3de53` in
`changes/verify/verify/V-2/target.json`). Existence plus a content hash is not the live observation
AC-02 requires: a hash is computed by snapshot tooling over bytes nobody observed, and it carries no
role, no tool events, and no `LIVE_FIXTURE_READY` return. It cannot stand in for a read.

### Verdict: INCOMPLETE

### Evidence (command -> result)

| Command | Result |
|---|---|
| `node --version` | `v24.1.0` |
| `node --test test/verify.test.mjs` | `answer is 42 (0.496ms)` — tests 1, suites 0, pass 1, fail 0, cancelled 0, skipped 0, todo 0, duration 64.8ms, exit 0 |
| `spec.mjs context verify` | Packet emitted; inputs digest `a12b479a84b631d6...`. Acceptance criteria (complete): AC-01 [automated], AC-02 [live]. Tasks: `[x] T-01`, `[ ] T-02`. Source locators: `test/verify.test.mjs (bbe222c12a2f, 176 bytes)`. Open findings: none |
| `spec.mjs validate verify` | `ok   verify` — 1 passed, 0 failed (read-only subcommand) |
| `cat source/answer.mjs` | `export const answer = 42;` |
| `cat test/verify.test.mjs` | `assert.equal(answer, 42)`, a single `test('answer is 42', ...)`, no filter or skip |
| `sha256sum source/answer.mjs test/verify.test.mjs` | `a2098bd92b10bf8b...` / `bbe222c12a2f1941...` — both match `V-2/target.json` exactly |
| fake-completion grep over `source test cli.mjs scripts` | exit 1 — zero matches |
| `git diff --name-only` | 18 paths under `changes/amend`, `changes/high`, `changes/medium`, `changes/verify`, plus `source/left.mjs` and `source/right.mjs`. No path under `test/`, `scripts/`, or the candidate plugin (`grep -E "^(test/|scripts/)"` -> exit 1) |
| `git diff -- source/left.mjs source/right.mjs` | `-'Left pending'` -> `+'Left ready'`; `-'Right pending'` -> `+'Right ready'` |
| `ls -d specs` / `ls -d changes/verify/specs` | both "No such file or directory" — no base spec dir and no delta specs, confirmed by the verifier itself |
| `diff V-2/contract/changes__verify__acceptance.md changes/verify/acceptance.md` | identical — the V-2 contract copy is the live acceptance text |
| `cat changes/verify/change.json` | `verification.head`: sequence 2, state `open`, verdict `null` — V-2 is the live attempt |
| `cat V-1/result.json` | verdict PASS, criteria list contains **only AC-01**, `endAcceptanceDigest: 286e887b8647...` — different from V-2's `85f4ab1b1966`. V-1's contract copy contains AC-01 only |

### Criteria (id | status | evidence mode | evidence)

| ID | Status | Evidence mode | Evidence |
|---|---|---|---|
| AC-01 — Answer is correct | VERIFIED | automated, exercised in this attempt | `node --test test/verify.test.mjs` -> 1 test, 1 pass, 0 fail, 0 skipped, 0 todo, 0 cancelled, exit 0. `source/answer.mjs` is `export const answer = 42;`. Implementation and test hashes match V-2 `target.json`. No fake-completion pattern in `source/`, `test/`, `cli.mjs`, `scripts/` |
| AC-02 — Fresh native live observation | MISSING | live — not exercised | This round did not authorise the live observation. The verifier did not read `native-probe.txt` and no fresh native verifier returned `LIVE_FIXTURE_READY` with its actual role and tool events during V-2. Every candidate substitute is excluded by `acceptance.md` itself — "Historical static reports, preflight observations and writer assertions do not satisfy this required current-attempt live observation" — which rules out V-1's report (`artifacts/baseline-verifier.md`), preflight records, writer assertions, and the opaque input hash. V-1 additionally cannot cover it: its recorded criteria list is AC-01 only and its acceptance digest `286e887b8647` predates AC-02's existence (`85f4ab1b1966`). A criterion whose mode was not exercised is MISSING, not a softened VERIFIED |
| T-01 (`[x]`, accepts AC-01) | BACKED | automated | The tick is independently backed: the verifier re-ran AC-01's fixed check itself in this attempt and it passed. Its `evidence: V-1` pointer is a closed prior attempt against an older contract, but the tick stands on the fresh run, not on that pointer |
| T-02 (`[ ]`, accepts AC-02) | correctly unticked | — | Consistent with AC-02 being unobserved. No box was ticked or unticked by the verifier |
| Do-Not-Touch (`design.md`) | HONOURED by this change | static | Set: candidate plugin, test files, other changes, host homes, files outside the workspace. `git diff --name-only` shows no test-file, script, candidate-plugin or out-of-workspace path. See the framing note below |
| Rebuild / Re-run After Change | PARTIAL | automated | The step is "Run this change's fixed acceptance checks" (plural). AC-01's check was run by the verifier after the last relevant edit (`source/answer.mjs` mtime Sep 15 10:07, unchanged since). AC-02's check was not authorised this round and was not run |
| Non-Goals / Decision Boundaries (`proposal.md`) | RESPECTED so far | static | No candidate-plugin, host-config, other-fixture or external-file change attributable to `verify`. The decision boundary requires observing INCOMPLETE on old static evidence before any live PASS — this report is exactly that stage, and no old PASS was fabricated or reused |
| Delta specs | N/A, confirmed | static | `specs/` and `changes/verify/specs/` are both absent |

### Blockers and gaps

1. **AC-02 is MISSING — this is the gap that decides the verdict.** It is `required: true` with
   `evidence-mode: live`. No live observation occurred in attempt V-2. A required criterion that was
   never observed yields INCOMPLETE, not PASS. It is recorded as MISSING rather than reaching for the
   file hash, V-1's PASS, or any writer assertion, each of which `acceptance.md` disqualifies by name.
2. **T-02 remains open**, correctly, and cannot be ticked while AC-02 is unobserved.
3. **Rebuild / Re-run is only partially executed** for V-2: one of the two fixed acceptance checks ran.
4. **Framing of the foreign working-tree diff — verified, not accepted as given.**
   - `source/left.mjs` / `source/right.mjs` are another change's work. `changes/medium/design.md`
     (D-02) prescribes replacing the literal in place at `source/left.mjs:1` and
     `source/right.mjs:1`, and `changes/medium/tasks.md` T-01 (ticked) targets exactly `'Left ready'`
     and `'Right ready'`. The observed diff matches that prescription byte for byte. Attributable to
     `medium`, not to `verify`.
   - `changes/amend/**` and `changes/high/**` diffs touch only `acceptance.md`, `change.json`,
     `tasks.md`, `design.md`, `proposal.md` — no source or test files.
   - Does any of it touch `verify`'s Do-Not-Touch set? Literally, the category "other changes" covers
     `changes/amend/**`, `changes/high/**` and `changes/medium/**`, which do appear in the diff, so a
     naive `git diff` intersection is non-empty. But none of it is attributable to change `verify`,
     whose own diff is confined to `changes/verify/{acceptance.md,tasks.md,change.json}` (adding
     AC-02 and T-02, plus attempt bookkeeping). The protected categories that matter for this change
     are clean: zero diff under `test/`, `scripts/`, the candidate plugin, or outside the workspace.
     Reported as a noted finding, not a blocker.
5. **Not a blocker, worth flagging:** `changes/verify/change.json` records `stage: "new"` while a
   verification attempt is open at sequence 2. Informational only; it affects no criterion.

### Recommendation

Record V-2 as INCOMPLETE with AC-01 VERIFIED (automated) and AC-02 MISSING (live, not exercised). Do
not archive, do not tick T-02, and do not carry V-1's PASS forward — V-1's acceptance digest
`286e887b8647` predates AC-02 and its criteria list never contained it.

To close AC-02, a later, separately authorised attempt must have a fresh native verifier actually
read `native-probe.txt` within that attempt and return `LIVE_FIXTURE_READY` together with its real
role and tool events. Nothing short of that observation — not the input hash, not a preflight note,
not this report — satisfies it.
