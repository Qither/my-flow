/**
 * Model routing for the my-flow subagent roles (planner, architect, critic, verifier).
 *
 * Baseline: every role inherits the main session's model (Claude `model: inherit`, Codex no
 * `model =` line). A per-user override under MY_FLOW_HOME (default ~/.my-flow) can replace
 * that; it is produced by a model-driven analysis that runs only after a script detected a
 * CLI upgrade, validated against a positive allowed set, and applied to the installed agent
 * files only (never to the repository's manifest.json or src/).
 *
 * Node built-ins only. Every reader fails open: a missing or unparsable file is "empty".
 *
 * Test seams (env): MY_FLOW_HOME, CLAUDE_CONFIG_DIR, CODEX_HOME, MY_FLOW_MODELS_FAKE_VERSIONS
 * ("claude=2.9.0,codex=0.200.0", empty value = null, no spawn), MY_FLOW_ASK_SCRIPT (replaces
 * scripts/ask.mjs), MY_FLOW_MODELS_CHECK_HOURS (throttle, default 1, 0 = every start).
 */
import { spawn, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeFileSync,
  writeSync,
} from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCli } from './spawn.mjs';

// ---------------------------------------------------------------- roots and constants
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const manifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
export const ROLES = Object.keys(manifest.agents);
export const PLUGIN_KEY = `${manifest.pluginName}@${manifest.pluginName}`;
const CLAUDE_ALIAS_RE = /^(inherit|sonnet|opus|haiku|fable)$/;
const DEFAULT_EFFORTS = ['low', 'medium', 'high', 'xhigh'];
const LOCK_STALE_MS = 30 * 60 * 1000;
const LOG_ROTATE_BYTES = 256 * 1024;
const MANAGED_TOML_HEADER = '# my-flow agent';
export const TASK_NAME = 'my-flow-models-check';

export const myFlowHome = () => process.env.MY_FLOW_HOME || join(homedir(), '.my-flow');
export const claudeHome = () => readConfig().claude?.home || process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude');
export const codexHome = () => process.env.CODEX_HOME || readConfig().codex?.home || join(homedir(), '.codex');

const paths = () => {
  const home = myFlowHome();
  return {
    home,
    config: join(home, 'config.json'),
    models: join(home, 'models.json'),
    state: join(home, 'models-state.json'),
    lock: join(home, 'models.lock'),
    log: join(home, 'models.log'),
    askDir: join(home, 'ask'),
  };
};
export const filePaths = paths;

const sameRoot = (a, b) => {
  if (!a || !b) return false;
  const na = resolve(a);
  const nb = resolve(b);
  return process.platform === 'win32' ? na.toLowerCase() === nb.toLowerCase() : na === nb;
};
const contained = (root, abs) => {
  const r = resolve(root);
  const a = resolve(abs);
  const [rr, aa] = process.platform === 'win32' ? [r.toLowerCase(), a.toLowerCase()] : [r, a];
  return aa === rr || aa.startsWith(rr + sep);
};

// ---------------------------------------------------------------- fail-open file helpers
function readJson(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}
function writeJsonAtomic(path, value) {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(value, null, 2) + '\n', 'utf8');
  renameSync(tmp, path);
}

export function readConfig() {
  const cfg = readJson(paths().config);
  return cfg && typeof cfg === 'object' ? cfg : {};
}
export function writeConfig(patch) {
  const p = paths().config;
  const current = readJson(p) ?? {};
  const merged = { ...current };
  for (const [k, v] of Object.entries(patch)) {
    merged[k] = v && typeof v === 'object' && !Array.isArray(v) ? { ...(current[k] ?? {}), ...v } : v;
  }
  if (!Array.isArray(merged.claude?.knownModels)) merged.claude = { ...(merged.claude ?? {}), knownModels: merged.claude?.knownModels ?? [] };
  if (!Array.isArray(merged.codex?.knownModels)) merged.codex = { ...(merged.codex ?? {}), knownModels: merged.codex?.knownModels ?? [] };
  merged.updated = new Date().toISOString();
  writeJsonAtomic(p, merged);
  return merged;
}

/** Read-modify-write of config.json through `fn(config)`; keeps the knownModels arrays. */
export function updateConfig(fn) {
  const p = paths().config;
  const cfg = readJson(p) ?? {};
  const next = fn(cfg) ?? cfg;
  for (const k of ['claude', 'codex']) {
    if (next[k] && !Array.isArray(next[k].knownModels)) next[k].knownModels = [];
  }
  next.updated = new Date().toISOString();
  writeJsonAtomic(p, next);
  return next;
}

