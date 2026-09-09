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
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
/** CLI flag, then environment variable, then default; non-numeric or non-positive values fall back. */
function numOpt(flag, envVar, fallback) {
  for (const v of [opts[flag], process.env[envVar]]) {
    const n = Number(v);
    if (v !== undefined && v !== '' && Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}
const CHANGES = join(root, 'changes');
const SPECS = join(root, 'specs');
const STATE = join(root, '.my-flow', 'state', 'current-change.json');

const out = (obj, text) => console.log(JSON_OUT ? JSON.stringify(obj, null, 2) : text);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};
const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);
const today = () => new Date().toISOString().slice(0, 10);

function listChanges() {
  if (!existsSync(CHANGES)) return [];
  return readdirSync(CHANGES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive' && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
}
function tasks(dir) {
  const t = read(join(dir, 'tasks.md'));
  if (t === null) return null;
  const done = (t.match(/^\s*- \[x\]/gim) ?? []).length;
  const open = (t.match(/^\s*- \[ \]/gm) ?? []).length;
  return { done, total: done + open };
}
const norm = (s) => (s ?? '').replace(/\r\n/g, '\n').trim();
function artifactState(dir, file) {
  const t = read(join(dir, file));
  if (t === null) return 'missing';
  for (const tpl of [join(CHANGES, '.templates', file), join(TEMPLATES, file)]) {
    if (existsSync(tpl) && norm(read(tpl)) === norm(t)) return 'empty'; // untouched template
  }
  const meaningful = t
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((l) => l.trim() && !/^#/.test(l.trim()));
  return meaningful.length ? 'done' : 'empty';
}
/**
 * Newest mtime (ms) of dir itself and everything under it. Directories count because a copied
 * file keeps its source mtime on Windows (`spec new` copies templates), while the directory's
 * mtime is the moment its entries were created.
 */
function newestMtime(dir) {
  let max = statSync(dir).mtimeMs;
  for (const d of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, d.name);
    max = Math.max(max, d.isDirectory() ? newestMtime(p) : statSync(p).mtimeMs);
  }
  return max;
}
/**
 * Requirements claimed by two or more active changes' delta specs, as
 * [{ cap, req, claims: [{ change, kind }] }]. ADDED / MODIFIED / REMOVED claims come from the
 * requirement headings; RENAMED claims from the `- FROM:` lines. Computed once per process.
 */
const RENAMED_FROM_RE = /^-\s*FROM:\s*`?### Requirement:\s*(.+?)`?\s*$/gm;
let overlapCache = null;
function overlapIndex() {
  if (overlapCache) return overlapCache;
  const claims = new Map(); // `<cap>/<req>` -> { cap, req, claims: [{ change, kind }] }
  const claim = (cap, req, change, kind) => {
    const key = `${cap}/${req}`; // capability names never contain '/'
    if (!claims.has(key)) claims.set(key, { cap, req, claims: [] });
    claims.get(key).claims.push({ change, kind });
  };
  for (const change of listChanges()) {
    const deltaRoot = join(CHANGES, change, 'specs');
    if (!existsSync(deltaRoot)) continue;
    for (const cap of readdirSync(deltaRoot)) {
      const delta = read(join(deltaRoot, cap, 'spec.md'));
      if (!delta) continue;
      for (const kind of ['ADDED', 'MODIFIED', 'REMOVED']) {
        for (const req of splitRequirements(sectionBody(delta, `${kind} Requirements`)).blocks.keys()) claim(cap, req, change, kind);
      }
      for (const m of sectionBody(delta, 'RENAMED Requirements').matchAll(RENAMED_FROM_RE)) claim(cap, m[1].trim(), change, 'RENAMED');
    }
  }
  overlapCache = [...claims.values()].filter((o) => new Set(o.claims.map((c) => c.change)).size >= 2);
  return overlapCache;
}
function overlapText({ cap, req, claims }) {
  const parts = claims.map((c) => `${c.change} (${c.kind})`);
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `overlap: ${cap} "${req}" in changes ${list}`;
}
/**
 * Audit nudges, derived from changes/archive/ alone. For each capability under specs/: sort the
 * archive by name (chronological across days), restart the count at every audit anchor
 * (`^<date>-(?:.*-)?audit-<cap>(?:-abandoned)?$`, so an abandoned audit still records that an
 * audit happened), and count the later directories that carry specs/<cap>/spec.md and do not end
 * in `-abandoned` (their deltas were never merged).
 */
function auditNudges(every) {
  const nudges = [];
  if (!existsSync(SPECS)) return nudges;
  const archiveDir = join(CHANGES, 'archive');
  const archived = existsSync(archiveDir)
    ? readdirSync(archiveDir, { withFileTypes: true })
        .filter((d) => d.isDirectory())
        .map((d) => d.name)
        .sort()
    : [];
  const caps = readdirSync(SPECS, { withFileTypes: true })
    .filter((d) => d.isDirectory() && /^[a-z0-9][a-z0-9-]*$/.test(d.name))
    .map((d) => d.name);
  for (const cap of caps) {
    const anchor = new RegExp(`^\\d{4}-\\d{2}-\\d{2}-(?:.*-)?audit-${cap}(?:-abandoned)?$`);
    let count = 0;
    for (const d of archived) {
      if (anchor.test(d)) count = 0;
      else if (!d.endsWith('-abandoned') && existsSync(join(archiveDir, d, 'specs', cap, 'spec.md'))) count++;
    }
    if (count >= every) nudges.push(`audit suggested: ${cap} (${count} merges since last audit)`);
  }
  return nudges;
}
function setState(change, stage) {
  const state = { change, stage, updated: new Date().toISOString() };
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify(state, null, 2) + '\n');
  return state;
}

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
  setState(name, 'new');
  out({ change: name, dir }, `created changes/${name}/{proposal,design,tasks}.md\nnext: fill proposal.md (interview) -> design.md + tasks.md (mf-plan)`);
  process.exit(0);
}

