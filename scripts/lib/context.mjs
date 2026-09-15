/**
 * Context packets (contract C-07, design D-07).
 *
 * A packet is everything a reviewer or an executor needs about one task, derived from the
 * committed intent and written to scratch. It is never an authoritative summary: every block in
 * it is a copy of text that still lives in `changes/<name>/`, and every locator carries the hash
 * of the file it points at, so a stale packet is detectable rather than merely old.
 *
 * Three rules shape what goes in. The global constraints and the complete acceptance index are
 * always present in full — a packet may lose detail, never a required criterion. The selected
 * task arrives with its prerequisite closure, because a task cannot be judged without what it
 * was allowed to assume. And `--since` compares the packet's own inputs, not the clock, so a
 * repeat review is told what actually changed.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { IntentIoError, writeFileAtomic } from './intent-io.mjs';
import { readChangeIntentDir } from './intent-graph.mjs';
import { readManifest } from './intent-state.mjs';
import { canonicalJson, currentContractDigest, digestOf, escalationFor, listFindings, sha256Hex } from './evidence.mjs';
import { sectionBody } from './intent.mjs';

export const PACKET_SCHEMA_VERSION = 2;
/** Packets are scratch: they are regenerated from intent and never committed. */
export const packetDir = (root, slug) => join(root, '.my-flow', 'context', slug);
const lf = (t) => t.replace(/\r\n/g, '\n');
const readIf = (p) => (existsSync(p) ? lf(readFileSync(p, 'utf8')) : null);
/** How much referenced block text one packet carries before detail is replaced by retrieval refs. */
export const DEFAULT_DETAIL_LIMIT = 24000;

const slice = (text, block) =>
  lf(text ?? '')
    .split('\n')
    .slice(block.line - 1, block.endLine)
    .join('\n')
    .trimEnd();

/** The prerequisite closure of a task: itself, and everything it was allowed to assume. */
export function prerequisiteClosure(graph, taskId) {
  const out = [];
  const seen = new Set();
  const visit = (id) => {
    if (seen.has(id)) return;
    seen.add(id);
    const node = graph.nodes.get(id);
    if (!node) return;
    for (const dep of node.dependsOn ?? []) visit(dep);
    out.push(id);
  };
  visit(taskId);
  return out;
}