/** The launcher recorded by install (D9) plus whether its pieces still exist. */
export function launcherStatus({ schtasksBin = process.env.MY_FLOW_SCHTASKS ?? 'schtasks' } = {}) {
  const l = readConfig().launcher;
  if (!l || typeof l.task !== 'string' || !l.task) return { launcher: 'primary', task: null };
  let query = 'unknown';
  try {
    const viaScript = process.env.MY_FLOW_SCHTASKS !== undefined;
    const r = viaScript
      ? spawnSync(process.execPath, [schtasksBin, '/query', '/tn', l.task], { timeout: 5000, windowsHide: true, encoding: 'utf8' })
      : spawnSync(schtasksBin, ['/query', '/tn', l.task], { timeout: 5000, windowsHide: true, encoding: 'utf8' });
    query = !r.error && r.status === 0 ? 'ok' : 'missing';
  } catch {
    query = 'missing';
  }
  return {
    launcher: 'schtasks',
    task: l.task,
    root: l.root ?? null,
    node: l.node ?? null,
    home: l.home ?? null,
    registered: l.registered ?? null,
    rootExists: !!l.root && existsSync(join(l.root, 'scripts', 'models.mjs')),
    nodeExists: !!l.node && existsSync(l.node),
    query,
  };
}

export function readState() {
  const s = readJson(paths().state);
  return s && typeof s === 'object' ? { version: 1, ...s } : { version: 1 };
}
export function writeState(state) {
  writeJsonAtomic(paths().state, state);
}
export function writeModels(doc) {
  writeJsonAtomic(paths().models, doc);
}
export function readModels() {
  const m = readJson(paths().models);
  return m && typeof m === 'object' && m.roles && typeof m.roles === 'object' ? m : null;
}

export function appendLog(level, message) {
  const p = paths().log;
  try {
    mkdirSync(dirname(p), { recursive: true });
    try {
      if (statSync(p).size > LOG_ROTATE_BYTES) renameSync(p, `${p}.1`);
    } catch {
      /* no log yet */
    }
    const fd = openSync(p, 'a');
    writeSync(fd, `${new Date().toISOString()} ${level} ${message}\n`);
    closeSync(fd);
  } catch {
    /* logging never fails the caller */
  }
}

// ---------------------------------------------------------------- baseline and allowed sets
export function baseline() {
  const roles = {};
  for (const [role, cfg] of Object.entries(manifest.agents)) {
    roles[role] = {
      claude: { model: 'inherit' },
      codex: { model: null, model_reasoning_effort: cfg.codex?.model_reasoning_effort ?? null },
    };
  }
  return roles;
}

/** Read-only, fail-open view of <CODEX_HOME>/models_cache.json. */
export function readModelsCache() {
  const out = { listed: [], efforts: new Map() };
  const cache = readJson(join(codexHome(), 'models_cache.json'));
  const models = Array.isArray(cache?.models) ? cache.models : [];
  for (const m of models) {
    if (!m || typeof m.slug !== 'string') continue;
    const efforts = Array.isArray(m.supported_reasoning_levels)
      ? m.supported_reasoning_levels.map((l) => (typeof l === 'string' ? l : l?.effort)).filter((e) => typeof e === 'string')
      : [];
    if (efforts.length) out.efforts.set(m.slug, efforts);
    if (m.visibility === 'list') out.listed.push(m.slug);
  }
  return out;
}

export function readMainModels() {
  const settings = readJson(join(claudeHome(), 'settings.json'));
  const claude = typeof settings?.model === 'string' && settings.model ? settings.model : null;
  let codex = null;
  try {
    for (const line of readFileSync(join(codexHome(), 'config.toml'), 'utf8').split(/\r?\n/)) {
      if (/^\s*\[/.test(line)) break;
      const m = /^\s*model\s*=\s*"([^"]+)"/.exec(line);
      if (m) {
        codex = m[1];
        break;
      }
    }
  } catch {
    /* no config */
  }
  return { claude, codex };
}

export function resolveAllowed() {
  const config = readConfig();
  const mainModels = readMainModels();
  const cache = readModelsCache();
  const claude = new Set([mainModels.claude, ...(config.claude?.knownModels ?? [])].filter((s) => typeof s === 'string' && s));
  const codex = new Set([mainModels.codex, ...cache.listed, ...(config.codex?.knownModels ?? [])].filter((s) => typeof s === 'string' && s));
  const efforts = (slug) => (slug && cache.efforts.has(slug) ? cache.efforts.get(slug) : DEFAULT_EFFORTS);
  return { claude, codex, efforts, mainModels };
}

