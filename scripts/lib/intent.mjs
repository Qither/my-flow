/**
 * my-flow intent library: the status and validate logic of the intent layer, shared by the
 * `spec.mjs` CLI and any in-process caller such as the dashboard server.
 *
 * Contract (specs/spec-helper, "Shared status and validate library"):
 *   - every function that touches the project takes `root` explicitly; nothing reads
 *     process.argv, nothing calls process.exit, nothing keeps state between calls;
 *   - `statusReport` / `validateReport` return both the JSON value and the exact text the CLI
 *     prints, from one code path, so the two renderings cannot diverge.
 *
 * `read(absPath)`, `tasks(dir)` and `newestMtime(dir)` take the path they operate on rather
 * than the root: they never closed over a module constant, and their callers already hold the
 * absolute path. Every other filesystem function takes `root` first.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeFileAtomic } from './intent-io.mjs';
import { changeIndex } from './intent-state.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', '..', 'templates', 'change');
const changesDir = (root) => join(root, 'changes');
const specsDir = (root) => join(root, 'specs');
const statePath = (root) => join(root, '.my-flow', 'state', 'current-change.json');

/** Option value, then environment variable, then default; non-numeric or non-positive values fall back. */
export function numOpt(flag, envVar, fallback, opts = {}) {
  for (const v of [flag === null ? undefined : opts[flag], process.env[envVar]]) {
    const n = Number(v);
    if (v !== undefined && v !== '' && Number.isFinite(n) && n > 0) return n;
  }
  return fallback;
}

export const read = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);
export const today = () => new Date().toISOString().slice(0, 10);
export const norm = (s) => (s ?? '').replace(/\r\n/g, '\n').trim();

