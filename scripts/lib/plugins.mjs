/**
 * my-flow plugin contract: manifest validation, the per-user registry, contributed-verb
 * lookup, and the renderers that `install.mjs` uses to merge a plugin into the Codex and
 * Claude surfaces (changes/plugin-contract/design.md D1-D9).
 *
 * A plugin is an independent repository with `my-flow-plugin.json` at its root. The registry
 * is `<MY_FLOW_HOME>/plugins.json`. Node built-ins only: the core never speaks MCP, it only
 * validates files and writes host configuration.
 *
 * Every reader fails open where the design says so: a missing registry is empty; an
 * unparsable one is empty with a warning for read-only callers and an error for writers.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { myFlowHome } from './models.mjs';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const coreManifest = JSON.parse(readFileSync(join(ROOT, 'manifest.json'), 'utf8'));
const corePackage = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8'));

/** Core CLI commands; a plugin name or contributed verb may never collide with one. */
export const CORE_COMMANDS = ['build', 'install', 'uninstall', 'init', 'ask', 'spec', 'dashboard', 'models', 'plugin'];
export const CORE_PREFIX = coreManifest.codexSkillPrefix;
export const CORE_SKILL_DIRS = Object.keys(coreManifest.skills).map((k) => `${CORE_PREFIX}${k}`);
export const CORE_ROLES = Object.keys(coreManifest.agents);
export const CORE_VERSION = corePackage.version;
export const MANIFEST_FILE = 'my-flow-plugin.json';
export const MARKER_FILE = '.my-flow-plugin';
export const HOOK_EVENTS = ['SessionStart', 'Stop', 'PreToolUse', 'PostToolUse', 'UserPromptSubmit', 'PreCompact', 'PostCompact'];
export const PLUGIN_AGENT_HEADER_RE = /^# my-flow agent: \S+ \(plugin /;

const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const SEMVER_RE = /^\d+\.\d+\.\d+(-[0-9A-Za-z.-]+)?$/;
const RANGE_RE = /^>=?\d+\.\d+\.\d+$/;
const PREFIX_RE = /^[a-z0-9][a-z0-9-]*-$/;
const BARE_KEY_RE = /^[A-Za-z0-9_-]+$/;
const HOOK_COMMAND_RE = /^node "\$\{CLAUDE_PLUGIN_ROOT\}\/([^"]+)"$/;

export const fwd = (p) => String(p).replace(/\\/g, '/');
const isObject = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);

// ---------------------------------------------------------------- registry (D3)
export function registryPath() {
  return join(myFlowHome(), 'plugins.json');
}

export function emptyRegistry() {
  return { version: 1, plugins: {} };
}

/**
 * Reads the registry. `strict: true` throws on an unreadable file (writers); otherwise the
 * file is treated as empty and `warn` receives one line (readers, dispatch, install).
 */
export function readRegistry({ strict = false, warn = (m) => console.error(m) } = {}) {
  const p = registryPath();
  if (!existsSync(p)) return emptyRegistry();
  let doc;
  try {
    doc = JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    const msg = `warning: cannot parse ${p} (${e.message}); treating the plugin registry as empty`;
    if (strict) throw new Error(`cannot parse ${p}: ${e.message}`);
    warn(msg);
    return emptyRegistry();
  }
  if (!isObject(doc) || doc.version !== 1 || !isObject(doc.plugins)) {
    const msg = `warning: ${p} is not a version 1 plugin registry; treating it as empty`;
    if (strict) throw new Error(`${p} is not a version 1 plugin registry`);
    warn(msg);
    return emptyRegistry();
  }
  return doc;
}

/** Atomic write: plugins.json.tmp then rename. */
export function writeRegistry(reg) {
  const p = registryPath();
  mkdirSync(dirname(p), { recursive: true });
  const tmp = `${p}.tmp`;
  writeFileSync(tmp, JSON.stringify(reg, null, 2) + '\n', 'utf8');
  renameSync(tmp, p);
  return p;
}

