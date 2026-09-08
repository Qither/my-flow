---
name: my-flow-mf-verify
description: "Independent, read-only verification of a change against tasks.md, spec scenarios, and design.md constraints, with fresh evidence and a PASS / FAIL / INCOMPLETE verdict. Use before any \"done\" claim, or when the user says \"verify the change\". (Distinct from the built-in verify skill.)"
argument-hint: "<change-name | acceptance criteria>"
---

# mf-verify (independent verification)

Verification is a separate pass from writing. Never verify in the context that produced the
code; delegate to the read-only `verifier` role and relay its report.

Input: {{ARGUMENTS}}

## Steps

1. Assemble the criteria:
   - every line of `changes/<name>/tasks.md` (ticked boxes are claims to check),
   - every `#### Scenario:` (WHEN / THEN) in `changes/<name>/specs/**` and the touched
     `specs/**`,
   - `design.md` `## Do-Not-Touch` and `## Rebuild / Re-run After Change`,
   - or, without a change, the acceptance criteria given in the input.
2. Delegate to the `verifier` role with the criteria list, the change directory, and
   `git diff --name-only <base>` for the change. Instruct it to run every check itself.

Spawn the native `verifier` subagent. Remind it that it must not edit files.

3. The verifier must:
   - run build, tests, type-check, and project verification commands and quote fresh output,
   - grep changed files for fake-completion patterns (placeholder TODOs, `test.skip`,
     `.only`, stub returns, unimplemented throws),
   - confirm `git diff --name-only` contains nothing under Do-Not-Touch paths,
   - confirm each Rebuild / Re-run step ran after the last relevant edit, or run it,
   - mark each criterion VERIFIED / PARTIAL / MISSING with the evidence used.
4. Save the report to `.my-flow/verify/<name>-<timestamp>.md`.
5. Relay the verdict verbatim. If FAIL or INCOMPLETE, list the gaps as the next tasks; do
   not soften the verdict.

## Report format

```
## Verification Report
### Verdict: PASS | FAIL | INCOMPLETE
### Evidence (command -> result)
### Criteria (id | VERIFIED / PARTIAL / MISSING | evidence)
### Blockers and gaps
### Recommendation
```
