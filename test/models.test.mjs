/**
 * Model routing: allowed sets, validation, renderers, surface location, probes, analysis,
 * the background check, the SessionStart hook fast path, the CLI, and the end-to-end
 * simulated upgrade. Every case runs against temp fixtures; nothing touches the real homes.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { test } from 'node:test';
import { ROOT, cleanEnv, cleanup, makeTmp, readText, write } from './helpers.mjs';

const LIB = join(ROOT, 'scripts', 'lib', 'models.mjs');
const MODELS = join(ROOT, 'scripts', 'models.mjs');
const SESSION_HOOK = join(ROOT, 'hooks', 'session-context.mjs');
const ROLES = ['planner', 'architect', 'critic', 'verifier'];
const SPAWN = { encoding: 'utf8', timeout: 30000, windowsHide: true };

// ---------------------------------------------------------------- fixtures
function cacheDoc(models) {
  return JSON.stringify({
    fetched_at: '2026-09-10T00:00:00Z',
    etag: 'x',
    client_version: '0.153.4',
    models: models.map(([slug, visibility, efforts]) => ({ slug, visibility, supported_reasoning_levels: efforts.map((effort) => ({ effort })), default_reasoning_level: efforts[1] ?? efforts[0] })),
  });
}
const CACHE_TODAY = [
  ['gpt-6-astra', 'list', ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']],
  ['gpt-5.5', 'list', ['low', 'medium', 'high', 'xhigh']],
  ['gpt-reserve', 'hide', ['low', 'medium', 'high']],
];

/** A full fixture: MY_FLOW_HOME, CLAUDE_CONFIG_DIR (with plugin registry + cache agents), CODEX_HOME (agents + config). */
function fixture(prefix, { cache = CACHE_TODAY, claudeModel = 'claude-fable-5-1[1m]', codexModel = 'gpt-6-astra', registry = 'array', cacheVersion = '9.9.9' } = {}) {
  const root = makeTmp(prefix);
  const home = join(root, 'my-flow');
  const claude = join(root, 'claude');
  const codex = join(root, 'codex');
  mkdirSync(home, { recursive: true });
  write(claude, 'settings.json', JSON.stringify({ model: claudeModel }));
  write(codex, 'config.toml', `model_context_window = 1000000\nmodel = "${codexModel}"\nmodel_reasoning_effort = "high"\n\n[agents]\nmax_threads = 4\n`);
  if (cache) write(codex, 'models_cache.json', cacheDoc(cache));
  for (const role of ROLES) {
    write(codex, `agents/${role}.toml`, readFileSync(join(ROOT, 'codex', 'agents', `${role}.toml`), 'utf8'));
  }
  const installPath = join(claude, 'plugins', 'cache', 'my-flow', 'my-flow', cacheVersion);
  for (const role of ROLES) {
    write(installPath, `agents/${role}.md`, readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'));
  }
  const entry = { scope: 'user', installPath, version: cacheVersion };
  if (registry === 'array') write(claude, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'my-flow@my-flow': [entry] } }));
  else if (registry === 'object') write(claude, 'plugins/installed_plugins.json', JSON.stringify({ version: 1, plugins: { 'my-flow@my-flow': entry } }));
  else if (registry === 'broken') write(claude, 'plugins/installed_plugins.json', '{ not json');
  else if (registry === 'no-path') write(claude, 'plugins/installed_plugins.json', JSON.stringify({ version: 2, plugins: { 'my-flow@my-flow': [{ scope: 'user' }] } }));
  const env = cleanEnv({ MY_FLOW_HOME: home, CLAUDE_CONFIG_DIR: claude, CODEX_HOME: codex, CLAUDE_PLUGIN_ROOT: installPath, MY_FLOW_MODELS_LAUNCHER: 'primary' });
  delete env.MY_FLOW_MODELS_FAKE_VERSIONS;
  delete env.MY_FLOW_ASK_SCRIPT;
  delete env.MY_FLOW_MODELS_CHECK_HOURS;
  delete env.MY_FLOW_SCHTASKS;
  return { root, home, claude, codex, installPath, env, cleanup: () => cleanup(root) };
}