/** Pure validation of a recommendation `{ roles, reason }` against the allowed sets. */
export function validateRecommendation(obj, allowed) {
  const errors = [];
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { ok: false, errors: ['recommendation is not an object'] };
  const roles = obj.roles;
  if (!roles || typeof roles !== 'object' || Array.isArray(roles)) return { ok: false, errors: ['roles is not an object'] };
  const keys = Object.keys(roles);
  for (const r of ROLES) if (!keys.includes(r)) errors.push(`missing role ${r}`);
  for (const k of keys) if (!ROLES.includes(k)) errors.push(`unknown role ${k}`);
  if (errors.length) return { ok: false, errors };
  const out = {};
  for (const role of ROLES) {
    const entry = roles[role];
    if (!entry || typeof entry !== 'object' || !entry.claude || typeof entry.claude !== 'object' || !entry.codex || typeof entry.codex !== 'object') {
      errors.push(`role ${role} needs claude and codex objects`);
      continue;
    }
    const cm = entry.claude.model;
    if (typeof cm !== 'string' || !(CLAUDE_ALIAS_RE.test(cm) || allowed.claude.has(cm))) {
      errors.push(`claude.model ${JSON.stringify(cm)} for ${role} is not in the allowed set`);
    }
    const xm = entry.codex.model ?? null;
    if (xm !== null && !(typeof xm === 'string' && allowed.codex.has(xm))) {
      errors.push(`codex.model ${JSON.stringify(xm)} for ${role} is not in the allowed set`);
    }
    const eff = entry.codex.model_reasoning_effort ?? null;
    const effortModel = xm ?? allowed.mainModels?.codex ?? null;
    if (eff !== null && !(typeof eff === 'string' && allowed.efforts(effortModel).includes(eff))) {
      errors.push(`codex.model_reasoning_effort ${JSON.stringify(eff)} for ${role} is not supported by ${effortModel ?? 'the default model'}`);
    }
    out[role] = { claude: { model: cm }, codex: { model: xm, model_reasoning_effort: eff } };
  }
  if (errors.length) return { ok: false, errors };
  const reason = typeof obj.reason === 'string' ? obj.reason.trim().slice(0, 2000) : '';
  return { ok: true, roles: out, reason };
}

// ---------------------------------------------------------------- renderers
const eolOf = (text) => (text.includes('\r\n') ? '\r\n' : '\n');

/** Replace (or insert after `description:`) the `model:` line of a Claude agent frontmatter. */
export function renderClaudeAgent(text, model) {
  const eol = eolOf(text);
  const lines = text.split(/\r?\n/);
  if (lines[0] !== '---') return text;
  const end = lines.indexOf('---', 1);
  if (end < 0) return text;
  const idx = lines.findIndex((l, i) => i > 0 && i < end && /^model:/.test(l));
  const line = `model: ${model}`;
  if (idx >= 0) lines[idx] = line;
  else {
    const d = lines.findIndex((l, i) => i > 0 && i < end && /^description:/.test(l));
    lines.splice(d >= 0 ? d + 1 : end, 0, line);
  }
  return lines.join(eol);
}

/** Rewrite the `model =` / `model_reasoning_effort =` lines of a managed Codex agent TOML. */
export function renderCodexAgent(text, { model, effort }) {
  if (!text.startsWith(MANAGED_TOML_HEADER)) return null;
  const eol = eolOf(text);
  const lines = text.split(/\r?\n/);
  // never touch anything inside developer_instructions
  const bodyStart = lines.findIndex((l) => /^developer_instructions\s*=/.test(l));
  const head = bodyStart >= 0 ? lines.slice(0, bodyStart) : lines;
  const tail = bodyStart >= 0 ? lines.slice(bodyStart) : [];
  const kept = head.filter((l) => !/^model\s*=/.test(l) && !/^model_reasoning_effort\s*=/.test(l));
  const insert = [];
  if (model) insert.push(`model = ${JSON.stringify(model)}`);
  if (effort) insert.push(`model_reasoning_effort = ${JSON.stringify(effort)}`);
  const d = kept.findIndex((l) => /^description\s*=/.test(l));
  kept.splice(d >= 0 ? d + 1 : kept.length, 0, ...insert);
  return [...kept, ...tail].join(eol);
}

