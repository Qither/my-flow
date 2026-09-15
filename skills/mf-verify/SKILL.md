---
name: mf-verify
description: "Independent, read-only verification of a change against tasks.md, spec scenarios, and design.md constraints, with fresh evidence and a PASS / FAIL / INCOMPLETE verdict. Use before any \"done\" claim, or when the user says \"verify the change\". (Distinct from the built-in verify skill.)"
argument-hint: "<change-name | acceptance criteria>"
allowed-tools: Read Grep Glob Bash Agent Write
---

# mf-verify (independent verification)

Verification is a separate pass from writing. Never verify in the context that produced the
code; delegate to the read-only `verifier` role and relay its report.

Input: $ARGUMENTS

## Steps

1. Assemble the criteria:
   - every line of `changes/<name>/tasks.md` (ticked boxes are claims to check),
   - every `#### Scenario:` (WHEN / THEN) in `changes/<name>/specs/**` and the touched
     `specs/**`,
   - `design.md` `## Do-Not-Touch` and `## Rebuild / Re-run After Change`,
   - or, without a change, the acceptance criteria given in the input.
2. Open a version-bound attempt: `/my-flow:spec evidence begin <name> [--inputs <file>]`. It
   captures the exact implementation and contract this report will belong to, and refuses to
   start while an amendment is pending or while the recorded review lane has not approved the
   contract. Give the verifier the attempt number it returns.
3. Build the final-verifier packet: `/my-flow:spec context <name>` with no `--task`. It carries
   every criterion, not a writer-selected subset, and is the only summary the verifier is given.
4. Delegate to the `verifier` role with the criteria list, the packet, the change directory, and
   `git diff --name-only <base>` for the change. Instruct it to run every check itself.

Use an ordinary foreground Agent call with `subagent_type: my-flow:verifier`; omit `name`,
`team_name` and `run_in_background` so teammate routing does not replace the configured role.
Do not run the checks in this
context first; the point is a fresh, independent pass.

5. The verifier must:
   - run build, tests, type-check, and project verification commands and quote fresh output,
   - grep changed files for fake-completion patterns (placeholder TODOs, `test.skip`,
     `.only`, stub returns, unimplemented throws),
   - confirm `git diff --name-only` contains nothing under Do-Not-Touch paths,
   - confirm each Rebuild / Re-run step ran after the last relevant edit, or run it,
   - mark each criterion VERIFIED / PARTIAL / MISSING / CONTRADICTED with the evidence used,
6. Record the result against the attempt, whatever it is:
   `/my-flow:spec evidence record <name> --attempt <n> --result <result.json> --report <file>`.
   The result names every required criterion as VERIFIED / PARTIAL / MISSING / CONTRADICTED and
   its evidence mode; a required criterion that is not VERIFIED cannot produce a PASS, and a
   claim in a mode the attempt did not actually observe is refused rather than downgraded.
   A FAIL or an INCOMPLETE is recorded too — the head is the durable answer, and an older PASS
   is never reinstated by scanning backwards.
7. Save the report to `.my-flow/verify/<name>-<timestamp>.md`.
8. Relay the verdict verbatim. If FAIL or INCOMPLETE, list the gaps as the next tasks; do
   not soften the verdict. `/my-flow:spec evidence status <name>` says whether the change is
   eligible for a verified archive, and why not when it is not.

## Report format

```
## Verification Report
### Verdict: PASS | FAIL | INCOMPLETE
### Evidence (command -> result)
### Criteria (id | VERIFIED / PARTIAL / MISSING | evidence)
### Blockers and gaps
### Recommendation
```