/** Imports the library with the process env pointed at a fixture (fresh module instance per call). */
async function lib(fx) {
  for (const k of ['MY_FLOW_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'MY_FLOW_MODELS_FAKE_VERSIONS', 'MY_FLOW_ASK_SCRIPT', 'MY_FLOW_SKIP_HOOKS', 'MY_FLOW_MODELS_CHECK_HOURS', 'CLAUDE_PLUGIN_ROOT', 'MY_FLOW_MODELS_LAUNCHER', 'MY_FLOW_SCHTASKS']) delete process.env[k];
  for (const k of ['MY_FLOW_HOME', 'CLAUDE_CONFIG_DIR', 'CODEX_HOME', 'MY_FLOW_MODELS_FAKE_VERSIONS', 'MY_FLOW_ASK_SCRIPT', 'MY_FLOW_SKIP_HOOKS', 'MY_FLOW_MODELS_CHECK_HOURS', 'CLAUDE_PLUGIN_ROOT', 'MY_FLOW_MODELS_LAUNCHER', 'MY_FLOW_SCHTASKS']) {
    if (fx.env[k] !== undefined) process.env[k] = fx.env[k];
  }
  return import(`${pathToFileURL(LIB).href}?t=${Date.now()}-${Math.random()}`);
}

const fullMap = (claude = 'inherit', codex = null, effort = 'high') =>
  Object.fromEntries(ROLES.map((r) => [r, { claude: { model: claude }, codex: { model: codex, model_reasoning_effort: effort } }]));

// ---------------------------------------------------------------- 2.2 allowed sets and validation
test('resolveAllowed: main models, listed cache slugs, knownModels; hidden slugs dropped; per-model efforts', async () => {
  const fx = fixture('allowed');
  try {
    write(fx.home, 'config.json', JSON.stringify({ claude: { knownModels: ['claude-opus-5'] }, codex: { knownModels: ['gpt-custom'] } }));
    const m = await lib(fx);
    const a = m.resolveAllowed();
    assert.deepEqual([...a.claude].sort(), ['claude-fable-5-1[1m]', 'claude-opus-5']);
    assert.deepEqual([...a.codex].sort(), ['gpt-5.5', 'gpt-6-astra', 'gpt-custom']);
    assert.ok(!a.codex.has('gpt-reserve'), 'hidden slug is not allowed');
    assert.deepEqual(a.efforts('gpt-6-astra'), ['low', 'medium', 'high', 'xhigh', 'max', 'ultra']);
    assert.deepEqual(a.efforts('gpt-5.5'), ['low', 'medium', 'high', 'xhigh']);
    assert.deepEqual(a.efforts('gpt-custom'), ['low', 'medium', 'high', 'xhigh'], 'unknown slug falls back');
    assert.deepEqual(a.mainModels, { claude: 'claude-fable-5-1[1m]', codex: 'gpt-6-astra' });
  } finally {
    fx.cleanup();
  }
});

test('validateRecommendation: table-driven', async () => {
  const fx = fixture('validate');
  try {
    const m = await lib(fx);
    const allowed = m.resolveAllowed();
    const cases = [
      ['valid baseline', { roles: m.baseline() }, true],
      ['valid full map with aliases and listed codex model', { roles: fullMap('sonnet', 'gpt-5.5', 'medium'), reason: 'x' }, true],
      ['valid main model full id', { roles: fullMap('claude-fable-5-1[1m]', 'gpt-6-astra', 'ultra') }, true],
      ['missing role', { roles: Object.fromEntries(Object.entries(fullMap()).slice(0, 3)) }, false, /missing role verifier/],
      ['extra role', { roles: { ...fullMap(), extra: fullMap().planner } }, false, /unknown role extra/],
      ['gpt-7 for codex', { roles: fullMap('inherit', 'gpt-7', 'high') }, false, /codex\.model "gpt-7" for planner/],
      ['claude-unknown', { roles: fullMap('claude-unknown') }, false, /claude\.model "claude-unknown"/],
      ['hidden slug', { roles: fullMap('inherit', 'gpt-reserve', 'high') }, false, /gpt-reserve/],
      ['non-object', 'nope', false, /not an object/],
      ['null roles', { roles: null }, false, /roles is not an object/],
      ['ultra for gpt-5.5 rejects', { roles: fullMap('inherit', 'gpt-5.5', 'ultra') }, false, /"ultra" for planner is not supported by gpt-5\.5/],
      ['ultra for gpt-6-astra passes', { roles: fullMap('inherit', 'gpt-6-astra', 'ultra') }, true],
      ['ultra with inherited main model gpt-6-astra passes', { roles: fullMap('inherit', null, 'ultra') }, true],
      ['null effort passes', { roles: fullMap('inherit', null, null) }, true],
    ];
    for (const [name, input, ok, re] of cases) {
      const r = m.validateRecommendation(input, allowed);
      assert.equal(r.ok, ok, `${name}: ${JSON.stringify(r)}`);
      if (!ok) assert.match(r.errors[0], re, name);
    }
    const long = m.validateRecommendation({ roles: m.baseline(), reason: 'r'.repeat(5000) }, allowed);
    assert.equal(long.reason.length, 2000);
  } finally {
    fx.cleanup();
  }
});

test('validateRecommendation: without a cache file ultra rejects and xhigh passes', async () => {
  const fx = fixture('nocache', { cache: null });
  try {
    const m = await lib(fx);
    const allowed = m.resolveAllowed();
    assert.deepEqual([...allowed.codex], ['gpt-6-astra'], 'only the main model without a cache');
    assert.equal(m.validateRecommendation({ roles: fullMap('inherit', null, 'ultra') }, allowed).ok, false);
    assert.equal(m.validateRecommendation({ roles: fullMap('inherit', null, 'xhigh') }, allowed).ok, true);
  } finally {
    fx.cleanup();
  }
});

test('readModelsCache: truncated file yields the empty contribution and is never written', async () => {
  const fx = fixture('cache-broken');
  try {
    const p = join(fx.codex, 'models_cache.json');
    writeFileSync(p, readFileSync(p, 'utf8').slice(0, 40));
    const before = statSync(p).mtimeMs;
    const m = await lib(fx);
    const c = m.readModelsCache();
    assert.deepEqual(c.listed, []);
    assert.equal(c.efforts.size, 0);
    m.resolveAllowed();
    assert.equal(statSync(p).mtimeMs, before);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 2.3 renderers and surfaces
test('renderers: replace, insert, idempotent, CRLF kept, sandbox and body untouched, unmanaged refused', async () => {
  const fx = fixture('render');
  try {
    const m = await lib(fx);
    const claude = readFileSync(join(ROOT, 'agents', 'critic.md'), 'utf8');
    const c1 = m.renderClaudeAgent(claude, 'sonnet');
    assert.match(c1, /^model: sonnet$/m);
    assert.equal(m.renderClaudeAgent(c1, 'inherit'), claude, 'applying the baseline reproduces the shipped file');
    assert.equal(m.renderClaudeAgent(c1, 'sonnet'), c1, 'idempotent');
    const noModel = claude.replace(/^model: inherit\n/m, '');
    assert.match(m.renderClaudeAgent(noModel, 'opus'), /^description:.*\nmodel: opus$/m, 'inserted after description');
    const crlf = claude.replace(/\n/g, '\r\n');
    const c2 = m.renderClaudeAgent(crlf, 'haiku');
    assert.ok(c2.includes('\r\nmodel: haiku\r\n') && !/[^\r]\n/.test(c2), 'CRLF preserved');

    const toml = readFileSync(join(ROOT, 'codex', 'agents', 'critic.toml'), 'utf8');
    const t1 = m.renderCodexAgent(toml, { model: 'gpt-5.5', effort: 'low' });
    assert.match(t1, /^description = .*\nmodel = "gpt-5\.5"\nmodel_reasoning_effort = "low"\nsandbox_mode = "read-only"\ndeveloper_instructions = /m);
    assert.equal(m.renderCodexAgent(t1, { model: null, effort: 'medium' }), toml, 'baseline reproduces the shipped TOML byte for byte');
    assert.equal(m.renderCodexAgent(t1, { model: 'gpt-5.5', effort: 'low' }), t1, 'idempotent');
    assert.equal(m.renderCodexAgent(toml, { model: null, effort: null }).includes('model_reasoning_effort'), false, 'null effort omits the line');
    assert.equal(m.renderCodexAgent(toml, { model: null, effort: null }).includes('sandbox_mode = "read-only"'), true);
    const body = toml.slice(toml.indexOf('developer_instructions'));
    assert.ok(t1.endsWith(body), 'developer_instructions untouched');
    assert.equal(m.renderCodexAgent('name = "critic"\nmodel = "x"\n', { model: null, effort: 'high' }), null, 'unmanaged TOML refused');
    const tcrlf = toml.replace(/\n/g, '\r\n');
    assert.ok(!/[^\r]\n/.test(m.renderCodexAgent(tcrlf, { model: 'gpt-5.5', effort: 'high' })), 'TOML CRLF preserved');
  } finally {
    fx.cleanup();
  }
});

test('applyRoles / resetSurfaces: both surfaces rewritten, applied recorded, baseline restored byte for byte', async () => {
  const fx = fixture('apply');
  try {
    const m = await lib(fx);
    const roles = fullMap('sonnet', 'gpt-5.5', 'low');
    const r = m.applyRoles(roles);
    assert.equal(r.written.length, 8);
    for (const role of ROLES) {
      assert.match(readFileSync(join(fx.installPath, 'agents', `${role}.md`), 'utf8'), /^model: sonnet$/m);
      const t = readFileSync(join(fx.codex, 'agents', `${role}.toml`), 'utf8');
      assert.match(t, /^model = "gpt-5\.5"$/m);
      assert.match(t, /^model_reasoning_effort = "low"$/m);
    }
    const st = m.readState();
    assert.equal(st.applied.claudeRoot.toLowerCase(), fx.installPath.toLowerCase());
    assert.equal(st.applied.codexAgentsDir.toLowerCase(), join(fx.codex, 'agents').toLowerCase());
    assert.equal(st.applied.hash, m.rolesHash(roles));
    const eff = m.readEffective();
    assert.deepEqual(eff.roles.critic, { claude: { model: 'sonnet' }, codex: { model: 'gpt-5.5', effort: 'low' } });

    write(fx.home, 'models.json', JSON.stringify({ version: 1, roles }));
    m.resetSurfaces();
    for (const role of ROLES) {
      assert.equal(readFileSync(join(fx.installPath, 'agents', `${role}.md`), 'utf8'), readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'));
      assert.equal(readFileSync(join(fx.codex, 'agents', `${role}.toml`), 'utf8'), readFileSync(join(ROOT, 'codex', 'agents', `${role}.toml`), 'utf8'));
    }
    assert.equal(existsSync(join(fx.home, 'models.json')), false);
    const st2 = m.readState();
    assert.equal(st2.applied, null);
    assert.equal(st2.pending.line, 'model routing reset to baseline');
  } finally {
    fx.cleanup();
  }
});

test('locateCodexSurface: unmanaged TOML skipped, config agentsDir honoured', async () => {
  const fx = fixture('codex-surface');
  try {
    const m = await lib(fx);
    writeFileSync(join(fx.codex, 'agents', 'critic.toml'), 'name = "critic"\nmodel = "mine"\n');
    const s = m.locateCodexSurface();
    assert.deepEqual(Object.keys(s.files).sort(), ['architect', 'planner', 'verifier']);
    const other = join(fx.root, 'elsewhere');
    write(other, 'planner.toml', readFileSync(join(ROOT, 'codex', 'agents', 'planner.toml'), 'utf8'));
    write(fx.home, 'config.json', JSON.stringify({ codex: { agentsDir: other } }));
    const s2 = m.locateCodexSurface();
    assert.equal(s2.dir.toLowerCase(), other.toLowerCase());
    assert.deepEqual(Object.keys(s2.files), ['planner']);
  } finally {
    fx.cleanup();
  }
});

test('locateClaudeSurface: registry shapes and containment', async () => {
  for (const [registry, expectFound] of [
    ['array', true],
    ['object', true],
    ['no-path', false],
    ['broken', false],
    ['none', false],
  ]) {
    const fx = fixture(`registry-${registry}`, { registry });
    try {
      const m = await lib(fx);
      const logs = [];
      const found = m.locateClaudeSurface({ log: (l, msg) => logs.push(`${l} ${msg}`) });
      assert.equal(!!found, expectFound, `registry=${registry}: ${JSON.stringify(logs)}`);
      if (found) assert.equal(found.root.toLowerCase(), fx.installPath.toLowerCase());
      if (registry === 'broken') assert.ok(logs.some((l) => /unreadable/.test(l)), 'parse error logged once');
      // recorded root fallback works whenever the registry gives nothing
      const viaRecorded = m.locateClaudeSurface({ recordedRoot: fx.installPath, log: () => {} });
      assert.equal(viaRecorded.root.toLowerCase(), fx.installPath.toLowerCase());
      // a checkout outside <CLAUDE_HOME>/plugins/ is skipped and logged
      const outside = join(fx.root, 'checkout');
      for (const role of ROLES) write(outside, `agents/${role}.md`, readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'));
      const logs2 = [];
      const r = m.locateClaudeSurface({ recordedRoot: outside, log: (l, msg) => logs2.push(msg) });
      if (!expectFound) {
        assert.equal(r, null);
        assert.ok(logs2.some((l) => /development checkout/.test(l)), `outside root logged: ${logs2}`);
      }
    } finally {
      fx.cleanup();
    }
  }
});

// ---------------------------------------------------------------- 3.1 probes and main models
test('parseVersion, readMainModels, fake versions without spawning', async () => {
  const fx = fixture('probe');
  try {
    const m = await lib(fx);
    assert.equal(m.parseVersion('2.1.259 (Claude Code)'), '2.1.259');
    assert.equal(m.parseVersion('codex-cli 0.153.4'), '0.153.4');
    assert.equal(m.parseVersion('nothing here'), null);
    assert.deepEqual(m.readMainModels(), { claude: 'claude-fable-5-1[1m]', codex: 'gpt-6-astra' });
    writeFileSync(join(fx.codex, 'config.toml'), 'model_context_window = 1\n\n[agents]\nmodel = "gpt-inside-section"\n');
    assert.equal(m.readMainModels().codex, null, 'model inside [agents] is not the main model');
    writeFileSync(join(fx.claude, 'settings.json'), '{ broken');
    assert.equal(m.readMainModels().claude, null);

    const cachePath = join(fx.codex, 'models_cache.json');
    const before = statSync(cachePath).mtimeMs;
    const c = m.readModelsCache();
    assert.deepEqual(c.listed, ['gpt-6-astra', 'gpt-5.5']);
    assert.deepEqual(c.efforts.get('gpt-reserve'), ['low', 'medium', 'high'], 'hidden slug keeps its efforts but is not listed');
    assert.equal(statSync(cachePath).mtimeMs, before);

    process.env.MY_FLOW_MODELS_FAKE_VERSIONS = 'claude=,codex=0.200.0';
    const emptyPath = join(fx.root, 'empty-path');
    mkdirSync(emptyPath, { recursive: true });
    const savedPath = process.env.PATH;
    process.env.PATH = emptyPath;
    try {
      assert.deepEqual(m.probeVersions(), { claude: null, codex: '0.200.0' });
    } finally {
      process.env.PATH = savedPath;
      delete process.env.MY_FLOW_MODELS_FAKE_VERSIONS;
    }
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 3.3 analysis transport
/** Writes a fixture ask script (a node program) under the fixture root and returns its path. */
function askScript(fx, name, body) {
  return write(fx.root, `ask-${name}.mjs`, body);
}
const VALID_ANSWER = (claude = 'sonnet', codex = null, effort = 'medium') =>
  JSON.stringify({ roles: fullMap(claude, codex, effort), reason: 'fixture' });
const ASK_OK = (answer) => `
import { writeFileSync } from 'node:fs';
const args = process.argv.slice(2);
const dump = process.env.ASK_DUMP;
if (dump) writeFileSync(dump, JSON.stringify({ args, MY_FLOW_SKIP_HOOKS: process.env.MY_FLOW_SKIP_HOOKS ?? null }));
console.log('artifact: fixture.md');
console.log('status: ok (0.1s)');
console.log('');
console.log('Here is my recommendation:');
console.log('\`\`\`json');
console.log(${JSON.stringify(answer)});
console.log('\`\`\`');
`;
const ASK_FAIL = `
console.log('artifact: fixture.md');
console.log('status: exit code 1 (0.1s)');
console.log('');
process.exit(1);
`;

test('runAnalysis: valid answer, invalid answer falls back to the next provider, failing script, env flag', async () => {
  const fx = fixture('analysis');
  try {
    const m = await lib(fx);
    const allowed = m.resolveAllowed();
    const ctx = { allowed, cliVersions: { claude: '2.9.0', codex: '0.200.0' }, mainModels: allowed.mainModels };
    const dump = join(fx.root, 'dump.json');
    process.env.ASK_DUMP = dump;
    process.env.MY_FLOW_SKIP_HOOKS = 'completion-guard';
    // (a) valid
    process.env.MY_FLOW_ASK_SCRIPT = askScript(fx, 'ok', ASK_OK(VALID_ANSWER()));
    const a = m.runAnalysis({ ...ctx, providers: ['claude'] });
    assert.equal(a.ok, true, JSON.stringify(a));
    assert.equal(a.provider, 'claude');
    assert.equal(a.roles.critic.claude.model, 'sonnet');
    assert.ok(existsSync(a.promptPath), 'prompt written');
    const prompt = readText(a.promptPath);
    assert.match(prompt, /gpt-6-astra: low, medium, high, xhigh, max, ultra/);
    assert.match(prompt, /"claude-fable-5-1\[1m\]"/);
    // (d) env flag and args
    const d = JSON.parse(readText(dump));
    assert.equal(d.MY_FLOW_SKIP_HOOKS, 'completion-guard,model-routing');
    assert.deepEqual(d.args.slice(0, 2), ['claude', '--prompt-file']);
    assert.ok(d.args.includes('--ask-dir') && d.args.includes('--cwd') && d.args.includes('--timeout'));
    // (b) invalid model -> second provider wins
    process.env.MY_FLOW_ASK_SCRIPT = askScript(fx, 'bad', ASK_OK(VALID_ANSWER('inherit', 'gpt-7', 'high')));
    const b = m.runAnalysis({ ...ctx, providers: ['claude'] });
    assert.equal(b.ok, false);
    assert.match(b.reason, /claude: invalid: codex\.model "gpt-7"/);
    // (c) exit 1 leaves everything untouched
    const before = { claude: readFileSync(join(fx.installPath, 'agents', 'critic.md'), 'utf8'), codex: readFileSync(join(fx.codex, 'agents', 'critic.toml'), 'utf8') };
    process.env.MY_FLOW_ASK_SCRIPT = askScript(fx, 'fail', ASK_FAIL);
    const c = m.runAnalysis({ ...ctx, providers: ['claude', 'codex'] });
    assert.equal(c.ok, false);
    assert.match(c.reason, /claude: exit 1; codex: exit 1/);
    assert.equal(readFileSync(join(fx.installPath, 'agents', 'critic.md'), 'utf8'), before.claude);
    assert.equal(readFileSync(join(fx.codex, 'agents', 'critic.toml'), 'utf8'), before.codex);
    assert.equal(existsSync(join(fx.home, 'models.json')), false);
    // parseRecommendation edge cases
    assert.equal(m.parseRecommendation('status: ok\n\n{"roles":{}}').value.roles !== undefined, true, 'bare object accepted');
    assert.equal(m.parseRecommendation('status: ok\n\nno json').ok, false);
    assert.equal(m.parseRecommendation('status: ok\n\n```json\n{ nope\n```').ok, false);
  } finally {
    delete process.env.ASK_DUMP;
    delete process.env.MY_FLOW_SKIP_HOOKS;
    delete process.env.MY_FLOW_ASK_SCRIPT;
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 3.4 the background check
function runModels(fx, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [MODELS, ...args], { ...SPAWN, cwd: fx.root, env: { ...fx.env, ...extraEnv } });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}
const readJson = (p) => JSON.parse(readText(p));
const logOf = (fx) => (existsSync(join(fx.home, 'models.log')) ? readText(join(fx.home, 'models.log')) : '');
const stateOf = (fx) => readJson(join(fx.home, 'models-state.json'));
const surfaceText = (fx, role) => ({
  claude: readFileSync(join(fx.installPath, 'agents', `${role}.md`), 'utf8'),
  codex: readFileSync(join(fx.codex, 'agents', `${role}.toml`), 'utf8'),
});

test('check: first run, unchanged, changed + valid, changed + failing, live lock, drift', async () => {
  const fx = fixture('check');
  try {
    const okScript = askScript(fx, 'ok', ASK_OK(VALID_ANSWER('sonnet', 'gpt-5.5', 'low')));
    const failScript = askScript(fx, 'fail', ASK_FAIL);
    const v1 = { MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.1.259,codex=0.153.4', MY_FLOW_ASK_SCRIPT: okScript };
    // first run: records seen, no analysis
    let r = runModels(fx, ['check', '--quiet'], v1);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(r.stdout, '', '--quiet prints nothing');
    let st = stateOf(fx);
    assert.deepEqual(st.seen.cliVersions, { claude: '2.1.259', codex: '0.153.4' });
    assert.equal(existsSync(join(fx.home, 'models.json')), false);
    assert.match(logOf(fx), /check start \(pid \d+\)[\s\S]*first run: recorded[\s\S]*check done \(pid \d+\)/);
    assert.equal(st.lastCheck.pid > 0, true);
    // unchanged
    r = runModels(fx, ['check'], v1);
    assert.equal(r.status, 0);
    assert.match(r.stdout, /unchanged/);
    // changed + valid answer
    r = runModels(fx, ['check', '--quiet'], { ...v1, MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.9.0,codex=0.153.4' });
    assert.equal(r.status, 0, r.stderr);
    const models = readJson(join(fx.home, 'models.json'));
    assert.equal(models.analyzedBy, 'claude');
    assert.equal(models.roles.critic.codex.model, 'gpt-5.5');
    for (const role of ROLES) {
      const s = surfaceText(fx, role);
      assert.match(s.claude, /^model: sonnet$/m);
      assert.match(s.codex, /^model = "gpt-5\.5"$/m);
      assert.match(s.codex, /^model_reasoning_effort = "low"$/m);
    }
    st = stateOf(fx);
    assert.ok(st.pending.line.startsWith('model routing updated for claude 2.9.0 / codex 0.153.4 (by claude): planner=sonnet/gpt-5.5@low'), st.pending.line);
    assert.equal(st.seen.cliVersions.claude, '2.9.0');
    assert.deepEqual(st.analysis, { attempts: 0, lastError: null });
    // changed + failing script: files byte-identical, attempts 1, seen unchanged
    const before = ROLES.map((role) => surfaceText(fx, role));
    r = runModels(fx, ['check', '--quiet'], { MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.9.0,codex=0.300.0', MY_FLOW_ASK_SCRIPT: failScript });
    assert.equal(r.status, 1);
    assert.deepEqual(ROLES.map((role) => surfaceText(fx, role)), before);
    st = stateOf(fx);
    assert.equal(st.analysis.attempts, 1);
    assert.equal(st.seen.cliVersions.codex, '0.153.4', 'seen not advanced after a failure');
    assert.match(logOf(fx), /analysis failed/);
    assert.match(st.pending.line, /^model routing analysis failed: /);
    // provider order: codex changed first -> codex tried first (its failure is logged first)
    assert.match(logOf(fx), /analysis by codex failed[\s\S]*analysis by claude failed/);
    // live lock: second run exits 0 and appends nothing
    write(fx.home, 'models.lock', JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    const logBefore = logOf(fx);
    r = runModels(fx, ['check', '--quiet'], v1);
    assert.equal(r.status, 0);
    assert.equal(logOf(fx), logBefore);
    writeFileSync(join(fx.home, 'models.lock'), JSON.stringify({ pid: 999999, started: '2000-01-01T00:00:00.000Z' }));
    // drift: hand-edit one surface back to inherit while models.json and applied match -> re-applied
    const criticMd = join(fx.installPath, 'agents', 'critic.md');
    writeFileSync(criticMd, readFileSync(criticMd, 'utf8').replace(/^model: sonnet$/m, 'model: inherit'));
    r = runModels(fx, ['check', '--quiet'], { MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.9.0,codex=0.153.4', MY_FLOW_ASK_SCRIPT: okScript });
    assert.equal(r.status, 0, r.stderr);
    assert.match(readFileSync(criticMd, 'utf8'), /^model: sonnet$/m);
    assert.match(logOf(fx), /re-applied override to .*critic\.md/);
    assert.match(logOf(fx), /\(stale lock|check start/);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 4.1 CLI entry
const CLI = join(ROOT, 'scripts', 'cli.mjs');
function runCli(fx, args, extraEnv = {}) {
  const r = spawnSync(process.execPath, [CLI, 'models', ...args], { ...SPAWN, cwd: fx.root, env: { ...fx.env, ...extraEnv } });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

test('models CLI: status on an empty home, lock refusals, invalid apply, reset restores the baseline', async () => {
  const fx = fixture('cli');
  try {
    const empty = join(fx.root, 'empty-home');
    mkdirSync(empty, { recursive: true });
    let r = runCli(fx, ['status', '--json'], { MY_FLOW_HOME: empty });
    assert.equal(r.status, 0, r.stderr);
    const doc = JSON.parse(r.stdout);
    assert.equal(doc.override, null);
    assert.equal(doc.effective.critic.claude.model, 'inherit');
    assert.equal(doc.effective.critic.codex.effort, 'medium');
    assert.match(runCli(fx, ['status'], { MY_FLOW_HOME: empty }).stdout, /override: none \(baseline: inherit\)/);

    // live lock: analyze and reset refuse, models.json stays
    const roles = fullMap('sonnet', 'gpt-5.5', 'low');
    write(fx.home, 'models.json', JSON.stringify({ version: 1, roles }));
    write(fx.home, 'models.lock', JSON.stringify({ pid: process.pid, started: new Date().toISOString() }));
    const stateBefore = existsSync(join(fx.home, 'models-state.json'));
    r = runCli(fx, ['analyze'], { MY_FLOW_ASK_SCRIPT: askScript(fx, 'ok', ASK_OK(VALID_ANSWER())), MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.9.0,codex=' });
    assert.equal(r.status, 1);
    assert.ok(r.stderr.includes(`analysis already running (pid ${process.pid})`), r.stderr);
    assert.equal(existsSync(join(fx.home, 'models-state.json')), stateBefore, 'analyze under lock writes nothing');
    r = runCli(fx, ['reset']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /analysis already running/);
    assert.ok(existsSync(join(fx.home, 'models.json')), 'reset under lock leaves models.json');
    r = runCli(fx, ['apply']);
    assert.equal(r.status, 1);
    writeFileSync(join(fx.home, 'models.lock'), JSON.stringify({ pid: 999999, started: '2000-01-01T00:00:00.000Z' }));

    // invalid override: exits 1, surfaces untouched
    const before = ROLES.map((role) => surfaceText(fx, role));
    write(fx.home, 'models.json', JSON.stringify({ version: 1, roles: fullMap('inherit', 'gpt-7', 'high') }));
    r = runCli(fx, ['apply']);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /override invalid.*gpt-7/);
    assert.deepEqual(ROLES.map((role) => surfaceText(fx, role)), before);

    // valid override applies, then reset restores the shipped files byte for byte
    write(fx.home, 'models.json', JSON.stringify({ version: 1, roles }));
    r = runCli(fx, ['apply']);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /re-applied/);
    assert.match(runCli(fx, ['apply']).stdout, /unchanged/);
    r = runCli(fx, ['reset']);
    assert.equal(r.status, 0, r.stderr);
    assert.equal(existsSync(join(fx.home, 'models.json')), false);
    for (const role of ROLES) {
      const s = surfaceText(fx, role);
      assert.equal(s.claude, readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'));
      assert.equal(s.codex, readFileSync(join(ROOT, 'codex', 'agents', `${role}.toml`), 'utf8'));
    }
    assert.equal(JSON.parse(runCli(fx, ['status', '--json']).stdout).override, null);
    assert.match(runCli(fx, ['bogus']).stderr, /usage/);
    // analyze --dry-run prints a recommendation and writes nothing
    r = runCli(fx, ['analyze', '--dry-run', '--provider', 'claude'], { MY_FLOW_ASK_SCRIPT: askScript(fx, 'ok2', ASK_OK(VALID_ANSWER('opus', null, 'high'))), MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.9.0,codex=0.1.0' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /"analyzedBy": "claude"[\s\S]*\(dry run: nothing written\)/);
    assert.equal(existsSync(join(fx.home, 'models.json')), false);
    // analyze for real writes and applies
    r = runCli(fx, ['analyze', '--provider', 'claude'], { MY_FLOW_ASK_SCRIPT: askScript(fx, 'ok2', ASK_OK(VALID_ANSWER('opus', null, 'high'))), MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.9.0,codex=0.1.0' });
    assert.equal(r.status, 0, r.stderr);
    assert.match(surfaceText(fx, 'planner').claude, /^model: opus$/m);
    assert.match(stateOf(fx).pending.line, /^model routing updated by "models analyze"/);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 4.2 SessionStart hook fast path
/** Runs hooks/session-context.mjs as a child with the full fixture env (never the real homes). */
function runSessionHook(cwd, env, { hook = SESSION_HOOK, input = {} } = {}) {
  const started = Date.now();
  const r = spawnSync(process.execPath, [hook], { ...SPAWN, cwd, env, input: JSON.stringify({ cwd, hook_event_name: 'SessionStart', ...input }) });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  const out = JSON.parse(r.stdout);
  const text = out.systemMessage ?? '';
  const routing = text.split('\n').filter((l) => l.startsWith('model routing'));
  return { ms: Date.now() - started, out, text, routing };
}
const realState = join(homedir(), '.my-flow', 'models-state.json');
const realStateMtime = () => (existsSync(realState) ? statSync(realState).mtimeMs : null);
const waitFor = async (fn, ms = 15000) => {
  const deadline = Date.now() + ms;
  while (Date.now() < deadline) {
    if (fn()) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return fn();
};

test('hook: fast, spawns one detached check, prints a pending line exactly once, honours skip, fails open', async (t) => {
  const fx = fixture('hook');
  const realBefore = realStateMtime();
  try {
    const project = join(fx.root, 'project');
    mkdirSync(project, { recursive: true });
    const env = { ...fx.env, MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.1.259,codex=0.153.4', MY_FLOW_ASK_SCRIPT: askScript(fx, 'ok', ASK_OK(VALID_ANSWER())) };
    // no changes/, nothing pending: output is still {} (the empty early exit is preserved) but a check is spawned
    const first = runSessionHook(project, env);
    assert.deepEqual(first.out, {});
    let st = stateOf(fx);
    assert.ok(st.lastSpawn?.at && Number.isInteger(st.lastSpawn.pid), `lastSpawn written: ${JSON.stringify(st)}`);
    assert.equal(st.claudePluginRoot.toLowerCase(), fx.installPath.toLowerCase());
    assert.ok(await waitFor(() => /check done/.test(logOf(fx))), 'detached check completed');
    // warm run is fast, and the throttle (default 1 h) does not spawn again
    const second = runSessionHook(project, env);
    assert.ok(second.ms < 1000, `warm hook took ${second.ms} ms`);
    assert.equal(stateOf(fx).lastSpawn.at, st.lastSpawn.at, 'throttled: no second spawn');
    // pending line appears exactly once across two runs
    st = stateOf(fx);
    st.pending = { line: 'model routing updated for test', at: new Date().toISOString() };
    writeFileSync(join(fx.home, 'models-state.json'), JSON.stringify(st));
    const a = runSessionHook(project, env);
    assert.deepEqual(a.routing, ['model routing updated for test']);
    assert.equal(a.out.hookSpecificOutput.hookEventName, 'SessionStart');
    const b = runSessionHook(project, env);
    assert.deepEqual(b.routing, []);
    // skip flag: no routing line, no state write, pending stays
    st = stateOf(fx);
    st.pending = { line: 'model routing still pending', at: new Date().toISOString() };
    delete st.lastSpawn;
    writeFileSync(join(fx.home, 'models-state.json'), JSON.stringify(st));
    const mtime = statSync(join(fx.home, 'models-state.json')).mtimeMs;
    const s = runSessionHook(project, { ...env, MY_FLOW_SKIP_HOOKS: 'model-routing' });
    assert.deepEqual(s.routing, []);
    assert.equal(statSync(join(fx.home, 'models-state.json')).mtimeMs, mtime, 'no state write under skip');
    assert.equal(stateOf(fx).pending.line, 'model routing still pending');
    assert.equal(stateOf(fx).lastSpawn, undefined, 'nothing spawned under skip');
    // in-process cold hookTick under 200 ms
    const m = await lib({ env: { ...env, MY_FLOW_HOME: join(fx.root, 'cold-home') } });
    const t0 = process.hrtime.bigint();
    const tick = m.hookTick({ pluginRoot: fx.installPath });
    const coldMs = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.ok(coldMs < 200, `cold hookTick took ${coldMs} ms`);
    assert.ok(Number.isInteger(tick.spawned));
    await waitFor(() => /check done/.test(existsSync(join(fx.root, 'cold-home', 'models.log')) ? readText(join(fx.root, 'cold-home', 'models.log')) : ''));
    // fail open: with the library renamed in a temp copy of the plugin root the hook still prints the change status
    const copy = join(fx.root, 'plugin-copy');
    for (const rel of ['hooks/session-context.mjs', 'hooks/lib/stdin.mjs', 'scripts/lib/spawn.mjs', 'manifest.json']) write(copy, rel, readFileSync(join(ROOT, rel), 'utf8'));
    write(copy, 'scripts/lib/models.mjs.renamed', readFileSync(LIB, 'utf8'));
    const proj2 = join(fx.root, 'project2');
    write(proj2, 'changes/demo/tasks.md', '## 1. x\n- [ ] 1.1 do and verify it\n');
    write(proj2, 'changes/demo/proposal.md', '## Why\nbecause\n');
    write(proj2, 'changes/demo/design.md', '## Do-Not-Touch\nnone\n');
    const f = runSessionHook(proj2, env, { hook: join(copy, 'hooks', 'session-context.mjs') });
    assert.match(f.text, /Active changes[\s\S]*demo: 0\/1 tasks ticked/);
    assert.deepEqual(f.routing, []);
  } finally {
    fx.cleanup();
  }
  assert.equal(realStateMtime(), realBefore, 'the real ~/.my-flow/models-state.json was not touched');
});

// ---------------------------------------------------------------- spec: baseline inheritance (generated files)
test('generated agents: model: inherit on Claude, no model = on Codex, read-only sandbox on architect and critic only', () => {
  for (const role of ROLES) {
    assert.match(readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'), /^model: inherit$/m, role);
    const toml = readFileSync(join(ROOT, 'codex', 'agents', `${role}.toml`), 'utf8');
    assert.doesNotMatch(toml, /^model\s*=/m, role);
    assert.equal(/^sandbox_mode = "read-only"$/m.test(toml), role === 'architect' || role === 'critic', role);
  }
  const r = spawnSync(process.execPath, [join(ROOT, 'scripts', 'build.mjs'), '--check'], { ...SPAWN, cwd: ROOT });
  assert.equal(r.status, 0, r.stdout + r.stderr);
});

// ---------------------------------------------------------------- 6.1 end-to-end simulated upgrade
const OLDER = { version: 1, seen: { cliVersions: { claude: '2.1.259', codex: '0.153.4' }, mainModels: { claude: 'claude-fable-5-1[1m]', codex: 'gpt-6-astra' } } };
const NEWER = 'claude=2.9.0,codex=0.153.4';
const checkDoneCount = (fx) => (logOf(fx).match(/check done \(pid \d+\)/g) ?? []).length;
const pairOf = (fx) => {
  const log = logOf(fx);
  const start = /(\S+) info check start \(pid (\d+)\)/.exec(log);
  const done = /(\S+) info check done \(pid (\d+)\)/.exec(log);
  return start && done ? { startAt: start[1], startPid: Number(start[2]), doneAt: done[1], donePid: Number(done[2]) } : null;
};

test('end-to-end: simulated upgrade, success fixture', async () => {
  const fx = fixture('e2e-ok');
  const realBefore = realStateMtime();
  try {
    write(fx.home, 'models-state.json', JSON.stringify(OLDER));
    const project = join(fx.root, 'project');
    mkdirSync(project, { recursive: true });
    const env = { ...fx.env, MY_FLOW_MODELS_CHECK_HOURS: '0', MY_FLOW_MODELS_FAKE_VERSIONS: NEWER, MY_FLOW_ASK_SCRIPT: askScript(fx, 'ok', ASK_OK(VALID_ANSWER('sonnet', 'gpt-5.5', 'low'))) };
    let runs = 0;
    const hook = () => {
      runs += 1;
      return runSessionHook(project, env);
    };
    const settled = async () => assert.ok(await waitFor(() => checkDoneCount(fx) === runs), `expected ${runs} check done lines, log:\n${logOf(fx)}`);

    const first = hook();
    assert.ok(first.ms < 1000, `first hook run took ${first.ms} ms`);
    assert.ok(await waitFor(() => pairOf(fx) && pairOf(fx).donePid === stateOf(fx).lastCheck?.pid), `pair with lastCheck.pid, log:\n${logOf(fx)}`);
    const st = stateOf(fx);
    const pair = pairOf(fx);
    assert.equal(pair.startPid, pair.donePid, 'same pid in the pair');
    assert.equal(pair.donePid, st.lastCheck.pid);
    assert.equal(st.lastSpawn.launcher, 'primary', 'tests always run the primary launcher');
    assert.equal(pair.donePid, st.lastSpawn.pid, 'primary launcher: the spawned pid is the check pid');
    assert.ok(pair.startAt >= st.lastSpawn.at, 'pair written after lastSpawn.at');
    assert.ok(st.lastCheck.at > st.lastSpawn.at, 'lastCheck newer than lastSpawn');
    assert.match(logOf(fx), /model routing updated for claude 2\.9\.0/);
    const m = await lib(fx);
    const models = readJson(join(fx.home, 'models.json'));
    assert.equal(m.validateRecommendation({ roles: models.roles }, m.resolveAllowed()).ok, true);
    for (const role of ROLES) {
      const s = surfaceText(fx, role);
      assert.match(s.claude, /^model: sonnet$/m);
      assert.match(s.codex, /^model = "gpt-5\.5"$/m);
      assert.match(s.codex, /^model_reasoning_effort = "low"$/m);
    }
    await settled();
    const second = hook();
    assert.equal(second.routing.length, 1);
    assert.match(second.routing[0], /^model routing updated for claude 2\.9\.0 \/ codex 0\.153\.4 \(by claude\): planner=sonnet\/gpt-5\.5@low/);
    await settled();
    const third = hook();
    assert.deepEqual(third.routing, []);
    await settled();
    const reset = runModels(fx, ['reset'], env);
    assert.equal(reset.status, 0, reset.stderr);
    const fourth = hook();
    assert.deepEqual(fourth.routing, ['model routing reset to baseline']);
    assert.equal(JSON.parse(runCli(fx, ['status', '--json'], env).stdout).override, null);
    await settled();
    for (const role of ROLES) {
      const s = surfaceText(fx, role);
      assert.equal(s.claude, readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'));
      assert.equal(s.codex, readFileSync(join(ROOT, 'codex', 'agents', `${role}.toml`), 'utf8'));
    }
  } finally {
    fx.cleanup();
  }
  assert.equal(realStateMtime(), realBefore, 'real ~/.my-flow untouched');
});

test('end-to-end: simulated upgrade, failure fixture keeps the baseline', async () => {
  const fx = fixture('e2e-fail');
  try {
    write(fx.home, 'models-state.json', JSON.stringify(OLDER));
    const project = join(fx.root, 'project');
    mkdirSync(project, { recursive: true });
    const env = { ...fx.env, MY_FLOW_MODELS_CHECK_HOURS: '0', MY_FLOW_MODELS_FAKE_VERSIONS: NEWER, MY_FLOW_ASK_SCRIPT: askScript(fx, 'fail', ASK_FAIL) };
    runSessionHook(project, env);
    assert.ok(await waitFor(() => pairOf(fx) && pairOf(fx).donePid === stateOf(fx).lastCheck?.pid), `pair, log:\n${logOf(fx)}`);
    const second = runSessionHook(project, env);
    assert.ok(await waitFor(() => checkDoneCount(fx) === 2), logOf(fx));
    for (const role of ROLES) {
      const s = surfaceText(fx, role);
      assert.equal(s.claude, readFileSync(join(ROOT, 'agents', `${role}.md`), 'utf8'));
      assert.equal(s.codex, readFileSync(join(ROOT, 'codex', 'agents', `${role}.toml`), 'utf8'));
    }
    assert.match(logOf(fx), /analysis failed/);
    assert.equal(existsSync(join(fx.home, 'models.json')), false);
    assert.equal(second.routing.length, 1);
    assert.match(second.routing[0], /^model routing analysis failed: /);
    assert.equal(stateOf(fx).analysis.attempts >= 1, true);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 7.1 launcher selection (schtasks / primary)
const SCHTASKS_OK = `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.SCHTASKS_DUMP, JSON.stringify(process.argv.slice(2)));
process.exit(Number(process.env.SCHTASKS_EXIT ?? 0));
`;
const SCHTASKS_SLOW = `
import { writeFileSync } from 'node:fs';
writeFileSync(process.env.SCHTASKS_DUMP, JSON.stringify(process.argv.slice(2)));
setTimeout(() => process.exit(0), 2000);
`;

test('launchCheck: schtasks when a task is registered, primary on failure / cooldown / opt-out / non-win32', async () => {
  const fx = fixture('launcher');
  try {
    const m = await lib(fx);
    delete process.env.MY_FLOW_MODELS_LAUNCHER;
    process.env.MY_FLOW_MODELS_FAKE_VERSIONS = 'claude=2.1.259,codex=0.153.4';
    const dump = join(fx.root, 'schtasks-argv.json');
    process.env.SCHTASKS_DUMP = dump;
    const argv = () => (existsSync(dump) ? JSON.parse(readText(dump)) : null);
    const clearDump = () => {
      if (existsSync(dump)) writeFileSync(dump, '');
    };
    const script = join(fx.installPath, '..', '..', 'nowhere', 'models.mjs'); // primary spawns exit at once: a missing script is fine
    const withTask = () => write(fx.home, 'config.json', JSON.stringify({ launcher: { task: 'my-flow-models-check', root: ROOT } }));
    const logLines = () => (logOf(fx).match(/falling back to primary/g) ?? []).length;

    // task set + exit 0 -> schtasks, pid null, argv recorded
    withTask();
    process.env.MY_FLOW_SCHTASKS = write(fx.root, 'schtasks-ok.mjs', SCHTASKS_OK);
    let st = {};
    let r = m.launchCheck(script, { platform: 'win32', state: st });
    assert.deepEqual({ launcher: r.launcher, pid: r.pid }, { launcher: 'schtasks', pid: null });
    assert.deepEqual(argv(), ['/run', '/tn', 'my-flow-models-check']);
    assert.equal(st.launcherFailedAt, undefined);

    // task set + exit 1 -> primary with a numeric pid, one log line, launcherFailedAt set
    clearDump();
    process.env.SCHTASKS_EXIT = '1';
    st = {};
    r = m.launchCheck(script, { platform: 'win32', state: st });
    r.child?.unref();
    assert.equal(r.launcher, 'primary');
    assert.ok(Number.isInteger(r.pid));
    assert.ok(st.launcherFailedAt, 'failure remembered');
    assert.equal(logLines(), 1);
    assert.match(logOf(fx), /schtasks \/run failed \(exit 1\), falling back to primary/);
    delete process.env.SCHTASKS_EXIT;

    // task set + sleeping fixture -> primary within the budget, then cooldown skips the fixture entirely
    clearDump();
    process.env.MY_FLOW_SCHTASKS = write(fx.root, 'schtasks-slow.mjs', SCHTASKS_SLOW);
    const homeSlow = join(fx.root, 'home-slow');
    mkdirSync(homeSlow, { recursive: true });
    process.env.MY_FLOW_HOME = homeSlow;
    withTask();
    write(homeSlow, 'config.json', JSON.stringify({ launcher: { task: 'my-flow-models-check', root: ROOT } }));
    const t0 = process.hrtime.bigint();
    const tick = m.hookTick({ pluginRoot: fx.installPath, scriptsDir: join(fx.root, 'nowhere') });
    const ms = Number(process.hrtime.bigint() - t0) / 1e6;
    assert.equal(tick.launcher, 'primary');
    assert.ok(ms < 1000, `hookTick took ${ms} ms`);
    let slowState = readJson(join(homeSlow, 'models-state.json'));
    assert.ok(slowState.launcherFailedAt, 'timeout remembered');
    assert.match(readText(join(homeSlow, 'models.log')), /schtasks \/run failed \(timeout\), falling back to primary/);
    const slowLog = readText(join(homeSlow, 'models.log'));
    clearDump();
    delete slowState.lastSpawn; // make the next tick want a check again
    writeFileSync(join(homeSlow, 'models-state.json'), JSON.stringify(slowState));
    const tick2 = m.hookTick({ pluginRoot: fx.installPath, scriptsDir: join(fx.root, 'nowhere') });
    assert.equal(tick2.launcher, 'primary');
    assert.equal(readText(dump), '', 'fixture not called during the cooldown');
    assert.equal(readText(join(homeSlow, 'models.log')), slowLog, 'no new log line during the cooldown');
    process.env.MY_FLOW_HOME = fx.home;

    // no config.launcher -> primary, fixture untouched
    clearDump();
    process.env.MY_FLOW_SCHTASKS = write(fx.root, 'schtasks-ok.mjs', SCHTASKS_OK);
    write(fx.home, 'config.json', JSON.stringify({ codex: { knownModels: [] } }));
    r = m.launchCheck(script, { platform: 'win32', state: {} });
    r.child?.unref();
    assert.equal(r.launcher, 'primary');
    assert.equal(readText(dump), '');

    // MY_FLOW_MODELS_LAUNCHER=primary with a task -> primary, fixture untouched
    withTask();
    process.env.MY_FLOW_MODELS_LAUNCHER = 'primary';
    r = m.launchCheck(script, { platform: 'win32', state: {} });
    r.child?.unref();
    assert.equal(r.launcher, 'primary');
    assert.equal(readText(dump), '');
    delete process.env.MY_FLOW_MODELS_LAUNCHER;

    // non-win32 with a task -> primary, fixture untouched
    r = m.launchCheck(script, { platform: 'linux', state: {} });
    r.child?.unref();
    assert.equal(r.launcher, 'primary');
    assert.equal(readText(dump), '');
  } finally {
    delete process.env.SCHTASKS_DUMP;
    delete process.env.SCHTASKS_EXIT;
    delete process.env.MY_FLOW_SCHTASKS;
    delete process.env.MY_FLOW_MODELS_FAKE_VERSIONS;
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 7.2 --home, installer dry-run, status launcher
const INSTALL = join(ROOT, 'scripts', 'install.mjs');

test('models check --home writes state under the given directory only', async () => {
  const fx = fixture('home-flag');
  try {
    const other = join(fx.root, 'other-home');
    const r = runModels(fx, ['check', '--quiet', '--home', other], { MY_FLOW_MODELS_FAKE_VERSIONS: 'claude=2.1.259,codex=0.153.4' });
    assert.equal(r.status, 0, r.stderr);
    assert.ok(existsSync(join(other, 'models-state.json')) && existsSync(join(other, 'models.log')), 'state and log under --home');
    assert.equal(existsSync(join(fx.home, 'models-state.json')), false, 'nothing under the default home');
    assert.equal(existsSync(join(fx.home, 'models.log')), false);
  } finally {
    fx.cleanup();
  }
});

test('install --dry-run prints the schtasks /create line (conhost --headless, --home) and writes nothing', { skip: process.platform !== 'win32' && 'win32 only' }, () => {
  const fx = fixture('install-dry');
  try {
    for (const tool of ['claude', 'codex']) {
      const r = spawnSync(process.execPath, [INSTALL, tool, '--dry-run'], { ...SPAWN, cwd: ROOT, env: fx.env });
      assert.equal(r.status, 0, r.stderr);
      const lines = r.stdout.split(/\r?\n/).filter((l) => l.includes('schtasks /create /f /tn my-flow-models-check'));
      assert.equal(lines.length, 1, `${tool}: ${r.stdout}`);
      const tr = /\/tr (.*) \/sc once \/st 00:00$/.exec(lines[0].trim());
      assert.ok(tr, lines[0]);
      assert.ok(tr[1].startsWith('conhost.exe --headless "'), tr[1]);
      assert.ok(tr[1].endsWith(`--home "${fx.home}"`), tr[1]);
      assert.ok(tr[1].includes(join(ROOT, 'scripts', 'models.mjs')), tr[1]);
      assert.equal(existsSync(join(fx.home, 'config.json')), false, 'dry run writes no config');
    }
  } finally {
    fx.cleanup();
  }
});

test('models status reports the recorded launcher with exists flags and the query result', async () => {
  const fx = fixture('status-launcher');
  try {
    write(fx.home, 'config.json', JSON.stringify({ launcher: { task: 'my-flow-models-check', root: ROOT, node: process.execPath, home: fx.home, registered: '2026-09-10T00:00:00.000Z' } }));
    const dump = join(fx.root, 'q.json');
    const okScript = askScript(fx, 'schtasks-q', SCHTASKS_OK);
    let r = runCli(fx, ['status', '--json'], { MY_FLOW_SCHTASKS: okScript, SCHTASKS_DUMP: dump });
    assert.equal(r.status, 0, r.stderr);
    const l = JSON.parse(r.stdout).launcher;
    assert.equal(l.task, 'my-flow-models-check');
    assert.equal(l.rootExists, true);
    assert.equal(l.nodeExists, true);
    assert.equal(l.query, 'ok');
    assert.deepEqual(JSON.parse(readText(dump)), ['/query', '/tn', 'my-flow-models-check']);
    r = runCli(fx, ['status', '--json'], { MY_FLOW_SCHTASKS: okScript, SCHTASKS_DUMP: dump, SCHTASKS_EXIT: '1' });
    assert.equal(JSON.parse(r.stdout).launcher.query, 'missing');
    assert.match(runCli(fx, ['status'], { MY_FLOW_SCHTASKS: okScript, SCHTASKS_DUMP: dump }).stdout, /launcher: schtasks task my-flow-models-check \(root .* exists:true, node exists:true, registered 2026-09-10T00:00:00.000Z, query ok\)/);
    write(fx.home, 'config.json', JSON.stringify({ codex: { knownModels: [] } }));
    assert.match(runCli(fx, ['status']).stdout, /launcher: primary \(no scheduled task\)/);
  } finally {
    fx.cleanup();
  }
});

// ---------------------------------------------------------------- 7.2 uninstall: task deleted only when no surface remains
test('uninstall --dry-run: keeps the task while another surface remains, deletes it otherwise, writes nothing', { skip: process.platform !== 'win32' && 'win32 only' }, () => {
  const fx = fixture('uninstall-dry');
  try {
    const cfgPath = join(fx.home, 'config.json');
    const both = { claude: { home: fx.claude, knownModels: [] }, codex: { home: fx.codex, agentsDir: join(fx.codex, 'agents'), knownModels: [] }, launcher: { task: 'my-flow-models-check', root: ROOT } };
    writeFileSync(cfgPath, JSON.stringify(both));
    const before = readText(cfgPath);
    let r = spawnSync(process.execPath, [INSTALL, '--uninstall', 'claude', '--dry-run'], { ...SPAWN, cwd: ROOT, env: fx.env });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /scheduled task kept for the other surface/);
    assert.doesNotMatch(r.stdout, /schtasks \/delete/);
    assert.equal(readText(cfgPath), before, 'dry run changes nothing');
    writeFileSync(cfgPath, JSON.stringify({ claude: both.claude, launcher: both.launcher }));
    const only = readText(cfgPath);
    r = spawnSync(process.execPath, [INSTALL, '--uninstall', 'claude', '--dry-run'], { ...SPAWN, cwd: ROOT, env: fx.env });
    assert.equal(r.status, 0, r.stderr);
    const del = r.stdout.split(/\r?\n/).filter((l) => l.includes('schtasks /delete /tn my-flow-models-check /f'));
    assert.equal(del.length, 1, r.stdout);
    assert.doesNotMatch(r.stdout, /kept for the other surface/);
    assert.equal(readText(cfgPath), only, 'dry run changes nothing');
  } finally {
    fx.cleanup();
  }
});
