---
name: ask
description: "Cross-model advisor - get a read-only second opinion from the other CLI (Codex from Claude, Claude from Codex) on a design, a diff, or a stuck decision. Never for implementation."
argument-hint: "<codex|claude> [--diff] [--files a,b] <question>"
allowed-tools: "Read Grep Glob Bash(node:*) Bash(git diff:*) Bash(git log:*) Write"
---

# Ask (cross-model advisor)

Input: $ARGUMENTS

## When to use

- A second opinion on `design.md` before /my-flow:execute.
- A review of the diff before the final gate.
- The plan review loop is stuck after two iterations.
- Unfamiliar SDK, engine, or API behavior where two independent readings reduce risk.

Not for implementation, and not as a substitute for reading the code yourself.

## Steps

1. Decide the provider (`codex` or `claude`). Default to the other tool.
2. Build the prompt file `.my-flow/ask/<timestamp>-prompt.md`:
   - a role preamble: "You are a read-only reviewer. Cite `path:line`. Answer with
     Verdict / Findings / Disagreements / Recommendation.",
   - the question,
   - with `--diff`: the output of `git diff` (or `git diff <base>...HEAD`),
   - with `--files`: the contents of the listed files, each under a `### path` heading,
   - the relevant sections of `proposal.md` / `design.md` when a change is active.
3. Run the advisor script. It reads the prompt from the file, runs the other CLI read-only
   with a timeout, and writes the artifact:

```
node "${CLAUDE_PLUGIN_ROOT}/scripts/ask.mjs" codex --prompt-file .my-flow/ask/<timestamp>-prompt.md
```
Run it with the Bash tool. For long reviews use `run_in_background` rather than a longer
timeout.

4. Read the artifact `.my-flow/ask/<timestamp>-<provider>-<slug>.md` (sections: Original
   task, Final prompt, Raw output, Summary, Action items).
5. Summarize in at most five lines and state explicitly whether you agree, and why.
   Disagreements are resolved by evidence or by the user, never by majority.

## Rules

- The other model is read-only; its output is advice.
- If the script reports a timeout or empty output, say so; do not invent an answer.
- Never pass secrets or credentials in the prompt file.
