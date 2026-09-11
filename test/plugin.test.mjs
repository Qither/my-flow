/**
 * Plugin contract tests (changes/plugin-contract): manifest validation, registry verbs,
 * contributed-verb dispatch, and the install / uninstall surfaces for a plugin.
 *
 * package.json lists the test files explicitly. Never switch to a bare `node --test`: its
 * default pattern would pick up test/fixtures/** (the plugin-demo fixture) as tests.
 *
 * Every spawn uses temporary MY_FLOW_HOME / CODEX_HOME / CLAUDE_CONFIG_DIR plus the
 * MY_FLOW_SCHTASKS and MY_FLOW_PLUGIN_FAKE_CLAUDE seams, so the real homes, the real
 * scheduled task and the real `claude` binary are never touched.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { test } from 'node:test';
import { ROOT, cleanEnv, cleanup, hasGit, makeTmp, readText, write } from './helpers.mjs';
import {
  claudeCommands,
  codexAgentToml,
  codexHookCommand,
  codexMcpTables,
  codexSkillText,
  loadManifest,
  substitutePluginRoot,
} from '../scripts/lib/plugins.mjs';

const FIXTURE = join(ROOT, 'test', 'fixtures', 'plugin-demo');
const CLI = join(ROOT, 'scripts', 'cli.mjs');
const INSTALL = join(ROOT, 'scripts', 'install.mjs');
const SPAWN = { encoding: 'utf8', timeout: 30000, windowsHide: true };
const fwd = (p) => p.replace(/\\/g, '/');

function fresh(t, prefix = 'plugin') {
  const root = makeTmp(prefix);
  t.after(() => cleanup(root));
  return root;
}

/** Temporary homes plus the seams; returns { env, my, codex, claude, root }. */
function homes(t, extra = {}) {
  const root = fresh(t, 'homes');
  const my = join(root, 'my-flow');
  const codex = join(root, 'codex');
  const claude = join(root, 'claude');
  for (const d of [my, codex, claude]) mkdirSync(d, { recursive: true });
  const fake = join(root, 'fake-schtasks.mjs');
  writeFileSync(fake, "import { appendFileSync } from 'node:fs';\nappendFileSync(process.env.FAKE_SCHTASKS_LOG, process.argv.slice(2).join(' ') + '\\n');\nprocess.exit(0);\n", 'utf8');
  const env = cleanEnv({
    MY_FLOW_HOME: my,
    CODEX_HOME: codex,
    CLAUDE_CONFIG_DIR: claude,
    MY_FLOW_SCHTASKS: fake,
    FAKE_SCHTASKS_LOG: join(root, 'schtasks.log'),
    MY_FLOW_PLUGIN_FAKE_CLAUDE: 'missing',
    ...extra,
  });
  return { env, my, codex, claude, root, schtasksLog: join(root, 'schtasks.log') };
}

const run = (args, env, opts = {}) => {
  const r = spawnSync(process.execPath, args, { ...SPAWN, env, cwd: ROOT, ...opts });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
};
const cli = (args, env, opts) => run([CLI, ...args], env, opts);
const install = (args, env) => run([INSTALL, ...args], env);

/** A mutable copy of the fixture with `mutate(manifest, copyRoot)` applied. */
function mutatedCopy(t, mutate) {
  const dir = join(fresh(t, 'copy'), 'plugin-demo');
  cpSync(FIXTURE, dir, { recursive: true });
  const p = join(dir, 'my-flow-plugin.json');
  const manifest = JSON.parse(readFileSync(p, 'utf8'));
  const next = mutate(manifest, dir) ?? manifest;
  writeFileSync(p, JSON.stringify(next, null, 2) + '\n', 'utf8');
  return dir;
}
const errorsOf = (dir) => loadManifest(dir, { registry: null }).errors;

// ---------------------------------------------------------------- 1.1 / 1.2 unit tests
test('manifest: the fixture is valid and fully described', () => {
  const r = loadManifest(FIXTURE, { registry: null });
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
  assert.equal(r.manifest.name, 'plugin-demo');
  assert.equal(r.prefix, 'plugin-demo-');
  assert.deepEqual(r.skills.map((s) => s.name), ['demo']);
  assert.deepEqual(r.agents.map((a) => a.role), ['demo-reviewer']);
  assert.equal(r.hooks.hooks.SessionStart.length, 1);
  assert.deepEqual(r.claude, { pluginName: 'plugin-demo', marketplaceName: 'plugin-demo' });
});

test('manifest: missing file and invalid JSON', (t) => {
  assert.equal(loadManifest(join(ROOT, 'test'), { registry: null }).errors[0], 'missing my-flow-plugin.json');
  const dir = fresh(t, 'bad');
  write(dir, 'my-flow-plugin.json', '{');
  assert.match(errorsOf(dir)[0], /^invalid JSON: /);
});

