/**
 * Usage records (contract C-07, design D-07).
 *
 * What this module measures is what a host actually reported, and nothing else. A field the
 * source did not provide stays `null` — never zero, never inferred from character counts, never
 * derived from an account quota or a price list. An aggregate that would have to guess reports
 * that it cannot be totalled instead of producing a number that reads as a measurement.
 *
 * Two accounting traps have explicit answers here. Cached input tokens are a subset of the input
 * tokens, so they are reported beside them and never added again. And a parent actor that reports
 * `inclusive` scope already contains its children, so inclusive values and self values are two
 * separate totals; mixing them would count the same work twice.
 *
 * Failed and abandoned attempts are recorded like any other. Work that did not succeed still
 * cost what it cost, and a report that quietly drops it overstates how cheap the change was.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { IntentIoError, holdsLock } from './intent-io.mjs';
import { readManifest } from './intent-state.mjs';

export const USAGE_SCHEMA_VERSION = 2;
export const ACCOUNTING_SCOPES = ['self', 'inclusive'];
export const OUTCOMES = ['succeeded', 'failed', 'abandoned', 'unknown'];
/** The token fields, all nullable. A missing one means "the source did not say". */
export const TOKEN_FIELDS = ['inputTokens', 'outputTokens', 'cachedInputTokens', 'reasoningTokens'];

const usageDir = (dir) => join(dir, 'usage');
const EVENT_RE = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/;
/**
 * An event id is a file name, and it may not steer the path it is written to. Characters a
 * filesystem will not take are replaced — but two different ids must never land on one file, or
 * the second import would be dropped as a replay and the total would be short. When the name has
 * to be changed at all, it carries a short digest of the id it came from.
 */
const eventFile = (id) => {
  const safe = id.replace(/[^A-Za-z0-9_.-]/g, '-');
  return safe === id ? `${id}.json` : `${safe}-${createHash('sha256').update(id).digest('hex').slice(0, 8)}.json`;
};

const nullableInt = (value, field) => {
  if (value === null || value === undefined) return null;
  if (!Number.isInteger(value) || value < 0) throw new IntentIoError('bad-usage', `${field} must be a non-negative whole number or null; a missing measurement is null, never zero`);
  return value;
};
const isoOrNull = (value, field) => {
  if (value === null || value === undefined) return null;
  const t = Date.parse(value);
  if (Number.isNaN(t)) throw new IntentIoError('bad-usage', `${field} is not an ISO timestamp`);
  return new Date(t).toISOString();
};

/** One normalized record. Everything the payload did not say becomes null, and stays null. */
export function normalizeUsage(payload, { changeId = null } = {}) {
  const eventId = String(payload?.eventId ?? '').trim();
  if (!EVENT_RE.test(eventId)) throw new IntentIoError('bad-usage', 'a usage record needs an eventId from its source, used as its identity');
  const scope = payload.accountingScope ?? null;
  if (scope !== null && !ACCOUNTING_SCOPES.includes(scope)) throw new IntentIoError('bad-usage', `accountingScope must be one of ${ACCOUNTING_SCOPES.join(', ')}, or null when the source did not say`);
  const outcome = payload.outcome ?? 'unknown';
  if (!OUTCOMES.includes(outcome)) throw new IntentIoError('bad-usage', `outcome must be one of ${OUTCOMES.join(', ')}`);
  if (typeof payload.source !== 'string' || !payload.source.trim()) throw new IntentIoError('bad-usage', 'a usage record names the source that reported it; an unattributed number is not a measurement');

  const tokens = {};
  for (const field of TOKEN_FIELDS) tokens[field] = nullableInt(payload[field], field);
  if (tokens.cachedInputTokens !== null && tokens.inputTokens !== null && tokens.cachedInputTokens > tokens.inputTokens) {
    throw new IntentIoError('bad-usage', 'cachedInputTokens is a subset of inputTokens and cannot exceed it');
  }
  const started = isoOrNull(payload.started, 'started');
  const finished = isoOrNull(payload.finished, 'finished');
  if (started && finished && Date.parse(finished) < Date.parse(started)) throw new IntentIoError('bad-usage', 'finished is before started');

  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    eventId,
    changeId,
    attemptId: payload.attemptId ?? null,
    actorId: payload.actorId ?? null,
    parentActorId: payload.parentActorId ?? null,
    stage: payload.stage ?? null,
    outcome,
    started,
    finished,
    source: payload.source,
    accountingScope: scope,
    ...tokens,
    units: payload.units ?? null,
    provider: payload.provider ?? null,
    model: payload.model ?? null,
    importedAt: new Date().toISOString(),
  };
}