// ---------------------------------------------------------------- status
if (cmd === 'status' || cmd === undefined) {
  const current = (() => {
    try {
      return JSON.parse(read(STATE) ?? 'null');
    } catch {
      return null;
    }
  })();
  const STALE_DAYS = numOpt('--stale-days', 'MY_FLOW_STALE_DAYS', 14);
  const now = Date.now();
  const names = name ? [name] : listChanges();
  const rowFor = (n) => {
    const dir = join(CHANGES, n);
    if (!existsSync(dir)) return { name: n, missing: true };
    const t = tasks(dir);
    const finished = !!t && t.total > 0 && t.done === t.total; // waiting for archive is not rot
    const mtime = newestMtime(dir);
    const ageDays = Math.max(0, Math.floor((now - mtime) / 86_400_000));
    return {
      name: n,
      current: current?.change === n,
      stage: current?.change === n ? current.stage : undefined,
      tasks: t,
      artifacts: Object.fromEntries(['proposal.md', 'design.md', 'tasks.md'].map((f) => [f.replace('.md', ''), artifactState(dir, f)])),
      deltaSpecs: existsSync(join(dir, 'specs')) ? readdirSync(join(dir, 'specs')).length : 0,
      stale: !finished && ageDays >= STALE_DAYS,
      staleDays: ageDays,
      lastModified: new Date(mtime).toISOString(),
    };
  };
  const rows = names.map(rowFor);
  // Warnings: printed after the rows, and returned verbatim in JSON `warnings`.
  const warnings = [];
  if (current?.change && current.stage !== 'archived') {
    const cur = rows.find((r) => r.name === current.change) ?? rowFor(current.change);
    const simple = existsSync(join(root, 'docs', 'changes', `${current.change}.md`));
    if (cur.missing && !simple) warnings.push(`state: current change "${current.change}" no longer exists under changes/`);
    else if (cur.stale) warnings.push(`state: current change "${current.change}" is stale [${cur.staleDays}d]`);
  }
  for (const o of overlapIndex()) warnings.push(overlapText(o));
  warnings.push(...auditNudges(numOpt(null, 'MY_FLOW_AUDIT_EVERY', 5)));
  const text = rows.length
    ? rows
        .map((r) =>
          r.missing
            ? `${r.name}: (missing)`
            : `${r.name}${r.current ? ` <- current (${r.stage})` : ''}: ${r.tasks ? `${r.tasks.done}/${r.tasks.total} tasks` : 'no tasks.md'}; ` +
              Object.entries(r.artifacts).map(([k, v]) => `${k}=${v}`).join(' ') +
              (r.deltaSpecs ? `; ${r.deltaSpecs} delta spec(s)` : '') +
              (r.stale ? ` [stale ${r.staleDays}d]` : '')
        )
        .join('\n')
    : 'no active changes (changes/ is empty or missing)';
  out({ root, current, changes: rows, warnings }, [text, ...warnings].join('\n'));
  process.exit(0);
}