test('manifest: mutated copies yield the D2 error texts', (t) => {
  assert.ok(errorsOf(mutatedCopy(t, (m) => { delete m.name; })).includes('name is required and must be kebab-case'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.version = '1'; })).includes('version must be semver'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.name = 'spec'; })).includes('name "spec" collides with core command "spec"'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.contributes.cli = { spec: 'scripts/hello.mjs' }; })).includes('cli verb "spec" collides with core command "spec"'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.codexSkillPrefix = 'my-flow-'; })).includes('codexSkillPrefix "my-flow-" is reserved for the core'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.codexSkillPrefix = 'Bad'; })).includes('codexSkillPrefix must be kebab-case and end with "-"'));
  const collides = mutatedCopy(t, (m, dir) => {
    m.codexSkillPrefix = 'my-';
    renameSync(join(dir, 'skills', 'demo'), join(dir, 'skills', 'flow-spec'));
  });
  assert.ok(errorsOf(collides).includes('skill "my-flow-spec" collides with the core skill directory "my-flow-spec"'));
  assert.deepEqual(errorsOf(mutatedCopy(t, (m) => { m.codexSkillPrefix = 'my-flow-browser-'; })), [], 'my-flow-browser- is legal by construction');
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.contributes.mcpServers['plugin-demo'].args = ['${HOME}/x']; })).includes('mcpServers.plugin-demo: unknown placeholder ${HOME}; only ${PLUGIN_ROOT} is substituted'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.contributes.mcpServers['bad.name'] = { command: 'node' }; })).includes('mcpServers name "bad.name" must match [A-Za-z0-9_-]'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.contributes.mcpServers['plugin-demo'].env = { 'A B': 'x' }; })).includes('mcpServers.plugin-demo.env key "A B" must match [A-Za-z0-9_-]'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { delete m.contributes.mcpServers['plugin-demo'].command; })).includes('mcpServers.plugin-demo: command is required'));
  assert.ok(errorsOf(mutatedCopy(t, (m, dir) => { writeFileSync(join(dir, '.mcp.json'), '{}'); })).includes('.mcp.json is not allowed; declare MCP servers in my-flow-plugin.json'));
  assert.ok(errorsOf(mutatedCopy(t, (m, dir) => {
    const p = join(dir, '.claude-plugin', 'plugin.json');
    const pj = JSON.parse(readFileSync(p, 'utf8'));
    pj.mcpServers = { x: { command: 'node' } };
    writeFileSync(p, JSON.stringify(pj));
  })).includes('.claude-plugin/plugin.json must not declare mcpServers (declare them in my-flow-plugin.json)'));
  assert.ok(errorsOf(mutatedCopy(t, (m, dir) => { rmSync(join(dir, '.claude-plugin', 'marketplace.json')); })).includes('.claude-plugin/marketplace.json must list plugin "plugin-demo"'));
  assert.ok(errorsOf(mutatedCopy(t, (m, dir) => { rmSync(join(dir, '.claude-plugin', 'plugin.json')); })).includes('.claude-plugin/plugin.json is missing'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.contributes.hooks = 'hooks/nope.json'; })).includes('hooks: file "hooks/nope.json" not found'));
  assert.ok(errorsOf(mutatedCopy(t, (m, dir) => {
    write(dir, 'hooks/hooks.json', JSON.stringify({ hooks: { Nope: [{ hooks: [{ type: 'command', command: 'node "${CLAUDE_PLUGIN_ROOT}/hooks/demo-hook.mjs"' }] }] } }));
  })).includes('hooks: unknown event "Nope"'));
  assert.ok(errorsOf(mutatedCopy(t, (m, dir) => {
    write(dir, 'hooks/hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'bash x.sh' }] }] } }));
  })).includes('hooks: command must be node "${CLAUDE_PLUGIN_ROOT}/<script>" (got: bash x.sh)'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.contributes.cli = { 'demo-hello': 'scripts/missing.mjs' }; })).includes('cli "demo-hello": script "scripts/missing.mjs" not found'));
  const r = loadManifest(mutatedCopy(t, (m) => { m.extra = 1; m.myFlow = '>=9.0.0'; }), { registry: null });
  assert.deepEqual(r.errors, []);
  assert.ok(r.warnings.includes('unknown field "extra" ignored'));
  assert.ok(r.warnings.includes('plugin wants my-flow >=9.0.0, installed 0.1.0'));
  assert.ok(errorsOf(mutatedCopy(t, (m) => { m.myFlow = 'latest'; })).includes('myFlow must look like ">=0.1.0"'));
});

