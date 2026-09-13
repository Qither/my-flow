## Why

my-flow is a thin workflow layer with no runtime and no external tools. The user wants to add
capabilities that cannot honour that promise inside the core (a browser harness needs Node
dependencies, a Chromium, and a small model), without breaking it. That calls for a plugin
mechanism: an explicit contract that lets an external repository extend both tool surfaces
(Claude Code plugin, Codex CLI skills) and any MCP client, while the core stays dependency-free.

The first plugin is a privacy-controlled Browser Harness. The motivation is that Claude in
Chrome hands an agent the whole existing browser context and collects telemetry the user cannot
audit. The user wants the same experience with the security boundary owned by their own code:
policy, approval, PII masking and audit log live in the harness; Stagehand is only the driver
that understands pages and performs actions; model selection and credentials never reach the
driver; the browser is an isolated local Chromium, never the daily profile.

The pasted design advice (four layers: Agent/Planner -> Browser Gateway -> Stagehand ->
Isolated Chromium, plus a Stagehand fork with telemetry off, a local model gateway, a Chrome
extension bridge for per-tab authorisation, and per-task temporary profiles) is treated as the
design sketch for the plugin, not as decided requirements. `mf-plan` verifies every Stagehand
claim in it against the official documentation before relying on it.

## What Changes

This is an **umbrella change**. It records the intent for the whole programme; it is never
executed directly. `mf-plan` splits it into ordered sub-changes, each with its own
`proposal.md` / `design.md` / `tasks.md` and its own `mf-verify`, in the repository it
belongs to. This umbrella is archived only after every sub-change is archived.

Ordered sub-changes (names are provisional; `mf-plan` may rename or merge adjacent ones but
must keep the order and the per-repo boundary):

1. **`plugin-contract`** (repo: my-flow). Defines what a plugin is and how my-flow consumes
   it:
   - A plugin is an **independent repository** with a manifest that declares what it
     contributes: skills, agents, hooks, CLI subcommands, and MCP servers.
   - my-flow gains `my-flow plugin add|remove|list|enable|disable` (`scripts/cli.mjs`,
     new `scripts/plugin.mjs`), a local plugin registry file, and `build` / `install`
     merging the plugin's contributions into the Claude Code and Codex surfaces alongside
     the core ones. Skills, agents and hooks are rendered only for Claude Code and Codex;
     MCP servers are registered for those two and are usable by any MCP client.
   - The contract is documented in `src/core/core.md` and the READMEs, and covered by a
     `plugin-contract` spec with a fixture plugin under `test/` so the mechanism is
     verified without the browser harness.
2. **`harness-core`** (repo: new `my-flow-browser`). The plugin skeleton conforming to the
   contract, plus the Browser Gateway and the Stagehand driver:
   - Gateway: domain allowlist, tab allowlist, action ACL, sensitive-field masking, secret
     detection, human approval gate, rate limit, structured audit log.
   - Default policy (strict; any loosening needs the user): read DOM / screenshot / click /
     type normal text allow; password fields deny; cookies deny; localStorage deny by
     default; clipboard, download, upload, payment submit, delete require approval.
   - Website content is always untrusted data, never instruction. The prompt-injection
     defence is architectural (observe -> candidate actions -> policy -> deterministic
     execute), and `act(page text)` / `agent()` style calls are not exposed to hosts.
   - Deterministic-first rule: locator over act, CSS/XPath over LLM, API over browser,
     Stagehand observe only when the page is unknown, self-heal only when a selector is
     unstable.
   - Small MCP primitive surface: `browser.open`, `browser.observe`, `browser.read`,
     `browser.click`, `browser.type`, `browser.extract`, `browser.screenshot`,
     `browser.back`, `browser.tabs`; a separate `browser.unsafe.*` namespace
     (`evaluate`, `cdp`, `cookies`) that always requires user approval.
   - Stagehand connects over CDP (`localBrowser.connect`) to a dedicated agent-profile
     Chromium started by the harness; the user's daily Chrome profile is never opened with
     CDP.
3. **`stagehand-fork`** (repo: fork of Stagehand, consumed by `my-flow-browser`). Outbound
   network audit, default telemetry disabled, OpenTelemetry routed to a localhost collector
   only, an outbound allowlist, and a documented firewall rule set (allow 127.0.0.1 and the
   model gateway, deny everything else). Upstream tracking strategy is recorded in its
   design.
