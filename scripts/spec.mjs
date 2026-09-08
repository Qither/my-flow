#!/usr/bin/env node
/**
 * my-flow spec helper: the intent layer without any external tool.
 *
 *   node scripts/spec.mjs new <name>            create changes/<name>/{proposal,design,tasks}.md from templates
 *   node scripts/spec.mjs status [name] [--json] list changes, ticked/total tasks, artifact state
 *   node scripts/spec.mjs validate [name] [--json]  structural checks (all active changes when no name)
 *   node scripts/spec.mjs archive <name> [--force]  move to changes/archive/<date>-<name>/ and merge delta specs
 *
 * Layout (borrowed from OpenSpec, no CLI required):
 *   specs/<capability>/spec.md                       current truth
 *   changes/<name>/proposal.md|design.md|tasks.md    intent for one change
 *   changes/<name>/specs/<capability>/spec.md        delta: ## ADDED|MODIFIED|REMOVED Requirements
 *   changes/archive/<YYYY-MM-DD>-<name>/             archived changes
 *
 * Options: --root <project dir> (default: cwd)
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates', 'change');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const FORCE = argv.includes('--force');
let root = process.cwd();
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') root = resolve(argv[++i]);
  else if (!argv[i].startsWith('--')) positional.push(argv[i]);
}
const [cmd, name] = positional;
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
function setState(change, stage) {
  mkdirSync(dirname(STATE), { recursive: true });
  writeFileSync(STATE, JSON.stringify({ change, stage, updated: new Date().toISOString() }, null, 2) + '\n');
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
  out({ change: name, dir }, `created changes/${name}/{proposal,design,tasks}.md\nnext: fill proposal.md (interview) -> design.md + tasks.md (plan)`);
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
  const names = name ? [name] : listChanges();
  const rows = names.map((n) => {
    const dir = join(CHANGES, n);
    if (!existsSync(dir)) return { name: n, missing: true };
    return {
      name: n,
      current: current?.change === n,
      stage: current?.change === n ? current.stage : undefined,
      tasks: tasks(dir),
      artifacts: Object.fromEntries(['proposal.md', 'design.md', 'tasks.md'].map((f) => [f.replace('.md', ''), artifactState(dir, f)])),
      deltaSpecs: existsSync(join(dir, 'specs')) ? readdirSync(join(dir, 'specs')).length : 0,
    };
  });
  const text = rows.length
    ? rows
        .map((r) =>
          r.missing
            ? `${r.name}: (missing)`
            : `${r.name}${r.current ? ` <- current (${r.stage})` : ''}: ${r.tasks ? `${r.tasks.done}/${r.tasks.total} tasks` : 'no tasks.md'}; ` +
              Object.entries(r.artifacts).map(([k, v]) => `${k}=${v}`).join(' ') +
              (r.deltaSpecs ? `; ${r.deltaSpecs} delta spec(s)` : '')
        )
        .join('\n')
    : 'no active changes (changes/ is empty or missing)';
  out({ root, current, changes: rows }, text);
  process.exit(0);
}

// ---------------------------------------------------------------- validate
function validateSpecFile(path, isDelta) {
  const errors = [];
  const t = read(path);
  if (t === null) return errors;
  const lines = t.split('\n');
  if (isDelta && !/^## (ADDED|MODIFIED|REMOVED|RENAMED) Requirements/m.test(t)) {
    errors.push(`${path}: delta spec needs at least one "## ADDED|MODIFIED|REMOVED Requirements" section`);
  }
  let req = null;
  let scenarios = 0;
  const flush = () => {
    if (req && scenarios === 0) errors.push(`${path}: requirement "${req}" has no "#### Scenario:"`);
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
    for (const cap of readdirSync(deltaRoot)) errors.push(...validateSpecFile(join(deltaRoot, cap, 'spec.md'), true));
  }
  return { name: n, errors, warnings };
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
function mergeDelta(cap, deltaText, log) {
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
    blocks.set(n, b);
  }
  for (const [n, b] of splitRequirements(sectionBody(deltaText, 'MODIFIED Requirements')).blocks) {
    if (!blocks.has(n)) log.push(`warn: ${cap}: MODIFIED requirement "${n}" not found; appended`);
    blocks.set(n, b);
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
      if (d) mergeDelta(cap, d, log);
    }
  }
  const dest = join(CHANGES, 'archive', `${today()}-${name}`);
  mkdirSync(dirname(dest), { recursive: true });
  renameSync(dir, dest);
  log.push(`moved changes/${name} -> changes/archive/${today()}-${name}`);
  try {
    const cur = JSON.parse(read(STATE) ?? 'null');
    if (cur?.change === name) setState(name, 'archived');
  } catch {
    /* ignore */
  }
  out({ archived: name, dest, log }, log.join('\n'));
  process.exit(0);
}

fail('usage: spec.mjs <new <name> | status [name] | validate [name] | archive <name>> [--json] [--root dir]');