test('renderers: placeholder substitution, skill rewrite, agent TOML, MCP tables, Claude commands', () => {
  const r = loadManifest(FIXTURE, { registry: null });
  assert.equal(substitutePluginRoot('${PLUGIN_ROOT}/x', 'C:\\p'), 'C:/p/x');
  assert.deepEqual(substitutePluginRoot({ a: ['${PLUGIN_ROOT}'], b: 1 }, '/p'), { a: ['/p'], b: 1 });
  const ctx = { pluginName: 'plugin-demo', root: r.root, prefix: r.prefix, skill: 'demo', skillNames: ['demo'] };
  const skill = codexSkillText(readFileSync(join(FIXTURE, 'skills', 'demo', 'SKILL.md'), 'utf8'), ctx);
  assert.match(skill, /^---\nname: plugin-demo-demo\n/);
  assert.ok(skill.includes('$plugin-demo-demo'));
  assert.ok(!skill.includes('${CLAUDE_PLUGIN_ROOT}') && !skill.includes('/plugin-demo:demo'));
  assert.ok(skill.includes(`${r.root}/README.md`));
  const toml = codexAgentToml('demo-reviewer', readFileSync(join(FIXTURE, 'agents', 'demo-reviewer.md'), 'utf8'), ctx);
  const lines = toml.split('\n');
  assert.ok(lines[0].startsWith('# my-flow agent: demo-reviewer (plugin plugin-demo, written by my-flow install codex - edit '));
  assert.equal(lines[1], 'name = "demo-reviewer"');
  assert.match(lines[2], /^description = "Read-only fixture reviewer/);
  assert.equal(lines[3], "developer_instructions = '''");
  assert.ok(toml.trimEnd().endsWith("'''"));
  assert.ok(toml.includes('$plugin-demo-demo'));
  assert.equal(
    codexHookCommand('node "${CLAUDE_PLUGIN_ROOT}/hooks/demo-hook.mjs"', { root: r.root, shimPath: 'C:\\h\\my-flow-shim.ps1' }),
    `powershell.exe -NoProfile -ExecutionPolicy Bypass -File "C:\\h\\my-flow-shim.ps1" -Script "${r.root}/hooks/demo-hook.mjs"`
  );
  const tables = codexMcpTables(r.manifest, r.root);
  assert.deepEqual(tables[0].lines, [
    '[mcp_servers.plugin-demo]',
    'command = "node"',
    `args = ["${r.root}/server/mcp.mjs"]`,
    `cwd = "${r.root}"`,
    'startup_timeout_sec = 20',
  ]);
  const c = claudeCommands(r);
  assert.equal(c.marketplaceAdd, `claude plugin marketplace add "${r.root}"`);
  assert.equal(c.pluginInstall, 'claude plugin install plugin-demo@plugin-demo');
  assert.deepEqual(c.mcpAdd, [`claude mcp add --transport stdio --scope user plugin-demo -- node "${r.root}/server/mcp.mjs"`]);
  assert.deepEqual(c.mcpRemove, ['claude mcp remove plugin-demo']);
});

test('fixture MCP server: initialize, tools/list, tools/call, ping over stdio', () => {
  const input = [
    { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18' } },
    { jsonrpc: '2.0', method: 'notifications/initialized' },
    { jsonrpc: '2.0', id: 2, method: 'tools/list' },
    { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'echo', arguments: { text: 'hi' } } },
    { jsonrpc: '2.0', id: 4, method: 'ping' },
    { jsonrpc: '2.0', id: 5, method: 'nope' },
  ].map((m) => JSON.stringify(m)).join('\n') + '\n';
  const r = spawnSync(process.execPath, [join(FIXTURE, 'server', 'mcp.mjs')], { ...SPAWN, input, env: cleanEnv() });
  assert.equal(r.status, 0, r.stderr);
  const lines = r.stdout.trim().split('\n').map((l) => JSON.parse(l));
  assert.equal(lines.length, 5);
  assert.equal(lines[0].result.protocolVersion, '2025-06-18');
  assert.equal(lines[1].result.tools[0].name, 'echo');
  assert.equal(lines[2].result.content[0].text, 'hi');
  assert.deepEqual(lines[3].result, {});
  assert.equal(lines[4].error.code, -32601);
});

// ---------------------------------------------------------------- 2.x registry and dispatch
const listJson = (env) => {
  const r = cli(['plugin', 'list', '--json'], env);
  assert.equal(r.status, 0, r.stderr);
  return JSON.parse(r.stdout);
};

test('registry: add -> list --json -> disable -> enable -> remove round trip under a temp home', (t) => {
  const h = homes(t);
  const add = cli(['plugin', 'add', FIXTURE], h.env);
  assert.equal(add.status, 0, add.stderr);
  assert.match(add.stdout, /^added plugin-demo 0\.1\.0 \(/m);
  assert.match(add.stdout, /^setup: pending \(node_modules missing under /m);
  assert.match(add.stdout, /^setup \(run it yourself; my-flow never executes it\): echo demo setup$/m);
  assert.match(add.stdout, /install codex/);
  const reg = JSON.parse(readText(join(h.my, 'plugins.json')));
  assert.equal(reg.version, 1);
  assert.equal(reg.plugins['plugin-demo'].enabled, true);
  assert.equal(reg.plugins['plugin-demo'].cloned, false);
  assert.equal(reg.plugins['plugin-demo'].path, fwd(FIXTURE));
  let j = listJson(h.env);
  assert.equal(j.plugins.length, 1);
  assert.equal(j.plugins[0].enabled, true);
  assert.equal(j.plugins[0].setup.state, 'pending');
  assert.ok(j.plugins[0].mcpServers['plugin-demo'].args[0].endsWith('/test/fixtures/plugin-demo/server/mcp.mjs'));
  assert.equal(j.plugins[0].cli['demo-hello'], `${fwd(FIXTURE)}/scripts/hello.mjs`);
  assert.equal(cli(['plugin', 'disable', 'plugin-demo'], h.env).status, 0);
  assert.equal(listJson(h.env).plugins[0].enabled, false);
  assert.equal(cli(['plugin', 'enable', 'plugin-demo'], h.env).status, 0);
  assert.equal(listJson(h.env).plugins[0].enabled, true);
  const rm = cli(['plugin', 'remove', 'plugin-demo'], h.env);
  assert.equal(rm.status, 0, rm.stderr);
  assert.match(rm.stdout, /^removed plugin-demo$/m);
  assert.match(rm.stdout, /claude mcp remove plugin-demo/);
  assert.equal(listJson(h.env).plugins.length, 0);
  assert.match(cli(['plugin', 'list'], h.env).stdout, /^no plugins registered/);
  // a second temp home never sees it
  cli(['plugin', 'add', FIXTURE], h.env);
  const other = homes(t);
  assert.equal(listJson(other.env).plugins.length, 0);
  assert.equal(cli(['plugin', 'remove', 'nope'], h.env).status, 1);
});

test('registry: duplicate add, --dry-run, core collision, setup never executed', (t) => {
  const h = homes(t);
  const dry = cli(['plugin', 'add', FIXTURE, '--dry-run'], h.env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^\[dry-run\] would add plugin-demo 0\.1\.0/);
  assert.ok(!existsSync(join(h.my, 'plugins.json')), 'dry-run writes no registry');
  assert.equal(cli(['plugin', 'add', FIXTURE], h.env).status, 0);
  const dup = cli(['plugin', 'add', FIXTURE], h.env);
  assert.equal(dup.status, 1);
  assert.match(dup.stderr, /plugin "plugin-demo" is already registered; remove it first/);
  const collide = cli(['plugin', 'add', mutatedCopy(t, (m) => { m.name = 'other'; m.codexSkillPrefix = 'other-'; m.contributes.cli = { spec: 'scripts/hello.mjs' }; })], h.env);
  assert.equal(collide.status, 1);
  assert.match(collide.stderr, /cli verb "spec" collides with core command "spec"/);
  // setup line is printed, never run
  const tmp = fresh(t, 'sentinel');
  const sentinelTxt = join(tmp, 'sentinel.txt');
  write(tmp, 'sentinel.mjs', `import { writeFileSync } from 'node:fs';\nwriteFileSync(${JSON.stringify(sentinelTxt)}, 'ran');\n`);
  const setupCmd = `node "${fwd(join(tmp, 'sentinel.mjs'))}"`;
  const copy = mutatedCopy(t, (m) => { m.name = 'demo-setup'; m.codexSkillPrefix = 'demo-setup-'; m.setup = setupCmd; delete m.contributes.cli; delete m.contributes.mcpServers; delete m.contributes.agents; });
  const pj = join(copy, '.claude-plugin', 'plugin.json');
  writeFileSync(pj, JSON.stringify({ ...JSON.parse(readFileSync(pj, 'utf8')), name: 'demo-setup' }));
  const mp = join(copy, '.claude-plugin', 'marketplace.json');
  writeFileSync(mp, JSON.stringify({ name: 'demo-setup', plugins: [{ name: 'demo-setup', source: './' }] }));
  const r = cli(['plugin', 'add', copy], h.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(setupCmd), 'setup line printed');
  assert.ok(!existsSync(sentinelTxt), 'setup line was not executed');
});

test('manifest: every violation is reported in one round', (t) => {
  const h = homes(t);
  const copy = mutatedCopy(t, (m) => { delete m.name; delete m.version; });
  const r = cli(['plugin', 'add', copy], h.env);
  assert.equal(r.status, 1);
  assert.match(r.stderr, /name is required and must be kebab-case/);
  assert.match(r.stderr, /version must be semver/);
});

test('uninstall codex: plugin content goes away even after plugin remove', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  assert.equal(install(['codex'], h.env).status, 0);
  assert.ok(existsSync(join(h.codex, 'skills', 'plugin-demo-demo')));
  assert.equal(cli(['plugin', 'remove', 'plugin-demo'], h.env).status, 0);
  assert.equal(install(['--uninstall', 'codex'], h.env).status, 0, 'removal never needs the registry');
  assert.ok(!existsSync(join(h.codex, 'skills', 'plugin-demo-demo')));
  assert.ok(!existsSync(join(h.codex, 'agents', 'demo-reviewer.toml')));
});

test('registry: a corrupt plugins.json cannot break core commands', (t) => {
  const h = homes(t);
  const clean = cli(['build', '--check'], h.env);
  write(h.my, 'plugins.json', '{');
  const corrupt = cli(['build', '--check'], h.env);
  assert.equal(corrupt.status, clean.status);
  assert.equal(corrupt.stdout, clean.stdout);
  assert.equal(clean.status, 0, clean.stdout + clean.stderr);
  assert.match(clean.stdout, /generated files are up to date/);
  const l = cli(['plugin', 'list'], h.env);
  assert.equal(l.status, 0);
  assert.match(l.stdout, /^no plugins registered/);
  assert.match(l.stderr, /warning: cannot parse/);
  assert.equal(cli(['plugin', 'add', FIXTURE], h.env).status, 1, 'writers refuse a corrupt registry');
});

test('list: setup, claude and codex states', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  let out = cli(['plugin', 'list'], h.env).stdout;
  assert.match(out, /^plugin-demo 0\.1\.0 \[enabled\] /m);
  assert.match(out, /^  setup: pending \(node_modules missing; run: echo demo setup\)$/m);
  assert.match(out, /^  claude: unknown \(claude not found\)$/m);
  assert.match(out, /^  codex: not installed$/m);
  assert.match(out, /^  verbs: demo-hello$/m);
  assert.match(out, /^  mcp: plugin-demo: node .*\/server\/mcp\.mjs \(cwd /m);
  // claude: installed with the fake seam and a planted installed_plugins.json
  write(h.claude, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'plugin-demo@plugin-demo': { installPath: fwd(FIXTURE) } } }));
  out = cli(['plugin', 'list'], { ...h.env, MY_FLOW_PLUGIN_FAKE_CLAUDE: 'plugin-demo' }).stdout;
  assert.match(out, /^  claude: installed$/m);
  out = cli(['plugin', 'list'], { ...h.env, MY_FLOW_PLUGIN_FAKE_CLAUDE: 'other' }).stdout;
  assert.match(out, /^  claude: not installed \(claude mcp get plugin-demo exited 1\)$/m);
  // setup: ok on a copy with an empty node_modules
  cli(['plugin', 'remove', 'plugin-demo'], h.env);
  const copy = mutatedCopy(t, () => {});
  mkdirSync(join(copy, 'node_modules'));
  cli(['plugin', 'add', copy], h.env);
  const j = listJson(h.env);
  assert.equal(j.plugins[0].setup.state, 'ok');
  assert.match(cli(['plugin', 'list'], h.env).stdout, /^  setup: ok$/m);
  // path: missing after the directory vanishes
  rmSync(copy, { recursive: true, force: true });
  out = cli(['plugin', 'list'], h.env).stdout;
  assert.match(out, /^  path: missing$/m);
});

