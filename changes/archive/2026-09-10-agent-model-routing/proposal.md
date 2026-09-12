## Why

The four subagent roles (planner, architect, critic, verifier) have their models pinned at
build time in `manifest.json`: Claude `opus` / `opus` / `sonnet` / `sonnet`, Codex `gpt-5.5`
for all four. Both surfaces are rendered from that file by `scripts/build.mjs`, and neither
side has a runtime override for these roles (`MY_FLOW_CODEX_MODEL` / `MY_FLOW_CLAUDE_MODEL`
only affect `ask`).

Two concrete problems today:

- The pins age. The user's `~/.codex/config.toml` already defaults to `gpt-6-astra`, while
  every installed `~/.codex/agents/*.toml` still says `gpt-5.5`, so subagents run an older
  model than the main session.
- The pins downgrade. A Claude session running Fable delegates planning to `opus` and
  reviews to `sonnet`, because the frontmatter forces it.

Both CLIs support inheritance natively: Claude Code accepts `model: inherit` (or omitting
`model`, which falls back to `CLAUDE_CODE_SUBAGENT_MODEL`, then the main conversation's
model); Codex resolves a missing `model` / `model_reasoning_effort` from the explicit spawn
value, then the `[agents]` default in `config.toml`, then the parent session. Codex agent
files also accept `sandbox_mode = "read-only"`, which my-flow does not use yet even though
three roles are read-only.

The user additionally wants model choice to keep adapting after future CLI upgrades without
manual edits: detect the upgrade with a script, and only then let the current strongest
model analyse and choose a role -> model / effort combination for quality and cost.

## What Changes

1. **Baseline: inherit.** `manifest.json` stops pinning model names. Claude agents get
   `model: inherit`; Codex agents drop `model =` and keep only `model_reasoning_effort`
   (planner / architect `high`, critic / verifier `medium`). Architect and critic additionally
   get `sandbox_mode = "read-only"` on the Codex side; the verifier does not, because it must
   run the test suite itself and every test writes to the temp directory (decided in mf-plan
   after architect review). `scripts/build.mjs`
   emits these fields. README (all languages) role table updated. This is the one-time
   manual sync of the repository; it is committed like any other change.

2. **Local override layer (never in the repo).** A user-level file, e.g.
   `~/.my-flow/models.json`, records `{ cliVersions, mainModels, roles: {<role>: {claude:
   {model}, codex: {model, model_reasoning_effort}}}, reason, updated }`. When present and
   valid, the installed agent files (`~/.codex/agents/*.toml` and the plugin's `agents/*.md`
   under `CLAUDE_PLUGIN_ROOT`) are re-rendered from it. When absent, invalid, or when the
   analysis failed, the installed files equal the inherit baseline. The repo's
   `manifest.json` and `src/` are never written by this layer.

