# plugin-demo

Dependency-free fixture plugin for `test/plugin.test.mjs`. It exists to prove the my-flow
plugin contract (`my-flow-plugin.json`, the Claude plugin layout without `.mcp.json`, one
skill, one agent, one hook, one CLI verb, one stdio MCP echo server) without a browser and
without `node_modules`.

`package.json` in the repository root lists test files explicitly, so a bare `node --test`
must never be used: it would pick up this directory as tests.

Layout:

- `my-flow-plugin.json` - the my-flow manifest (contract source of truth).
- `.claude-plugin/plugin.json`, `.claude-plugin/marketplace.json` - the Claude plugin surface.
- `skills/demo/SKILL.md`, `agents/demo-reviewer.md`, `hooks/hooks.json`, `hooks/demo-hook.mjs`.
- `scripts/hello.mjs` - the `demo-hello` verb, run through `my-flow demo-hello`.
- `server/mcp.mjs` - newline-delimited JSON-RPC stdio server with one tool, `echo`.