function readClaudeValue(text) {
  const m = /^model:\s*(.+?)\s*$/m.exec(text);
  return m ? m[1] : null;
}
function readCodexValues(text) {
  const m = /^model\s*=\s*"([^"]*)"/m.exec(text);
  const e = /^model_reasoning_effort\s*=\s*"([^"]*)"/m.exec(text);
  return { model: m ? m[1] : null, effort: e ? e[1] : null };
}

// ---------------------------------------------------------------- surfaces
function frontmatterName(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text);
  const n = m && /^name:\s*(.+?)\s*$/m.exec(m[1]);
  return n ? n[1] : null;
}

/** Candidate plugin roots: the registry (array or single entry) plus the recorded hook root. */
export function locateClaudeSurface({ recordedRoot = null, log = () => {} } = {}) {
  const pluginsDir = join(claudeHome(), 'plugins');
  const registryPath = join(pluginsDir, 'installed_plugins.json');
  const candidates = [];
  let registry = null;
  if (existsSync(registryPath)) {
    try {
      registry = JSON.parse(readFileSync(registryPath, 'utf8'));
    } catch (e) {
      log('warn', `claude surface: ${registryPath} unreadable (${e.message}); using the recorded plugin root only`);
    }
  }
  const entry = registry?.plugins?.[PLUGIN_KEY];
  for (const e of Array.isArray(entry) ? entry : entry ? [entry] : []) {
    if (e && typeof e.installPath === 'string' && e.installPath) candidates.push(e.installPath);
  }
  if (recordedRoot) candidates.push(recordedRoot);
  for (const root of candidates) {
    if (!contained(pluginsDir, root)) {
      log('info', `claude surface: development checkout ${root}, not rewritten`);
      continue;
    }
    const files = {};
    let complete = true;
    for (const role of ROLES) {
      const p = join(root, 'agents', `${role}.md`);
      let text = null;
      try {
        text = readFileSync(p, 'utf8');
      } catch {
        complete = false;
        break;
      }
      if (frontmatterName(text) !== role) {
        complete = false;
        break;
      }
      files[role] = p;
    }
    if (complete) return { root: resolve(root), files };
  }
  return null;
}

export function locateCodexSurface() {
  const dir = readConfig().codex?.agentsDir || join(codexHome(), 'agents');
  const files = {};
  for (const role of ROLES) {
    const p = join(dir, `${role}.toml`);
    try {
      if (readFileSync(p, 'utf8').startsWith(MANAGED_TOML_HEADER)) files[role] = p;
    } catch {
      /* missing */
    }
  }
  return Object.keys(files).length ? { dir: resolve(dir), files } : null;
}

export const rolesHash = (roles) => createHash('sha256').update(JSON.stringify(roles)).digest('hex');

/** Rewrite every located installed agent file from `roles`; records `state.applied`. */
export function applyRoles(roles, { log = () => {}, recordedRoot = null } = {}) {
  const claude = locateClaudeSurface({ recordedRoot, log });
  const codex = locateCodexSurface();
  const written = [];
  if (claude) {
    for (const [role, p] of Object.entries(claude.files)) {
      const before = readFileSync(p, 'utf8');
      const after = renderClaudeAgent(before, roles[role].claude.model);
      if (after !== before) {
        writeFileSync(p, after, 'utf8');
        written.push(p);
      }
    }
  } else log('info', 'claude surface: not found, skipped');
  if (codex) {
    for (const [role, p] of Object.entries(codex.files)) {
      const before = readFileSync(p, 'utf8');
      const after = renderCodexAgent(before, { model: roles[role].codex.model, effort: roles[role].codex.model_reasoning_effort });
      if (after !== null && after !== before) {
        writeFileSync(p, after, 'utf8');
        written.push(p);
      }
    }
  } else log('info', 'codex surface: not found, skipped');
  const state = readState();
  state.applied = { claudeRoot: claude?.root ?? null, codexAgentsDir: codex?.dir ?? null, hash: rolesHash(roles), at: new Date().toISOString() };
  writeState(state);
  return { claude, codex, written };
}

export function resetSurfaces({ log = () => {} } = {}) {
  const result = applyRoles(baseline(), { log, recordedRoot: readState().claudePluginRoot ?? null });
  try {
    unlinkSync(paths().models);
  } catch {
    /* no override */
  }
  const state = readState();
  state.applied = null;
  state.pending = { line: 'model routing reset to baseline', at: new Date().toISOString() };
  writeState(state);
  log('info', 'reset: override removed, baseline restored');
  return result;
}

