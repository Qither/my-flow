---
name: demo
description: Fixture skill of the plugin-demo plugin. Prints a greeting through the plugin's contributed CLI verb.
---

# Demo skill

This skill belongs to the `plugin-demo` fixture. Invoke it as `/plugin-demo:demo`.

Steps:

1. Read `${CLAUDE_PLUGIN_ROOT}/README.md` for the fixture layout (dependency-free files only).
2. Run `my-flow demo-hello <words>` and report the printed greeting. Dependency-bearing code
   is reached only through the `my-flow <verb>` dispatcher, never through
   `${CLAUDE_PLUGIN_ROOT}` paths.
