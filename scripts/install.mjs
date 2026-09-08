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
 */
import { createHash } from 'node:crypto';
import {
  cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, symlinkSync, writeFileSync, lstatSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
    log('Claude block removed. Disable the plugin with: claude plugin disable my-flow@my-flow');
    process.exit(0);
  }
  const settingsPath = join(CLAUDE_HOME, 'settings.json');
  const settings = existsSync(settingsPath) ? JSON.parse(readFileSync(settingsPath, 'utf8')) : {};
  backup([settingsPath, join(CLAUDE_HOME, 'CLAUDE.md')]);

  settings.env = { ...(settings.env ?? {}), CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS: '1' };
  write(settingsPath, JSON.stringify(settings, null, 2) + '\n');

  const block = readFileSync(join(ROOT, 'claude', 'CLAUDE.block.md'), 'utf8');
  const md = join(CLAUDE_HOME, 'CLAUDE.md');
  write(md, upsertBlock(existsSync(md) ? readFileSync(md, 'utf8') : '', block));

  console.log(`
Next steps (run in a terminal, not inside a Claude session):
  development:  claude --plugin-dir "${ROOT}"
  stable:       claude plugin marketplace add "${ROOT}"
                claude plugin install my-flow@my-flow
`);
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
  log('Codex surface removed.');
  process.exit(0);
}

// ---------------- install ----------------
const built = ['codex/AGENTS.block.md', 'codex/hooks.template.json', 'hooks/codex-shim.ps1'].map((p) => join(ROOT, p));
for (const p of built) if (!existsSync(p)) throw new Error(`missing ${p}; run node scripts/build.mjs first`);

backup([configPath, hooksJsonPath, agentsMdPath]);

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
for (const [ev, groups] of Object.entries(doc.hooks)) {
  groups.forEach((g, gi) =>
    (g.hooks ?? []).forEach((h, hi) => {
      if (!isOurs(h)) return;
      trust[`${hooksJsonPath}:${EVENT_LABEL[ev] ?? ev}:${gi}:${hi}`] = { trusted_hash: trustEntry(ev, g, h) };
    })
  );
}
doc.state = { ...(doc.state ?? {}), ...trust };
write(hooksJsonPath, JSON.stringify(doc, null, 2) + '\n');

// config.toml managed block
let config = existsSync(configPath) ? stripTomlBlock(readFileSync(configPath, 'utf8')) : '';
const tomlKey = (k) => `'${k.replace(/'/g, "''")}'`;
const block = [
  TOML_START,
  '# Trust state for my-flow hooks (regenerated by `my-flow install codex`).',
  ...Object.entries(trust).flatMap(([k, v]) => [`[hooks.state.${tomlKey(k)}]`, `trusted_hash = "${v.trusted_hash}"`, '']),
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

console.log(`
Codex surface installed. Verify with:
  codex           -> type $${prefix} and check the skills appear; /hooks should show my-flow entries as trusted
  codex features list | findstr /i "hooks goals multi_agent"
If Codex still asks to trust the hooks, approve them once via /hooks (the hash algorithm may have changed upstream).
`);