/** Effective values read back from the installed files, per role and surface. */
export function readEffective({ recordedRoot = null } = {}) {
  const claude = locateClaudeSurface({ recordedRoot });
  const codex = locateCodexSurface();
  const roles = {};
  for (const role of ROLES) {
    roles[role] = {
      claude: claude?.files[role] ? { model: readClaudeValue(readFileSync(claude.files[role], 'utf8')) } : null,
      codex: codex?.files[role] ? readCodexValues(readFileSync(codex.files[role], 'utf8')) : null,
    };
  }
  return { claude, codex, roles };
}

function surfacesDiffer(models, effective) {
  for (const role of ROLES) {
    const want = models.roles[role];
    const have = effective.roles[role];
    if (!want) return true;
    if (have.claude && have.claude.model !== want.claude.model) return true;
    if (have.codex && ((have.codex.model ?? null) !== (want.codex.model ?? null) || (have.codex.effort ?? null) !== (want.codex.model_reasoning_effort ?? null))) return true;
  }
  return false;
}

// ---------------------------------------------------------------- probes
export function parseVersion(text) {
  const m = /(\d+\.\d+\.\d+)/.exec(text ?? '');
  return m ? m[1] : null;
}

export function fakeVersions() {
  const raw = process.env.MY_FLOW_MODELS_FAKE_VERSIONS;
  if (raw === undefined) return null;
  const out = { claude: null, codex: null };
  for (const part of raw.split(',')) {
    const [k, v = ''] = part.split('=').map((s) => s.trim());
    if (k === 'claude' || k === 'codex') out[k] = v || null;
  }
  return out;
}

export function probeVersions() {
  const fake = fakeVersions();
  if (fake) return fake;
  const probe = (name) => {
    try {
      const { result } = spawnCli(name, ['--version'], { encoding: 'utf8', timeout: 15000, windowsHide: true });
      return result.status === 0 ? parseVersion(`${result.stdout ?? ''}\n${result.stderr ?? ''}`) : null;
    } catch {
      return null;
    }
  };
  return { claude: probe('claude'), codex: probe('codex') };
}

// ---------------------------------------------------------------- lock
const alive = (pid) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === 'EPERM';
  }
};

/** Returns a release function, or null when another live run holds the lock. */
export function acquireLock() {
  const p = paths().lock;
  mkdirSync(dirname(p), { recursive: true });
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const fd = openSync(p, 'wx');
      writeSync(fd, JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
      closeSync(fd);
      return () => {
        try {
          unlinkSync(p);
        } catch {
          /* already gone */
        }
      };
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      const held = readJson(p);
      const age = Date.now() - Date.parse(held?.started ?? 0);
      if (held && Number.isInteger(held.pid) && alive(held.pid) && age < LOCK_STALE_MS) return null;
      try {
        unlinkSync(p);
      } catch {
        /* raced */
      }
    }
  }
  return null;
}
export function lockHolder() {
  return readJson(paths().lock);
}

// ---------------------------------------------------------------- analysis
function roleDescriptions() {
  const out = {};
  for (const role of ROLES) {
    try {
      const text = readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8');
      const m = /^description:\s*(.+?)\s*$/m.exec(text);
      out[role] = m ? m[1].replace(/^"|"$/g, '') : role;
    } catch {
      out[role] = role;
    }
  }
  return out;
}

export function buildPrompt({ allowed, cliVersions, mainModels, previous = null }) {
  const desc = roleDescriptions();
  const readOnly = { planner: false, architect: true, critic: true, verifier: true };
  const lines = [
    '# my-flow model routing',
    '',
    'You choose which model each my-flow subagent role should use on two CLIs (Claude Code and Codex CLI).',
    'Optimise for quality of planning and review first, then cost. Answer with ONE fenced `json` block',
    '`{ "roles": { ... }, "reason": "..." }` and nothing else. Do not read or modify files.',
    '',
    '## Roles',
  ];
  for (const role of ROLES) lines.push(`- ${role}: ${desc[role]}${readOnly[role] ? ' (read-only)' : ''}`);
  lines.push(
    '',
    '## Current environment',
    `- Claude Code ${cliVersions.claude ?? 'not installed'}, main model: ${mainModels.claude ?? 'unknown'}`,
    `- Codex CLI ${cliVersions.codex ?? 'not installed'}, main model: ${mainModels.codex ?? 'unknown'}`,
    '',
    '## Allowed values (the answer is rejected as a whole if any value is outside these sets)',
    `- claude.model: "inherit" (the main model), the aliases sonnet | opus | haiku | fable, or one of: ${[...allowed.claude].map((s) => JSON.stringify(s)).join(', ') || '(none)'}`,
    `- codex.model: null (inherit the main model) or one of: ${[...allowed.codex].map((s) => JSON.stringify(s)).join(', ') || '(none)'}`,
    '- codex.model_reasoning_effort: null (model default) or one of the levels the chosen model supports:'
  );
  const effortModels = [...allowed.codex];
  if (!effortModels.length) lines.push(`  - default: ${DEFAULT_EFFORTS.join(', ')}`);
  for (const slug of effortModels) lines.push(`  - ${slug}: ${allowed.efforts(slug).join(', ')}`);
  lines.push('', '## Baseline (used when no override exists)', '```json', JSON.stringify({ roles: baseline() }, null, 2), '```');
  if (previous?.roles) lines.push('', '## Previous override', '```json', JSON.stringify({ roles: previous.roles, reason: previous.reason ?? '' }, null, 2), '```');
  lines.push(
    '',
    '## Answer format',
    '```json',
    JSON.stringify({ roles: Object.fromEntries(ROLES.map((r) => [r, { claude: { model: 'inherit' }, codex: { model: null, model_reasoning_effort: 'high' } }])), reason: 'one paragraph' }, null, 2),
    '```',
    ''
  );
  return lines.join('\n');
}