export function isGitSource(source) {
  return /^(https?|ssh|git|file):\/\//.test(source) || source.startsWith('git@') || source.endsWith('.git');
}

export function cloneDir(key) {
  return join(myFlowHome(), 'plugins', key);
}

export function gitClone(url, dest) {
  return spawnSync('git', ['clone', '--depth', '1', url, dest], { encoding: 'utf8', windowsHide: true, timeout: 120000 });
}

// ---------------------------------------------------------------- manifest (D2)
export function parseFrontmatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.replace(/\r\n/g, '\n'));
  if (!m) return { meta: {}, body: text.replace(/\r\n/g, '\n'), raw: '' };
  const meta = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    let v = kv[2].trim();
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1);
    meta[kv[1]] = v;
  }
  return { meta, body: m[2], raw: m[1] };
}

function satisfiesRange(range) {
  const m = /^(>=?)?(\d+)\.(\d+)\.(\d+)$/.exec(range);
  if (!m) return true;
  const want = [m[2], m[3], m[4]].map(Number);
  const have = CORE_VERSION.split('.').map((s) => parseInt(s, 10) || 0);
  for (let i = 0; i < 3; i++) {
    if (have[i] > want[i]) return m[1] === '>=' || m[1] === '>';
    if (have[i] < want[i]) return false;
  }
  return m[1] !== '>';
}

/**
 * Contributions of every registered plugin except `exceptKey`, for collision checks
 * (D2: prefixes, roles, verbs, server names are unique across the registry).
 */
export function registryContributions(registry, exceptKey = null) {
  const out = { prefixes: new Map(), roles: new Map(), verbs: new Map(), servers: new Map() };
  for (const [key, entry] of Object.entries(registry?.plugins ?? {})) {
    if (key === exceptKey || !entry || typeof entry.path !== 'string') continue;
    const r = loadManifest(entry.path, { registry: null });
    if (!r.manifest) continue;
    if (!out.prefixes.has(r.prefix)) out.prefixes.set(r.prefix, key);
    for (const a of r.agents) if (!out.roles.has(a.role)) out.roles.set(a.role, key);
    for (const v of Object.keys(r.manifest.contributes?.cli ?? {})) if (!out.verbs.has(v)) out.verbs.set(v, key);
    for (const s of Object.keys(r.manifest.contributes?.mcpServers ?? {})) if (!out.servers.has(s)) out.servers.set(s, key);
  }
  return out;
}

/**
 * Loads and validates `<root>/my-flow-plugin.json`. Returns
 * `{ manifest, errors, warnings, root, file, prefix, skills, agents, hooks, claude }`;
 * `manifest` is null when the file is missing or not an object. Errors carry the D2 texts
 * without the file prefix (the caller prints `plugin add: <file>: <message>`).
 * `registry` (default: the current registry, non-strict) drives the cross-plugin collision
 * checks; pass `null` to skip them; `selfKey` excludes the plugin's own entry.
 */
