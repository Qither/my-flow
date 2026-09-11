#!/usr/bin/env node
/**
 * my-flow install / uninstall.
 *
 *   node scripts/install.mjs claude [--dry-run]
 *       - backs up ~/.claude/settings.json, sets env.CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS=1
 *       - upserts the my-flow block into ~/.claude/CLAUDE.md
 *       - prints the plugin install commands (not executed)
 *
 *   node scripts/install.mjs codex [--link] [--dry-run]
 *       - backs up ~/.codex/{config.toml,hooks.json,AGENTS.md}
 *       - copies (or junction-links) codex/skills/my-flow-* and codex/agents/*.toml
 *       - writes ~/.codex/hooks/my-flow-shim.ps1, merges hooks.json, writes trusted hashes
 *       - upserts the my-flow block into ~/.codex/AGENTS.md
 *
 *   node scripts/install.mjs --uninstall codex [--dry-run]
 *
 * Everything is idempotent and text-based: user content outside my-flow markers is preserved.
 *
 * Test seam: MY_FLOW_SCHTASKS. Whenever it is defined, every Task Scheduler call runs
 * `process.execPath <MY_FLOW_SCHTASKS> <args>` instead of `schtasks <args>` (the same rule
 * scripts/lib/models.mjs applies), so a test install into a temporary home never touches
 * the user's real scheduled task.
 */
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, lstatSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TASK_NAME, filePaths, updateConfig, writeConfig } from './lib/models.mjs';
import {
  MARKER_FILE,
  PLUGIN_AGENT_HEADER_RE,
  claudeCommands,
  codexAgentToml,
  codexHookCommand,
  codexMcpTables,
  codexSkillText,
  loadRegistered,
  mcpTableRe,
} from './lib/plugins.mjs';
import { spawnSync } from 'node:child_process';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const argv = process.argv.slice(2);
const UNINSTALL = argv.includes('--uninstall');
const DRY = argv.includes('--dry-run');
const LINK = argv.includes('--link');
const target = argv.find((a) => a === 'claude' || a === 'codex');
if (!target) {
  console.error('usage: install.mjs <claude|codex> [--link] [--dry-run]   |   install.mjs --uninstall codex');
  process.exit(2);
}

const CLAUDE_HOME = process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
const CODEX_HOME = process.env.CODEX_HOME || join(homedir(), '.codex');
const START_RE = /<!-- MY-FLOW:START[^>]*-->/;
const END = '<!-- MY-FLOW:END -->';
const TOML_START = '# >>> my-flow managed >>>';
const TOML_END = '# <<< my-flow managed <<<';

const log = (m) => console.log(`${DRY ? '[dry-run] ' : ''}${m}`);
/**
 * Enabled plugins with a loadable manifest, read once per install branch (design D7 failure
 * path). An unreadable registry is treated as empty with a warning; a plugin whose path is
 * missing or whose manifest has errors is skipped with a logged reason and never aborts the
 * core install.
 */
function loadPlugins({ includeDisabled = false } = {}) {
  let registered;
  try {
    registered = loadRegistered({ warn: (m) => console.error(m) });
  } catch (e) {
    console.error(`warning: ${e.message}; treating the plugin registry as empty`);
    return [];
  }
  const out = [];
  for (const { key, entry, loaded } of registered.plugins) {
    if (entry.enabled === false && !includeDisabled) continue;
    if (!loaded.manifest || loaded.errors.length) {
      log(`skip plugin ${key}: ${loaded.errors[0] ?? 'manifest could not be loaded'}`);
      continue;
    }
    out.push({ key, entry, loaded });
  }
  return out;
}
/** Task Scheduler call through the MY_FLOW_SCHTASKS seam (see the header comment). */
function schtasks(args) {
  const opts = { encoding: 'utf8', windowsHide: true, timeout: 15000 };
  const seam = process.env.MY_FLOW_SCHTASKS;
  return seam !== undefined ? spawnSync(process.execPath, [seam, ...args], opts) : spawnSync('schtasks', args, opts);
}
/**
 * Registers the Task Scheduler task that starts the background model-routing check outside
 * the hook's job object (design D4 / D9, win32 only). Re-registers with /f on every install;
 * refuses when conhost.exe is missing; records config.launcher only on success.
 */