// ---------------------------------------------------------------- validate
function validateSpecFile(absPath, isDelta) {
  const errors = [];
  const t = read(absPath);
  if (t === null) return errors;
  const path = absPath.startsWith(root) ? absPath.slice(root.length + 1).replace(/\\/g, '/') : absPath;
  const lines = t.split('\n');
  if (isDelta && !/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements/m.test(t)) {
    errors.push(`${path}: delta spec needs at least one "## ADDED|MODIFIED|REMOVED Requirements" section`);
  }
  let req = null;
  let scenarios = 0;
  let needsScenarios = true; // false inside REMOVED / RENAMED sections (name + Reason only)
  const flush = () => {
    if (req && needsScenarios && scenarios === 0) errors.push(`${path}: requirement "${req}" has no "#### Scenario:"`);
  };
  lines.forEach((line, i) => {
    if (/^### Requirement:/.test(line)) {
      flush();
      req = line.replace(/^### Requirement:\s*/, '').trim();
      scenarios = 0;
    } else if (/^#{1,3} Scenario:/.test(line) || /^#{5,} Scenario:/.test(line)) {
      errors.push(`${path}:${i + 1}: scenarios must use exactly four hashes ("#### Scenario:")`);
    } else if (/^#### Scenario:/.test(line)) {
      scenarios++;
      const block = lines.slice(i + 1, i + 12).join('\n');
      if (!/\*\*WHEN\*\*/.test(block) || !/\*\*THEN\*\*/.test(block)) {
        errors.push(`${path}:${i + 1}: scenario needs "- **WHEN**" and "- **THEN**" lines`);
      }
    } else if (/^## /.test(line)) {
      flush();
      req = null;
      needsScenarios = !/^## (REMOVED|RENAMED) Requirements/.test(line);
    }
  });
  flush();
  return errors;
}
function validateChange(n) {
  const dir = join(CHANGES, n);
  const errors = [];
  const warnings = [];
  if (!existsSync(dir)) return { name: n, errors: [`changes/${n} does not exist`], warnings };
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) {
    const state = artifactState(dir, f);
    if (state === 'missing') errors.push(`changes/${n}/${f} is missing`);
    else if (state === 'empty') warnings.push(`changes/${n}/${f} has no content yet`);
  }
  const design = read(join(dir, 'design.md')) ?? '';
  for (const section of ['## Do-Not-Touch', '## Rebuild / Re-run After Change']) {
    if (!design.includes(section)) errors.push(`changes/${n}/design.md is missing the required section "${section}"`);
  }
  const proposal = read(join(dir, 'proposal.md')) ?? '';
  for (const section of ['## Non-Goals', '## Decision Boundaries']) {
    if (proposal && !proposal.includes(section)) warnings.push(`changes/${n}/proposal.md has no "${section}" section`);
  }
  const t = read(join(dir, 'tasks.md')) ?? '';
  t.split('\n').forEach((line, i) => {
    if (/^\s*- \[/.test(line) && !/^\s*- \[(x| )\] \d+\.\d+ /i.test(line)) {
      errors.push(`changes/${n}/tasks.md:${i + 1}: task lines must look like "- [ ] 1.1 <task> and verify <check>"`);
    } else if (/^\s*- \[(x| )\] \d+\.\d+ /i.test(line) && !/\bverif(y|ied|ies|ication)\b/i.test(line)) {
      warnings.push(`changes/${n}/tasks.md:${i + 1}: task does not say how it is verified`);
    }
  });
  const deltaRoot = join(dir, 'specs');
  if (existsSync(deltaRoot)) {
    for (const cap of readdirSync(deltaRoot)) {
      const deltaPath = join(deltaRoot, cap, 'spec.md');
      errors.push(...validateSpecFile(deltaPath, true));
      const r = validateDeltaAgainstMain(n, cap, read(deltaPath));
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }
    // overlaps with other active changes are reported, never resolved (warnings only)
    for (const o of overlapIndex()) if (o.claims.some((c) => c.change === n)) warnings.push(overlapText(o));
  }
  return { name: n, errors, warnings };
}

/**
 * Cross-check a delta spec against the main spec it will be merged into:
 *   MODIFIED  -> requirement must exist in specs/<cap>/spec.md
 *   REMOVED   -> requirement must exist, and the entry must carry a **Reason** (Migration is advisory)
 *   RENAMED   -> FROM must exist; archive does not merge renames automatically
 *   ADDED     -> requirement must NOT already exist (otherwise it should be MODIFIED)
 */
function validateDeltaAgainstMain(n, cap, deltaText) {
  const errors = [];
  const warnings = [];
  if (!deltaText) return { errors, warnings };
  const where = `changes/${n}/specs/${cap}/spec.md`;
  const mainText = read(join(SPECS, cap, 'spec.md'));
  const mainNames = mainText ? new Set(splitRequirements(mainText).blocks.keys()) : new Set();
  const names = (header) => [...splitRequirements(sectionBody(deltaText, header)).blocks.entries()];

  for (const [req] of names('MODIFIED Requirements')) {
    if (!mainText) errors.push(`${where}: MODIFIED "${req}" but specs/${cap}/spec.md does not exist`);
    else if (!mainNames.has(req)) errors.push(`${where}: MODIFIED "${req}" is not in specs/${cap}/spec.md (use ADDED, or fix the name)`);
  }
  for (const [req, block] of names('REMOVED Requirements')) {
    if (!mainText) errors.push(`${where}: REMOVED "${req}" but specs/${cap}/spec.md does not exist`);
    else if (!mainNames.has(req)) errors.push(`${where}: REMOVED "${req}" is not in specs/${cap}/spec.md`);
    if (!/\*\*Reason\*\*/.test(block)) errors.push(`${where}: REMOVED "${req}" needs a "**Reason**:" line`);
    if (!/\*\*Migration\*\*/.test(block)) warnings.push(`${where}: REMOVED "${req}" has no "**Migration**:" line`);
  }
  for (const [req] of names('ADDED Requirements')) {
    if (mainNames.has(req)) warnings.push(`${where}: ADDED "${req}" already exists in specs/${cap}/spec.md; use MODIFIED to replace it`);
  }
  const renamed = sectionBody(deltaText, 'RENAMED Requirements');
  if (renamed.trim()) {
    for (const m of renamed.matchAll(RENAMED_FROM_RE)) {
      if (!mainNames.has(m[1].trim())) errors.push(`${where}: RENAMED FROM "${m[1].trim()}" is not in specs/${cap}/spec.md`);
    }
    warnings.push(`${where}: RENAMED requirements are not merged automatically by "spec archive"; apply the rename by hand`);
  }
  return { errors, warnings };
}
if (cmd === 'validate') {
  const names = name ? [name] : listChanges();
  const results = names.map(validateChange);
  if (existsSync(SPECS)) {
    for (const cap of readdirSync(SPECS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const errs = validateSpecFile(join(SPECS, cap.name, 'spec.md'), false);
      if (errs.length) results.push({ name: `specs/${cap.name}`, errors: errs, warnings: [] });
    }
  }
  const failed = results.filter((r) => r.errors.length);
  const text = results
    .map((r) => [`${r.errors.length ? 'FAIL' : 'ok  '} ${r.name}`, ...r.errors.map((e) => `  error: ${e}`), ...r.warnings.map((w) => `  warn:  ${w}`)].join('\n'))
    .join('\n');
  out({ ok: failed.length === 0, results }, `${text}\n${results.length - failed.length} passed, ${failed.length} failed`);
  process.exit(failed.length ? 1 : 0);
}

// ---------------------------------------------------------------- archive
function splitRequirements(text) {
  // returns { head, blocks: Map<name, text> } for a "## Requirements" style body
  const blocks = new Map();
  const re = /^### Requirement:\s*(.+)$/gm;
  const idx = [];
  let m;
  while ((m = re.exec(text))) idx.push({ name: m[1].trim(), start: m.index });
  const head = idx.length ? text.slice(0, idx[0].start) : text;
  idx.forEach((it, i) => {
    const end = i + 1 < idx.length ? idx[i + 1].start : text.length;
    blocks.set(it.name, text.slice(it.start, end).trimEnd() + '\n\n');
  });
  return { head, blocks };
}
function sectionBody(text, header) {
  const re = new RegExp(`^## ${header}\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}
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
    const cur = JSON.parse(read(STATE) ?? 'null');
    if (cur?.change === name) setState(name, 'archived');
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
  const state = setState(name, stageArg);
  out(state, `${name}: stage ${stageArg} (updated ${state.updated})`);
  process.exit(0);
}

fail(
  'usage: spec.mjs <new <name> | status [name] [--stale-days n] | validate [name] | archive <name> | abandon <name> [--reason "..."] | stage <name> <stage>> [--json] [--force] [--root dir]'
);