3. **Upgrade detection by script, analysis by model.** The SessionStart hook compares the
   current `claude --version` / `codex --version` (and the main model declared in each CLI's
   config, when readable) with the values recorded in `~/.my-flow/models.json`
   (or a sibling state file). On change it spawns a detached background process (same
   pattern as `dashboard start`) and returns immediately; the hook itself never calls a
   model and must stay well under one second. The background process asks the strongest
   available model, through the existing `ask.mjs` read-only path, for a role -> model /
   effort recommendation with reasons, validates the answer (only model names the CLI
   accepts, only the four known roles, only allowed effort values), writes
   `~/.my-flow/models.json`, re-renders the installed agent files, and logs to
   `~/.my-flow/models.log`. On failure or timeout it writes nothing new and the baseline
   (inherit) stays in effect. On Windows the detached process is started through a Task
   Scheduler task that `install` registers (decided by the user after task 6.2 showed that
   Codex kills any child of its hook's job object); that task and its launcher shim are the
   only writes outside `~/.my-flow/` and the agent directories, and `uninstall` removes them. The next SessionStart prints one summary line ("model routing
   updated for claude 2.1.x: planner=..., ...", or "model routing analysis failed: ...").

4. **A manual entry point** `my-flow models [status|analyze|apply|reset]` wraps the same
   code so the flow can be run and inspected without waiting for an upgrade. `reset`
   deletes the override and restores the baseline.

## Non-Goals

- No automatic edits, commits, or rebuilds of the repository. The automatic layer writes
  only under `~/.my-flow/` and the installed agent files.
- No new "list available models" API is assumed for either CLI; detection uses version
  strings and config files only. Codex's locally written `~/.codex/models_cache.json` counts
  as a config file: it is read fail-open and never written. If a CLI later offers an
  enumeration command, that is a follow-up.
- No change to `ask.mjs` model selection semantics (`--model`, `MY_FLOW_*_MODEL`) beyond
  reusing it as the transport for the analysis.
- No change to which roles exist, their prompts, or the mf-plan / mf-verify flow. The
  mf-plan fast mode is a separate change (`mf-plan-fast`).
- No per-project routing; the override is per user.

## Decision Boundaries

The agent may decide alone:

- Exact file names and JSON shape under `~/.my-flow/`, and the log format.
- Which CLI runs the analysis: default to the CLI whose version changed; when both changed,
  use Claude first and fall back to Codex; when neither CLI can be spawned, skip.
- The analysis prompt, the validation rules for a recommendation, and the timeout (bounded
  by the existing `ask.mjs` defaults).
- How the installed Claude plugin agent files are located (via `CLAUDE_PLUGIN_ROOT` from the
  hook, recorded for the background process) and how a missing location is handled
  (skip that surface, log it).
- Test strategy for the end-to-end simulation (fake version strings and a stubbed `ask`
  transport are acceptable for the automated test; one real run is still required in
  mf-verify).

Needs the user:

- Any write outside `~/.my-flow/`, `~/.codex/agents/`, and the plugin's `agents/` directory.
- Changing the baseline away from inherit, or changing the effort tiers.
- Adding a dependency or a long-running daemon.

## Capabilities

### New Capabilities

- `model-routing`: baseline inheritance for the four roles, upgrade detection by script,
  model-driven recommendation applied locally with validation and fallback, manual `models`
  command.

### Modified Capabilities

none (the `spec-helper`, `dashboard`, and `mf-audit` specs are untouched).

## Impact

- `manifest.json`, `scripts/build.mjs`, generated `agents/*.md` and `codex/agents/*.toml`.
- `hooks/session-context.mjs` (version comparison and summary line) and `hooks/hooks.json`
  if a new script is added; the Codex shim if the hook payload changes.
- New `scripts/models.mjs` (or similar) and a dispatcher entry in `scripts/cli.mjs`;
  reuse of `scripts/ask.mjs` and `scripts/lib/spawn.mjs`.
- `scripts/install.mjs` (record plugin root / repo-independent paths, install baseline).
- README in all eight languages: role table, CLI table, hooks table, troubleshooting.
- New tests under `test/`.

## Success Criteria

1. `node scripts/build.mjs --check` passes and `node --test test/` is green after the
   baseline change; generated Claude agents contain `model: inherit`, generated Codex
   agents contain no `model =` line, architect / critic contain
   `sandbox_mode = "read-only"`, and planner / verifier contain no `sandbox_mode` line.
2. With `~/.my-flow/` recording an older CLI version, starting a session makes the
   SessionStart hook return in under one second and spawn the analysis in the background
   (observable via the log and the detached process).
3. After the analysis completes, `~/.my-flow/models.json` exists, every recommended model
   name and effort value passed validation, and the installed agent files were re-rendered
   with those values.
4. When the analysis fails or times out (simulated), the installed agent files remain the
   inherit baseline and the log records the failure.
5. The next SessionStart prints exactly one summary line describing the result.
6. `my-flow models reset` restores the baseline and `my-flow models status` reports it.