export function parseRecommendation(stdout) {
  const text = String(stdout ?? '');
  const blank = text.search(/\r?\n\s*\r?\n/);
  const body = blank >= 0 ? text.slice(blank) : text;
  const fence = /```json\s*([\s\S]*?)```/i.exec(body) ?? /```\s*([\s\S]*?)```/.exec(body);
  let raw = fence ? fence[1] : null;
  if (raw === null) {
    const start = body.indexOf('{');
    const end = body.lastIndexOf('}');
    if (start < 0 || end <= start) return { ok: false, reason: 'no JSON answer found' };
    raw = body.slice(start, end + 1);
  }
  try {
    return { ok: true, value: JSON.parse(raw) };
  } catch (e) {
    return { ok: false, reason: `unparsable JSON answer (${e.message})` };
  }
}

/** Runs the analysis through ask.mjs for each provider in order; first valid answer wins. */
export function runAnalysis({ providers, allowed, cliVersions, mainModels, previous = null, timeout = 180000, log = () => {} }) {
  const { home, askDir } = paths();
  mkdirSync(askDir, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
  const promptPath = join(askDir, `${ts}-models-prompt.md`);
  writeFileSync(promptPath, buildPrompt({ allowed, cliVersions, mainModels, previous }), 'utf8');
  const askScript = process.env.MY_FLOW_ASK_SCRIPT || join(ROOT, 'scripts', 'ask.mjs');
  const skip = [...(process.env.MY_FLOW_SKIP_HOOKS ?? '').split(',').map((s) => s.trim()).filter(Boolean), 'model-routing'];
  const env = { ...process.env, MY_FLOW_SKIP_HOOKS: [...new Set(skip)].join(',') };
  const failures = [];
  for (const provider of providers) {
    const r = spawnSync(process.execPath, [askScript, provider, '--prompt-file', promptPath, '--cwd', home, '--ask-dir', askDir, '--timeout', String(timeout)], {
      encoding: 'utf8',
      env,
      timeout: timeout + 20000,
      killSignal: 'SIGKILL',
      maxBuffer: 16 * 1024 * 1024,
      windowsHide: true,
    });
    let reason = null;
    if (r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null)) reason = `timeout after ${timeout} ms`;
    else if (r.error) reason = `spawn error: ${r.error.message}`;
    else if (r.status !== 0) reason = `exit ${r.status}`;
    else if (!(r.stdout ?? '').trim()) reason = 'empty output';
    if (!reason) {
      const parsed = parseRecommendation(r.stdout);
      if (!parsed.ok) reason = parsed.reason;
      else {
        const v = validateRecommendation(parsed.value, allowed);
        if (v.ok) {
          log('info', `analysis by ${provider}: valid recommendation`);
          return { ok: true, provider, roles: v.roles, reason: v.reason, promptPath };
        }
        reason = `invalid: ${v.errors[0]}`;
      }
    }
    log('warn', `analysis by ${provider} failed: ${reason}`);
    failures.push(`${provider}: ${reason}`);
  }
  return { ok: false, reason: failures.join('; ') || 'no provider', promptPath };
}

// ---------------------------------------------------------------- check (background)
const deepEqual = (a, b) => JSON.stringify(a) === JSON.stringify(b);

