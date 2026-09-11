#!/usr/bin/env node
/**
 * my-flow CLI dispatcher.
 *   my-flow build [--check]
 *   my-flow install claude|codex [--link] [--dry-run]
 *   my-flow uninstall codex [--dry-run]
 *   my-flow init [--simple] [--tools claude,codex] [dir]
 *   my-flow ask <codex|claude> [--diff] [--files a,b] [--timeout ms] <question...>
 *   my-flow dashboard [start|stop|status] [--port N] [--root dir] [--json]
 *   my-flow models [status|analyze|apply|reset] [--json] [--provider claude|codex] [--dry-run]
 *   my-flow plugin add|remove|list|enable|disable ...
 *   my-flow <verb> ...   a verb contributed by an enabled plugin (registry: <MY_FLOW_HOME>/plugins.json)
 *
 * Core commands are matched first and never load the plugin library; the library is
 * imported dynamically only for the usage text and for verbs outside the core table, so a
 * corrupt registry cannot affect `my-flow build` and friends.
 */
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const [cmd, ...rest] = process.argv.slice(2);

const scripts = {
  build: 'build.mjs',
  install: 'install.mjs',
  uninstall: 'install.mjs',
  init: 'init.mjs',
  ask: 'ask.mjs',
  spec: 'spec.mjs',
  dashboard: 'dashboard.mjs',
  models: 'models.mjs',
  plugin: 'plugin.mjs',
};

async function usage(code) {
  let pluginLines = '';
  try {
    const { enabledVerbs } = await import('./lib/plugins.mjs');
    const verbs = enabledVerbs({ warn: () => {} });
    if (verbs.length) pluginLines = '\n' + verbs.map((v) => `  ${v.verb} ...   (plugin ${v.plugin})`).join('\n');
  } catch {
    /* a broken registry never breaks the usage text */
  }
  console.log(`my-flow <command>

  build [--check]                           render src/ into Claude + Codex surfaces
  install claude|codex [--link] [--dry-run] install one tool surface
  uninstall codex [--dry-run]               restore the Codex surface
  init [--simple] [--tools claude,codex]    set up a project (specs/, changes/, templates)
  spec new|status|validate|archive|stage ... manage the intent layer (no external tool)
  ask <codex|claude> [--diff] [--files a,b] <question...>   cross-model advisor
  dashboard [start|stop|status] [--port N] [--root dir]  local web dashboard over specs/ and changes/
  models [status|analyze|apply|reset] [--json] [--dry-run] subagent model routing (inherit baseline, local override)
  plugin add|remove|list|enable|disable ...  register plugin repositories (my-flow-plugin.json)${pluginLines}`);
  process.exit(code);
}

if (!cmd || cmd === '-h' || cmd === '--help') await usage(0);

if (!scripts[cmd]) {
  let hit = null;
  try {
    const { resolvePluginVerb } = await import('./lib/plugins.mjs');
    hit = resolvePluginVerb(cmd);
  } catch (e) {
    console.error(`warning: plugin registry unavailable (${e.message})`);
  }
  if (hit?.disabled) {
    await new Promise((done) => {
      process.stderr.write(`note: "${cmd}" is contributed by plugin "${hit.disabled}", which is disabled (my-flow plugin enable ${hit.disabled})\n`, done);
    });
    await usage(1);
  }
  if (hit) {
    if (!existsSync(hit.script)) {
      console.error(`plugin "${hit.key}": script ${hit.script} is missing; run my-flow plugin add again`);
      process.exit(1);
    }
    const r = spawnSync(process.execPath, [hit.script, ...rest], { stdio: 'inherit', env: { ...process.env, MY_FLOW_PLUGIN_ROOT: hit.root } });
    process.exit(r.status ?? 1);
  }
  await usage(1);
}

const args = cmd === 'uninstall' ? ['--uninstall', ...rest] : rest;
const r = spawnSync(process.execPath, [resolve(join(HERE, scripts[cmd])), ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
