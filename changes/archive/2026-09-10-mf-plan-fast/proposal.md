## Why

`mf-plan` always runs three subagents in sequence (planner, architect, critic), each of
which re-reads the code, and loops up to three times on `BLOCK` / `REJECT`. That is the
right cost for a change whose design is open, but for a request that already names the
files, the behaviour, and how to check it, it is several times slower than the built-in
`/plan` or Codex's plan mode while adding little. The only shortcut today is the "single
file, just do it" row of the stage table, which produces no `design.md` / `tasks.md` at all,
so the change loses its progress ledger, its verification criteria, and its archive record.

The user wants an explicit fast lane: same artifacts, same downstream flow (`execute`,
`mf-verify`, `spec archive`), a fraction of the review cost, and the option to run straight
into execution.

## What Changes

1. **`mf-plan --fast`.** The main conversation reads the touched files and writes
   `proposal.md` (when given free text), `design.md`, and `tasks.md` itself. No planner
   subagent, no PLAN-DR header, no architect review. Exactly one `critic` review follows;
   on `REJECT` the main conversation applies the fixes once and finishes without a second
   review round, listing any remaining findings. `design.md` carries a `Plan mode: fast`
   line under `## Context`, and the handoff shows `Review: fast (critic OKAY|REJECT-fixed,
   no architect)`. Output format is identical to the full mode, so `spec validate`,
   `execute`, `mf-verify`, and `spec archive` need no change.

2. **Guard.** `--fast` is only honoured when the user passes it; the model may suggest it
   in a handoff but never selects it on its own. When the proposal or free text touches
   auth, migrations, destructive operations, public API changes, build config, shaders, or
   engine modules (the same detection that auto-enables `--deliberate`), `mf-plan` refuses
   `--fast`, states why in one line, and continues in full mode.

3. **`--go`.** Valid only together with `--fast`. After the handoff, `mf-plan` continues
   directly into the `execute` flow for the same change: runs `spec stage <name> execute`,
   skips the "paste this `/goal`" stop (the Stop hook execute-guard remains the backstop),
   and starts task 1. Everything else in `execute`, including the final gate and
   `mf-verify`, is unchanged.

4. **Documentation.** `src/core/core.md` and the README stage table gain one row:
   "Concrete, multi-file, design already clear -> `mf-plan --fast [--go] -> execute ->
   mf-verify`". The skill table and the "how the flow skills differ from the built-ins"
   section mention the fast lane. Rendered for both Claude and Codex by `build.mjs`.

## Non-Goals

- No change to the full mode's planner / architect / critic loop or to the agent prompts.
- No change to `execute` beyond accepting a hand-in that skips the `/goal` stop; no change
  to `mf-verify`, `spec.mjs`, or the hooks.
- No automatic selection of `--fast` by the model, and no relaxing of the "never skip
  mf-plan and mf-verify" rule for the high-risk categories.
- No fast variant of `mf-verify`; the final gate stays as it is.
- Model routing for the roles is handled by the separate change `agent-model-routing`.

## Decision Boundaries

The agent may decide alone:

- Exact wording of the skill text, the `Plan mode: fast` marker, and the handoff line.
- How `--go` hands over to `execute` inside one skill invocation (call the skill vs. inline
  the execute steps), as long as `tasks.md` remains the only ledger and the state file is
  refreshed via `spec stage`.
- The keyword list used by the guard, provided it is the same list `--deliberate` uses.
- Where in `execute` the "skip the /goal stop when invoked with --go" clause lives.

Needs the user:

- Any second review round or any additional subagent in fast mode.
- Any change to the high-risk categories or to the rule that only the user selects
  `--fast`.
- Any change to the `execute` final gate.

## Capabilities

### New Capabilities

- `mf-plan-fast`: single-context planning with one critic pass, the high-risk guard, and
  the `--go` hand-over into execute.

### Modified Capabilities

none (no existing spec covers mf-plan or execute).

## Impact

- `src/skills/mf-plan.md` (flags, fast branch, guard, handoff), `src/skills/execute.md`
  (hand-in clause), `src/core/core.md` (stage table), `manifest.json` only if the
  `allowed-tools` for mf-plan need to grow (execute currently declares none).
- README in all eight languages: stage table, skill table, built-in comparison.
- Generated outputs: `skills/mf-plan/SKILL.md`, `skills/execute/SKILL.md`,
  `codex/skills/my-flow-mf-plan/`, `codex/skills/my-flow-execute/`, `claude/CLAUDE.block.md`,
  `codex/AGENTS.block.md`.

## Success Criteria

1. `node scripts/build.mjs --check` passes and `node --test test/` is green; the rendered
   Claude and Codex mf-plan skills both document `--fast` and `--go`.
2. Running `mf-plan --fast` on a small concrete change spawns exactly one subagent (critic)
   and no planner / architect, and the resulting `design.md` / `tasks.md` pass
   `spec validate` with `Plan mode: fast` present in `design.md`.
3. Running `mf-plan --fast` on a request that mentions a migration is refused with a
   one-line reason and continues in full mode (planner, architect, critic all appear).
4. Running `mf-plan --fast --go` enters task 1 of `execute` without printing the
   "paste this `/goal`" stop, and `.my-flow/state/current-change.json` shows stage
   `execute`.
5. The stage table in the rendered `CLAUDE.block.md` / `AGENTS.block.md` contains the new
   fast-lane row.
