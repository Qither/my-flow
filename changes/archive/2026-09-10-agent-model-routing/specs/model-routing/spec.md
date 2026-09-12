## Purpose

How the four my-flow subagent roles (planner, architect, critic, verifier) get their model on
each CLI surface: an inherit-by-default baseline shipped by the repository, a per-user local
override chosen by a model after a script detects a CLI upgrade, validation and fallback rules
for that override, and the `models` command that exposes the whole mechanism.

## ADDED Requirements

### Requirement: Baseline inheritance

The repository SHALL ship the four roles without a pinned model name. The generated Claude
agent files SHALL carry `model: inherit`; the generated Codex agent files SHALL carry no
`model =` line and SHALL keep only `model_reasoning_effort` (planner and architect `high`,
critic and verifier `medium`). The Codex architect and critic files SHALL carry
`sandbox_mode = "read-only"`; planner and verifier SHALL carry no `sandbox_mode` line.

#### Scenario: Build output inherits the main model
- **WHEN** `node scripts/build.mjs` runs from the repository
- **THEN** every `agents/<role>.md` contains `model: inherit`, no `codex/agents/<role>.toml`
  contains a `model =` line, and `node scripts/build.mjs --check` exits 0

#### Scenario: Read-only sandbox on the two review roles only
- **WHEN** the Codex agent files are generated
- **THEN** `architect.toml` and `critic.toml` contain `sandbox_mode = "read-only"` and
  `planner.toml` and `verifier.toml` do not

### Requirement: Local override with validation and fallback

A per-user override SHALL live under the my-flow home directory (`~/.my-flow/`, overridable by
`MY_FLOW_HOME`) as `models.json`, recording the CLI versions and main models it was derived
from, one entry per role with a Claude model and a Codex model plus effort, a reason, and a
timestamp. Applying the override SHALL rewrite only the installed agent files: the Codex
agents directory and the Claude plugin's `agents/` directory located under the Claude plugins
directory. The repository's `manifest.json` and `src/` SHALL never be written by this
mechanism. An override SHALL be rejected as a whole when it names a role other than the four
known ones, omits a role, names a Claude model outside the accepted aliases and known models,
names a Codex model outside the main model, the listed slugs of `models_cache.json` and the
configured known models, or names an effort the selected Codex model does not support. A
rejected or missing override SHALL leave the installed files equal to the baseline.

#### Scenario: A valid override is applied to both surfaces
- **WHEN** `models.json` validates and `models apply` runs
- **THEN** each installed Claude agent file's `model:` line and each installed Codex agent
  file's `model_reasoning_effort =` line equal the corresponding role entry, and no file
  outside the two installed agent directories and the my-flow home changes

#### Scenario: An invalid override changes nothing
- **WHEN** `models.json` names a Codex model that is neither the main model nor a listed cache
  slug nor a known model, and `models apply` runs
- **THEN** the command exits non-zero, names the offending role and value, and the installed
  agent files are byte-identical to the baseline

#### Scenario: Effort validation follows the model's supported levels
- **WHEN** the Codex models cache lists the chosen model without the effort named in the
  override
- **THEN** the override is rejected; when the cache lists that effort for the model, the
  override passes

### Requirement: Upgrade detection by script, analysis by model

The SessionStart hook SHALL never call a model. It SHALL read the my-flow state, compare the
recorded plugin root with the current one, apply a throttle, and when due spawn one detached
background check that returns control immediately; the hook's own work SHALL complete well
under one second and SHALL exit 0 even when the routing library is missing or broken. The
background check SHALL probe both CLI versions and main models, compare them with the recorded
values, and only on a change run one read-only analysis through the existing `ask` transport
with the resolved allowed model sets in its prompt. The analysis SHALL run under a lock shared
with the manual commands, and its nested CLI session SHALL not trigger a second check. On
success the check writes the override and applies it; on failure or timeout it writes no
override and keeps the baseline, recording the failure.

#### Scenario: The hook returns immediately and delegates
- **WHEN** a session starts with a stale recorded version and the throttle allows a check
- **THEN** the hook exits 0 in under one second, records the spawned child's pid, and the
  detached check later logs a `check start` and `check done` pair with the same pid

#### Scenario: A changed version triggers exactly one analysis
- **WHEN** the background check finds a CLI version different from the recorded one
- **THEN** exactly one analysis runs, the override is written and applied when it validates,
  and the recorded versions are updated

#### Scenario: A failed analysis keeps the baseline
- **WHEN** the analysis transport exits non-zero or times out
- **THEN** no `models.json` is written, the installed agent files are byte-identical to the
  baseline, and the failure is logged with its reason

#### Scenario: The hook fails open without the routing library
- **WHEN** the routing library cannot be imported by the hook
- **THEN** the hook still prints the active-change status and exits 0

### Requirement: One summary line at the next session start

The background check SHALL leave a pending summary; the next SessionStart SHALL print that
summary exactly once and clear it.

#### Scenario: The summary appears once
- **WHEN** a check has completed since the last session start
- **THEN** the next session start prints one line describing the result (updated, failed, or
  reset) and the session after that prints nothing about routing

### Requirement: The `models` command

The CLI SHALL expose `models status [--json]`, `models analyze [--dry-run]`, `models apply`,
and `models reset`. `status` SHALL report the recorded versions, the override or its absence,
the effective per-role values read back from the installed files, and any pending summary.
`analyze` SHALL run the same analysis as the background check; `apply` SHALL re-render the
installed files from the current override; `reset` SHALL delete the override and restore the
baseline. `analyze`, `apply`, and `reset` SHALL refuse to run while another run holds the lock.

#### Scenario: Reset restores the baseline
- **WHEN** an override is applied and `models reset` runs
- **THEN** the override file is deleted, the installed agent files equal the shipped baseline,
  and `models status --json` reports no override

#### Scenario: Commands respect the lock
- **WHEN** the lock names a live process and `models reset` runs
- **THEN** the command exits 1 with `analysis already running (pid N)` and the override file
  is left in place
