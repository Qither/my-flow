#!/usr/bin/env node
/**
 * my-flow spec helper: the intent layer without any external tool.
 *
 *   node scripts/spec.mjs new <name>            create changes/<name>/{proposal,design,tasks}.md from templates
 *   node scripts/spec.mjs status [name] [--json] list changes, ticked/total tasks, artifact state
 *   node scripts/spec.mjs validate [name] [--json]  structural checks (all active changes when no name)
 *   node scripts/spec.mjs archive <name> [--force]  move to changes/archive/<date>-<name>/ and merge delta specs
 *   node scripts/spec.mjs abandon <name> [--reason "..."] [--force]  move to changes/archive/<date>-<name>-abandoned/, merge nothing
 *   node scripts/spec.mjs stage <name> <stage> [--force]  set .my-flow/state/current-change.json (refreshes `updated`)
 *
 * Layout (borrowed from OpenSpec, no CLI required):
 *   specs/<capability>/spec.md                       current truth
 *   changes/<name>/proposal.md|design.md|tasks.md    intent for one change
 *   changes/<name>/specs/<capability>/spec.md        delta: ## ADDED|MODIFIED|REMOVED Requirements
 *   changes/archive/<YYYY-MM-DD>-<name>/             archived changes (deltas merged into specs/)
 *   changes/archive/<YYYY-MM-DD>-<name>-abandoned/   abandoned changes (deltas never merged)
 *
 * Options: --root <project dir> (default: cwd), --stale-days <n> (status; default 14, env MY_FLOW_STALE_DAYS)
 *
 * The status and validate logic lives in scripts/lib/intent.mjs so the dashboard server can call
 * it in-process; this file is the CLI over that library plus the new / archive / abandon / stage
 * commands.
 */
import { cpSync, existsSync, mkdirSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listChanges, read, readState, sectionBody, setState, splitRequirements, statusReport, tasks, today, validateReport } from './lib/intent.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates', 'change');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const FORCE = argv.includes('--force');
let root = process.cwd();
const opts = {}; // value-taking flags other than --root
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') root = resolve(argv[++i]);
  else if (argv[i] === '--stale-days' || argv[i] === '--reason') opts[argv[i]] = argv[++i];
  else if (!argv[i].startsWith('--')) positional.push(argv[i]);
}
const [cmd, name, stageArg] = positional;
const CHANGES = join(root, 'changes');
const SPECS = join(root, 'specs');

const out = (obj, text) => console.log(JSON_OUT ? JSON.stringify(obj, null, 2) : text);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// ---------------------------------------------------------------- new
if (cmd === 'new') {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) fail('usage: spec.mjs new <kebab-case-name>');
  const dir = join(CHANGES, name);
  if (existsSync(dir)) fail(`changes/${name} already exists`);
  mkdirSync(dir, { recursive: true });
  const projectTemplates = join(CHANGES, '.templates');
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) {
    const src = existsSync(join(projectTemplates, f)) ? join(projectTemplates, f) : join(TEMPLATES, f);
    cpSync(src, join(dir, f));
  }
  setState(root, name, 'new');
  out({ change: name, dir }, `created changes/${name}/{proposal,design,tasks}.md\nnext: fill proposal.md (interview) -> design.md + tasks.md (mf-plan)`);
  process.exit(0);
}

// ---------------------------------------------------------------- status
if (cmd === 'status' || cmd === undefined) {
  const r = statusReport(root, { name, staleDays: opts['--stale-days'] });
  out(r.json, r.text);
  process.exit(0);
}

// ---------------------------------------------------------------- validate
if (cmd === 'validate') {
  const r = validateReport(root, { name });
  out(r.json, r.text);
  process.exit(r.failed ? 1 : 0);
}

// ---------------------------------------------------------------- archive
/**
 * Provenance marker: one `<!-- via: <date>-<change> -->` line directly after the requirement
 * heading. Every existing marker anywhere in the block is dropped first (a MODIFIED delta is
 * often a copy of the current block, old marker included), so a merged block carries exactly one.
 */