export function listChanges(root) {
  const CHANGES = changesDir(root);
  if (!existsSync(CHANGES)) return [];
  return readdirSync(CHANGES, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive' && !d.name.startsWith('.') && !d.name.startsWith('_'))
    .map((d) => d.name)
    .sort();
}
export function tasks(dir) {
  const t = read(join(dir, 'tasks.md'));
  if (t === null) return null;
  const done = (t.match(/^\s*- \[x\]/gim) ?? []).length;
  const open = (t.match(/^\s*- \[ \]/gm) ?? []).length;
  return { done, total: done + open };
}
export function artifactState(root, dir, file) {
  const t = read(join(dir, file));
  if (t === null) return 'missing';
  for (const tpl of [join(changesDir(root), '.templates', file), join(TEMPLATES, file)]) {
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
export function newestMtime(dir) {
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
 * requirement headings; RENAMED claims from the `- FROM:` lines. Computed on every call so a
 * long-lived process sees deltas added after the previous call.
 */
const RENAMED_FROM_RE = /^-\s*FROM:\s*`?### Requirement:\s*(.+?)`?\s*$/gm;
export function overlapIndex(root) {
  const CHANGES = changesDir(root);
  const claims = new Map(); // `<cap>/<req>` -> { cap, req, claims: [{ change, kind }] }
  const claim = (cap, req, change, kind) => {
    const key = `${cap}/${req}`; // capability names never contain '/'
    if (!claims.has(key)) claims.set(key, { cap, req, claims: [] });
    claims.get(key).claims.push({ change, kind });
  };
  for (const change of listChanges(root)) {
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
  return [...claims.values()].filter((o) => new Set(o.claims.map((c) => c.change)).size >= 2);
}
export function overlapText({ cap, req, claims }) {
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
export function auditNudges(root, every) {
  const SPECS = specsDir(root);
  const nudges = [];
  if (!existsSync(SPECS)) return nudges;
  const archiveDir = join(changesDir(root), 'archive');
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
/** Parsed `.my-flow/state/current-change.json`, or null when missing or unreadable (fail open). */
export function readState(root) {
  try {
    return JSON.parse(read(statePath(root)) ?? 'null');
  } catch {
    return null;
  }
}
export function setState(root, change, stage) {
  const STATE = statePath(root);
  const state = { change, stage, updated: new Date().toISOString() };
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileAtomic(STATE, JSON.stringify(state, null, 2) + '\n'); // C-09: single-file write under the caller's lock
  return state;
}

// ---------------------------------------------------------------- requirements
export function splitRequirements(text) {
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
export function sectionBody(text, header) {
  const re = new RegExp(`^## ${header}\\s*$`, 'm');
  const m = re.exec(text);
  if (!m) return '';
  const rest = text.slice(m.index + m[0].length);
  const next = /^## /m.exec(rest);
  return next ? rest.slice(0, next.index) : rest;
}

// ---------------------------------------------------------------- validate
export function validateSpecFile(root, absPath, isDelta) {
  const t = read(absPath);
  if (t === null) return [];
  const path = absPath.startsWith(root) ? absPath.slice(root.length + 1).replace(/\\/g, '/') : absPath;
  return validateSpecText(t, path, isDelta);
}
/** The same structural checks over text that is not on disk yet, so archive can validate its output. */
export function validateSpecText(text, path, isDelta) {
  const errors = [];
  const t = norm(text) + '\n';
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
export function validateChange(root, n) {
  const dir = join(changesDir(root), n);
  const errors = [];
  const warnings = [];
  if (!existsSync(dir)) return { name: n, errors: [`changes/${n} does not exist`], warnings };
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) {
    const state = artifactState(root, dir, f);
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
      errors.push(...validateSpecFile(root, deltaPath, true));
      const r = validateDeltaAgainstMain(root, n, cap, read(deltaPath));
      errors.push(...r.errors);
      warnings.push(...r.warnings);
    }
    // overlaps with other active changes are reported, never resolved (warnings only)
    for (const o of overlapIndex(root)) if (o.claims.some((c) => c.change === n)) warnings.push(overlapText(o));
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
export function validateDeltaAgainstMain(root, n, cap, deltaText) {
  const errors = [];
  const warnings = [];
  if (!deltaText) return { errors, warnings };
  const where = `changes/${n}/specs/${cap}/spec.md`;
  const mainText = read(join(specsDir(root), cap, 'spec.md'));
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

// ---------------------------------------------------------------- reports
/**
 * `spec status [name]`: `{ json, text }`, where `json` is the object printed with --json and
 * `text` the human rendering. `staleDays` / `auditEvery` behave like the CLI flag values: when
 * absent, the environment variable and then the default apply.
 */
export function statusReport(root, { name, staleDays, auditEvery } = {}) {
  const CHANGES = changesDir(root);
  const current = readState(root);
  const STALE_DAYS = numOpt('--stale-days', 'MY_FLOW_STALE_DAYS', 14, { '--stale-days': staleDays });
  const now = Date.now();
  const names = name ? [name] : listChanges(root);
  const index = changeIndex(root); // additive identity fields (C-02); the existing keys are untouched
  const rowFor = (n) => {
    const dir = join(CHANGES, n);
    if (!existsSync(dir)) return { name: n, missing: true };
    const t = tasks(dir);
    const entry = index.entries.find((e) => e.location === 'active' && e.dirName === n);
    const finished = !!t && t.total > 0 && t.done === t.total; // waiting for archive is not rot
    const mtime = newestMtime(dir);
    const ageDays = Math.max(0, Math.floor((now - mtime) / 86_400_000));
    return {
      name: n,
      id: entry?.id ?? null,
      schemaVersion: entry?.schemaVersion ?? 1,
      current: current?.change === n,
      stage: current?.change === n ? current.stage : undefined,
      tasks: t,
      artifacts: Object.fromEntries(['proposal.md', 'design.md', 'tasks.md'].map((f) => [f.replace('.md', ''), artifactState(root, dir, f)])),
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
  for (const o of overlapIndex(root)) warnings.push(overlapText(o));
  warnings.push(...auditNudges(root, numOpt('--audit-every', 'MY_FLOW_AUDIT_EVERY', 5, { '--audit-every': auditEvery })));
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
  return { json: { root, current, changes: rows, warnings, diagnostics: index.diagnostics }, text: [text, ...warnings].join('\n') };
}
/**
 * `spec validate [name]`: `{ json, text, failed }`, where `failed` is the number of results
 * carrying errors (the CLI exits 1 when it is non-zero).
 */
export function validateReport(root, { name } = {}) {
  const SPECS = specsDir(root);
  const names = name ? [name] : listChanges(root);
  const results = names.map((n) => validateChange(root, n));
  if (existsSync(SPECS)) {
    for (const cap of readdirSync(SPECS, { withFileTypes: true }).filter((d) => d.isDirectory())) {
      const errs = validateSpecFile(root, join(SPECS, cap.name, 'spec.md'), false);
      if (errs.length) results.push({ name: `specs/${cap.name}`, errors: errs, warnings: [] });
    }
  }
  const failed = results.filter((r) => r.errors.length);
  const text = results
    .map((r) => [`${r.errors.length ? 'FAIL' : 'ok  '} ${r.name}`, ...r.errors.map((e) => `  error: ${e}`), ...r.warnings.map((w) => `  warn:  ${w}`)].join('\n'))
    .join('\n');
  return { json: { ok: failed.length === 0, results }, text: `${text}\n${results.length - failed.length} passed, ${failed.length} failed`, failed: failed.length };
}