function pendingLine(models, provider) {
  const parts = ROLES.map((r) => {
    const x = models.roles[r];
    return `${r}=${x.claude.model}/${x.codex.model ?? 'inherit'}@${x.codex.model_reasoning_effort ?? 'default'}`;
  });
  return `model routing updated for claude ${models.cliVersions.claude ?? '-'} / codex ${models.cliVersions.codex ?? '-'} (by ${provider}): ${parts.join(', ')}`;
}

/**
 * The detached background run spawned by the hook (and `models check`). Never throws;
 * returns an exit code. See design D7.
 */
export function check({ quiet = true, providers = null, timeout = 180000 } = {}) {
  const say = (level, msg) => {
    appendLog(level, msg);
    if (!quiet) console.log(msg);
  };
  const release = acquireLock();
  if (!release) return 0;
  say('info', `check start (pid ${process.pid})`);
  let code = 0;
  try {
    const state = readState();
    const recordedRoot = state.claudePluginRoot ?? null;
    const allowed = resolveAllowed();
    const models = readModels();
    // 2. re-apply when the override validates but the installed files drifted
    if (models) {
      const v = validateRecommendation({ roles: models.roles, reason: models.reason }, allowed);
      if (v.ok) {
        const eff = readEffective({ recordedRoot });
        const applied = state.applied ?? null;
        const rootChanged = eff.claude && !sameRoot(applied?.claudeRoot, eff.claude.root);
        const dirChanged = eff.codex && !sameRoot(applied?.codexAgentsDir, eff.codex.dir);
        if (rootChanged || dirChanged || surfacesDiffer(models, eff)) {
          const r = applyRoles(v.roles, { log: say, recordedRoot });
          say('info', `re-applied override to ${r.written.join(', ') || '(no file changed)'}`);
        }
      } else say('warn', `override invalid, not applied: ${v.errors[0]}`);
    }
    // 3-5. probe and compare
    const cliVersions = probeVersions();
    const mainModels = readMainModels();
    const current = { cliVersions, mainModels };
    const st = readState();
    if (!st.seen) {
      st.seen = current;
      writeState(st);
      say('info', `first run: recorded claude ${cliVersions.claude ?? '-'} / codex ${cliVersions.codex ?? '-'} (no analysis; run "models analyze" to request one)`);
    } else if (deepEqual(current, st.seen)) {
      say('info', 'unchanged');
    } else {
      // 6. provider order
      const changed = ['claude', 'codex'].filter((p) => st.seen.cliVersions?.[p] !== cliVersions[p]);
      let order = providers ?? (changed.length === 1 ? [changed[0], changed[0] === 'claude' ? 'codex' : 'claude'] : ['claude', 'codex']);
      order = order.filter((p) => cliVersions[p] !== null);
      if (!order.length) {
        st.seen = current;
        writeState(st);
        say('warn', 'no CLI available for the analysis; recorded versions');
      } else {
        const result = runAnalysis({ providers: order, allowed, cliVersions, mainModels, previous: models, timeout, log: say });
        const now = readState();
        if (result.ok) {
          const doc = { version: 1, updated: new Date().toISOString(), analyzedBy: result.provider, cliVersions, mainModels, roles: result.roles, reason: result.reason };
          writeJsonAtomic(paths().models, doc);
          applyRoles(result.roles, { log: say, recordedRoot });
          const after = readState();
          after.seen = current;
          after.analysis = { attempts: 0, lastError: null };
          after.pending = { line: pendingLine(doc, result.provider), at: new Date().toISOString() };
          writeState(after);
          say('info', after.pending.line);
        } else {
          const attempts = (now.analysis?.attempts ?? 0) + 1;
          now.analysis = { attempts, lastError: result.reason };
          now.pending = { line: `model routing analysis failed: ${result.reason} (baseline inherit kept)`, at: new Date().toISOString() };
          if (attempts >= 3) now.seen = current;
          writeState(now);
          say('warn', `analysis failed: ${result.reason} (attempt ${attempts})`);
          code = 1;
        }
      }
    }
  } catch (e) {
    say('error', `check crashed: ${e.stack ?? e.message}`);
    code = 1;
  } finally {
    const st = readState();
    st.lastCheck = { at: new Date().toISOString(), pid: process.pid };
    writeState(st);
    release();
    say('info', `check done (pid ${process.pid})`);
  }
  return code;
}

// ---------------------------------------------------------------- hook (fast path)
const checkHours = () => {
  const h = Number(process.env.MY_FLOW_MODELS_CHECK_HOURS ?? 1);
  return Number.isFinite(h) ? h : 1;
};