const PATH_RE = /(?:^|[\s`'"(\[])((?:[A-Za-z0-9_.-]+\/)+[A-Za-z0-9_.-]+\.(?:mjs|cjs|js|ts|json|md|css|html))/g;
const pathsIn = (text) => {
  const found = new Set();
  for (const m of String(text ?? '').matchAll(PATH_RE)) found.add(m[1]);
  return found;
};

/**
 * File locators with the hash of what they currently hold. A named file that does not exist is a
 * diagnostic, not a silent omission: it is usually a locator that moved.
 */
function locatorsFor(root, paths) {
  const locators = [];
  const diagnostics = [];
  for (const path of [...paths].sort()) {
    const abs = join(root, path);
    if (!existsSync(abs) || !statSync(abs).isFile()) {
      diagnostics.push({ code: 'missing-locator', message: `${path} is named by this task but does not exist; the locator moved or was never written`, path });
      continue;
    }
    const text = readFileSync(abs);
    locators.push({ path, hash: sha256Hex(text), bytes: text.length });
  }
  return { locators, diagnostics };
}

/**
 * One packet. `taskId` selects the task lane; without it the packet is the final verifier's, which
 * has no task filter and carries every criterion.
 */
export function buildPacket(root, { dir, rel, slug, taskId = null, detailLimit = DEFAULT_DETAIL_LIMIT, inputs = {} }) {
  const intent = readChangeIntentDir(dir, slug, { rel });
  if (!intent.exists) throw new IntentIoError('no-such-change', `${rel}/tasks.md does not exist; there is no intent to derive a packet from`);
  const manifest = readManifest(dir);
  const diagnostics = intent.diagnostics.map((d) => ({ code: d.code, message: d.message, path: d.path ?? null, line: d.line ?? null, severity: d.severity ?? 'error' }));

  const mode = taskId ? 'task' : 'final';
  if (taskId && !intent.graph.nodes.has(taskId)) {
    throw new IntentIoError('no-such-task', `${rel}/tasks.md declares no task ${taskId}`);
  }
  const selected = taskId ? prerequisiteClosure(intent.graph, taskId) : [...intent.graph.nodes.keys()];
  // a cycle inside the closure is reported here too: the closure it produced is not an order
  for (const cycle of intent.graph.cycles) {
    if (cycle.some((id) => selected.includes(id))) diagnostics.push({ code: 'cycle', message: `the prerequisite closure runs through a cycle: ${cycle.join(' -> ')}`, path: `${rel}/tasks.md`, line: null, severity: 'error' });
  }

  const designText = readIf(join(dir, 'design.md')) ?? '';
  const acceptanceText = readIf(join(dir, 'acceptance.md')) ?? '';
  const proposalText = readIf(join(dir, 'proposal.md')) ?? '';

  // the global constraints, in full and never truncated: they are the reason a packet exists
  const constraints = {
    doNotTouch: sectionBody(designText, 'Do-Not-Touch').trim(),
    rebuild: sectionBody(designText, 'Rebuild / Re-run After Change').trim(),
    nonGoals: sectionBody(proposalText, 'Non-Goals').trim(),
    decisionBoundaries: sectionBody(proposalText, 'Decision Boundaries').trim(),
  };

  // the complete criteria index, whatever the task lane: a packet never hides a required criterion
  const acceptance = intent.acceptance.criteria.map((c) => ({ id: c.id, title: c.title, required: c.required, evidenceModes: c.evidenceModes ?? [], checks: c.checks ?? null }));

  const tasks = selected.map((id) => {
    const { task } = intent.graph.nodes.get(id);
    return {
      id,
      number: task.number,
      title: task.title,
      checked: task.checked,
      dependsOn: task.dependsOn ?? [],
      accepts: task.accepts ?? [],
      design: task.design ?? [],
      blocked: task.blocked ?? null,
      selected: taskId === null || id === taskId,
    };
  });

  // only the blocks this lane actually references, copied from the documents that own them
  const referenced = { acceptance: new Set(), design: new Set() };
  for (const t of tasks) {
    t.accepts.forEach((id) => referenced.acceptance.add(id));
    t.design.forEach((id) => referenced.design.add(id));
  }
  const blocks = { design: {}, acceptance: {} };
  // where each copied block came from, so a block dropped for size can still be fetched
  const sources = new Map();
  for (const id of [...referenced.design].sort()) {
    const block = intent.design.byId.get(id);
    if (!block) continue;
    blocks.design[id] = slice(designText, block);
    sources.set(`design:${id}`, { path: `${rel}/design.md`, line: block.line, endLine: block.endLine });
  }
  for (const id of [...referenced.acceptance].sort()) {
    const block = intent.acceptance.byId.get(id);
    if (!block) continue;
    blocks.acceptance[id] = slice(acceptanceText, block);
    sources.set(`acceptance:${id}`, { path: `${rel}/acceptance.md`, line: block.line, endLine: block.endLine });
  }

  const named = new Set();
  for (const t of tasks) pathsIn(t.title).forEach((p) => named.add(p));
  for (const c of acceptance) if (referenced.acceptance.has(c.id) || mode === 'final') pathsIn(c.checks).forEach((p) => named.add(p));
  const { locators, diagnostics: locatorDiagnostics } = locatorsFor(root, named);
  diagnostics.push(...locatorDiagnostics.map((d) => ({ ...d, line: null, severity: 'warning' })));

  // an open finding is part of the context: it is the reason the next attempt is not a first one
  const findings = listFindings(dir)
    .filter((f) => !f.resolvedBy)
    .filter((f) => mode === 'final' || (f.tasks ?? []).some((id) => selected.includes(id)))
    .map((f) => ({ id: f.id, cause: f.cause, tasks: f.tasks ?? [], attempts: (f.attempts ?? []).length, escalation: escalationFor(f) }));

  const packet = {
    schemaVersion: PACKET_SCHEMA_VERSION,
    changeId: manifest?.id ?? null,
    slug,
    rel,
    mode,
    taskId,
    constraints,
    acceptance,
    tasks,
    blocks,
    locators,
    findings,
    truncated: [],
    diagnostics,
  };
  applyDetailLimit(packet, detailLimit, sources);

  // the inputs a repeat is compared against: what the packet was derived from, never when
  packet.inputs = {
    contractDigest: manifest ? currentContractDigest(root, dir, rel, inputs.supportingContractPaths ? inputs : null) : null,
    mode,
    taskId,
    tasks: tasks.map((t) => t.id),
    blocks: Object.fromEntries([
      ...Object.entries(packet.blocks.design).map(([id, text]) => [`design:${id}`, sha256Hex(text)]),
      ...Object.entries(packet.blocks.acceptance).map(([id, text]) => [`acceptance:${id}`, sha256Hex(text)]),
    ]),
    constraints: sha256Hex(canonicalJson(constraints)),
    locators: Object.fromEntries(locators.map((l) => [l.path, l.hash])),
    findings: Object.fromEntries(findings.map((f) => [f.id, f.attempts])),
  };
  packet.inputsDigest = digestOf(packet.inputs);
  return packet;
}

/**
 * Keep the packet under its detail budget by replacing the longest block bodies with a retrieval
 * reference. Constraints, the criteria index, the task closure and the locators are never touched.
 */
function applyDetailLimit(packet, limit, sources) {
  const size = () => Object.values(packet.blocks.design).concat(Object.values(packet.blocks.acceptance)).reduce((n, t) => n + t.length, 0);
  if (!limit || size() <= limit) return;
  const entries = [
    ...Object.entries(packet.blocks.design).map(([id, text]) => ({ kind: 'design', id, text })),
    ...Object.entries(packet.blocks.acceptance).map(([id, text]) => ({ kind: 'acceptance', id, text })),
  ].sort((a, b) => b.text.length - a.text.length || a.id.localeCompare(b.id));
  for (const entry of entries) {
    if (size() <= limit) break;
    delete packet.blocks[entry.kind === 'design' ? 'design' : 'acceptance'][entry.id];
    const source = sources.get(`${entry.kind}:${entry.id}`);
    packet.truncated.push({
      kind: entry.kind,
      id: entry.id,
      bytes: entry.text.length,
      path: source.path,
      line: source.line,
      endLine: source.endLine,
      // a location in the committed text, not a command: the block is still where it was
      retrieve: `${source.path}:${source.line}-${source.endLine}`,
    });
  }
  packet.truncated.sort((a, b) => a.id.localeCompare(b.id));
}

const packetFile = (root, slug, packet) => join(packetDir(root, slug), `${packet.mode}-${packet.taskId ?? 'all'}-${packet.inputsDigest.slice(0, 12)}.json`);

/** Persist a packet in scratch, so the next run can say what changed since this one. */
export function persistPacket(root, slug, packet) {
  const path = packetFile(root, slug, packet);
  mkdirSync(packetDir(root, slug), { recursive: true });
  writeFileAtomic(path, JSON.stringify(packet, null, 2) + '\n');
  return path;
}

/**
 * The persisted packet with this inputs digest, in this lane. A digest from a different lane is
 * not a previous version of this packet — comparing a task packet with the final one would report
 * a closure change that never happened — so the lane is part of the match, and a digest short
 * enough to name two packets is refused rather than resolved to the first one on disk.
 */
export function readPersisted(root, slug, digest, { mode = null, taskId = null } = {}) {
  const d = packetDir(root, slug);
  if (!existsSync(d) || !digest) return null;
  const wanted = String(digest).trim().toLowerCase();
  if (!/^[0-9a-f]{12,64}$/.test(wanted)) {
    throw new IntentIoError('bad-since', `${JSON.stringify(digest)} is not an inputs digest; pass at least 12 hex characters of the one a previous packet printed`);
  }
  const matches = [];
  for (const file of readdirSync(d).sort()) {
    if (!file.endsWith('.json')) continue;
    let packet;
    try {
      packet = JSON.parse(readFileSync(join(d, file), 'utf8'));
    } catch {
      continue; // an unreadable scratch file is not evidence of anything; the caller regenerates
    }
    if (mode !== null && packet.mode !== mode) continue;
    if (mode !== null && (packet.taskId ?? null) !== (taskId ?? null)) continue;
    if (typeof packet.inputsDigest === 'string' && packet.inputsDigest.startsWith(wanted)) matches.push(packet);
  }
  if (matches.length > 1) {
    throw new IntentIoError('ambiguous-since', `${wanted} names ${matches.length} persisted packets; pass more of the digest`);
  }
  return matches[0] ?? null;
}

/**
 * What a repeat review needs: the inputs that changed since the previous packet, and the open
 * findings, rather than the whole context again. Comparison is over inputs, never timestamps.
 */
export function diffPackets(previous, current) {
  if (!previous) return { known: false, unchanged: false, changed: [], findings: current.findings };
  const changed = [];
  const before = previous.inputs ?? {};
  const after = current.inputs ?? {};
  if (before.contractDigest !== after.contractDigest) changed.push({ kind: 'contract', id: current.rel, was: before.contractDigest, now: after.contractDigest });
  if (before.constraints !== after.constraints) changed.push({ kind: 'constraints', id: 'design.md', was: before.constraints, now: after.constraints });
  const keys = (o) => new Set(Object.keys(o ?? {}));
  for (const group of ['blocks', 'locators', 'findings']) {
    const all = new Set([...keys(before[group]), ...keys(after[group])]);
    for (const id of [...all].sort()) {
      const was = before[group]?.[id];
      const now = after[group]?.[id];
      if (was !== now) changed.push({ kind: group === 'blocks' ? 'block' : group === 'locators' ? 'locator' : 'finding', id, was: was ?? null, now: now ?? null });
    }
  }
  const beforeTasks = (before.tasks ?? []).join(',');
  const afterTasks = (after.tasks ?? []).join(',');
  if (beforeTasks !== afterTasks) changed.push({ kind: 'closure', id: current.taskId ?? 'all', was: beforeTasks, now: afterTasks });
  return { known: true, unchanged: changed.length === 0, changed, findings: current.findings };
}

const listOf = (items, empty) => (items.length ? items : [empty]);

/** The packet as Markdown, in the order a reader needs it: constraints, contract, then detail. */
export function renderPacket(packet, diff = null) {
  const out = [];
  out.push(`# Context packet — ${packet.slug} (${packet.mode === 'final' ? 'final verification' : packet.taskId})`);
  out.push('');
  out.push(`Derived from ${packet.rel}. Scratch, not an authoritative summary; every block below is a copy.`);
  out.push(`Inputs digest: ${packet.inputsDigest}`);
  out.push('');
  if (diff?.known) {
    out.push('## Since the previous packet');
    out.push('');
    if (diff.unchanged) out.push('- nothing this packet is derived from has changed');
    else for (const c of diff.changed) out.push(`- ${c.kind} ${c.id} changed`);
    out.push('');
  }
  out.push('## Constraints');
  out.push('');
  out.push(`### Do-Not-Touch${'\n\n'}${packet.constraints.doNotTouch || '_not declared_'}`);
  out.push('');
  out.push(`### Rebuild / Re-run After Change${'\n\n'}${packet.constraints.rebuild || '_not declared_'}`);
  if (packet.constraints.nonGoals) out.push('', `### Non-Goals${'\n\n'}${packet.constraints.nonGoals}`);
  if (packet.constraints.decisionBoundaries) out.push('', `### Decision Boundaries${'\n\n'}${packet.constraints.decisionBoundaries}`);
  out.push('');
  out.push('## Acceptance criteria (complete)');
  out.push('');
  for (const c of packet.acceptance) out.push(`- ${c.id}${c.required ? '' : ' (optional)'} — ${c.title} [${c.evidenceModes.join(', ') || 'no evidence mode'}]: ${c.checks ?? 'no checks named'}`);
  out.push('');
  out.push(packet.mode === 'final' ? '## Tasks' : '## Selected task and its prerequisites');
  out.push('');
  for (const t of packet.tasks) out.push(`- [${t.checked ? 'x' : ' '}] ${t.id} ${t.title}${t.selected && packet.mode === 'task' ? '  <- selected' : ''}${t.blocked ? `  (blocked: ${t.blocked})` : ''}`);
  out.push('');
  out.push('## Referenced blocks');
  out.push('');
  for (const text of Object.values(packet.blocks.design)) out.push(text, '');
  for (const text of Object.values(packet.blocks.acceptance)) out.push(text, '');
  for (const t of packet.truncated) out.push(`- ${t.kind} ${t.id} not included (${t.bytes} bytes): ${t.path}, retrieve with \`${t.retrieve}\``);
  if (packet.truncated.length) out.push('');
  out.push('## Source locators');
  out.push('');
  for (const l of listOf(packet.locators.map((l) => `- ${l.path} (${l.hash.slice(0, 12)}, ${l.bytes} bytes)`), '- none named by this lane')) out.push(l);
  out.push('');
  out.push('## Open findings');
  out.push('');
  for (const f of listOf(packet.findings.map((f) => `- ${f.id}: ${f.cause} (${f.attempts} attempt(s); ${f.escalation.required ? `escalated to ${f.escalation.lane}` : 'no escalation yet'})`), '- none')) out.push(f);
  if (packet.diagnostics.length) {
    out.push('');
    out.push('## Diagnostics');
    out.push('');
    for (const d of packet.diagnostics) out.push(`- ${d.severity} ${d.code}: ${d.message}`);
  }
  out.push('');
  return out.join('\n');
}

