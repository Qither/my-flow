#!/usr/bin/env node
/**
 * my-flow model routing CLI.
 *
 *   node scripts/models.mjs status [--json]
 *   --home <dir> (any command) uses <dir> instead of MY_FLOW_HOME / ~/.my-flow; the scheduled task passes it
 *   node scripts/models.mjs analyze [--provider claude|codex] [--timeout ms] [--dry-run]
 *   node scripts/models.mjs apply
 *   node scripts/models.mjs reset
 *   node scripts/models.mjs check [--quiet]      internal: what the SessionStart hook spawns
 *
 * State lives under MY_FLOW_HOME (default ~/.my-flow); see scripts/lib/models.mjs.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  ROLES,
  acquireLock,
  appendLog,
  applyRoles,
  check,
  filePaths,
  launcherStatus,
  lockHolder,
  probeVersions,
  readEffective,
  readMainModels,
  readModels,
  readState,
  resetSurfaces,
  resolveAllowed,
  runAnalysis,
  validateRecommendation,
  writeModels,
  writeState,
} from './lib/models.mjs';

function parseArgs(argv) {
  const opts = { json: false, quiet: false, dryRun: false, provider: null, timeout: 180000, home: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') opts.json = true;
    else if (a === '--quiet') opts.quiet = true;
    else if (a === '--dry-run') opts.dryRun = true;
    else if (a === '--provider') opts.provider = argv[++i] ?? null;
    else if (a === '--timeout') opts.timeout = Number(argv[++i]) || opts.timeout;
    else if (a === '--home') opts.home = argv[++i] ?? null;
  }
  return opts;
}

const say = (level, msg) => {
  appendLog(level, msg);
  console.log(msg);
};

function withLock(fn) {
  const release = acquireLock();
  if (!release) {
    const holder = lockHolder();
    console.error(`analysis already running (pid ${holder?.pid ?? '?'})`);
    return 1;
  }
  try {
    return fn();
  } finally {
    release();
  }
}

function cliStatus({ json }) {
  const state = readState();
  const models = readModels();
  const effective = readEffective({ recordedRoot: state.claudePluginRoot ?? null });
  const p = filePaths();
  const launcher = launcherStatus();
  const doc = {
    home: p.home,
    launcher,
    override: models ? { updated: models.updated ?? null, analyzedBy: models.analyzedBy ?? null, cliVersions: models.cliVersions ?? null, roles: models.roles, reason: models.reason ?? '' } : null,
    seen: state.seen ?? null,
    lastSpawn: state.lastSpawn ?? null,
    lastCheck: state.lastCheck ?? null,
    applied: state.applied ?? null,
    pending: state.pending ?? null,
    analysis: state.analysis ?? null,
    surfaces: { claude: effective.claude?.root ?? null, codex: effective.codex?.dir ?? null },
    effective: effective.roles,
    lock: existsSync(p.lock) ? lockHolder() : null,
  };
  if (json) {
    console.log(JSON.stringify(doc, null, 2));
    return 0;
  }
  console.log(`my-flow home: ${doc.home}`);
  console.log(`override: ${models ? `${models.analyzedBy ?? '?'} at ${models.updated ?? '?'} (${p.models})` : 'none (baseline: inherit)'}`);
  console.log(`seen: ${state.seen ? `claude ${state.seen.cliVersions?.claude ?? '-'} / codex ${state.seen.cliVersions?.codex ?? '-'}` : 'never checked'}`);
  console.log(`surfaces: claude ${doc.surfaces.claude ?? 'not found'}; codex ${doc.surfaces.codex ?? 'not found'}`);
  for (const role of ROLES) {
    const e = effective.roles[role];
    const c = e.claude ? e.claude.model ?? '(no model line)' : '-';
    const x = e.codex ? `${e.codex.model ?? 'inherit'}@${e.codex.effort ?? 'default'}` : '-';
    console.log(`  ${role.padEnd(10)} claude ${c.padEnd(12)} codex ${x}`);
  }
  console.log(
    launcher.launcher === 'schtasks'
      ? `launcher: schtasks task ${launcher.task} (root ${launcher.root} exists:${launcher.rootExists}, node exists:${launcher.nodeExists}, registered ${launcher.registered}, query ${launcher.query})`
      : 'launcher: primary (no scheduled task)'
  );
  if (state.pending?.line) console.log(`pending: ${state.pending.line}`);
  if (doc.lock) console.log(`lock: pid ${doc.lock.pid} since ${doc.lock.started}`);
  return 0;
}

function cliAnalyze({ provider, timeout, dryRun }) {
  return withLock(() => {
    const allowed = resolveAllowed();
    const cliVersions = probeVersions();
    const mainModels = readMainModels();
    const previous = readModels();
    const providers = provider ? [provider] : ['claude', 'codex'].filter((p) => cliVersions[p] !== null);
    if (!providers.length) {
      console.error('no CLI available for the analysis (claude / codex not found)');
      return 1;
    }
    const result = runAnalysis({ providers, allowed, cliVersions, mainModels, previous, timeout, log: dryRun ? () => {} : appendLog });
    if (!result.ok) {
      console.error(`analysis failed: ${result.reason}`);
      return 1;
    }
    const doc = { version: 1, updated: new Date().toISOString(), analyzedBy: result.provider, cliVersions, mainModels, roles: result.roles, reason: result.reason };
    console.log(JSON.stringify(doc, null, 2));
    if (dryRun) {
      console.log('(dry run: nothing written)');
      return 0;
    }
    const { models } = filePaths();
    writeModels(doc);
    const state = readState();
    applyRoles(result.roles, { log: appendLog, recordedRoot: state.claudePluginRoot ?? null });
    const after = readState();
    after.seen = { cliVersions, mainModels };
    after.analysis = { attempts: 0, lastError: null };
    after.pending = { line: `model routing updated by "models analyze" (${result.provider})`, at: new Date().toISOString() };
    writeState(after);
    say('info', `analyze: override written to ${models} and applied`);
    return 0;
  });
}

function cliApply() {
  return withLock(() => {
    const models = readModels();
    if (!models) {
      console.error('no override (models.json missing); nothing to apply. Run "models analyze" first.');
      return 1;
    }
    const v = validateRecommendation({ roles: models.roles, reason: models.reason }, resolveAllowed());
    if (!v.ok) {
      console.error(`override invalid, not applied: ${v.errors.join('; ')}`);
      return 1;
    }
    const state = readState();
    const r = applyRoles(v.roles, { log: appendLog, recordedRoot: state.claudePluginRoot ?? null });
    const after = readState();
    const line = r.written.length ? `model routing re-applied to ${r.written.length} file(s)` : 'model routing unchanged (override already applied)';
    after.pending = { line, at: new Date().toISOString() };
    writeState(after);
    say('info', r.written.length ? `re-applied: ${r.written.join(', ')}` : 'unchanged');
    return 0;
  });
}

function cliReset() {
  return withLock(() => {
    resetSurfaces({ log: appendLog });
    console.log('model routing reset to baseline (inherit)');
    return 0;
  });
}

export function main(argv = process.argv.slice(2)) {
  const [cmd, ...rest] = argv;
  const opts = parseArgs(rest);
  if (opts.home) process.env.MY_FLOW_HOME = resolve(opts.home); // before any library call reads the home
  if (cmd === 'status') return cliStatus(opts);
  if (cmd === 'analyze') return cliAnalyze(opts);
  if (cmd === 'apply') return cliApply();
  if (cmd === 'reset') return cliReset();
  if (cmd === 'check') return check({ quiet: opts.quiet, providers: opts.provider ? [opts.provider] : null, timeout: opts.timeout });
  console.error('usage: models.mjs status [--json] | analyze [--provider claude|codex] [--timeout ms] [--dry-run] | apply | reset | check [--quiet]');
  return 1;
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  process.exit(main());
}