/** Every record on disk, oldest event id first. Records are immutable history. */
export function listUsage(dir) {
  const d = usageDir(dir);
  if (!existsSync(d)) return [];
  const out = [];
  for (const file of readdirSync(d).sort()) {
    if (!file.endsWith('.json')) continue;
    try {
      out.push(JSON.parse(readFileSync(join(d, file), 'utf8')));
    } catch {
      out.push({ eventId: file.replace(/\.json$/, ''), unreadable: true });
    }
  }
  return out;
}

/**
 * Plan the import of one payload. A record already on disk under the same event id is not
 * re-imported and not overwritten: a source that replays its events must not inflate the total.
 */
export function importUsage(root, { dir, rel, payload }, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'usage import requires the live intent lock token');
  const record = normalizeUsage(payload, { changeId: readManifest(dir)?.id ?? null });
  const file = eventFile(record.eventId);
  if (existsSync(join(usageDir(dir), file))) return { record, duplicate: true, steps: [] };
  return { record, duplicate: false, steps: [{ kind: 'file', path: `${rel}/usage/${file}`, content: JSON.stringify(record, null, 2) + '\n' }] };
}

/**
 * Sum a token field over records, or report that it cannot be summed. One missing value makes the
 * total unknown: a partial sum presented as a total is the exact mistake this contract forbids.
 */
function sumOrUnknown(records, field) {
  if (!records.length) return { value: null, known: 0, unknown: 0, complete: true };
  let value = 0;
  let known = 0;
  let unknown = 0;
  for (const r of records) {
    if (r[field] === null || r[field] === undefined) unknown += 1;
    else {
      value += r[field];
      known += 1;
    }
  }
  return { value: unknown ? null : value, known, unknown, complete: unknown === 0, partial: unknown ? value : null };
}

/** The union of the intervals the records cover, in milliseconds; overlapping work is not doubled. */
export function wallTimeMs(records) {
  const spans = records
    .filter((r) => r.started && r.finished)
    .map((r) => [Date.parse(r.started), Date.parse(r.finished)])
    .sort((a, b) => a[0] - b[0]);
  const missing = records.filter((r) => !r.started || !r.finished).length;
  if (!spans.length) return { ms: null, missing, spans: 0 };
  let total = 0;
  let [start, end] = spans[0];
  for (const [s, e] of spans.slice(1)) {
    if (s > end) {
      total += end - start;
      [start, end] = [s, e];
    } else if (e > end) end = e;
  }
  total += end - start;
  // one unmeasured interval makes the union a lower bound, and it is reported as one
  return { ms: total, missing, spans: spans.length, lowerBound: missing > 0 };
}

/** Effort may sum actor durations: unlike wall time, two actors working at once cost twice. */
export const effortMs = (records) => {
  const measured = records.filter((r) => r.started && r.finished);
  return { ms: measured.reduce((n, r) => n + (Date.parse(r.finished) - Date.parse(r.started)), 0), missing: records.length - measured.length };
};

const bucket = (records) => {
  const tokens = {};
  for (const field of TOKEN_FIELDS) tokens[field] = sumOrUnknown(records, field);
  return { events: records.length, outcomes: countBy(records, 'outcome'), tokens, wallTime: wallTimeMs(records), effort: effortMs(records) };
};
const countBy = (records, field) => {
  const out = {};
  for (const r of records) out[r[field] ?? 'unknown'] = (out[r[field] ?? 'unknown'] ?? 0) + 1;
  return out;
};
const groupBy = (records, field) => {
  const out = new Map();
  for (const r of records) {
    const key = r[field] ?? 'unattributed';
    if (!out.has(key)) out.set(key, []);
    out.get(key).push(r);
  }
  return [...out.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])));
};

/**
 * The aggregate. Self-scoped and inclusive-scoped records are reported as separate totals and
 * never added together; records whose scope the source did not state are shown on their own and
 * excluded from both, because there is no way to know which total they belong in.
 */