test('dispatch: contributed verb, unknown verb, disabled plugin note, missing script', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  const hello = cli(['demo-hello', 'a', 'b'], h.env);
  assert.equal(hello.status, 0, hello.stderr);
  assert.equal(hello.stdout, `hello from plugin-demo at ${fwd(FIXTURE)}\na b\n`);
  const usage = cli([], h.env);
  assert.equal(usage.status, 0);
  assert.match(usage.stdout, /^  demo-hello \.\.\.   \(plugin plugin-demo\)$/m);
  const nope = cli(['nope'], h.env);
  assert.equal(nope.status, 1);
  assert.match(nope.stdout, /^my-flow <command>/);
  cli(['plugin', 'disable', 'plugin-demo'], h.env);
  const disabled = cli(['demo-hello'], h.env);
  assert.equal(disabled.status, 1);
  assert.match(disabled.stderr, /"demo-hello" is contributed by plugin "plugin-demo", which is disabled/);
  assert.ok(!cli([], h.env).stdout.includes('(plugin plugin-demo)'), 'disabled verbs leave the usage text');
  // missing script: a registered copy whose script vanished
  cli(['plugin', 'remove', 'plugin-demo'], h.env);
  const copy = mutatedCopy(t, () => {});
  cli(['plugin', 'add', copy], h.env);
  rmSync(join(copy, 'scripts', 'hello.mjs'));
  const missing = cli(['demo-hello'], h.env);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /script .* is missing; run my-flow plugin add again/);
});

