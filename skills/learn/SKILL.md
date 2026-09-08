---
name: learn
description: "Extract a reusable skill from what this session figured out, behind a three-question quality gate, and write it where both Claude Code and Codex can load it."
argument-hint: "[skill-name] [--dry-run]"
allowed-tools: Read Grep Glob Write
disable-model-invocation: true
---

# Learn (skill extraction)

Input: $ARGUMENTS

## Quality gate (all three must be true, otherwise "document only")

1. Could someone find this with five minutes of searching? -> must be **no**.
2. Is it specific to this codebase, project, engine setup, or workflow? -> must be **yes**.
3. Did it take real debugging, design, or operational effort to discover? -> must be **yes**.

Prefer skills that encode decisions, constraints, pitfalls, and verification steps. Generic
snippets and library usage belong in documentation, not skills.

## Steps

1. Identify the repeatable task this session accomplished. If none passes the gate, say so
   and offer a short note for `docs/` instead.
2. Extract: inputs, ordered steps, success criteria, constraints and pitfalls, verification
   evidence, and the commands that proved it.
3. Draft one `SKILL.md` with YAML frontmatter `name`, `description` (starts with what it does
   and when to use it), `argument-hint`, followed by: When to use, Steps, Verification,
   Pitfalls.
4. Write the same file to both locations so both tools see it:
   - `.claude/skills/<name>/SKILL.md`
   - `.agents/skills/<name>/SKILL.md`
   Use `$ARGUMENTS` style only where the tool supports it; otherwise describe the input in prose.
   With `--dry-run`, print the draft only.
5. List anything still too fuzzy to encode safely (unresolved branches, environment
   assumptions). Promote the skill to `~/.claude/skills/` or `~/.codex/skills/` only when the
   user asks.

## Output

- Proposed skill name and target paths
- The complete SKILL.md
- Open questions, if any