/**
 * Starts the detached background check (design D4 step 6).
 *
 * - `schtasks` (win32 only): when config.json names a scheduled task (`config.launcher.task`,
 *   registered by `install`) and MY_FLOW_MODELS_LAUNCHER is not `primary`, run
 *   `schtasks /run /tn <task>` synchronously with a 750 ms cap. Task Scheduler starts the
 *   check outside the hook's job object, which is what lets it survive under Codex (a plain
 *   detached child, and `cmd.exe /c start /b`, were both killed with the hook).
 * - `primary`: everywhere else, or when `/run` fails or times out: the plain detached spawn.
 *   A failure is remembered in `state.launcherFailedAt` and `schtasks` is not tried again
 *   for MY_FLOW_MODELS_CHECK_HOURS (default 1 h), so a hung schtasks costs 750 ms per hour.
 *
 * Mutates `state` (launcherFailedAt); the caller writes it. MY_FLOW_SCHTASKS=<script> is a test
 * seam that replaces the schtasks binary with `node <script> /run /tn <task>`.
 */
export function launchCheck(script, { platform = process.platform, schtasksBin = process.env.MY_FLOW_SCHTASKS ?? 'schtasks', state = {}, now = Date.now(), log = appendLog } = {}) {
  const task = readConfig().launcher?.task;
  const wantTask = platform === 'win32' && typeof task === 'string' && task && process.env.MY_FLOW_MODELS_LAUNCHER !== 'primary';
  if (wantTask) {
    const failedAt = Date.parse(state.launcherFailedAt ?? 0) || 0;
    const coolingDown = failedAt && now - failedAt < checkHours() * 3600 * 1000;
    if (!coolingDown) {
      const viaScript = process.env.MY_FLOW_SCHTASKS !== undefined;
      const r = viaScript
        ? spawnSync(process.execPath, [schtasksBin, '/run', '/tn', task], { timeout: 750, windowsHide: true, encoding: 'utf8' })
        : spawnSync(schtasksBin, ['/run', '/tn', task], { timeout: 750, windowsHide: true, encoding: 'utf8' });
      if (!r.error && r.status === 0) {
        delete state.launcherFailedAt;
        return { child: null, pid: null, launcher: 'schtasks' };
      }
      const why = r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null) ? 'timeout' : r.error ? r.error.message : `exit ${r.status}`;
      state.launcherFailedAt = new Date(now).toISOString();
      log('warn', `schtasks /run failed (${why}), falling back to primary`);
    }
  }
  const child = spawn(process.execPath, [script, 'check', '--quiet'], { detached: true, stdio: 'ignore', windowsHide: true, env: process.env });
  return { child, pid: child.pid ?? null, launcher: 'primary' };
}

/**
 * Called by the SessionStart hook. Cheap: one state read, at most one write, one detached
 * spawn. Returns { lines } to append to the hook's output.
 */
export function hookTick({ pluginRoot = process.env.CLAUDE_PLUGIN_ROOT ?? null, scriptsDir = join(ROOT, 'scripts'), now = Date.now() } = {}) {
  const skip = (process.env.MY_FLOW_SKIP_HOOKS ?? '').split(',').map((s) => s.trim());
  if (skip.includes('model-routing') || skip.includes('all')) return { lines: [], skipped: true };
  const lines = [];
  const state = readState();
  let dirty = false;
  if (state.pending?.line) {
    lines.push(state.pending.line.startsWith('model routing') ? state.pending.line : `model routing: ${state.pending.line}`);
    state.pending = null;
    dirty = true;
  }
  if (pluginRoot && !sameRoot(state.claudePluginRoot, pluginRoot)) {
    state.claudePluginRoot = pluginRoot;
    dirty = true;
  }
  const hasOverride = existsSync(paths().models);
  const needApply = hasOverride && pluginRoot && contained(join(claudeHome(), 'plugins'), pluginRoot) && !sameRoot(state.applied?.claudeRoot, pluginRoot);
  const last = Date.parse(state.lastSpawn?.at ?? 0) || 0;
  const needCheck = !state.lastSpawn || now - last >= checkHours() * 3600 * 1000;
  let spawned = null;
  let launcher = null;
  if (needApply || needCheck) {
    try {
      const r = launchCheck(join(scriptsDir, 'models.mjs'), { state, now });
      r.child?.unref();
      spawned = r.pid;
      launcher = r.launcher;
      state.lastSpawn = { at: new Date(now).toISOString(), pid: spawned, launcher };
      dirty = true;
    } catch {
      /* spawning is best effort */
    }
  }
  if (dirty) writeState(state);
  return { lines, spawned, launcher };
}