test('registry: --name registers under an alias and refuses core command names', (t) => {
  const h = homes(t);
  assert.equal(cli(['plugin', 'add', FIXTURE, '--name', 'spec'], h.env).status, 1);
  assert.equal(cli(['plugin', 'add', FIXTURE, '--name', 'Bad_Name'], h.env).status, 1);
  const r = cli(['plugin', 'add', FIXTURE, '--name', 'demo-alias'], h.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^added demo-alias 0\.1\.0 /m);
  const j = listJson(h.env);
  assert.equal(j.plugins[0].name, 'demo-alias');
  assert.equal(cli(['demo-hello'], h.env).status, 0, 'verbs dispatch through the alias entry');
  assert.equal(cli(['plugin', 'enable', 'plugin-demo'], h.env).status, 1, 'the manifest name is not the key');
  assert.equal(cli(['plugin', 'remove', 'demo-alias'], h.env).status, 0);
});

// ---------------------------------------------------------------- 3.x install surfaces
/** A fake `claude` first on PATH that records having been run; the sentinel must never appear. */
function fakeClaudeOnPath(t, env) {
  const dir = fresh(t, 'bin');
  const sentinel = join(dir, 'claude-ran.txt');
  writeFileSync(join(dir, 'claude.cmd'), `@echo ran > "${sentinel}"\r\n`, 'utf8');
  writeFileSync(join(dir, 'claude'), `#!/bin/sh\necho ran > "${sentinel}"\n`, { encoding: 'utf8', mode: 0o755 });
  return { sentinel, env: { ...env, PATH: `${dir}${process.platform === 'win32' ? ';' : ':'}${env.PATH ?? process.env.PATH}` } };
}

