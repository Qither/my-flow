/**
 * my-flow linked-intent parser (contract C-01).
 *
 * Markdown stays authoritative: `tasks.md` alone owns completion and blockers, and this module
 * only reads it. A task keeps the legacy `- [ ] 1.1 <action> and verify <check>` grammar and may
 * carry indented v2 fields directly beneath it:
 *
 *     - [ ] 1.1 Reject unfinished archives and verify the unfinished-task fixture is refused
 *       - id: T-01
 *       - depends-on: none
 *       - accepts: AC-01
 *       - design: D-04
 *
 * Rules this module enforces, and nothing more:
 *   - a field attaches only to the immediately preceding task, never across a heading, a blank
 *     line or a fence; a field with no task above it is orphan metadata, which is an error;
 *   - `none` is an explicit empty list, an absent field means unknown, and unknown or repeated
 *     v2 field names are errors while ordinary indented prose stays a legacy note;
 *   - fenced examples and HTML comments are never parsed, and nothing here executes content;
 *   - renumbering a task or editing its title never changes its id, and every parsed item keeps
 *     the source span it came from.
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { MANIFEST_FILE, changeIndex, newManifest, resolveChange } from './intent-state.mjs';

export const TASK_FIELDS = ['id', 'depends-on', 'accepts', 'design', 'evidence', 'kind', 'blocked'];
export const LIST_FIELDS = ['depends-on', 'accepts', 'design', 'evidence'];
export const TASK_KINDS = ['work', 'closeout'];
export const EVIDENCE_MODES = ['automated', 'manual', 'static', 'live'];

const ID_PATTERNS = {
  task: /^T-[A-Za-z0-9-]+$/,
  acceptance: /^AC-[A-Za-z0-9-]+$/,
  design: /^D-[A-Za-z0-9-]+$/,
  evidence: /^V-[A-Za-z0-9-]+$/,
};
const FIELD_ID_KIND = { id: 'task', 'depends-on': 'task', accepts: 'acceptance', design: 'design', evidence: 'evidence' };

const TASK_RE = /^(\s*)- \[([ xX])\] (\d+(?:\.\d+)*) (.*)$/;
const FIELD_RE = /^(\s+)- ([a-z][a-z0-9-]*):[ \t]?(.*)$/;
const NOTE_RE = /^(\s+)- (.*)$/;
const FENCE_RE = /^\s*(```+|~~~+)/;
const norm = (s) => (s ?? '').replace(/\r\n/g, '\n');

/**
 * Every diagnostic carries an explicit severity. `error` means the derived graph cannot be
 * trusted for navigation (a reference that does not resolve, a cycle, a repeated id);
 * `notice` is a true statement about the ledger that blocks nothing; `warning` is advice.
 */
const NOTICE_CODES = ['checked-but-blocked', 'checked-with-unfinished-prerequisite'];
const diag = (code, message, extra = {}) => ({
  code,
  message,
  severity: NOTICE_CODES.includes(code) ? 'notice' : 'error',
  ...extra,
});
export const hasStructuralError = (diagnostics) => diagnostics.some((d) => d.severity === 'error');

/**
 * Splits text into lines, marking every line that sits inside a fenced block or an HTML comment
 * so no caller ever parses an example. Returns `[{ text, line, skip }]` (1-based line numbers).
 */
export function scanLines(text) {
  const out = [];
  let fence = null;
  let inComment = false;
  norm(text)
    .split('\n')
    .forEach((text_, i) => {
      const line = i + 1;
      let skip = inComment;
      if (!inComment) {
        const m = FENCE_RE.exec(text_);
        if (fence) {
          skip = true; // the closing fence itself belongs to the block
          if (m && m[1].startsWith(fence[0]) && m[1].length >= fence.length) fence = null;
        } else if (m) {
          fence = m[1];
          skip = true;
        }
      }
      // HTML comments are tracked after fences so a commented fence cannot unbalance the scan
      let content = text_;
      if (!fence) {
        const opens = (text_.match(/<!--/g) ?? []).length;
        const closes = (text_.match(/-->/g) ?? []).length;
        if (inComment) {
          skip = true;
          if (closes > opens) inComment = false;
        } else if (opens > closes) {
          inComment = true;
          skip = true;
        } else if (opens > 0) {
          // an inline comment is not content: a template placeholder must never parse as a value
          content = text_.replace(/<!--[\s\S]*?-->/g, '');
          if (!content.trim()) skip = true;
        }
      }
      out.push({ text: content, raw: text_, line, skip });
    });
  return out;
}