function registerLauncher() {
  if (process.platform !== 'win32') return;
  const conhost = join(process.env.SystemRoot || 'C:\\Windows', 'System32', 'conhost.exe');
  if (!existsSync(conhost)) {
    log(`scheduled task not registered: ${conhost} is missing (the hook will use the plain detached child)`);
    return;
  }
  const home = filePaths().home;
  const action = `conhost.exe --headless "${process.execPath}" "${join(ROOT, 'scripts', 'models.mjs')}" check --quiet --home "${home}"`;
  const create = (trigger) => ['/create', '/f', '/tn', TASK_NAME, '/tr', action, ...trigger];
  const once = create(['/sc', 'once', '/st', '00:00']);
  log(`schtasks ${once.join(' ')}`);
  if (DRY) return;
  let r = schtasks(once);
  if (r.error || r.status !== 0) {
    log(`schtasks /sc once refused (${r.error?.message ?? `exit ${r.status}`}): ${(r.stderr || r.stdout || '').trim()}; retrying with /sc onlogon`);
    r = schtasks(create(['/sc', 'onlogon']));
  }
  if (r.error || r.status !== 0) {
    log(`scheduled task not registered: ${(r.stderr || r.stdout || r.error?.message || '').trim()}`);
    return;
  }
  writeConfig({ launcher: { task: TASK_NAME, root: ROOT, node: process.execPath, home, registered: new Date().toISOString() } });
  log(`scheduled task ${TASK_NAME} registered (action: ${action})`);
}

/** Uninstall side: drop this tool's home from config.json; delete the task once no surface remains. */
function unregisterSurface(tool) {
  const p = filePaths().config;
  if (!existsSync(p)) return;
  log(`update ${p} (remove ${tool}.home)`);
  let cfg;
  if (DRY) cfg = JSON.parse(readFileSync(p, 'utf8'));
  else cfg = updateConfig((c) => {
    if (c[tool]) delete c[tool].home;
    return c;
  });
  const remaining = ['claude', 'codex'].filter((k) => k !== tool && cfg[k]?.home);
  if (remaining.length) {
    log('scheduled task kept for the other surface');
    return;
  }
  if (cfg.launcher?.task) {
    log(`schtasks /delete /tn ${cfg.launcher.task} /f`);
    if (!DRY) {
      schtasks(['/delete', '/tn', cfg.launcher.task, '/f']);
      updateConfig((c) => {
        delete c.launcher;
        return c;
      });
    }
  }
}