test('install codex: dry-run prints the plugin lines and writes nothing', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  const r = install(['codex', '--dry-run'], h.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`[dry-run] add ${join(h.codex, 'skills', 'plugin-demo-demo')}`), r.stdout);
  assert.ok(r.stdout.includes(`[dry-run] add ${join(h.codex, 'agents', 'demo-reviewer.toml')}`));
  assert.match(r.stdout, /^\[dry-run\] add hook SessionStart: powershell\.exe .* -Script "/m);
  assert.ok(r.stdout.includes(`-Script "${fwd(FIXTURE)}/hooks/demo-hook.mjs"`));
  assert.match(r.stdout, /^\[dry-run\] add \[mcp_servers\.plugin-demo\]$/m);
  assert.match(r.stdout, /^\[dry-run\]   command = "node"$/m);
  assert.match(r.stdout, /^\[dry-run\]   startup_timeout_sec = 20$/m);
  assert.ok(!existsSync(join(h.codex, 'skills')), 'dry-run creates nothing under CODEX_HOME');
  assert.ok(!existsSync(join(h.codex, 'config.toml')));
  assert.ok(!existsSync(h.schtasksLog), 'dry-run never reaches the launcher');
});

test('install codex: a real install renders skills, agent, hook and MCP table', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  const r = install(['codex'], h.env);
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^plugin plugin-demo: skills plugin-demo-\*, mcp plugin-demo$/m);
  const skillMd = readText(join(h.codex, 'skills', 'plugin-demo-demo', 'SKILL.md'));
  assert.match(skillMd, /^---\nname: plugin-demo-demo\n/);
  assert.ok(skillMd.includes('$plugin-demo-demo'));
  assert.ok(!skillMd.includes('${CLAUDE_PLUGIN_ROOT}') && !skillMd.includes('/plugin-demo:demo'));
  assert.equal(readText(join(h.codex, 'skills', 'plugin-demo-demo', '.my-flow-plugin')), 'plugin-demo\n');
  assert.ok(readText(join(h.codex, 'agents', 'demo-reviewer.toml')).startsWith('# my-flow agent: demo-reviewer (plugin plugin-demo'));
  const hooks = JSON.parse(readText(join(h.codex, 'hooks.json')));
  const groups = hooks.hooks.SessionStart;
  assert.equal(groups.length, 2, 'the plugin group is appended after the core group');
  assert.ok(groups[groups.length - 1].hooks[0].command.endsWith(`-Script "${fwd(FIXTURE)}/hooks/demo-hook.mjs"`));
  const config = readText(join(h.codex, 'config.toml'));
  assert.match(config, /^\[mcp_servers\.plugin-demo\]$/m);
  assert.match(config, /^command = "node"$/m);
  assert.match(config, /^startup_timeout_sec = 20$/m);
  assert.match(config, /^\[hooks\.state\..*session_start:1:0'\]$/m, 'the plugin hook is trusted too');
  // a second dry-run reports replace, never skip, for the managed directory
  const second = install(['codex', '--dry-run'], h.env);
  assert.ok(second.stdout.includes(`[dry-run] replace ${join(h.codex, 'skills', 'plugin-demo-demo')}`), second.stdout);
  assert.ok(!second.stdout.includes(`skip ${join(h.codex, 'skills', 'plugin-demo-demo')}`));
  // uninstall dry-run announces the removal and leaves the directory in place
  const un = install(['--uninstall', 'codex', '--dry-run'], h.env);
  assert.ok(un.stdout.includes(`[dry-run] remove ${join(h.codex, 'skills', 'plugin-demo-demo')}`), un.stdout);
  assert.ok(existsSync(join(h.codex, 'skills', 'plugin-demo-demo')));
  assert.match(readText(h.schtasksLog), /\/create/);
});