4. **`model-gateway`** (repo: `my-flow-browser`). A loopback LLM gateway. Stagehand only ever
   sees `http://127.0.0.1:<port>/llm`; the gateway holds the provider credentials and routes
   by task class (browser-extract -> cheap model, browser-vision -> vision model, planning ->
   the host's model, sensitive page -> local model). The concrete provider, model names and
   routing table are the user's decision.
5. **`extension-bridge`** (repo: `my-flow-browser`). A Chrome extension plus bridge so a
   host can be granted a single current tab instead of a whole CDP endpoint on port 9222.
   This is what makes the harness safer than Claude in Chrome rather than merely equal.
6. **`temp-profiles`** (repo: `my-flow-browser`). Per-task temporary browser profiles with
   selective cookie import and destruction at task end, on top of the named
   `Agent-General` / `Agent-Work` / `Agent-Sensitive` profiles from sub-change 2.

7. **`request-interception`** (repo: my-flow-browser). Added on 2026-09-11 by the user's
   decision on harness-core task 8.3, after ten independent verification passes showed that
   the completeness of harness-core's frame enumeration cannot be reached by patching: refuse
   every subframe document and subresource request bound for a host outside the tab's
   allowlist before the browser sends it, so a screenshot cannot hold what was never fetched
   and completeness stops being a security precondition. A blocked frame is a hole, not
   foreign content; every refusal is audited; pages render with holes inside the agent
   profile, which the user accepted. Depends only on sub-change 2 and may run any time after
   it is archived; numbered last so sub-changes 3 to 6 keep their numbers.

## Non-Goals

- No hosted or cloud browser (Browserbase or any other SaaS browser provider). Local
  Chromium only.
- No non-Chromium browser support (Stagehand is Chromium-only).
- No exposure of Stagehand's high-level autonomous `agent()` mode or of raw CDP / arbitrary
  JavaScript to hosts outside the approval-gated `browser.unsafe.*` namespace.
- No provider credentials stored in, or readable by, the Stagehand driver or the plugin
  manifest; credentials live only in the model gateway configuration.
- No remote or multi-user access: every listener (MCP, gateway, OTEL collector) binds to
  loopback only.
- No change to the four-stage flow, the existing skills, the Stop-hook execute-guard, or
  the spec helper's archive semantics, unless the user approves it inside a sub-change.
- No runtime dependency added to my-flow core. Anything that needs a package lives in the
  plugin repository.
- No publishing to npm or a plugin marketplace in this programme; installation is from a
  local path or git URL.
- No edits to the open change `changes/execute-goal-default`; it is finished separately.

## Decision Boundaries

Needs the user (each of these stops the sub-change until the user answers):

- Adding any dependency to my-flow core, including an MCP SDK for the contract layer.
- Which cheap model / provider Stagehand uses for semantic locators and self-healing, and
  the gateway routing table (extract / vision / planning / sensitive).
- Any loosening of the default policy table above (a deny becoming allow, an approval
  becoming allow).
- Any change to the four-stage flow, `src/core/core.md` stage rules, or existing skills
  (for example letting `mf-verify` pick up browser tools automatically).

The agent may decide alone (recorded with reasons in the sub-change's `design.md`):

- The plugin manifest file name, schema and version field; the registry file location under
  `.my-flow/` or the user config directory; the exact CLI verbs and flags.
- Directory layout of the `my-flow-browser` repository and how it vendors or references the
  Stagehand fork.
- Exact names, argument shapes and result shapes of the `browser.*` primitives, as long as
  the surface stays as small as listed and `unsafe` stays separate and approval-gated.
- Audit log format, masking rules for known sensitive field types, rate-limit values.
- Names of the agent profiles and where they are stored.
- Splitting or merging adjacent sub-changes, keeping the order and the per-repo boundary.

## Capabilities

### New Capabilities
- `plugin-contract` (my-flow): what a plugin repository must provide and what `plugin
  add|remove|list|enable|disable`, `build` and `install` do with it.
- `browser-harness` (my-flow-browser): the gateway policy, the primitive surface, profile
  isolation, injection defence and audit behaviour. Sub-changes 3 to 6 add their own
  capability specs in their repositories (`stagehand-privacy`, `model-gateway`,
  `extension-bridge`, `temp-profiles`).

### Modified Capabilities
none at the umbrella level. A sub-change that must touch `spec-helper`, `model-routing` or
`dashboard` declares its own delta spec and needs the user's approval (see Decision
Boundaries).

## Impact

- my-flow repo: `manifest.json`, `scripts/cli.mjs`, new `scripts/plugin.mjs`,
  `scripts/build.mjs`, `scripts/install.mjs`, `src/core/core.md`, the eight READMEs, new
  `specs/plugin-contract/spec.md`, tests under `test/`. Core stays zero-dependency.
- New repository `my-flow-browser` (Node 20+, Stagehand fork, Chromium, MCP stdio server,
  loopback model gateway, Chrome extension).
- New repository: Stagehand fork.
- User machine: dedicated Chromium agent profiles, an OS firewall rule set for the Stagehand
  process, provider credentials in the gateway config.
- Hosts: Claude Code and Codex get skills / agents / hooks / MCP from the plugin; any other
  MCP client gets the `browser.*` tools.

## Success Criteria

The umbrella is done when every sub-change is archived and all of the following hold with
fresh evidence:

1. `my-flow plugin list` shows `my-flow-browser` installed and enabled on both the Claude
   Code and the Codex surface; `npm run check` and `npm test` are green in my-flow, and the
   fixture plugin test proves the contract without the browser harness.
2. Real end-to-end on both hosts: from Claude Code and from Codex, an agent uses only the
   `browser.*` primitives to run an `mf-verify` style check of the my-flow dashboard (open,
   observe, click, screenshot) inside an isolated agent profile, and every action appears in
   the audit log.
3. Security scenarios pass on both hosts: a password field is masked in `read` and
   `extract`; a download triggers an approval prompt and does not proceed without it; a test
   page containing injected instructions is treated as data and produces no unrequested
   action; the outbound network audit of the Stagehand process shows connections only to
   127.0.0.1 and the model gateway.
4. The extension bridge grants exactly one tab; the same primitives fail against any other
   tab. The temporary profile is destroyed at task end and its cookies are gone.
5. Each repository's own build and test commands are green, and each sub-change has a
   PASS from `mf-verify`.