/** Records tool homes for the model-routing layer in <MY_FLOW_HOME>/config.json (merge, never clobber). */
function recordConfig(patch) {
  log(`write ${filePaths().config}`);
  if (DRY) return;
  writeConfig(patch);
}
function write(path, content) {
  log(`write ${path}`);
  if (DRY) return;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, content, 'utf8');
}
function backup(paths) {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const dir = join(dirname(paths[0]), '.my-flow-backup', stamp);
  for (const p of paths) {
    if (!existsSync(p)) continue;
    log(`backup ${p} -> ${dir}`);
    if (!DRY) {
      mkdirSync(dir, { recursive: true });
      cpSync(p, join(dir, p.split(/[\\/]/).pop()), { recursive: true });
    }
  }
  return dir;
}
function upsertBlock(existing, block) {
  const text = existing.replace(/\r\n/g, '\n');
  const s = text.search(START_RE);
  const e = text.indexOf(END);
  if (s !== -1 && e !== -1 && e > s) {
    return text.slice(0, s) + block.trimEnd() + text.slice(e + END.length);
  }
  return (text.trimEnd() ? text.trimEnd() + '\n\n' : '') + block.trimEnd() + '\n';
}
function removeBlock(existing) {
  const text = existing.replace(/\r\n/g, '\n');
  const s = text.search(START_RE);
  const e = text.indexOf(END);
  if (s === -1 || e === -1) return text;
  return (text.slice(0, s) + text.slice(e + END.length)).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// =====================================================================================
// Claude Code
// =====================================================================================
if (target === 'claude') {
  if (UNINSTALL) {
    const md = join(CLAUDE_HOME, 'CLAUDE.md');
    if (existsSync(md)) write(md, removeBlock(readFileSync(md, 'utf8')));
    unregisterSurface('claude');
    log('Claude block removed. Disable the plugin with: claude plugin disable my-flow@my-flow');
    // Plugin commands are printed, never executed (D9, U7).
    for (const { key, loaded } of loadPlugins({ includeDisabled: true })) {
      const c = claudeCommands(loaded);
      if (!c.mcpRemove.length && !c.pluginDisable) continue;
      console.log(`plugin ${key} (run in a terminal, not inside a Claude session):`);
      for (const line of c.mcpRemove) console.log(`  ${line}`);
      if (c.pluginDisable) console.log(`  ${c.pluginDisable}`);
    }
    process.exit(0);
  }
  const claudePlugins = loadPlugins();
  const settingsPath = join(CLAUDE_HOME, 'settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  backup([settingsPath, join(CLAUDE_HOME, 'CLAUDE.md')]);

  settings.env = { ...(settings.env ?? {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };
  write(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const block = readFileSync(join(ROOT, 'claude', 'CLAUDE.block.md'), 'utf8');
  const md = join(CLAUDE_HOME, 'CLAUDE.md');
  write(md, upsertBlock(existsSync(md) ? readFileSync(md, 'utf8') : '', block));

  recordConfig({ claude: { home: CLAUDE_HOME } });
  registerLauncher();

  console.log(`
Next steps (run in a terminal, not inside a Claude session):
  development:  claude --plugin-dir "${ROOT}"
  stable:       claude plugin marketplace add "${ROOT}"
                claude plugin install my-flow@my-flow
`);
  // One block per enabled plugin, printed in both modes and executed in neither (D9, U7).
  for (const { key, loaded } of claudePlugins) {
    const c = claudeCommands(loaded);
    console.log(`plugin ${key} (run in a terminal, not inside a Claude session):`);
    if (c.marketplaceAdd) console.log(`  ${c.marketplaceAdd}`);
    if (c.pluginInstall) console.log(`  ${c.pluginInstall}`);
    for (const line of c.mcpAdd) console.log(`  ${line}`);
    console.log('');
  }
  process.exit(0);
}

// =====================================================================================
// Codex
// =====================================================================================
const skillsDir = join(CODEX_HOME, 'skills');
const agentsDir = join(CODEX_HOME, 'agents');
const hooksDir = join(CODEX_HOME, 'hooks');
const shimPath = join(hooksDir, 'my-flow-shim.ps1');
const hooksJsonPath = join(CODEX_HOME, 'hooks.json');
const configPath = join(CODEX_HOME, 'config.toml');
const agentsMdPath = join(CODEX_HOME, 'AGENTS.md');
const prefix = manifest.codexSkillPrefix;

// --- trusted hash (ported from oh-my-codex src/config/codex-hooks.ts) ---
class RawNumber {
  constructor(raw) {
    this.raw = raw;
  }
}
function canonical(v) {
  if (v instanceof RawNumber) return v.raw;
  if (Array.isArray(v)) return `[${v.map(canonical).join(',')}]`;
  if (v && typeof v === 'object') {
    return `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${canonical(v[k])}`).join(',')}}`;
  }
  return JSON.stringify(v);
}
const sha = (v) => `sha256:${createHash('sha256').update(canonical(v)).digest('hex')}`;
const EVENT_LABEL = { SessionStart: 'session_start', Stop: 'stop', PreToolUse: 'pre_tool_use', PostToolUse: 'post_tool_use', UserPromptSubmit: 'user_prompt_submit', PreCompact: 'pre_compact', PostCompact: 'post_compact' };
const MATCHER_AWARE = new Set(['SessionStart', 'PreToolUse', 'PostToolUse']);
function trustEntry(eventName, group, handler) {
  const timeout = typeof handler.timeout === 'number' ? new RawNumber(String(handler.timeout === 0 ? 1 : handler.timeout)) : 600;
  return sha({
    event_name: EVENT_LABEL[eventName],
    ...(MATCHER_AWARE.has(eventName) && group.matcher ? { matcher: group.matcher } : {}),
    hooks: [{ type: 'command', command: handler.command, timeout, async: false }],
  });
}
const isOurs = (h) => typeof h?.command === 'string' && h.command.includes('my-flow-shim.ps1');

function loadHooksJson() {
  if (!existsSync(hooksJsonPath)) return { hooks: {} };
  try {
    return JSON.parse(readFileSync(hooksJsonPath, 'utf8'));
  } catch (e) {
    throw new Error(`cannot parse ${hooksJsonPath}: ${e.message}`);
  }
}
function stripOurHooks(doc) {
  const out = { ...doc, hooks: {} };
  for (const [ev, groups] of Object.entries(doc.hooks ?? {})) {
    const kept = (groups ?? [])
      .map((g) => ({ ...g, hooks: (g.hooks ?? []).filter((h) => !isOurs(h)) }))
      .filter((g) => g.hooks.length);
    if (kept.length) out.hooks[ev] = kept;
  }
  if (out.state) {
    out.state = Object.fromEntries(Object.entries(out.state).filter(([, v]) => !ourHashes.has(v?.trusted_hash)));
    if (!Object.keys(out.state).length) delete out.state; // older installs wrote our trust hashes here
  }
  return out;
}
const ourHashes = new Set();
function stripTomlBlock(text) {
  const t = text.replace(/\r\n/g, '\n');
  const s = t.indexOf(TOML_START);
  const e = t.indexOf(TOML_END);
  if (s === -1 || e === -1) return t;
  return (t.slice(0, s) + t.slice(e + TOML_END.length)).replace(/\n{3,}/g, '\n\n').trimEnd() + '\n';
}

// ---------------- plugin rendering (design D7) ----------------
/**
 * Step 1: stale plugin content first, so a disabled or removed plugin disappears on the next
 * install. Marker-driven, never registry-driven: a skill directory carrying `.my-flow-plugin`
 * and an agent TOML whose header names a plugin. A user directory without the marker is never
 * touched.
 */
function removeStalePluginContent() {
  for (const entry of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    const dir = join(skillsDir, entry);
    if (!existsSync(join(dir, MARKER_FILE))) continue;
    log(`remove ${dir}`);
    if (!DRY) rmSync(dir, { recursive: true, force: true });
  }
  for (const entry of existsSync(agentsDir) ? readdirSync(agentsDir) : []) {
    if (!entry.endsWith('.toml')) continue;
    const p = join(agentsDir, entry);
    if (!PLUGIN_AGENT_HEADER_RE.test(readFileSync(p, 'utf8').split('\n')[0] ?? '')) continue;
    log(`remove ${p}`);
    if (!DRY) rmSync(p, { force: true });
  }
}

/** Step 2: plugin skills are always copied (never junction-linked) so placeholders are rewritten. */
function renderPluginSkills(plugins) {
  let noted = false;
  for (const { loaded } of plugins) {
    if (!loaded.skills.length) continue;
    if (LINK && !noted) {
      log('note: plugin skills are always copied so their placeholders can be rewritten');
      noted = true;
    }
    const skillNames = loaded.skills.map((s) => s.name);
    for (const s of loaded.skills) {
      const to = join(skillsDir, `${loaded.prefix}${s.name}`);
      if (existsSync(to) && !existsSync(join(to, MARKER_FILE))) {
        log(`skip ${to} (exists and is not managed by my-flow; remove it first to replace)`);
        continue;
      }
      log(`${existsSync(to) ? 'replace' : 'add'} ${to}`);
      if (DRY) continue;
      rmSync(to, { recursive: true, force: true });
      mkdirSync(skillsDir, { recursive: true });
      cpSync(s.dir, to, { recursive: true });
      const skillMd = join(to, 'SKILL.md');
      writeFileSync(
        skillMd,
        codexSkillText(readFileSync(skillMd, 'utf8'), {
          pluginName: loaded.manifest.name,
          root: loaded.root,
          prefix: loaded.prefix,
          skill: s.name,
          skillNames,
        }),
        'utf8'
      );
      writeFileSync(join(to, MARKER_FILE), `${loaded.manifest.name}\n`, 'utf8');
    }
  }
}

/** Step 3: plugin agent TOMLs, keeping the `# my-flow agent` prefix the core's own check uses. */
function renderPluginAgents(plugins) {
  for (const { loaded } of plugins) {
    const skillNames = loaded.skills.map((s) => s.name);
    for (const a of loaded.agents) {
      const to = join(agentsDir, `${a.role}.toml`);
      if (existsSync(to) && !readFileSync(to, 'utf8').startsWith('# my-flow agent')) {
        log(`skip ${to} (exists and is not managed by my-flow; remove it first to replace)`);
        continue;
      }
      log(`${existsSync(to) ? 'replace' : 'add'} ${to}`);
      if (DRY) continue;
      mkdirSync(agentsDir, { recursive: true });
      writeFileSync(
        to,
        codexAgentToml(a.role, readFileSync(a.file, 'utf8'), {
          pluginName: loaded.manifest.name,
          root: loaded.root,
          prefix: loaded.prefix,
          skillNames,
        }),
        'utf8'
      );
    }
  }
}

// ---------------- uninstall ----------------
if (UNINSTALL) {
  backup([configPath, hooksJsonPath, agentsMdPath]);
  for (const entry of existsSync(skillsDir) ? readdirSync(skillsDir) : []) {
    if (entry.startsWith(prefix)) {
      log(`remove ${join(skillsDir, entry)}`);
      if (!DRY) rmSync(join(skillsDir, entry), { recursive: true, force: true });
    }
  }
  for (const name of Object.keys(manifest.agents)) {
    const p = join(agentsDir, `${name}.toml`);
    if (existsSync(p) && readFileSync(p, 'utf8').startsWith('# my-flow agent')) {
      log(`remove ${p}`);
      if (!DRY) rmSync(p, { force: true });
    }
  }
  // Plugin content (D8): marker-driven, so a plugin already dropped from the registry is
  // still cleaned. The shim, hook and TOML-block steps below remove plugin hooks and MCP
  // tables by their own markers.
  removeStalePluginContent();
  if (existsSync(shimPath)) {
    log(`remove ${shimPath}`);
    if (!DRY) rmSync(shimPath, { force: true });
  }
  if (existsSync(hooksJsonPath)) {
    const doc = loadHooksJson();
    // collect our hashes from current entries before stripping
    for (const [ev, groups] of Object.entries(doc.hooks ?? {})) {
      groups.forEach((g) => g.hooks?.forEach((h) => isOurs(h) && ourHashes.add(trustEntry(ev, g, h))));
    }
    write(hooksJsonPath, JSON.stringify(stripOurHooks(doc), null, 2) + '\n');
  }
  if (existsSync(configPath)) write(configPath, stripTomlBlock(readFileSync(configPath, 'utf8')));
  if (existsSync(agentsMdPath)) write(agentsMdPath, removeBlock(readFileSync(agentsMdPath, 'utf8')));
  unregisterSurface('codex');
  log('Codex surface removed.');
  process.exit(0);
}

// ---------------- install ----------------
const built = ['codex/AGENTS.block.md', 'codex/hooks.template.json', 'hooks/codex-shim.ps1'].map((p) => join(ROOT, p));
for (const p of built) if (!existsSync(p)) throw new Error(`missing ${p}; run node scripts/build.mjs first`);

backup([configPath, hooksJsonPath, agentsMdPath]);

// plugins: registry read once, stale plugin content removed first (D7 step 1)
const plugins = loadPlugins();
removeStalePluginContent();

// skills
const srcSkills = join(ROOT, 'codex', 'skills');
for (const entry of readdirSync(srcSkills)) {
  const from = join(srcSkills, entry);
  const to = join(skillsDir, entry);
  if (existsSync(to)) {
    log(`replace ${to}`);
    if (!DRY) rmSync(to, { recursive: true, force: true });
  } else log(`add ${to}`);
  if (DRY) continue;
  mkdirSync(skillsDir, { recursive: true });
  if (LINK) symlinkSync(from, to, 'junction');
  else {
    cpSync(from, to, { recursive: true });
    // substitute the repo root into skill bodies that call scripts
    const skillMd = join(to, 'SKILL.md');
    writeFileSync(skillMd, readFileSync(skillMd, 'utf8').replace(/\{\{MYFLOW_ROOT\}\}/g, ROOT.replace(/\\/g, '/')), 'utf8');
  }
}
if (LINK) log('note: with --link, {{MYFLOW_ROOT}} in skill bodies is not substituted; set it by editing src or use copy mode.');
renderPluginSkills(plugins);

// agents
for (const name of Object.keys(manifest.agents)) {
  const from = join(ROOT, 'codex', 'agents', `${name}.toml`);
  const to = join(agentsDir, `${name}.toml`);
  if (existsSync(to) && !readFileSync(to, 'utf8').startsWith('# my-flow agent')) {
    log(`skip ${to} (exists and is not managed by my-flow; remove it first to replace)`);
    continue;
  }
  log(`${existsSync(to) ? 'replace' : 'add'} ${to}`);
  if (!DRY) {
    mkdirSync(agentsDir, { recursive: true });
    cpSync(from, to);
  }
}
renderPluginAgents(plugins);

// shim
const shim = readFileSync(join(ROOT, 'hooks', 'codex-shim.ps1'), 'utf8').replace('{{NODE}}', process.execPath);
write(shimPath, '﻿' + shim.replace(/\r?\n/g, '\r\n'));

// hooks.json
const template = JSON.parse(
  readFileSync(join(ROOT, 'codex', 'hooks.template.json'), 'utf8')
    .replace(/\{\{SHIM\}\}/g, shimPath.replace(/\\/g, '\\\\'))
    .replace(/\{\{ROOT\}\}/g, ROOT.replace(/\\/g, '/'))
);
const doc = stripOurHooks(loadHooksJson());
const trust = {};
for (const [ev, groups] of Object.entries(template.hooks)) {
  doc.hooks[ev] = [...(doc.hooks[ev] ?? []), ...groups];
}
// Plugin hook groups (D7 step 4): appended after the core groups, so the core's trust-key
// indices stay stable. The command is built here, after JSON parsing, with shimPath verbatim;
// JSON.stringify escapes it on write and the trust loop below hashes this same string.
for (const { loaded } of plugins) {
  for (const [ev, groups] of Object.entries(loaded.hooks?.hooks ?? {})) {
    const rendered = (groups ?? []).map((g) => ({
      ...g,
      hooks: (g.hooks ?? []).map((h) => ({ ...h, command: codexHookCommand(h.command, { root: loaded.root, shimPath }) })),
    }));
    for (const g of rendered) for (const h of g.hooks) log(`add hook ${ev}: ${h.command}`);
    doc.hooks[ev] = [...(doc.hooks[ev] ?? []), ...rendered];
  }
}
for (const [ev, groups] of Object.entries(doc.hooks)) {
  groups.forEach((g, gi) =>
    (g.hooks ?? []).forEach((h, hi) => {
      if (!isOurs(h)) return;
      trust[`${hooksJsonPath}:${EVENT_LABEL[ev] ?? ev}:${gi}:${hi}`] = { trusted_hash: trustEntry(ev, g, h) };
    })
  );
}
// Trust state lives only in config.toml ([hooks.state.*] below): Codex 0.154+ rejects a hooks.json
// with any top-level key other than `description` / `hooks` ("unknown field `state`").
delete doc.state;
write(hooksJsonPath, JSON.stringify(doc, null, 2) + '\n');

// config.toml managed block
let config = existsSync(configPath) ? stripTomlBlock(readFileSync(configPath, 'utf8')) : '';
const tomlKey = (k) => `'${k.replace(/'/g, "''")}'`;
// Plugin MCP servers (D7 step 5). A table already defined outside the managed block wins:
// a duplicate TOML table would make Codex reject the whole file.
const pluginToml = [];
for (const { loaded } of plugins) {
  for (const { server, lines } of codexMcpTables(loaded.manifest, loaded.root)) {
    if (mcpTableRe(server).test(config)) {
      log(`skip [mcp_servers.${server}]: defined outside the my-flow block; remove it first to let my-flow manage it`);
      continue;
    }
    log(`add [mcp_servers.${server}]`);
    for (const l of lines) log(`  ${l}`);
    pluginToml.push(...lines, '');
  }
}
if (pluginToml.length) {
  pluginToml.unshift(`# Plugin MCP servers (regenerated by \`my-flow install codex\`; registry: ${join(filePaths().home, 'plugins.json')})`);
}
const block = [
  TOML_START,
  '# Trust state for my-flow hooks (regenerated by `my-flow install codex`).',
  ...Object.entries(trust).flatMap(([k, v]) => [`[hooks.state.${tomlKey(k)}]`, `trusted_hash = "${v.trusted_hash}"`, '']),
  ...pluginToml,
  TOML_END,
  '',
].join('\n');
config = config.trimEnd() + '\n\n' + block;
write(configPath, config);
for (const feature of ['hooks', 'goals', 'multi_agent']) {
  if (!new RegExp(`^\\s*${feature}\\s*=\\s*true`, 'm').test(config)) {
    log(`WARNING: [features] ${feature} = true not found in config.toml; enable it with: codex features enable ${feature}`);
  }
}

// AGENTS.md
const agentsBlock = readFileSync(join(ROOT, 'codex', 'AGENTS.block.md'), 'utf8');
write(agentsMdPath, upsertBlock(existsSync(agentsMdPath) ? readFileSync(agentsMdPath, 'utf8') : '', agentsBlock));

recordConfig({ codex: { home: CODEX_HOME, agentsDir } });
registerLauncher();

for (const { key, loaded } of plugins) {
  const skills = loaded.skills.length ? `skills ${loaded.prefix}*` : 'no skills';
  const servers = Object.keys(loaded.manifest.contributes?.mcpServers ?? {});
  console.log(`plugin ${key}: ${skills}, mcp ${servers.length ? servers.join(', ') : 'none'}`);
}

console.log(`
Codex surface installed. Verify with:
  codex           -> type $${prefix} and check the skills appear; /hooks should show my-flow entries as trusted
  codex features list | findstr /i "hooks goals multi_agent"
If Codex still asks to trust the hooks, approve them once via /hooks (the hash algorithm may have changed upstream).
`);