test('install codex: no plugin registered leaves the core output unchanged', (t) => {
  const h = homes(t);
  const a = install(['codex', '--dry-run'], h.env);
  const b = install(['codex', '--dry-run'], h.env);
  assert.equal(a.status, 0, a.stderr);
  assert.equal(a.stdout, b.stdout, 'the core dry-run is deterministic with the same empty homes');
  for (const needle of ['plugin', 'add hook', '[mcp_servers.']) {
    assert.ok(!a.stdout.includes(needle), `core output must not mention "${needle}"`);
  }
});

test('install codex: an unmanaged mcp_servers table wins and is reported', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  write(h.codex, 'config.toml', '[mcp_servers.plugin-demo]\ncommand = "x"\n');
  const dry = install(['codex', '--dry-run'], h.env);
  assert.ok(dry.stdout.includes('skip [mcp_servers.plugin-demo]: defined outside the my-flow block; remove it first to let my-flow manage it'), dry.stdout);
  assert.ok(!dry.stdout.includes('[dry-run] add [mcp_servers.plugin-demo]'), 'the skip line replaces the add lines');
  assert.equal(install(['codex'], h.env).status, 0);
  const config = readText(join(h.codex, 'config.toml'));
  assert.equal(config.split('\n').filter((l) => l === '[mcp_servers.plugin-demo]').length, 1, 'never a duplicate table');
});

test('install codex: user content survives install + uninstall byte for byte', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  const keep = join(h.codex, 'skills', 'plugin-demo-keep', 'SKILL.md');
  write(h.codex, 'skills/plugin-demo-keep/SKILL.md', '---\nname: plugin-demo-keep\n---\n\nA user skill that only looks like a plugin skill.\n');
  write(h.codex, 'config.toml', '[features]\nhooks = true\n\n[mcp_servers.other]\ncommand = "x"\n');
  write(h.codex, 'hooks.json', JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'node "C:/user/own-hook.mjs"', timeout: 5 }] }] } }, null, 2) + '\n');
  const planted = ['config.toml', 'hooks.json'].map((f) => readFileSync(join(h.codex, f), 'utf8'));
  const plantedKeep = readFileSync(keep, 'utf8');
  assert.equal(install(['codex'], h.env).status, 0);
  assert.ok(existsSync(join(h.codex, 'skills', 'plugin-demo-demo')));
  assert.equal(install(['--uninstall', 'codex'], h.env).status, 0);
  assert.deepEqual(['config.toml', 'hooks.json'].map((f) => readFileSync(join(h.codex, f), 'utf8')), planted);
  assert.equal(readFileSync(keep, 'utf8'), plantedKeep, 'an unmarked directory is never touched');
  assert.ok(!existsSync(join(h.codex, 'skills', 'plugin-demo-demo')), 'plugin skill removed');
  assert.ok(!existsSync(join(h.codex, 'agents', 'demo-reviewer.toml')), 'plugin agent removed');
  assert.match(readText(h.schtasksLog), /\/delete/);
});

test('install codex: a disabled plugin is removed on the next install', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  install(['codex'], h.env);
  cli(['plugin', 'disable', 'plugin-demo'], h.env);
  const r = install(['codex'], h.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(!existsSync(join(h.codex, 'skills', 'plugin-demo-demo')));
  assert.ok(!existsSync(join(h.codex, 'agents', 'demo-reviewer.toml')));
  const config = readText(join(h.codex, 'config.toml'));
  assert.ok(!config.includes('[mcp_servers.plugin-demo]'));
  const hooks = JSON.parse(readText(join(h.codex, 'hooks.json')));
  assert.equal(hooks.hooks.SessionStart.length, 1, 'only the core group remains');
});

