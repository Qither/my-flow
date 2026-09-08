---
name: interview
description: "Socratic interview that turns a vague idea into a change proposal (changes/<name>/proposal.md) with explicit non-goals and decision boundaries. Use when a request has no acceptance criteria or file anchors, or when the user says \"interview me\"."
argument-hint: "<idea> [--quick] [--change <name>]"
allowed-tools: "Read Grep Glob Bash(git log:*) Bash(git status:*) Bash(node:*) Write AskUserQuestion"
---

# Interview

Turn an idea into a `proposal.md` that a planner can act on without guessing. One question
per round. Intent before implementation detail.

Input: $ARGUMENTS

## When to use / skip

- Use when the request has no acceptance criteria, no file or symbol anchors, or asks
  "should we ...". Also when the user explicitly asks to be interviewed.
- Skip (go straight to /my-flow:mf-plan or /my-flow:execute) when the request already names the
  files or symbols, the expected behavior, and how to check it.

## Flags

- `--quick`: threshold 0.30, max 5 rounds. Default: threshold 0.20, max 8 rounds.
- `--change <name>`: attach to an existing `changes/<name>/` instead of creating one.

## 1. Preflight (no questions yet)

1. Read the project `CLAUDE.md` / `AGENTS.md` and any `specs/**/spec.md` that cover the
   touched area.
2. Run `git log -10 --oneline` and `git status --short` for recent context.
3. List every unknown you would have to ask about, then route each one:
   - `[from-code]` answer it yourself by reading the code. Never ask the user.
   - `[from-code needs-confirm]` you found a pattern; confirm in one line ("I found X in
     `path`; follow that?").
   - `[from-user]` intent, scope, trade-offs, success definition. Only these become rounds.

## 2. Rounds

Ask exactly one question per round, targeting the weakest dimension, in this order:
Intent -> Outcome -> Scope and non-goals -> Decision boundaries -> Constraints -> Success
criteria -> (brownfield) Context.

- Stay on a thread until it is one layer deeper than the user's first answer.
- Do at least one pressure pass: revisit an earlier answer with an evidence, assumption, or
  trade-off follow-up ("You said X; what happens if Y?").
- Optional one-line challenge modes when an answer is thin: Contrarian ("what if the
  opposite is true?"), Simplifier ("what is the smallest version?"), Terminologist ("what
  exactly does <term> mean here?").
- After three consecutive rounds answered from code or research, the next round must ask
  the user for a judgment call.
- Print a header each round: `Round n | Target: <dimension> | Ambiguity: NN%`.

Ask with the AskUserQuestion tool: one question, two to four concrete options, "Other"
is always available. Use free-form prose only when the answer is a value or a name.

## 3. Scoring

`ambiguity = 1 - sum(weight_i * clarity_i)` with clarity in [0, 1] per dimension.
Weights: intent 0.30, outcome 0.25, scope 0.20, constraints 0.15, success 0.10.
Brownfield: intent 0.25, outcome 0.20, scope 0.20, constraints 0.15, success 0.10, context 0.10.
Show the six-row table after every round.

## 4. Readiness gates (all required, even below threshold)

- `## Non-Goals` is explicit and non-empty.
- `## Decision Boundaries` states what the agent may decide alone and what needs the user.
- At least one pressure pass happened.
- Do-Not-Touch areas and Rebuild / Re-run steps are named, or explicitly "none".

## 5. Exit

Exit at threshold plus gates, or at round 4+ with a warning if the user asks to stop, or at
the hard cap. Never exit silently; always print the handoff block.

## 6. Outputs

1. Unless `--change` was given, create the change with `/my-flow:spec new <name>`
   (kebab-case slug of the idea), or `docs/changes/<name>.md` from the template in simple mode.
2. Write `proposal.md` with: `## Why`, `## What Changes`, `## Non-Goals`,
   `## Decision Boundaries`, `## Capabilities` (new / modified, or "none"), `## Impact`,
   `## Success Criteria`.
3. Save the transcript to `.my-flow/interviews/<name>-<timestamp>.md`.
4. Write `.my-flow/state/current-change.json` as `{"change":"<name>","stage":"interview"}`.

## Handoff (always the last thing you print)

```
## Handoff
Change: changes/<name>    Ambiguity: 0.NN (threshold 0.NN)
Residual risk: none | <one line>
Next: /my-flow:mf-plan <name>   (or /my-flow:execute <name> if the design is trivial)
```