export function loadManifest(rootIn, { registry, selfKey = null, warn = () => {} } = {}) {
  const root = fwd(resolve(rootIn));
  const file = `${root}/${MANIFEST_FILE}`;
  const errors = [];
  const warnings = [];
  const result = { manifest: null, errors, warnings, root, file, prefix: null, skills: [], agents: [], hooks: null, claude: null };
  if (!existsSync(file)) {
    errors.push(`missing ${MANIFEST_FILE}`);
    return result;
  }
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(file, 'utf8'));
  } catch (e) {
    errors.push(`invalid JSON: ${e.message}`);
    return result;
  }
  if (!isObject(manifest)) {
    errors.push('invalid JSON: not an object');
    return result;
  }
  result.manifest = manifest;
  const reg = registry === undefined ? readRegistry({ warn }) : registry;
  const others = reg ? registryContributions(reg, selfKey) : null;

  const known = new Set(['name', 'version', 'description', 'myFlow', 'node', 'codexSkillPrefix', 'contributes', 'setup', 'setupCheck', '$schema']);
  for (const k of Object.keys(manifest)) if (!known.has(k)) warnings.push(`unknown field "${k}" ignored`);

  // name / version / description
  const name = manifest.name;
  if (typeof name !== 'string' || !KEBAB_RE.test(name)) errors.push('name is required and must be kebab-case');
  else if (CORE_COMMANDS.includes(name)) errors.push(`name "${name}" collides with core command "${name}"`);
  if (typeof manifest.version !== 'string' || !SEMVER_RE.test(manifest.version)) errors.push('version must be semver');
  if (typeof manifest.description !== 'string' || !manifest.description.trim()) errors.push('description is required');
  if (manifest.myFlow !== undefined) {
    if (typeof manifest.myFlow !== 'string' || !RANGE_RE.test(manifest.myFlow)) errors.push('myFlow must look like ">=0.1.0"');
    else if (!satisfiesRange(manifest.myFlow)) warnings.push(`plugin wants my-flow ${manifest.myFlow}, installed ${CORE_VERSION}`);
  }

  // codexSkillPrefix
  const prefix = manifest.codexSkillPrefix === undefined ? `${typeof name === 'string' ? name : 'plugin'}-` : manifest.codexSkillPrefix;
  result.prefix = prefix;
  if (typeof prefix !== 'string' || !PREFIX_RE.test(prefix)) errors.push('codexSkillPrefix must be kebab-case and end with "-"');
  else if (prefix === CORE_PREFIX) errors.push(`codexSkillPrefix "${CORE_PREFIX}" is reserved for the core`);
  else if (others && others.prefixes.has(prefix)) errors.push(`codexSkillPrefix "${prefix}" is already used by plugin "${others.prefixes.get(prefix)}"`);

  const contributes = isObject(manifest.contributes) ? manifest.contributes : {};
  if (manifest.contributes !== undefined && !isObject(manifest.contributes)) errors.push('contributes must be an object');

  // skills
  if (contributes.skills !== undefined) {
    if (!Array.isArray(contributes.skills)) errors.push('contributes.skills must be an array of directories');
    else {
      contributes.skills.forEach((d, i) => {
        const dir = join(root, String(d));
        if (typeof d !== 'string' || !existsSync(dir) || !statSync(dir).isDirectory()) {
          errors.push(`contributes.skills[${i}]: directory "${d}" not found`);
          return;
        }
        for (const entry of readdirSync(dir)) {
          const skillDir = join(dir, entry);
          if (!statSync(skillDir).isDirectory() || !existsSync(join(skillDir, 'SKILL.md'))) continue;
          if (!KEBAB_RE.test(entry)) {
            errors.push(`skill "${entry}" is not kebab-case`);
            continue;
          }
          result.skills.push({ name: entry, dir: fwd(skillDir) });
        }
      });
    }
  }
  if (typeof prefix === 'string' && PREFIX_RE.test(prefix)) {
    for (const s of result.skills) {
      const target = `${prefix}${s.name}`;
      if (CORE_SKILL_DIRS.includes(target)) errors.push(`skill "${target}" collides with the core skill directory "${target}"`);
    }
  }

  // agents
  if (contributes.agents !== undefined) {
    if (!Array.isArray(contributes.agents)) errors.push('contributes.agents must be an array of directories');
    else {
      contributes.agents.forEach((d, i) => {
        const dir = join(root, String(d));
        if (typeof d !== 'string' || !existsSync(dir) || !statSync(dir).isDirectory()) {
          errors.push(`contributes.agents[${i}]: directory "${d}" not found`);
          return;
        }
        for (const entry of readdirSync(dir)) {
          if (!entry.endsWith('.md')) continue;
          const role = entry.slice(0, -3);
          const text = readFileSync(join(dir, entry), 'utf8');
          const { meta, body } = parseFrontmatter(text);
          if (!meta.description) errors.push(`agent "${entry}": missing description`);
          if (body.includes("'''")) errors.push(`agent "${entry}": body must not contain '''`);
          if (CORE_ROLES.includes(role)) errors.push(`agent "${role}" collides with core agent "${role}"`);
          else if (others && others.roles.has(role)) errors.push(`agent "${role}" is already contributed by plugin "${others.roles.get(role)}"`);
          result.agents.push({ role, file: fwd(join(dir, entry)), description: meta.description ?? '', body });
        }
      });
    }
  }

  // hooks
  if (contributes.hooks !== undefined) {
    const rel = contributes.hooks;
    const p = typeof rel === 'string' ? join(root, rel) : null;
    if (!p || !existsSync(p)) errors.push(`hooks: file "${rel}" not found`);
    else {
      let doc;
      try {
        doc = JSON.parse(readFileSync(p, 'utf8'));
      } catch (e) {
        errors.push(`hooks: invalid JSON: ${e.message}`);
      }
      if (doc) {
        if (!isObject(doc.hooks)) errors.push('hooks: file must contain a "hooks" object');
        else {
          for (const [ev, groups] of Object.entries(doc.hooks)) {
            if (!HOOK_EVENTS.includes(ev)) {
              errors.push(`hooks: unknown event "${ev}"`);
              continue;
            }
            for (const g of Array.isArray(groups) ? groups : []) {
              for (const h of Array.isArray(g?.hooks) ? g.hooks : []) {
                const m = typeof h?.command === 'string' ? HOOK_COMMAND_RE.exec(h.command) : null;
                if (!m) {
                  errors.push(`hooks: command must be node "\${CLAUDE_PLUGIN_ROOT}/<script>" (got: ${h?.command})`);
                  continue;
                }
                if (!existsSync(join(root, m[1]))) errors.push(`hooks: script "${m[1]}" not found`);
              }
            }
          }
          result.hooks = doc;
        }
      }
    }
  }

  // cli
  if (contributes.cli !== undefined) {
    if (!isObject(contributes.cli)) errors.push('contributes.cli must be an object of verb -> script');
    else {
      for (const [verb, script] of Object.entries(contributes.cli)) {
        if (!KEBAB_RE.test(verb)) errors.push(`cli verb "${verb}" must be kebab-case`);
        else if (CORE_COMMANDS.includes(verb)) errors.push(`cli verb "${verb}" collides with core command "${verb}"`);
        else if (others && others.verbs.has(verb)) errors.push(`cli verb "${verb}" is already contributed by plugin "${others.verbs.get(verb)}"`);
        if (typeof script !== 'string' || !existsSync(join(root, script))) errors.push(`cli "${verb}": script "${script}" not found`);
      }
    }
  }

  // mcpServers
  if (contributes.mcpServers !== undefined) {
    if (!isObject(contributes.mcpServers)) errors.push('contributes.mcpServers must be an object of name -> server');
    else {
      for (const [sname, s] of Object.entries(contributes.mcpServers)) {
        if (!BARE_KEY_RE.test(sname)) errors.push(`mcpServers name "${sname}" must match [A-Za-z0-9_-]`);
        else if (others && others.servers.has(sname)) errors.push(`mcpServers "${sname}" is already contributed by plugin "${others.servers.get(sname)}"`);
        if (!isObject(s) || typeof s.command !== 'string' || !s.command) {
          errors.push(`mcpServers.${sname}: command is required`);
          continue;
        }
        if (s.args !== undefined && !(Array.isArray(s.args) && s.args.every((a) => typeof a === 'string'))) errors.push(`mcpServers.${sname}: args must be an array of strings`);
        if (s.env !== undefined) {
          if (!isObject(s.env) || !Object.values(s.env).every((v) => typeof v === 'string')) errors.push(`mcpServers.${sname}: env must be an object of string -> string`);
          else for (const k of Object.keys(s.env)) if (!BARE_KEY_RE.test(k)) errors.push(`mcpServers.${sname}.env key "${k}" must match [A-Za-z0-9_-]`);
        }
        if (s.cwd !== undefined && typeof s.cwd !== 'string') errors.push(`mcpServers.${sname}: cwd must be a string`);
        if (s.startupTimeoutSec !== undefined && !(Number.isInteger(s.startupTimeoutSec) && s.startupTimeoutSec > 0)) errors.push(`mcpServers.${sname}: startupTimeoutSec must be a positive integer`);
        const values = [...(Array.isArray(s.args) ? s.args : []), ...(isObject(s.env) ? Object.values(s.env) : []), ...(typeof s.cwd === 'string' ? [s.cwd] : [])];
        for (const v of values) {
          for (const m of String(v).matchAll(/\$\{([^}]*)\}/g)) {
            if (m[1] !== 'PLUGIN_ROOT') errors.push(`mcpServers.${sname}: unknown placeholder \${${m[1]}}; only \${PLUGIN_ROOT} is substituted`);
          }
        }
      }
    }
  }

  if (manifest.setup !== undefined && typeof manifest.setup !== 'string') errors.push('setup must be a string');
  if (manifest.setupCheck !== undefined && typeof manifest.setupCheck !== 'string') errors.push('setupCheck must be a relative path');

  // Claude layout
  const needsClaude = result.skills.length > 0 || result.agents.length > 0 || contributes.hooks !== undefined;
  const pluginJsonPath = join(root, '.claude-plugin', 'plugin.json');
  const marketplacePath = join(root, '.claude-plugin', 'marketplace.json');
  const claude = { pluginName: typeof name === 'string' ? name : null, marketplaceName: null };
  if (existsSync(join(root, '.mcp.json'))) errors.push('.mcp.json is not allowed; declare MCP servers in my-flow-plugin.json');
  if (existsSync(pluginJsonPath)) {
    try {
      const pj = JSON.parse(readFileSync(pluginJsonPath, 'utf8'));
      if (pj.mcpServers !== undefined) errors.push('.claude-plugin/plugin.json must not declare mcpServers (declare them in my-flow-plugin.json)');
      if (typeof name === 'string' && pj.name !== name) errors.push(`.claude-plugin/plugin.json name "${pj.name}" must equal "${name}"`);
      if (typeof pj.name === 'string') claude.pluginName = pj.name;
    } catch (e) {
      errors.push(`.claude-plugin/plugin.json: invalid JSON: ${e.message}`);
    }
  } else if (needsClaude) errors.push('.claude-plugin/plugin.json is missing');
  if (existsSync(marketplacePath)) {
    try {
      const mp = JSON.parse(readFileSync(marketplacePath, 'utf8'));
      const listed = Array.isArray(mp.plugins) && mp.plugins.some((p) => p && p.name === name);
      if (typeof mp.name !== 'string' || !listed) errors.push(`.claude-plugin/marketplace.json must list plugin "${name}"`);
      else claude.marketplaceName = mp.name;
    } catch (e) {
      errors.push(`.claude-plugin/marketplace.json: invalid JSON: ${e.message}`);
    }
  } else if (needsClaude) errors.push(`.claude-plugin/marketplace.json must list plugin "${name}"`);
  result.claude = claude;
  return result;
}

