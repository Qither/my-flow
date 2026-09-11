#!/usr/bin/env node
/**
 * my-flow plugin registry verbs (changes/plugin-contract/design.md D3-D5).
 *
 *   node scripts/plugin.mjs add <path|git-url> [--name <n>] [--dry-run]
 *   node scripts/plugin.mjs remove <name>
 *   node scripts/plugin.mjs enable <name> | disable <name>
 *   node scripts/plugin.mjs list [--json]
 *
 * The registry is <MY_FLOW_HOME>/plugins.json. `add` validates the plugin's
 * my-flow-plugin.json and prints the plugin's `setup` line (never executed) plus the two
 * `install` commands that merge the plugin into the Codex and Claude surfaces.
 * Exit codes: 0 success, 1 refused, 2 bad usage.
 *
 * Test seams: MY_FLOW_HOME, CODEX_HOME, CLAUDE_CONFIG_DIR, MY_FLOW_PLUGIN_FAKE_CLAUDE
 * ("missing" = claude not found; a comma-separated server list = those `claude mcp get`
 * calls succeed, all others fail, nothing is spawned).
 */
import { existsSync, mkdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { claudeHome, codexHome } from './lib/models.mjs';
import { spawnCli } from './lib/spawn.mjs';
import {
  CORE_COMMANDS,
  MANIFEST_FILE,
  ROOT,
  cloneDir,
  fwd,
  gitClone,
  isGitSource,
  loadManifest,
  loadRegistered,
  readRegistry,
  registryPath,
  resolvedServers,
  setupState,
  writeRegistry,
} from './lib/plugins.mjs';

const argv = process.argv.slice(2);
const verb = argv[0];
const DRY = argv.includes('--dry-run');
const JSON_OUT = argv.includes('--json');
const KEBAB_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const CLI = join(ROOT, 'scripts', 'cli.mjs');
const installLines = () => [`next: node "${CLI}" install codex`, `      node "${CLI}" install claude`];

function usage(code) {
  console.error('usage: plugin.mjs add <path|git-url> [--name <n>] [--dry-run] | remove <name> | enable <name> | disable <name> | list [--json]');
  process.exit(code);
}
function fail(prefix, message, code = 1) {
  console.error(`plugin ${prefix}: ${message}`);
  process.exit(code);
}
function positional(after = 1) {
  const out = [];
  for (let i = after; i < argv.length; i++) {
    if (argv[i] === '--name') {
      i++;
      continue;
    }
    if (argv[i].startsWith('--')) continue;
    out.push(argv[i]);
  }
  return out;
}
function option(name) {
  const i = argv.indexOf(name);
  return i === -1 ? null : argv[i + 1] ?? null;
}
/** The manifest `name` without validation (null when unreadable), for the duplicate check. */
function peekName(root) {
  try {
    const n = JSON.parse(readFileSync(join(root, MANIFEST_FILE), 'utf8')).name;
    return typeof n === 'string' && KEBAB_RE.test(n) ? n : null;
  } catch {
    return null;
  }
}
function strictRegistry(prefix) {
  try {
    return readRegistry({ strict: true });
  } catch (e) {
    return fail(prefix, e.message);
  }
}

// ---------------------------------------------------------------- add
function add() {
  const [source] = positional();
  if (!source) usage(2);
  const nameOpt = option('--name');
  if (nameOpt !== null) {
    if (!KEBAB_RE.test(nameOpt)) fail('add', `--name "${nameOpt}" must be kebab-case`);
    if (CORE_COMMANDS.includes(nameOpt)) fail('add', `--name "${nameOpt}" collides with core command "${nameOpt}"`);
  }
  const registry = strictRegistry('add');
  let root;
  let cloned = false;
  let tmpClone = null;
  if (isGitSource(source)) {
    const dest = cloneDir(nameOpt ?? '<name>');
    if (DRY) {
      console.log(`[dry-run] would clone ${source} into ${dest}; manifest validation skipped (dry-run does not clone)`);
      process.exit(0);
    }
    tmpClone = join(cloneDir(''), `.tmp-${process.pid}`);
    mkdirSync(cloneDir(''), { recursive: true });
    rmSync(tmpClone, { recursive: true, force: true });
    const r = gitClone(source, tmpClone);
    if (r.error || r.status !== 0) fail('add', `git clone failed: ${(r.stderr || r.error?.message || '').trim()}`);
    root = tmpClone;
    cloned = true;
  } else {
    root = resolve(source);
    if (!existsSync(root)) fail('add', `path ${fwd(root)} does not exist`);
  }
  // The registration check comes before validation so a duplicate add is reported as such,
  // not as a collision with its own earlier entry.
  const preKey = nameOpt ?? peekName(root);
  if (preKey && registry.plugins[preKey]) {
    if (tmpClone) rmSync(tmpClone, { recursive: true, force: true });
    fail('add', `plugin "${preKey}" is already registered; remove it first`);
  }
  const loaded = loadManifest(root, { registry, selfKey: null, warn: (m) => console.error(`plugin add: ${m}`) });
  for (const w of loaded.warnings) console.error(`plugin add: warning: ${w}`);
  if (loaded.errors.length) {
    for (const e of loaded.errors) console.error(`plugin add: ${loaded.file}: ${e}`);
    if (tmpClone) rmSync(tmpClone, { recursive: true, force: true });
    process.exit(1);
  }
  const key = nameOpt ?? loaded.manifest.name;
  if (registry.plugins[key]) {
    if (tmpClone) rmSync(tmpClone, { recursive: true, force: true });
    fail('add', `plugin "${key}" is already registered; remove it first`);
  }
  if (cloned) {
    const dest = cloneDir(key);
    rmSync(dest, { recursive: true, force: true });
    renameSync(tmpClone, dest);
    root = dest;
  }
  const abs = fwd(resolve(root));
  if (DRY) {
    console.log(`[dry-run] would add ${key} ${loaded.manifest.version} (${abs}) -> ${registryPath()}`);
    process.exit(0);
  }
  registry.plugins[key] = { path: abs, source, enabled: true, added: new Date().toISOString(), version: loaded.manifest.version, cloned };
  const p = writeRegistry(registry);
  console.log(`added ${key} ${loaded.manifest.version} (${abs}) -> ${p}`);
  if (typeof loaded.manifest.setup === 'string') console.log(`setup (run it yourself; my-flow never executes it): ${loaded.manifest.setup}`);
  const s = setupState({ path: abs }, loaded.manifest);
  console.log(s.state === 'ok' ? 'setup: ok' : `setup: pending (${s.check} missing under ${abs})`);
  for (const l of installLines()) console.log(l);
  process.exit(0);
}

// ---------------------------------------------------------------- remove / enable / disable
function entryOrFail(prefix, registry, name) {
  if (!name) usage(2);
  const entry = registry.plugins[name];
  if (!entry) fail(prefix, `plugin "${name}" is not registered`);
  return entry;
}

function remove() {
  const [name] = positional();
  const registry = strictRegistry('remove');
  const entry = entryOrFail('remove', registry, name);
  const loaded = existsSync(entry.path) ? loadManifest(entry.path, { registry: null }) : null;
  delete registry.plugins[name];
  if (entry.cloned) rmSync(cloneDir(name), { recursive: true, force: true });
  writeRegistry(registry);
  console.log(`removed ${name}`);
  console.log(`next: node "${CLI}" install codex  (refreshes the Codex surface)`);
  for (const server of Object.keys(loaded?.manifest?.contributes?.mcpServers ?? {})) console.log(`      claude mcp remove ${server}`);
  process.exit(0);
}

function toggle(enabled) {
  const prefix = enabled ? 'enable' : 'disable';
  const [name] = positional();
  const registry = strictRegistry(prefix);
  const entry = entryOrFail(prefix, registry, name);
  entry.enabled = enabled;
  writeRegistry(registry);
  console.log(`${name} ${enabled ? 'enabled' : 'disabled'}`);
  for (const l of installLines()) console.log(l);
  process.exit(0);
}

// ---------------------------------------------------------------- list
function readInstalledPlugins() {
  const p = join(claudeHome(), 'plugins', 'installed_plugins.json');
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}
function claudeListed(doc, key) {
  if (!doc) return false;
  const plugins = doc.plugins ?? doc;
  if (Array.isArray(plugins)) return plugins.some((p) => p === key || p?.name === key || p?.id === key || p?.key === key);
  return typeof plugins === 'object' && plugins !== null && Object.prototype.hasOwnProperty.call(plugins, key);
}
function claudeMcpGet(server) {
  const fake = process.env.MY_FLOW_PLUGIN_FAKE_CLAUDE;
  if (fake !== undefined) {
    if (fake === 'missing') return { found: false, status: null };
    const ok = fake.split(',').map((s) => s.trim()).includes(server);
    return { found: true, status: ok ? 0 : 1 };
  }
  try {
    const { result } = spawnCli('claude', ['mcp', 'get', server], { encoding: 'utf8', timeout: 10000, windowsHide: true });
    if (result.error || result.status === null) return { found: false, status: null };
    return { found: true, status: result.status };
  } catch {
    return { found: false, status: null };
  }
}
function probeClaude(loaded) {
  if (process.env.MY_FLOW_PLUGIN_FAKE_CLAUDE === 'missing') return { state: 'unknown', detail: 'claude not found' };
  const servers = Object.keys(loaded.manifest?.contributes?.mcpServers ?? {});
  const hasSurface = loaded.skills.length > 0 || loaded.agents.length > 0 || loaded.manifest?.contributes?.hooks !== undefined;
  for (const server of servers) {
    const r = claudeMcpGet(server);
    if (!r.found) return { state: 'unknown', detail: 'claude not found' };
    if (r.status !== 0) return { state: 'not installed', detail: `claude mcp get ${server} exited ${r.status}` };
  }
  if (!servers.length && process.env.MY_FLOW_PLUGIN_FAKE_CLAUDE === undefined) {
    try {
      const { result } = spawnCli('claude', ['--version'], { encoding: 'utf8', timeout: 10000, windowsHide: true });
      if (result.error || result.status === null) return { state: 'unknown', detail: 'claude not found' };
    } catch {
      return { state: 'unknown', detail: 'claude not found' };
    }
  }
  if (hasSurface) {
    const marketplace = loaded.claude?.marketplaceName ?? loaded.manifest.name;
    if (!claudeListed(readInstalledPlugins(), `${loaded.claude?.pluginName ?? loaded.manifest.name}@${marketplace}`)) {
      return { state: 'not installed', detail: 'not in installed_plugins.json' };
    }
  }
  return { state: 'installed', detail: '' };
}
function managedBlock(text) {
  const t = text.replace(/\r\n/g, '\n');
  const s = t.indexOf('# >>> my-flow managed >>>');
  const e = t.indexOf('# <<< my-flow managed <<<');
  return s === -1 || e === -1 ? '' : t.slice(s, e);
}
function probeCodex(loaded) {
  const home = codexHome();
  const skills = {};
  for (const s of loaded.skills) skills[`${loaded.prefix}${s.name}`] = existsSync(join(home, 'skills', `${loaded.prefix}${s.name}`, 'SKILL.md'));
  const configPath = join(home, 'config.toml');
  const block = existsSync(configPath) ? managedBlock(readFileSync(configPath, 'utf8')) : '';
  const mcpServers = {};
  for (const server of Object.keys(loaded.manifest?.contributes?.mcpServers ?? {})) {
    mcpServers[server] = new RegExp(`^\\[mcp_servers\\.${server.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\]`, 'm').test(block);
  }
  const all = [...Object.values(skills), ...Object.values(mcpServers)];
  const k = all.filter(Boolean).length;
  const state = all.length === 0 || k === 0 ? 'not installed' : k === all.length ? 'installed' : 'partial';
  return { state, skills, mcpServers };
}

function list() {
  const { registry, plugins } = loadRegistered({ warn: (m) => console.error(m) });
  const rows = [];
  for (const { key, entry, loaded } of plugins) {
    const manifest = loaded.manifest;
    const pathExists = existsSync(entry.path);
    const row = {
      name: key,
      version: manifest?.version ?? entry.version ?? null,
      description: manifest?.description ?? null,
      path: entry.path,
      source: entry.source ?? null,
      enabled: entry.enabled !== false,
      added: entry.added ?? null,
      cloned: entry.cloned === true,
      node: manifest?.node ?? null,
      pathExists,
      error: loaded.errors[0] ?? null,
      setup: manifest ? setupState(entry, manifest) : { state: 'pending', check: 'node_modules', command: null },
      claude: manifest ? probeClaude(loaded) : { state: 'unknown', detail: loaded.errors[0] ?? 'manifest not loaded' },
      codex: manifest ? probeCodex(loaded) : { state: 'not installed', skills: {}, mcpServers: {} },
      cli: Object.fromEntries(Object.entries(manifest?.contributes?.cli ?? {}).map(([v, s]) => [v, `${loaded.root}/${fwd(s)}`])),
      mcpServers: manifest ? resolvedServers(manifest, loaded.root) : {},
    };
    rows.push(row);
  }
  if (JSON_OUT) {
    console.log(JSON.stringify({ version: 1, registry: registryPath(), plugins: rows }, null, 2));
    process.exit(0);
  }
  if (!rows.length) {
    console.log('no plugins registered (my-flow plugin add <path|git-url>)');
    process.exit(0);
  }
  for (const r of rows) {
    console.log(`${r.name} ${r.version ?? '?'} [${r.enabled ? 'enabled' : 'disabled'}] ${r.path}`);
    console.log(`  source: ${r.source ?? '-'}${r.node ? `            node: ${r.node}` : ''}`);
    if (r.error) console.log(`  error: ${r.error}`);
    console.log(`  setup: ${r.setup.state === 'ok' ? 'ok' : `pending (${r.setup.check} missing${r.setup.command ? `; run: ${r.setup.command}` : ''})`}`);
    console.log(`  claude: ${r.claude.state}${r.claude.detail ? ` (${r.claude.detail})` : ''}`);
    const skillsK = Object.values(r.codex.skills).filter(Boolean).length;
    const mcpK = Object.values(r.codex.mcpServers).filter(Boolean).length;
    console.log(`  codex: ${r.codex.state}${r.codex.state === 'partial' ? ` (skills ${skillsK}/${Object.keys(r.codex.skills).length}, mcp ${mcpK}/${Object.keys(r.codex.mcpServers).length})` : ''}`);
    const verbs = Object.keys(r.cli);
    if (verbs.length) console.log(`  verbs: ${verbs.join(', ')}`);
    for (const [server, s] of Object.entries(r.mcpServers)) console.log(`  mcp: ${server}: ${[s.command, ...s.args].join(' ')} (cwd ${s.cwd})`);
    if (!r.pathExists) console.log('  path: missing');
  }
  process.exit(0);
}

switch (verb) {
  case 'add':
    add();
    break;
  case 'remove':
    remove();
    break;
  case 'enable':
    toggle(true);
    break;
  case 'disable':
    toggle(false);
    break;
  case 'list':
    list();
    break;
  default:
    usage(verb === '-h' || verb === '--help' ? 0 : 2);
}