/** Comma-separated ids, with `none` as the explicit empty list. Returns `{ values, explicitNone }`. */
function parseIdList(raw) {
  const trimmed = raw.trim();
  if (trimmed === '') return { values: [], explicitNone: false, empty: true };
  if (trimmed.toLowerCase() === 'none') return { values: [], explicitNone: true };
  return { values: trimmed.split(',').map((s) => s.trim()).filter(Boolean), explicitNone: false };
}

/**
 * Parses one `tasks.md`. Returns `{ schemaVersion, tasks, diagnostics }`, where `schemaVersion`
 * is 2 as soon as any task carries an `id` field and 1 (legacy) otherwise. Legacy tasks parse
 * fine; their relations are simply unknown.
 */
export function parseTasksMarkdown(text, { path = 'tasks.md' } = {}) {
  const lines = scanLines(text);
  const tasks = [];
  const diagnostics = [];
  const add = (code, message, line, extra) => diagnostics.push(diag(code, message, { path, line, ...extra }));

  let current = null; // the task a field would attach to
  let currentIndent = 0;
  const seenFields = new Set();

  const closeTask = (endLine) => {
    if (current) current.endLine = endLine;
    current = null;
    seenFields.clear();
  };

  for (const { text: raw, line, skip } of lines) {
    if (skip) {
      closeTask(line - 1);
      continue;
    }
    const t = TASK_RE.exec(raw);
    if (t) {
      closeTask(line - 1);
      const [, indent, box, number, title] = t;
      current = {
        number,
        title: title.trim(),
        checked: box.toLowerCase() === 'x',
        id: null,
        kind: 'work',
        dependsOn: null,
        accepts: null,
        design: null,
        evidence: null,
        blocked: null,
        notes: [],
        line,
        endLine: line,
        path,
      };
      currentIndent = indent.length;
      tasks.push(current);
      if (!/\bverif(y|ied|ies|ication)\b/i.test(title)) {
        add('no-verification', `task ${number} does not say how it is verified`, line, { severity: 'warning' });
      }
      continue;
    }
    if (/^\s*- \[/.test(raw)) {
      // a checkbox that is not the agreed grammar; intent.mjs already reports it, keep one voice
      closeTask(line - 1);
      continue;
    }
    if (/^#{1,6}\s/.test(raw) || raw.trim() === '') {
      closeTask(line - 1);
      continue;
    }
    const f = FIELD_RE.exec(raw);
    if (f && f[1].length > currentIndent) {
      const [, , key, value] = f;
      if (!current) {
        add('orphan-metadata', `"- ${key}:" has no task above it`, line, { field: key });
        continue;
      }
      if (!TASK_FIELDS.includes(key)) {
        add('unknown-field', `unknown task field "${key}" (allowed: ${TASK_FIELDS.join(', ')})`, line, { field: key, task: current.id ?? current.number });
        continue;
      }
      if (seenFields.has(key)) {
        add('duplicate-field', `task ${current.id ?? current.number} repeats the field "${key}"`, line, { field: key, task: current.id ?? current.number });
        continue;
      }
      seenFields.add(key);
      applyField(current, key, value, line, add);
      current.endLine = line;
      continue;
    }
    const n = current ? NOTE_RE.exec(raw) : null;
    if (n && n[1].length > currentIndent) {
      current.notes.push({ text: n[2], line }); // legacy indented note, preserved as prose
      current.endLine = line;
      continue;
    }
    closeTask(line - 1);
  }
  closeTask(lines.length);

  const byId = new Map();
  for (const task of tasks) {
    if (!task.id) continue;
    if (byId.has(task.id)) {
      add('duplicate-id', `task id ${task.id} is used by task ${byId.get(task.id).number} and task ${task.number}`, task.line, { id: task.id });
      continue;
    }
    byId.set(task.id, task);
  }
  const schemaVersion = tasks.some((t) => t.id) ? 2 : 1;
  return { schemaVersion, tasks, diagnostics, byId };
}

function applyField(task, key, value, line, add) {
  const kind = FIELD_ID_KIND[key];
  if (key === 'id') {
    const id = value.trim();
    if (!ID_PATTERNS.task.test(id)) {
      add('bad-id', `task id "${id}" must look like T-01`, line, { field: key });
      return;
    }
    task.id = id;
    return;
  }
  if (key === 'kind') {
    const k = value.trim().toLowerCase();
    if (!TASK_KINDS.includes(k)) {
      add('bad-kind', `unknown task kind "${value.trim()}" (allowed: ${TASK_KINDS.join(', ')})`, line, { field: key });
      return;
    }
    task.kind = k;
    return;
  }
  if (key === 'blocked') {
    task.blocked = value.trim();
    if (!task.blocked) add('empty-field', 'a "blocked" field needs a reason', line, { field: key });
    return;
  }
  const { values, explicitNone, empty } = parseIdList(value);
  if (empty) {
    add('empty-field', `"${key}" is empty; write "none" for an explicit empty list or remove the field to leave it unknown`, line, { field: key });
    return;
  }
  const bad = values.filter((v) => !ID_PATTERNS[kind].test(v));
  for (const b of bad) add('bad-id', `"${key}" value "${b}" is not a valid ${kind} id`, line, { field: key });
  const prop = { 'depends-on': 'dependsOn', accepts: 'accepts', design: 'design', evidence: 'evidence' }[key];
  task[prop] = explicitNone ? [] : values.filter((v) => ID_PATTERNS[kind].test(v));
}

// ---------------------------------------------------------------- acceptance
const AC_RE = /^###[ \t]+(AC-[A-Za-z0-9-]+)[ \t]*(?:[—–-][ \t]*(.*))?$/;
const AC_FIELDS = ['evidence-mode', 'required', 'checks', 'requirements', 'tasks'];

/**
 * Parses `acceptance.md` into `{ criteria, diagnostics }`. Every criterion keeps its declared
 * evidence modes, whether it is required, and the free text naming its checks; `checks` is a
 * description of the observation, never a shell DSL, and is not executed here or anywhere.
 */
export function parseAcceptanceMarkdown(text, { path = 'acceptance.md' } = {}) {
  const lines = scanLines(text);
  const criteria = [];
  const diagnostics = [];
  const add = (code, message, line, extra) => diagnostics.push(diag(code, message, { path, line, ...extra }));
  let current = null;
  const seen = new Set();

  for (const { text: raw, line, skip } of lines) {
    if (skip) continue;
    const m = AC_RE.exec(raw);
    if (m) {
      if (current) current.endLine = line - 1;
      current = {
        id: m[1],
        title: (m[2] ?? '').trim(),
        evidenceModes: null,
        required: true,
        checks: null,
        requirements: null,
        tasks: null,
        body: [],
        line,
        endLine: line,
        path,
      };
      if (seen.has(current.id)) add('duplicate-id', `acceptance id ${current.id} appears twice`, line, { id: current.id });
      seen.add(current.id);
      criteria.push(current);
      continue;
    }
    if (/^#{1,3}\s/.test(raw)) {
      if (current) current.endLine = line - 1;
      current = null;
      continue;
    }
    if (!current) continue;
    current.endLine = line;
    const f = /^- ([a-z][a-z0-9-]*):[ \t]?(.*)$/.exec(raw);
    if (!f) {
      if (raw.trim()) current.body.push(raw);
      continue;
    }
    const [, key, value] = f;
    if (!AC_FIELDS.includes(key)) {
      add('unknown-field', `unknown acceptance field "${key}" (allowed: ${AC_FIELDS.join(', ')})`, line, { field: key, id: current.id });
      continue;
    }
    if (key === 'evidence-mode') {
      const modes = value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
      for (const mode of modes) if (!EVIDENCE_MODES.includes(mode)) add('bad-evidence-mode', `unknown evidence mode "${mode}" (allowed: ${EVIDENCE_MODES.join(', ')})`, line, { id: current.id });
      current.evidenceModes = modes.filter((mode) => EVIDENCE_MODES.includes(mode));
    } else if (key === 'required') {
      const v = value.trim().toLowerCase();
      if (!['true', 'false'].includes(v)) add('bad-required', `"required" must be true or false (got "${value.trim()}")`, line, { id: current.id });
      current.required = v !== 'false';
    } else if (key === 'tasks') {
      current.tasks = value.split(',').map((s) => s.trim()).filter(Boolean);
    } else {
      current[key] = value.trim();
    }
  }
  for (const c of criteria) {
    // An incomplete criterion is a contract that is not finished yet, not a broken graph: a
    // reader can still navigate it, and archive refuses it separately in the C-05 preflight.
    if (c.evidenceModes === null) add('missing-evidence-mode', `acceptance ${c.id} declares no evidence-mode`, c.line, { id: c.id, severity: 'warning' });
    else if (c.evidenceModes.length === 0) add('missing-evidence-mode', `acceptance ${c.id} lists no usable evidence mode`, c.line, { id: c.id, severity: 'warning' });
    if (!c.checks) add('missing-checks', `acceptance ${c.id} names no checks`, c.line, { id: c.id, severity: 'warning' });
  }
  return { criteria, diagnostics, byId: new Map(criteria.map((c) => [c.id, c])) };
}

// ---------------------------------------------------------------- design decisions
const D_RE = /^###[ \t]+(D-[A-Za-z0-9-]+)[ \t]*(?:[—–-][ \t]*(.*))?$/;

/** Parses the `### D-01 — Title` headings of `design.md` into stable, referable blocks. */
export function parseDesignMarkdown(text, { path = 'design.md' } = {}) {
  const lines = scanLines(text);
  const decisions = [];
  const diagnostics = [];
  const seen = new Set();
  let current = null;
  for (const { text: raw, line, skip } of lines) {
    if (skip) continue;
    const m = D_RE.exec(raw);
    if (m) {
      if (current) current.endLine = line - 1;
      current = { id: m[1], title: (m[2] ?? '').trim(), line, endLine: line, path };
      if (seen.has(current.id)) diagnostics.push(diag('duplicate-id', `design id ${current.id} appears twice`, { path, line, id: current.id }));
      seen.add(current.id);
      decisions.push(current);
      continue;
    }
    if (/^#{1,3}\s/.test(raw)) {
      if (current) current.endLine = line - 1;
      current = null;
      continue;
    }
    if (current) current.endLine = line;
  }
  return { decisions, diagnostics, byId: new Map(decisions.map((d) => [d.id, d])) };
}

// ---------------------------------------------------------------- the derived graph
export const READINESS = ['invalid', 'blocked', 'complete', 'unknown', 'waiting', 'ready'];

/** Rotates a cycle to start at its smallest id so the same loop is reported once. */
function canonicalCycle(path) {
  const ids = path.slice(0, -1);
  let at = 0;
  for (let i = 1; i < ids.length; i++) if (ids[i] < ids[at]) at = i;
  return [...ids.slice(at), ...ids.slice(0, at)];
}

/**
 * Derives forward and reverse links, reference diagnostics, cycles and readiness from one parsed
 * change. Nothing here is written back: the derived graph never changes a checkbox, and an
 * undeclared dependency stays unknown rather than being inferred from task numbering.
 *
 * Readiness precedence (C-01): invalid reference or cycle, then an explicit blocker or amendment
 * hold, then a ticked box, then a missing dependency declaration, then unfinished prerequisites,
 * otherwise ready. A ticked box that is also blocked, or that still has an unfinished
 * prerequisite, stays visible as a diagnostic instead of being silently corrected.
 */
export function buildTaskGraph(intent, { holds = new Map() } = {}) {
  const tasks = intent.tasks.tasks;
  const byId = intent.tasks.byId ?? new Map(tasks.filter((t) => t.id).map((t) => [t.id, t]));
  const acceptance = intent.acceptance?.byId ?? new Map();
  const design = intent.design?.byId ?? new Map();
  const diagnostics = [];
  const at = (task) => ({ path: task.path, line: task.line, task: task.id ?? task.number });

  const nodes = new Map();
  for (const task of tasks) {
    if (!task.id) continue;
    if (nodes.has(task.id)) continue; // the duplicate is already reported by the parser
    nodes.set(task.id, {
      id: task.id,
      task,
      dependsOn: task.dependsOn,
      dependents: [],
      refs: [],
      readiness: null,
      reasons: [],
      hold: holds.get(task.id) ?? null,
    });
  }

  // typed outgoing references, validated against the documents that own each id space
  for (const node of nodes.values()) {
    const { task } = node;
    for (const id of task.dependsOn ?? []) {
      node.refs.push({ type: 'task', id, field: 'depends-on', resolved: nodes.has(id) });
      if (!nodes.has(id)) diagnostics.push(diag('unknown-dependency', `task ${task.id} depends on ${id}, which no task declares`, { ...at(task), ref: id }));
      else nodes.get(id).dependents.push(task.id);
    }
    for (const id of task.accepts ?? []) {
      node.refs.push({ type: 'acceptance', id, field: 'accepts', resolved: acceptance.has(id) });
      if (!acceptance.has(id)) diagnostics.push(diag('unknown-acceptance', `task ${task.id} accepts ${id}, which acceptance.md does not define`, { ...at(task), ref: id }));
    }
    for (const id of task.design ?? []) {
      node.refs.push({ type: 'design', id, field: 'design', resolved: design.has(id) });
      if (!design.has(id)) diagnostics.push(diag('unknown-design', `task ${task.id} cites ${id}, which design.md does not define`, { ...at(task), ref: id }));
    }
    for (const id of task.evidence ?? []) node.refs.push({ type: 'evidence', id, field: 'evidence', resolved: null });
  }
  for (const node of nodes.values()) node.dependents.sort();

  // cycles, including a task that depends on itself
  const cycles = [];
  {
    const state = new Map();
    const stack = [];
    const seen = new Set();
    const visit = (id) => {
      state.set(id, 1);
      stack.push(id);
      for (const dep of nodes.get(id).dependsOn ?? []) {
        if (!nodes.has(dep)) continue;
        const s = state.get(dep) ?? 0;
        if (s === 1) {
          const cycle = canonicalCycle([...stack.slice(stack.indexOf(dep)), dep]);
          const key = cycle.join('>');
          if (!seen.has(key)) {
            seen.add(key);
            cycles.push(cycle);
          }
        } else if (s === 0) visit(dep);
      }
      stack.pop();
      state.set(id, 2);
    };
    for (const id of nodes.keys()) if ((state.get(id) ?? 0) === 0) visit(id);
  }
  const inCycle = new Set();
  for (const cycle of cycles) {
    for (const id of cycle) inCycle.add(id);
    const task = nodes.get(cycle[0]).task;
    diagnostics.push(diag('dependency-cycle', `dependency cycle: ${[...cycle, cycle[0]].join(' -> ')}`, { ...at(task), cycle }));
  }

  // pass 1: the states that do not depend on another task's state
  const invalidRefs = new Set(diagnostics.filter((d) => d.code === 'unknown-dependency' || d.code === 'unknown-acceptance' || d.code === 'unknown-design').map((d) => d.task));
  for (const node of nodes.values()) {
    const { task } = node;
    if (inCycle.has(node.id) || invalidRefs.has(node.id)) {
      node.readiness = 'invalid';
      node.reasons.push(inCycle.has(node.id) ? 'part of a dependency cycle' : 'a typed reference does not resolve');
      continue;
    }
    if (node.hold || task.blocked) {
      node.readiness = 'blocked';
      node.reasons.push(node.hold ? `held by amendment ${node.hold}` : `blocked: ${task.blocked}`);
      if (task.checked) diagnostics.push(diag('checked-but-blocked', `task ${task.id} is ticked but carries a blocker; a blocked task is never complete`, at(task)));
      continue;
    }
    if (task.checked) node.readiness = 'complete';
  }
  // pass 2: the states that read their prerequisites
  for (const node of nodes.values()) {
    const { task } = node;
    const unfinished = (task.dependsOn ?? []).filter((id) => nodes.get(id)?.readiness !== 'complete');
    if (node.readiness === 'complete' && unfinished.length) {
      diagnostics.push(diag('checked-with-unfinished-prerequisite', `task ${task.id} is ticked while ${unfinished.join(', ')} ${unfinished.length > 1 ? 'are' : 'is'} unfinished`, { ...at(task), unfinished }));
    }
    if (node.readiness) continue;
    if (task.dependsOn === null) {
      node.readiness = 'unknown';
      node.reasons.push('no dependency declaration; prerequisites are unknown, not none');
      continue;
    }
    if (unfinished.length) {
      node.readiness = 'waiting';
      node.reasons.push(`waiting for ${unfinished.join(', ')}`);
      continue;
    }
    node.readiness = 'ready';
    node.reasons.push(task.dependsOn.length ? 'every declared prerequisite is complete' : 'no prerequisites');
  }

  // tasks with no id keep working: they are readable, and their relations are simply unknown
  const legacy = tasks
    .filter((t) => !t.id)
    .map((task) => ({ id: null, task, dependsOn: null, dependents: [], refs: [], readiness: task.checked ? 'complete' : 'unknown', reasons: ['legacy task without a stable id'], hold: null }));

  return { nodes, legacy, cycles, diagnostics, all: [...nodes.values(), ...legacy] };
}

/** Reverse index of every typed reference, as `{ '<type>:<id>': [{ from, field }] }`. */
export function reverseIndex(graph) {
  const back = new Map();
  for (const node of graph.nodes.values()) {
    for (const ref of node.refs) {
      const key = `${ref.type}:${ref.id}`;
      if (!back.has(key)) back.set(key, []);
      back.get(key).push({ from: node.id, field: ref.field });
    }
  }
  return back;
}

// ---------------------------------------------------------------- one change
const readIf = (p) => (existsSync(p) ? readFileSync(p, 'utf8').replace(/\r\n/g, '\n') : null);

/**
 * Reads one change's intent documents and parses all three. The caller holds the repository
 * intent lock (C-09); this function only reads. `acceptance.md` is optional: a legacy change
 * simply has no criteria, and its tasks' relations stay unknown.
 */
export function readChangeIntent(root, name, opts = {}) {
  return readChangeIntentDir(join(root, 'changes', name), name, opts);
}

/**
 * The same read addressed by directory, so an archived change under `changes/archive/<dir>` is
 * parsed exactly like an active one. `rel` only labels diagnostics.
 */
export function readChangeIntentDir(dir, name, { holds = new Map(), rel = `changes/${name}` } = {}) {
  const tasksText = readIf(join(dir, 'tasks.md'));
  const acceptanceText = readIf(join(dir, 'acceptance.md'));
  const designText = readIf(join(dir, 'design.md'));
  const tasks = parseTasksMarkdown(tasksText ?? '', { path: `${rel}/tasks.md` });
  const acceptance = parseAcceptanceMarkdown(acceptanceText ?? '', { path: `${rel}/acceptance.md` });
  const design = parseDesignMarkdown(designText ?? '', { path: `${rel}/design.md` });
  const parsed = { name, dir, rel, schemaVersion: tasks.schemaVersion, exists: tasksText !== null, tasks, acceptance, design };
  const graph = buildTaskGraph(parsed, { holds });
  return {
    ...parsed,
    graph,
    diagnostics: [...tasks.diagnostics, ...acceptance.diagnostics, ...design.diagnostics, ...graph.diagnostics],
  };
}

// ---------------------------------------------------------------- the shared inspection projection
export const REFERENCE_TYPES = ['task', 'acceptance', 'design', 'evidence'];

/**
 * One projection, used by `spec inspect` and by `GET /api/intent/...` alike, so the CLI and the
 * dashboard can never drift. It carries identity, location, every task with its readiness and
 * typed outgoing and incoming references, the acceptance and design blocks those references
 * point at, and the diagnostics that explain anything unresolved.
 *
 * Display names are resolved from the target on the way out, never copied into a stored index,
 * so a renamed criterion shows its new title everywhere at once.
 *
 * Returns `{ error, message }` instead of throwing: `no-such-change` is a 404 for the API and a
 * refusal for the CLI, `duplicate-identity` and a structurally invalid graph are a 409.
 */
export function inspectChange(root, ref, { task = null, index = null } = {}) {
  const idx = index ?? changeIndex(root);
  const r = resolveChange(root, ref, idx);
  if (r.error) return { error: r.error, message: r.message, ...(r.paths ? { paths: r.paths } : {}) };
  const entry = r.entry;
  const intent = readChangeIntentDir(entry.dir, entry.slug, { rel: entry.rel });
  if (!intent.exists) return { error: 'no-such-change', message: `${entry.rel} has no tasks.md to inspect` };

  const graph = intent.graph;
  const acceptance = intent.acceptance.byId;
  const design = intent.design.byId;
  const labelOf = (type, id) => {
    if (type === 'task') return graph.nodes.get(id)?.task?.title ?? null;
    if (type === 'acceptance') return acceptance.get(id)?.title ?? null;
    if (type === 'design') return design.get(id)?.title ?? null;
    return null; // an evidence attempt is labelled by its own record, not by this document
  };
  const back = reverseIndex(graph);
  const incomingFor = (type, id) => (back.get(`${type}:${id}`) ?? []).map((e) => ({ type: 'task', from: e.from, field: e.field, label: labelOf('task', e.from) }));

  const taskView = (node) => ({
    id: node.id,
    number: node.task.number,
    title: node.task.title,
    checked: node.task.checked,
    kind: node.task.kind,
    blocked: node.task.blocked,
    readiness: node.readiness,
    reasons: node.reasons,
    line: node.task.line,
    endLine: node.task.endLine,
    path: node.task.path,
    notes: node.task.notes.map((n) => n.text),
    outgoing: node.refs.map((ref_) => ({ ...ref_, label: labelOf(ref_.type, ref_.id) })),
    incoming: node.id ? incomingFor('task', node.id) : [],
  });

  const tasks = graph.all.map(taskView);
  const identity = {
    id: entry.id,
    slug: entry.slug,
    kind: entry.kind,
    stage: entry.stage,
    revision: entry.manifest?.revision ?? null,
    updated: entry.manifest?.updated ?? null,
  };
  const diagnostics = [
    ...intent.diagnostics,
    ...idx.diagnostics.filter((d) => d.path?.startsWith(`${entry.rel}/`) || d.paths?.includes(entry.rel)),
  ];
  const projection = {
    schemaVersion: intent.schemaVersion,
    identity,
    location: { location: entry.location, rel: entry.rel, dirName: entry.dirName },
    counts: { total: tasks.length, done: tasks.filter((t) => t.checked).length },
    tasks,
    acceptance: intent.acceptance.criteria.map((c) => ({
      id: c.id,
      title: c.title,
      required: c.required,
      evidenceModes: c.evidenceModes,
      checks: c.checks,
      requirements: c.requirements,
      line: c.line,
      endLine: c.endLine,
      path: c.path,
      incoming: incomingFor('acceptance', c.id),
    })),
    design: intent.design.decisions.map((d) => ({ id: d.id, title: d.title, line: d.line, endLine: d.endLine, path: d.path, incoming: incomingFor('design', d.id) })),
    diagnostics,
    invalid: hasStructuralError(diagnostics),
  };
  if (task === null) return { projection };
  const selected = projection.tasks.find((t) => t.id === task);
  if (!selected) return { error: 'no-such-reference', message: `${entry.rel} has no task ${task}`, projection };
  return { projection: { ...projection, task: selected } };
}

/**
 * The typed single-reference projection behind `#/change/<uuid>/<type>/<id>`. Only ids this
 * change's own documents define are resolvable; nothing here reads a client-supplied path.
 */
export function inspectReference(root, ref, type, id, { index = null } = {}) {
  if (!REFERENCE_TYPES.includes(type)) return { error: 'bad-reference-type', message: `reference type must be one of ${REFERENCE_TYPES.join(', ')}` };
  const r = inspectChange(root, ref, { index });
  if (r.error) return r;
  const p = r.projection;
  const found =
    type === 'task'
      ? p.tasks.find((t) => t.id === id)
      : type === 'acceptance'
        ? p.acceptance.find((c) => c.id === id)
        : type === 'design'
          ? p.design.find((d) => d.id === id)
          : null;
  if (type === 'evidence') {
    return { error: 'no-such-reference', message: `no recorded verification attempt ${id} for ${p.location.rel}`, projection: p };
  }
  if (!found) return { error: 'no-such-reference', message: `${p.location.rel} defines no ${type} ${id}`, projection: p };
  return { projection: { schemaVersion: p.schemaVersion, identity: p.identity, location: p.location, type, item: found, diagnostics: p.diagnostics, invalid: p.invalid } };
}

/** The human rendering of a projection, so `spec inspect` and `--json` cannot disagree. */
export function inspectText(projection) {
  const { identity, location, counts } = projection;
  const lines = [
    `${identity.slug}${identity.id ? ` (${identity.id})` : ' (legacy, no stable id)'}`,
    `  kind ${identity.kind}; stage ${identity.stage ?? 'unknown'}; ${location.location} at ${location.rel}; schema v${projection.schemaVersion}`,
    `  ${counts.done}/${counts.total} tasks ticked`,
  ];
  const render = (t) => {
    const out = [`  ${t.checked ? '[x]' : '[ ]'} ${t.number} ${t.id ?? '(no id)'} ${t.readiness}: ${t.title}`];
    for (const reason of t.reasons) out.push(`        why: ${reason}`);
    for (const ref of t.outgoing) out.push(`        ${ref.field} -> ${ref.type} ${ref.id}${ref.label ? ` (${ref.label})` : ''}${ref.resolved === false ? ' [unresolved]' : ''}`);
    for (const inc of t.incoming) out.push(`        needed by ${inc.from}${inc.label ? ` (${inc.label})` : ''}`);
    return out;
  };
  for (const t of projection.task ? [projection.task] : projection.tasks) lines.push(...render(t));
  for (const d of projection.diagnostics) lines.push(`  ${d.severity}: ${d.code}: ${d.message}`);
  return lines.join('\n');
}

// ---------------------------------------------------------------- explicit upgrade (D-01, C-08)
const TASK_ID_FOR = (n) => `T-${String(n).padStart(2, '0')}`;

/**
 * Plans the explicit legacy -> v2 upgrade of one active change. Nothing is written: the caller
 * runs the returned steps as one journalled transaction, so a crash mid-upgrade is recoverable.
 *
 * What it does: assign a stable id to every task that lacks one, keep every line of prose and
 * every checkbox exactly as it is, copy the originals under `migration/original/`, and create an
 * unapproved draft acceptance inventory.
 *
 * What it deliberately does not do: invent dependencies (an undeclared prerequisite stays
 * unknown, and numbering never implies one), invent acceptance criteria (the draft inventory is
 * commented out, so the parsed model gains nothing the author did not approve), or treat a
 * ticked box as newly verified. The decisions that remain are returned in `decisions`.
 */
export function planChangeUpgrade(root, name) {
  const entry = resolveChange(root, name).entry;
  if (!entry) return { error: 'no-such-change', message: `no active or archived change is called "${name}"` };
  if (entry.location !== 'active') return { error: 'not-active', message: `${entry.rel} is archived; historical changes are preserved exactly as they are` };
  if (existsSync(join(root, 'docs', 'changes', `${name}.md`))) {
    return { error: 'simple-mode', message: `docs/changes/${name}.md is a simple-mode change; simple mode keeps legacy reading and is not upgraded` };
  }
  const dir = entry.dir;
  const tasksPath = join(dir, 'tasks.md');
  if (!existsSync(tasksPath)) return { error: 'no-tasks', message: `${entry.rel}/tasks.md does not exist` };
  const original = readFileSync(tasksPath, 'utf8').replace(/\r\n/g, '\n');
  const parsed = parseTasksMarkdown(original, { path: `${entry.rel}/tasks.md` });
  const hasManifest = existsSync(join(dir, MANIFEST_FILE));
  const alreadyIded = parsed.tasks.length > 0 && parsed.tasks.every((t) => t.id);
  if (hasManifest && alreadyIded) return { error: 'already-v2', message: `${entry.rel} already has a change.json and an id on every task` };

  // 1. tasks.md: insert one "- id: T-nn" line under each task that has none, and nothing else
  const used = new Set(parsed.tasks.map((t) => t.id).filter(Boolean));
  let next = 1;
  const freshId = () => {
    while (used.has(TASK_ID_FOR(next))) next++;
    const id = TASK_ID_FOR(next);
    used.add(id);
    return id;
  };
  const lines = original.split('\n');
  const inserts = [];
  for (const task of parsed.tasks) {
    if (task.id) continue;
    const indent = /^(\s*)- \[/.exec(lines[task.line - 1])[1];
    inserts.push({ at: task.line, text: `${indent}  - id: ${freshId()}` });
  }
  const upgradedLines = [];
  const insertAt = new Map(inserts.map((i) => [i.at, i.text]));
  lines.forEach((line, i) => {
    upgradedLines.push(line);
    const add = insertAt.get(i + 1);
    if (add !== undefined) upgradedLines.push(add);
  });
  const upgradedTasks = upgradedLines.join('\n');

  // 2. the draft acceptance inventory: commented out, so nothing is invented in the parsed model
  const acceptancePath = join(dir, 'acceptance.md');
  const hasAcceptance = existsSync(acceptancePath);
  const idFor = new Map();
  parseTasksMarkdown(upgradedTasks).tasks.forEach((t) => idFor.set(t.number, t.id));
  const draft = [
    '# Acceptance and test map',
    '',
    '> Draft, unapproved. `spec upgrade` derived the list below from the verification phrase each',
    '> task already carried. Nothing here is in force while it stays commented out: uncomment a',
    '> block only when you have decided its evidence mode and its checks, then point the task at',
    '> it with `- accepts: AC-nn`.',
    '',
    ...parsed.tasks.flatMap((t, i) => {
      const phrase = /\band verif(?:y|ies|ied)\b(.*)$/i.exec(t.title)?.[1]?.trim() ?? '';
      return [
        '<!--',
        `### AC-${String(i + 1).padStart(2, '0')} — ${t.title.replace(/\s+and verif(?:y|ies|ied)\b.*$/i, '').trim() || 'outcome'}`,
        '',
        `Derived from task ${t.number} (${idFor.get(t.number) ?? t.id}).`,
        '',
        '- evidence-mode: ',
        '- required: true',
        `- checks: ${phrase || 'decide what observation proves this'}`,
        `- tasks: ${idFor.get(t.number) ?? t.id}`,
        '-->',
        '',
      ];
    }),
  ].join('\n');

  const steps = [
    { kind: 'file', path: `${entry.rel}/migration/original/tasks.md`, content: original },
    { kind: 'file', path: `${entry.rel}/tasks.md`, content: upgradedTasks },
  ];
  for (const f of ['proposal.md', 'design.md', 'acceptance.md']) {
    const p = join(dir, f);
    if (existsSync(p)) steps.push({ kind: 'file', path: `${entry.rel}/migration/original/${f}`, content: readFileSync(p, 'utf8').replace(/\r\n/g, '\n') });
  }
  if (!hasAcceptance) steps.push({ kind: 'file', path: `${entry.rel}/acceptance.md`, content: draft });
  if (!hasManifest) {
    steps.push({ kind: 'file', path: `${entry.rel}/${MANIFEST_FILE}`, content: JSON.stringify(newManifest(entry.slug, { stage: 'mf-plan' }), null, 2) + '\n' });
  }

  const decisions = [
    ...(hasManifest ? [] : ['a stable identity (change.json) is created; it is generated once and never replaced']),
    `${inserts.length} task(s) received a stable id; ${parsed.tasks.length - inserts.length} already had one`,
    'no dependency was inferred: every task without "- depends-on" keeps unknown prerequisites until you declare them',
    hasAcceptance ? 'acceptance.md already exists and is left untouched' : 'acceptance.md is created as a commented-out draft; nothing in it is in force until you uncomment and complete a block',
    'no acceptance reference was added to any task, and no ticked box was treated as newly verified',
    'the originals are preserved under migration/original/',
  ];
  return { entry, steps, decisions, counts: { tasks: parsed.tasks.length, idsAdded: inserts.length } };
}