// ---------------------------------------------------------------- placeholders and lookups
/** Replaces `${PLUGIN_ROOT}` with the forward-slash plugin root in strings, arrays and objects. */
export function substitutePluginRoot(value, root) {
  const r = fwd(root);
  if (typeof value === 'string') return value.replace(/\$\{PLUGIN_ROOT\}/g, r);
  if (Array.isArray(value)) return value.map((v) => substitutePluginRoot(v, root));
  if (isObject(value)) return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, substitutePluginRoot(v, root)]));
  return value;
}

/** Substituted server definitions: `{ <server>: { command, args, cwd, env, startupTimeoutSec } }`. */
export function resolvedServers(manifest, root) {
  const out = {};
  for (const [name, s] of Object.entries(manifest?.contributes?.mcpServers ?? {})) {
    out[name] = {
      command: s.command,
      args: substitutePluginRoot(Array.isArray(s.args) ? s.args : [], root),
      cwd: substitutePluginRoot(typeof s.cwd === 'string' ? s.cwd : '${PLUGIN_ROOT}', root),
      env: substitutePluginRoot(isObject(s.env) ? s.env : {}, root),
      startupTimeoutSec: Number.isInteger(s.startupTimeoutSec) ? s.startupTimeoutSec : null,
    };
  }
  return out;
}

