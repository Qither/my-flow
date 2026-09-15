/**
 * Shared helpers for the node:test suites. Every test gets its own temp root; scripts and
 * hooks are exercised as child processes exactly like Claude Code / Codex run them.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const SPEC = join(ROOT, 'scripts', 'spec.mjs');
export const HOOK = join(ROOT, 'hooks', 'completion-guard.mjs');
export const TEMPLATES = join(ROOT, 'templates', 'change');

export function makeTmp(prefix) {
  // realpath: os.tmpdir() may be an 8.3 short path on Windows; scripts print resolved paths
  return realpathSync.native(mkdtempSync(join(tmpdir(), `my-flow-${prefix}-`)));
}

export function cleanup(dir) {
  try {
    rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  } catch {
    /* never fail a test on cleanup (Windows EBUSY on .git objects) */
  }
}

export function write(root, rel, text) {
  const p = join(root, rel);
  mkdirSync(dirname(p), { recursive: true });
  writeFileSync(p, text, 'utf8');
  return p;
}

export const readText = (p) => readFileSync(p, 'utf8').replace(/\r\n/g, '\n');

export function cleanEnv(extra = {}) {
  const env = { ...process.env };
  for (const k of ['MY_FLOW_SKIP_HOOKS', 'MY_FLOW_EXECUTE_GUARD_TTL_HOURS', 'GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE']) delete env[k];
  return { ...env, ...extra };
}

const SPAWN = { encoding: 'utf8', timeout: 20000, windowsHide: true };

export function runSpec(root, args, env = cleanEnv()) {
  const r = spawnSync(process.execPath, [SPEC, ...args, '--root', root], { ...SPAWN, cwd: root, env });
  return { status: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
}

export function runSpecJson(root, args, env) {
  const r = runSpec(root, [...args, '--json'], env);
  return { ...r, json: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

/** Runs the Stop hook with a JSON payload on stdin (or `raw` verbatim) and parses its output. */
export function runHook(cwd, input = {}, env = cleanEnv(), raw) {
  const r = spawnSync(process.execPath, [HOOK], {
    ...SPAWN,
    cwd,
    env,
    input: raw ?? JSON.stringify({ cwd, ...input }),
  });
  assert.equal(r.status, 0, `hook exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}

export function hasGit() {
  return spawnSync('git', ['--version'], SPAWN).status === 0;
}

export function gitInit(dir) {
  const opts = { ...SPAWN, cwd: dir };
  let r = spawnSync('git', ['init', '-q', '-b', 'main'], opts);
  assert.equal(r.status, 0, r.stderr);
  r = spawnSync(
    'git',
    ['-c', 'user.email=t@example.com', '-c', 'user.name=t', '-c', 'commit.gpgsign=false', 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init'],
    opts
  );
  assert.equal(r.status, 0, r.stderr);
}

export const iso = (offsetMs = 0) => new Date(Date.now() + offsetMs).toISOString();
export const HOUR = 3600 * 1000;

export function writeState(root, state) {
  write(root, '.my-flow/state/current-change.json', JSON.stringify(state, null, 2) + '\n');
}

export function readState(root) {
  return JSON.parse(readText(join(root, '.my-flow', 'state', 'current-change.json')));
}

export const CONTEXT_HOOK = join(ROOT, 'hooks', 'session-context.mjs');

/** Runs the SessionStart hook with a JSON payload on stdin and parses its output. */
export function runContextHook(cwd, input = {}, env = cleanEnv()) {
  // Session binding tests must not inherit the caller's real model-routing homes.
  // Keep the routing hook active with a fresh throttled state; its launcher has its own suite.
  const homes = join(cwd, '.my-flow', 'test-homes');
  for (const name of ['my-flow', 'codex', 'claude']) mkdirSync(join(homes, name), { recursive: true });
  const state = join(homes, 'my-flow', 'models-state.json');
  if (!existsSync(state)) writeFileSync(state, JSON.stringify({ version: 1, lastSpawn: { at: new Date().toISOString() }, pending: { line: 'test-only model routing state' } }));
  const recorder = join(homes, 'scheduler.mjs');
  writeFileSync(recorder, `import { appendFileSync } from 'node:fs';\nappendFileSync(${JSON.stringify(join(homes, 'scheduler-calls.jsonl'))}, JSON.stringify(process.argv.slice(2)) + '\\n');\n`);
  const hookEnv = { ...env, MY_FLOW_HOME: join(homes, 'my-flow'), CODEX_HOME: join(homes, 'codex'), CLAUDE_CONFIG_DIR: join(homes, 'claude'), MY_FLOW_SCHTASKS: recorder };
  const r = spawnSync(process.execPath, [CONTEXT_HOOK], { ...SPAWN, cwd, env: hookEnv, input: JSON.stringify({ cwd, ...input }) });
  assert.equal(r.status, 0, `session-context exited ${r.status}: ${r.stderr}`);
  return JSON.parse(r.stdout);
}