test('install codex: a broken or missing plugin never aborts the core install', (t) => {
  const h = homes(t);
  const copy = mutatedCopy(t, () => {});
  cli(['plugin', 'add', copy], h.env);
  rmSync(copy, { recursive: true, force: true });
  const r = install(['codex'], h.env);
  assert.equal(r.status, 0, r.stderr);
  assert.ok(r.stdout.includes(`skip plugin plugin-demo: path ${fwd(copy)} is missing`), r.stdout);
  assert.ok(existsSync(join(h.codex, 'AGENTS.md')), 'the core install still finished');
  // a corrupt registry is treated as empty, with a warning
  write(h.my, 'plugins.json', '{');
  const corrupt = install(['codex', '--dry-run'], h.env);
  assert.equal(corrupt.status, 0, corrupt.stderr);
  assert.match(corrupt.stderr, /warning: cannot parse .*plugins\.json/);
  assert.ok(!corrupt.stdout.includes('plugin-demo'));
});

test('install claude: the three commands are printed and never executed', (t) => {
  const base = homes(t);
  const { sentinel, env } = fakeClaudeOnPath(t, base.env);
  cli(['plugin', 'add', FIXTURE], env);
  const dry = install(['claude', '--dry-run'], env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /^plugin plugin-demo \(run in a terminal, not inside a Claude session\):$/m);
  assert.ok(dry.stdout.includes(`  claude plugin marketplace add "${fwd(FIXTURE)}"`), dry.stdout);
  assert.ok(dry.stdout.includes('  claude plugin install plugin-demo@plugin-demo'));
  assert.ok(dry.stdout.includes(`  claude mcp add --transport stdio --scope user plugin-demo -- node "${fwd(FIXTURE)}/server/mcp.mjs"`));
  assert.ok(!existsSync(join(base.claude, 'settings.json')), 'dry-run writes nothing into CLAUDE_CONFIG_DIR');
  assert.ok(!existsSync(sentinel), 'no claude process ran');
  const real = install(['claude'], env);
  assert.equal(real.status, 0, real.stderr);
  assert.ok(real.stdout.includes(`  claude mcp add --transport stdio --scope user plugin-demo -- node "${fwd(FIXTURE)}/server/mcp.mjs"`));
  assert.ok(!existsSync(sentinel), 'a real install still executes no claude command');
  const un = install(['--uninstall', 'claude', '--dry-run'], env);
  assert.ok(un.stdout.includes('  claude mcp remove plugin-demo'), un.stdout);
  assert.ok(un.stdout.includes('  claude plugin disable plugin-demo@plugin-demo'));
  assert.ok(!existsSync(sentinel));
});

test('build --check is unaffected by a registered plugin', (t) => {
  const h = homes(t);
  cli(['plugin', 'add', FIXTURE], h.env);
  // never spawnSync('npm') from a test: it fails with EINVAL on Windows without a shell
  const r = cli(['build', '--check'], h.env);
  assert.equal(r.status, 0, r.stdout + r.stderr);
  assert.match(r.stdout, /generated files are up to date/);
});

test('registry: git source is cloned under the my-flow home and deleted on remove', { skip: !hasGit() }, (t) => {
  const h = homes(t);
  const repo = join(fresh(t, 'repo'), 'plugin-demo');
  cpSync(FIXTURE, repo, { recursive: true });
  const git = (args) => spawnSync('git', ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', ...args], { ...SPAWN, cwd: repo });
  assert.equal(git(['init', '-q', '-b', 'main']).status, 0);
  assert.equal(git(['add', '-A']).status, 0);
  assert.equal(git(['commit', '-q', '--no-verify', '-m', 'init']).status, 0);
  const url = `file:///${fwd(repo).replace(/^\//, '')}`;
  const dry = cli(['plugin', 'add', url, '--dry-run'], h.env);
  assert.equal(dry.status, 0, dry.stderr);
  assert.match(dry.stdout, /would clone .* manifest validation skipped/);
  const r = cli(['plugin', 'add', url], h.env);
  assert.equal(r.status, 0, r.stderr);
  const clone = join(h.my, 'plugins', 'plugin-demo');
  assert.ok(existsSync(join(clone, 'my-flow-plugin.json')));
  const reg = JSON.parse(readText(join(h.my, 'plugins.json')));
  assert.equal(reg.plugins['plugin-demo'].cloned, true);
  assert.equal(reg.plugins['plugin-demo'].path, fwd(clone));
  assert.equal(cli(['plugin', 'remove', 'plugin-demo'], h.env).status, 0);
  assert.ok(!existsSync(clone), 'clone deleted on remove');
});