export function setupState(entry, manifest) {
  const check = typeof manifest?.setupCheck === 'string' ? manifest.setupCheck : 'node_modules';
  const ok = existsSync(join(entry.path, check));
  return { state: ok ? 'ok' : 'pending', check, command: typeof manifest?.setup === 'string' ? manifest.setup : null };
}

/**
 * Registered plugins with their loaded manifests, in registry order:
 * `[{ key, entry, loaded }]`, `loaded` being the loadManifest result (errors when the path
 * is missing: `path <abs> is missing`). Reads the registry once (non-strict).
 */
export function loadRegistered({ warn = (m) => console.error(m), registry } = {}) {
  const reg = registry ?? readRegistry({ warn });
  const out = [];
  for (const [key, entry] of Object.entries(reg.plugins)) {
    if (!entry || typeof entry.path !== 'string' || !existsSync(entry.path)) {
      out.push({ key, entry, loaded: { manifest: null, errors: [`path ${fwd(entry?.path ?? '')} is missing`], warnings: [], root: fwd(entry?.path ?? ''), skills: [], agents: [], hooks: null, claude: null, prefix: null } });
      continue;
    }
    out.push({ key, entry, loaded: loadManifest(entry.path, { registry: reg, selfKey: key, warn }) });
  }
  return { registry: reg, plugins: out };
}