export function usageReport(dir) {
  const all = listUsage(dir);
  const unreadable = all.filter((r) => r.unreadable);
  const records = all.filter((r) => !r.unreadable);
  const self = records.filter((r) => r.accountingScope === 'self');
  const inclusive = records.filter((r) => r.accountingScope === 'inclusive');
  const unscoped = records.filter((r) => r.accountingScope === null || r.accountingScope === undefined);

  const notes = [];
  if (unscoped.length) notes.push(`${unscoped.length} record(s) do not state an accounting scope; they are listed separately and are in no total`);
  if (inclusive.length) notes.push(`${inclusive.length} record(s) are inclusive of their children; the inclusive and self totals overlap and are never added together`);
  for (const field of TOKEN_FIELDS) {
    const missing = records.filter((r) => r[field] === null || r[field] === undefined).length;
    if (missing) notes.push(`${field} is unknown for ${missing} of ${records.length} record(s), so its total is unknown rather than partial`);
  }
  if (unreadable.length) notes.push(`${unreadable.length} record file(s) could not be read and are counted nowhere`);
  if (records.some((r) => r.cachedInputTokens !== null)) notes.push('cachedInputTokens is a subset of inputTokens and is never added to it');

  return {
    schemaVersion: USAGE_SCHEMA_VERSION,
    events: records.length,
    unreadable: unreadable.map((r) => r.eventId),
    scopes: { self: bucket(self), inclusive: bucket(inclusive), unscoped: bucket(unscoped) },
    byStage: Object.fromEntries(groupBy(records, 'stage').map(([k, v]) => [k, bucket(v)])),
    byActor: Object.fromEntries(groupBy(records, 'actorId').map(([k, v]) => [k, bucket(v)])),
    byAttempt: Object.fromEntries(groupBy(records, 'attemptId').map(([k, v]) => [k, bucket(v)])),
    byOutcome: countBy(records, 'outcome'),
    sources: [...new Set(records.map((r) => r.source))].sort(),
    notes,
  };
}

const tokenLine = (label, t) => `    ${label}: ${t.value === null ? `unknown (${t.known} of ${t.known + t.unknown} record(s) reported it)` : t.value}`;
const bucketLines = (label, b) =>
  b.events === 0
    ? [`  ${label}: no records`]
    : [
        `  ${label}: ${b.events} record(s)`,
        ...TOKEN_FIELDS.map((f) => tokenLine(f, b.tokens[f])),
        `    wall time: ${b.wallTime.ms === null ? 'unknown' : `${Math.round(b.wallTime.ms / 1000)}s${b.wallTime.lowerBound ? ' (a lower bound: some records have no interval)' : ''}`}`,
        `    effort: ${b.effort.ms === 0 && b.effort.missing === b.events ? 'unknown' : `${Math.round(b.effort.ms / 1000)}s`}${b.effort.missing ? ` (${b.effort.missing} record(s) without an interval)` : ''}`,
      ];

/** The report as text. Every unknown is named as an unknown. */
export function renderUsage(report, slug) {
  const lines = [`${slug}: ${report.events} usage record(s) from ${report.sources.join(', ') || 'no source'}`];
  lines.push(...bucketLines('self-scoped', report.scopes.self));
  lines.push(...bucketLines('inclusive of children', report.scopes.inclusive));
  if (report.scopes.unscoped.events) lines.push(...bucketLines('scope not stated', report.scopes.unscoped));
  lines.push(`  outcomes: ${Object.entries(report.byOutcome).map(([k, v]) => `${k} ${v}`).join(', ') || 'none'}`);
  for (const note of report.notes) lines.push(`  note: ${note}`);
  return lines.join('\n');
}

/**
 * A comparison between this change and a set of earlier ones. It names its sample and what is
 * absent from it, and it never states a saving: with unknowns in either side, a percentage would
 * be a claim the data cannot support.
 */
export function compareUsage(subject, baselines, { riskClass = null } = {}) {
  const absent = [];
  const totalOf = (r) => r.scopes.self.tokens.inputTokens.value !== null && r.scopes.self.tokens.outputTokens.value !== null;
  if (!totalOf(subject)) absent.push('the subject has unknown token totals');
  for (const b of baselines) if (!totalOf(b.report)) absent.push(`${b.slug} has unknown token totals`);
  if (!baselines.length) absent.push('no comparable change was named');
  if (!riskClass) absent.push('no risk class was stated for the sample');
  return {
    riskClass,
    sample: { subject: subject.events, baselines: baselines.map((b) => ({ slug: b.slug, events: b.report.events })) },
    comparable: absent.length === 0,
    absent,
    // deliberately no ratio, percentage or price: see the module comment
    note: 'this comparison reports coverage and absent data only; it makes no saving or pricing claim',
  };
}