const VIA_LINE_RE = /^<!-- via: .+ -->\s*$/;
function stampVia(block, via) {
  const lines = block.split('\n').filter((l) => !VIA_LINE_RE.test(l));
  lines.splice(1, 0, `<!-- via: ${via} -->`);
  return lines.join('\n');
}
function mergeDelta(cap, deltaText, log, via) {
  const target = join(SPECS, cap, 'spec.md');
  let current = read(target);
  if (current === null) {
    const purpose = sectionBody(deltaText, 'Purpose').trim();
    current = `# ${cap} Specification\n\n## Purpose\n${purpose || 'TBD'}\n\n## Requirements\n\n`;
  }
  if (!/^## Requirements/m.test(current)) current = current.trimEnd() + '\n\n## Requirements\n\n';
  const reqStart = current.search(/^## Requirements/m);
  const before = current.slice(0, reqStart);
  const { head, blocks } = splitRequirements(current.slice(reqStart));
  for (const [, b] of splitRequirements(sectionBody(deltaText, 'ADDED Requirements')).blocks) {
    const n = /^### Requirement:\s*(.+)$/m.exec(b)[1].trim();
    if (blocks.has(n)) log.push(`warn: ${cap}: ADDED requirement "${n}" already exists; replaced`);
    blocks.set(n, stampVia(b, via));
  }
  for (const [n, b] of splitRequirements(sectionBody(deltaText, 'MODIFIED Requirements')).blocks) {
    if (!blocks.has(n)) log.push(`warn: ${cap}: MODIFIED requirement "${n}" not found; appended`);
    blocks.set(n, stampVia(b, via));
  }
  for (const [n] of splitRequirements(sectionBody(deltaText, 'REMOVED Requirements')).blocks) {
    if (blocks.delete(n)) log.push(`${cap}: removed requirement "${n}"`);
    else log.push(`warn: ${cap}: REMOVED requirement "${n}" not found`);
  }
  if (/^## RENAMED Requirements/m.test(deltaText)) log.push(`warn: ${cap}: RENAMED section is not merged automatically; apply by hand`);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, before + head.trimEnd() + '\n\n' + [...blocks.values()].join(''), 'utf8');
  log.push(`merged delta into specs/${cap}/spec.md`);
}
if (cmd === 'archive') {
  if (!name) fail('usage: spec.mjs archive <name> [--force]');
  const dir = join(CHANGES, name);
  if (!existsSync(dir)) fail(`changes/${name} does not exist`);
  const t = tasks(dir);
  if (!FORCE) {
    if (!t || t.total === 0) fail('refusing to archive: tasks.md has no tasks (use --force to override)');
    if (t.done !== t.total) fail(`refusing to archive: ${t.total - t.done} task(s) still unticked (use --force to override)`);
    const verifyDir = join(root, '.my-flow', 'verify');
    const pass =
      existsSync(verifyDir) &&
      readdirSync(verifyDir).some((f) => f.startsWith(`${name}-`) && /Verdict:\s*PASS/.test(read(join(verifyDir, f)) ?? ''));
    if (!pass) fail('refusing to archive: no PASS verification report under .my-flow/verify/ (run verify, or use --force)');
  }
  const log = [];
  const deltaRoot = join(dir, 'specs');
  if (existsSync(deltaRoot)) {
    for (const cap of readdirSync(deltaRoot)) {
      const d = read(join(deltaRoot, cap, 'spec.md'));
      if (d) mergeDelta(cap, d, log, `${today()}-${name}`);
    }
  }
  const dest = moveToArchive(name, '', log);
  out({ archived: name, dest, log }, log.join('\n'));
  process.exit(0);
}
/** Moves changes/<name> to changes/archive/<date>-<name><suffix>; state becomes `archived` only when that change was current. */
function moveToArchive(name, suffix, log) {
  const base = `${today()}-${name}${suffix}`;
  const dest = join(CHANGES, 'archive', base);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(join(CHANGES, name), dest);
  log.push(`moved changes/${name} -> changes/archive/${base}`);
  try {
    if (readState(root)?.change === name) setState(root, name, 'archived');
  } catch {
    /* ignore */
  }
  return dest;
}

// ---------------------------------------------------------------- abandon
if (cmd === 'abandon') {
  if (!name) fail('usage: spec.mjs abandon <name> [--reason "..."] [--force]');
  const dir = join(CHANGES, name);
  if (!existsSync(dir)) fail(`changes/${name} does not exist`);
  const proposalPath = join(dir, 'proposal.md');
  let proposal = read(proposalPath) ?? '';
  const reasonLine = () => /^\*\*Reason\*\*:?.*$/m.exec(sectionBody(proposal, 'Abandoned'))?.[0];
  if (opts['--reason'] && !reasonLine()) {
    proposal = `${proposal.trimEnd()}\n\n## Abandoned\n\n**Reason**: ${opts['--reason']}\n`;
    writeFileSync(proposalPath, proposal, 'utf8');
  }
  if (!reasonLine()) {
    fail(`refusing to abandon: changes/${name}/proposal.md has no "## Abandoned" section with a "**Reason**:" line (add one, or pass --reason "...")`);
  }
  const t = tasks(dir);
  if (!FORCE && t && t.total > 0 && t.done === t.total) {
    fail(`refusing to abandon: every task in changes/${name}/tasks.md is ticked; this is an archive, not an abandonment (run "spec archive ${name}", or use --force)`);
  }
  // Delta specs are deliberately never read: nothing from an abandoned change reaches specs/.
  const log = [`abandoned changes/${name} (${reasonLine()})`];
  const dest = moveToArchive(name, '-abandoned', log);
  out({ abandoned: name, dest, log }, log.join('\n'));
  process.exit(0);
}

// ---------------------------------------------------------------- stage
const STAGES = ['new', 'interview', 'mf-plan', 'execute', 'done', 'archived'];
if (cmd === 'stage') {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name) || !stageArg) fail(`usage: spec.mjs stage <kebab-case-name> <${STAGES.join('|')}> [--force]`);
  if (!STAGES.includes(stageArg)) fail(`unknown stage "${stageArg}" (expected one of: ${STAGES.join(', ')})`);
  const known = existsSync(join(CHANGES, name)) || existsSync(join(root, 'docs', 'changes', `${name}.md`));
  if (!known && !FORCE) fail(`changes/${name} does not exist (use --force to set the state anyway)`);
  const state = setState(root, name, stageArg);
  out(state, `${name}: stage ${stageArg} (updated ${state.updated})`);
  process.exit(0);
}

fail(
  'usage: spec.mjs <new <name> | status [name] [--stale-days n] | validate [name] | archive <name> | abandon <name> [--reason "..."] | stage <name> <stage>> [--json] [--force] [--root dir]'
);