/**
 * Looks a contributed verb up among enabled plugins: `{ key, root, script }`; when only a
 * disabled plugin has it: `{ disabled: key }`; otherwise null.
 */
export function resolvePluginVerb(verb, { warn = (m) => console.error(m) } = {}) {
  const { plugins } = loadRegistered({ warn });
  let disabled = null;
  for (const { key, entry, loaded } of plugins) {
    const script = loaded.manifest?.contributes?.cli?.[verb];
    if (typeof script !== 'string') continue;
    if (entry.enabled === false) {
      disabled = disabled ?? key;
      continue;
    }
    return { key, root: loaded.root, script: `${loaded.root}/${fwd(script)}` };
  }
  return disabled ? { disabled } : null;
}

/** `[{ verb, plugin }]` for every enabled plugin, for the usage text. */
export function enabledVerbs({ warn = () => {} } = {}) {
  const { plugins } = loadRegistered({ warn });
  const out = [];
  for (const { key, entry, loaded } of plugins) {
    if (entry.enabled === false || !loaded.manifest) continue;
    for (const verb of Object.keys(loaded.manifest.contributes?.cli ?? {})) out.push({ verb, plugin: key });
  }
  return out;
}

// ---------------------------------------------------------------- Codex renderers (D7)
function rewriteBody(text, { pluginName, root, prefix, skillNames }) {
  let out = text.replace(/\$\{CLAUDE_PLUGIN_ROOT\}/g, fwd(root));
  for (const skill of [...skillNames].sort((a, b) => b.length - a.length)) {
    out = out.split(`/${pluginName}:${skill}`).join(`$${prefix}${skill}`);
  }
  return out;
}

/** SKILL.md text for the Codex copy: `name:` becomes `<prefix><skill>`, placeholders rewritten. */
export function codexSkillText(text, { pluginName, root, prefix, skill, skillNames = [skill] }) {
  const t = text.replace(/\r\n/g, '\n');
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(t);
  let out = t;
  if (m) {
    const fm = m[1].replace(/^name:.*$/m, `name: ${prefix}${skill}`);
    out = `---\n${fm}\n---\n` + t.slice(m[0].length);
  }
  return rewriteBody(out, { pluginName, root, prefix, skillNames });
}

