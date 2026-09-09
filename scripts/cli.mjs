#!/usr/bin/env node
/**
 * my-flow CLI dispatcher.
 *   my-flow build [--check]
 *   my-flow install claude|codex [--link] [--dry-run]
 *   my-flow uninstall codex [--dry-run]
 *   my-flow init [--simple] [--tools claude,codex] [dir]
 *   my-flow ask <codex|claude> [--diff] [--files a,b] [--timeout ms] <question...>
 */
import { spawnSync } from 'node:child_process';
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
};

if (!cmd || cmd === '-h' || cmd === '--help' || !scripts[cmd]) {
  console.log(`my-flow <command>

  build [--check]                           render src/ into Claude + Codex surfaces
  install claude|codex [--link] [--dry-run] install one tool surface
  uninstall codex [--dry-run]               restore the Codex surface
  init [--simple] [--tools claude,codex]    set up a project (specs/, changes/, templates)
  spec new|status|validate|archive|stage ... manage the intent layer (no external tool)
  ask <codex|claude> [--diff] [--files a,b] <question...>   cross-model advisor`);
  process.exit(cmd && !scripts[cmd] ? 1 : 0);
}

const args = cmd === 'uninstall' ? ['--uninstall', ...rest] : rest;
const r = spawnSync(process.execPath, [resolve(join(HERE, scripts[cmd])), ...args], { stdio: 'inherit' });
process.exit(r.status ?? 1);