/** Codex agent TOML with the managed plugin header, mirroring the build step's rendering. */
export function codexAgentToml(role, mdText, { pluginName, root, prefix, skillNames = [] }) {
  const { meta, body } = parseFrontmatter(mdText);
  const rendered = rewriteBody(body, { pluginName, root, prefix, skillNames }).replace(/\n{3,}/g, '\n\n').replace(/^\n+/, '').trimEnd() + '\n';
  if (rendered.includes("'''")) throw new Error(`agent "${role}.md": body must not contain '''`);
  return [
    `# my-flow agent: ${role} (plugin ${pluginName}, written by my-flow install codex - edit ${fwd(root)}/agents/${role}.md instead)`,
    `name = ${JSON.stringify(role)}`,
    `description = ${JSON.stringify(meta.description ?? '')}`,
    `developer_instructions = '''\n${rendered}'''`,
    '',
  ].join('\n');
}

/** Codex form of a plugin hook command: the PowerShell shim call with the absolute script path. */
export function codexHookCommand(command, { root, shimPath }) {
  const m = HOOK_COMMAND_RE.exec(command);
  if (!m) throw new Error(`hooks: command must be node "\${CLAUDE_PLUGIN_ROOT}/<script>" (got: ${command})`);
  return `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "${shimPath}" -Script "${fwd(root)}/${m[1]}"`;
}

/** `[{ server, lines }]`: the `[mcp_servers.<server>]` TOML tables for the managed block. */
export function codexMcpTables(manifest, root) {
  const out = [];
  for (const [server, s] of Object.entries(resolvedServers(manifest, root))) {
    const lines = [
      `[mcp_servers.${server}]`,
      `command = ${JSON.stringify(s.command)}`,
      `args = [${s.args.map((a) => JSON.stringify(a)).join(', ')}]`,
      `cwd = ${JSON.stringify(s.cwd)}`,
    ];
    if (s.startupTimeoutSec !== null) lines.push(`startup_timeout_sec = ${s.startupTimeoutSec}`);
    const env = Object.entries(s.env);
    if (env.length) {
      lines.push(`[mcp_servers.${server}.env]`);
      for (const [k, v] of env) lines.push(`${k} = ${JSON.stringify(v)}`);
    }
    out.push({ server, lines });
  }
  return out;
}

/** Regex matching an unmanaged `[mcp_servers.<server>]` (or sub-table) header in TOML text. */
export function mcpTableRe(server) {
  const esc = server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^\\s*\\[mcp_servers\\.(?:${esc}|"${esc}"|'${esc}')(?:\\.[^\\]]*)?\\]`, 'm');
}

// ---------------------------------------------------------------- Claude commands (D9)
const q = (s) => `"${String(s).replace(/"/g, '\\"')}"`;

/**
 * The printed Claude commands for one loaded plugin:
 * `{ marketplaceAdd, pluginInstall, mcpAdd: [], mcpRemove: [], pluginDisable, hasSurface }`.
 */
export function claudeCommands(loaded) {
  const { manifest, root, claude } = loaded;
  const hasSurface = loaded.skills.length > 0 || loaded.agents.length > 0 || manifest?.contributes?.hooks !== undefined;
  const pluginName = claude?.pluginName ?? manifest?.name ?? '';
  const marketplace = claude?.marketplaceName ?? manifest?.name ?? '';
  const mcpAdd = [];
  const mcpRemove = [];
  for (const [server, s] of Object.entries(resolvedServers(manifest, root))) {
    const env = Object.entries(s.env).map(([k, v]) => `--env ${k}=${v}`);
    mcpAdd.push(`claude mcp add --transport stdio --scope user ${server}${env.length ? ' ' + env.join(' ') : ''} -- ${s.command}${s.args.map((a) => ' ' + q(a)).join('')}`);
    mcpRemove.push(`claude mcp remove ${server}`);
  }
  return {
    hasSurface,
    marketplaceAdd: hasSurface ? `claude plugin marketplace add ${q(fwd(root))}` : null,
    pluginInstall: hasSurface ? `claude plugin install ${pluginName}@${marketplace}` : null,
    pluginDisable: hasSurface ? `claude plugin disable ${pluginName}@${marketplace}` : null,
    mcpAdd,
    mcpRemove,
  };
}
