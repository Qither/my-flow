#!/usr/bin/env node
/**
 * my-flow spec helper: the intent layer without any external tool.
 *
 *   node scripts/spec.mjs new <name>            create changes/<name>/{proposal,design,tasks}.md from templates
 *   node scripts/spec.mjs status [name] [--json] list changes, ticked/total tasks, artifact state
 *   node scripts/spec.mjs validate [name] [--json]  structural checks (all active changes when no name)
 *   node scripts/spec.mjs archive <name> [--force]  move to changes/archive/<date>-<name>/ and merge delta specs
 *   node scripts/spec.mjs abandon <name> [--reason "..."] [--force]  move to changes/archive/<date>-<name>-abandoned/, merge nothing
 *   node scripts/spec.mjs stage <name> <stage> [--force] [--skip-contract-gate]  set .my-flow/state/current-change.json (refreshes `updated`)
 *   node scripts/spec.mjs inspect <name-or-uuid> [--task T-01]  linked tasks, references and readiness
 *   node scripts/spec.mjs upgrade <name> [--apply]   explicit legacy -> linked-intent migration (dry run by default)
 *   node scripts/spec.mjs baseline <name> [--amend A-1]   capture the spec base every delta claim is written against
 *   node scripts/spec.mjs conflicts <name>          compare every delta claim against its captured base
 *   node scripts/spec.mjs review record <name> --file <json> [--amend A-1]   immutable review records
 *   node scripts/spec.mjs finding record|resolve|status <name> [...]   repeated root causes and their design review
 *   node scripts/spec.mjs lane select|set|status <name> [...]   the risk lane and whether its reviews approve the contract
 *   node scripts/spec.mjs context <name> [--task T-01] [--since <digest>]   derived context packet, written to scratch
 *   node scripts/spec.mjs usage <name> [--compare a,b] [--risk low|medium|high] | usage import <name> --file <json>   measured usage, with its unknowns named
 *   node scripts/spec.mjs amend propose|apply|cancel|status <name> [...]   staged contract amendments
 *   node scripts/spec.mjs evidence begin|record|cancel|status <name> [...]  immutable verification attempts
 *   node scripts/spec.mjs repo list|add <alias> --path <dir>|remove <alias>   local cross-repository aliases
 *   node scripts/spec.mjs session new|show|release|recover <key>   session identity and its lease
 *   node scripts/spec.mjs recover [tx-id]          list unfinished intent transactions, or roll one forward
 *
 * Layout (borrowed from OpenSpec, no CLI required):
 *   specs/<capability>/spec.md                       current truth
 *   changes/<name>/proposal.md|design.md|tasks.md    intent for one change
 *   changes/<name>/specs/<capability>/spec.md        delta: ## ADDED|MODIFIED|REMOVED Requirements
 *   changes/archive/<YYYY-MM-DD>-<name>/             archived changes (deltas merged into specs/)
 *   changes/archive/<YYYY-MM-DD>-<name>-abandoned/   abandoned changes (deltas never merged)
 *
 * Options: --root <project dir> (default: cwd), --stale-days <n> (status; default 14, env MY_FLOW_STALE_DAYS),
 * --lock-timeout <ms> (how long to wait for the one repository intent lock; default 2000)
 *
 * Every command runs inside the coordinated I/O protocol of scripts/lib/intent-io.mjs: reads
 * materialize one locked snapshot, writes hold the same lock, a busy lock exits 2 and an
 * unfinished transaction journal asks for `spec recover` instead of serving a mixed state.
 *
 * The status and validate logic lives in scripts/lib/intent.mjs so the dashboard server can call
 * it in-process; this file is the CLI over that library plus the new / archive / abandon / stage
 * commands.
 */
import { randomUUID } from 'node:crypto';
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { listChanges, read, readState, sectionBody, setState, splitRequirements, statusReport, tasks, today, validateReport } from './lib/intent.mjs';
import { IntentIoError, pendingTransactions, recoverTransaction, runTransaction, withIntentLock, withIntentSnapshot, writeFileAtomic } from './lib/intent-io.mjs';
import { inspectChange, inspectText, planChangeUpgrade, readChangeIntentDir } from './lib/intent-graph.mjs';
import { acquireLease, addRepository, createManifest, currentSession, listLeases, readManifest, readRepositories, recoverExpiredLease, releaseLease, removeRepository, resolveChange, resolveSessionIdentity, updateLifecycle } from './lib/intent-state.mjs';
import { amendmentState, applyAmendment, attemptName, contractApproval, declaredScope, escalationFor, executableContractProblems, laneHistory, laneRequirements, listFindings, planLaneChange, recordFinding, resolveFinding, selectLane, beginAttempt, cancelAmendment, cancelAttempt, currentContractDigest, evidenceStatus, parseAttemptName, proposeAmendment, recordAttempt, recordReview } from './lib/evidence.mjs';
import { archivePreflight, captureBaseline, compareBases, inspectCloseout } from './lib/archive.mjs';
import { buildPacket, diffPackets, persistPacket, readPersisted, renderPacket } from './lib/context.mjs';
import { compareUsage, importUsage, renderUsage, usageReport } from './lib/usage.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const TEMPLATES = join(HERE, '..', 'templates', 'change');
const argv = process.argv.slice(2);
const JSON_OUT = argv.includes('--json');
const FORCE = argv.includes('--force');
// waiving the execute contract gate is its own decision: `--force` already means "the change need
// not exist" and "take over a live lease", and recovering a lease must not waive a gate as well
const SKIP_CONTRACT_GATE = argv.includes('--skip-contract-gate');
// planning flags, read here so `lane select` answers the same question mf-plan asks (D-07)
const FAST = argv.includes('--fast');
const DELIBERATE = argv.includes('--deliberate');
const GO = argv.includes('--go');
let root = process.cwd();
const opts = {}; // value-taking flags other than --root
const positional = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--root') root = resolve(argv[++i]);
  else if (argv[i] === '--stale-days' || argv[i] === '--reason' || argv[i] === '--lock-timeout' || argv[i] === '--task' || argv[i] === '--inputs' || argv[i] === '--attempt' || argv[i] === '--result' || argv[i] === '--report' || argv[i] === '--session' || argv[i] === '--actor' || argv[i] === '--amend' || argv[i] === '--expected-revision' || argv[i] === '--path' || argv[i] === '--file' || argv[i] === '--id' || argv[i] === '--review' || argv[i] === '--remedy' || argv[i] === '--lane' || argv[i] === '--paths' || argv[i] === '--since' || argv[i] === '--compare' || argv[i] === '--risk') opts[argv[i]] = argv[++i];
  else if (!argv[i].startsWith('--')) positional.push(argv[i]);
}
const [cmd, name, stageArg] = positional;
const CHANGES = join(root, 'changes');
const SPECS = join(root, 'specs');

const NL = '\n';
/** The lock token of the enclosing `mutate`, so a publication never takes a second lock. */
let currentToken = null;
const publish = (purpose, steps) => runTransaction(root, { purpose, steps }, currentToken);
const out = (obj, text) => console.log(JSON_OUT ? JSON.stringify(obj, null, 2) : text);
const fail = (msg) => {
  console.error(msg);
  process.exit(1);
};

// ---------------------------------------------------------------- coordinated I/O (C-09)
/**
 * Every command body runs inside this wrapper, so the one repository lock is acquired once at
 * the outer operation and the three coordinated failures get stable exits: a busy lock is
 * retryable (exit 2), an unfinished journal asks for recovery, everything else is exit 1.
 */
const lockTimeout = () => {
  const n = Number(opts['--lock-timeout']);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
};
function guarded(fn) {
  try {
    return fn();
  } catch (e) {
    if (!(e instanceof IntentIoError)) throw e;
    const exit = e.code === 'busy' ? 2 : 1;
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: e.code, message: e.message, retryable: e.retryable }, null, 2));
    else console.error(`${e.code}: ${e.message}`);
    process.exit(exit);
  }
}
/** A JSON payload named by a flag; the CLI never takes structured input on the command line. */
const readJsonOpt = (flag) => {
  const p = opts[flag];
  if (!p) fail(`${flag} <file> is required`);
  if (!existsSync(p)) fail(`${flag}: ${p} does not exist`);
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch (e) {
    return fail(`${flag}: ${p} is not valid JSON (${e.message})`);
  }
};
/** One complete multi-file intent read, materialized in memory before anything is printed. */
const snapshot = (purpose, fn) => guarded(() => withIntentSnapshot(root, fn, { purpose, timeoutMs: lockTimeout() }));
/** One coordinated write; nested library calls receive `token` and never take a second lock. */
const mutate = (purpose, fn) =>
  guarded(() =>
    withIntentLock(
      root,
      (token) => {
        const pending = pendingTransactions(root);
        if (pending.length) {
          throw new IntentIoError('recovery-pending', `an intent transaction is unfinished (${pending.map((p) => p.id).join(', ')}); run "spec recover ${pending[0].id}" first`, { pending });
        }
        currentToken = token;
        try {
          return fn(token);
        } finally {
          currentToken = null;
        }
      },
      { purpose, timeoutMs: lockTimeout() }
    )
  );

// ---------------------------------------------------------------- new
/**
 * A project may keep its own `changes/.templates`. A customized set from before v2 has no
 * `.template-version` marker: that project keeps creating legacy changes, with one clear message
 * saying how to move on, rather than having v2 files appear in a template set it maintains.
 */
const templateSet = () => {
  const projectTemplates = join(CHANGES, '.templates');
  const version = existsSync(projectTemplates) ? (read(join(projectTemplates, '.template-version')) ?? '').trim() : null;
  const v2 = !existsSync(projectTemplates) || version === '2';
  const pick = (f) => (existsSync(join(projectTemplates, f)) ? join(projectTemplates, f) : join(TEMPLATES, f));
  return { v2, pick, projectTemplates };
};

if (cmd === 'new') {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name)) fail('usage: spec.mjs new <kebab-case-name>');
  const dir = join(CHANGES, name);
  const { v2, pick } = templateSet();
  mutate('new', (token) => {
    if (existsSync(dir)) fail(`changes/${name} already exists`);
    mkdirSync(dir, { recursive: true });
    for (const f of v2 ? ['proposal.md', 'design.md', 'tasks.md', 'acceptance.md'] : ['proposal.md', 'design.md', 'tasks.md']) {
      cpSync(pick(f), join(dir, f));
    }
    if (v2) createManifest(root, dir, name, { stage: 'new' }, token);
    setState(root, name, 'new');
  });
  const files = v2 ? '{proposal,design,tasks,acceptance}.md + change.json' : '{proposal,design,tasks}.md';
  const legacyNote = v2
    ? ''
    : '\nnote: changes/.templates is a customized template set from before the linked-intent schema, so this change is legacy.' +
      `\n      Add acceptance.md and a ".template-version" file containing "2" to changes/.templates, or run "spec upgrade ${name} --apply" once it is drafted.`;
  out({ change: name, dir, schemaVersion: v2 ? 2 : 1 }, `created changes/${name}/${files}\nnext: fill proposal.md (interview) -> design.md + tasks.md (mf-plan)${legacyNote}`);
  process.exit(0);
}

// ---------------------------------------------------------------- upgrade
if (cmd === 'upgrade') {
  if (!name) fail('usage: spec.mjs upgrade <name> [--apply]   (a dry run unless --apply is given)');
  const APPLY = argv.includes('--apply');
  const r = mutate('upgrade', (token) => {
    const plan = planChangeUpgrade(root, name);
    if (plan.error) return plan;
    if (!APPLY) return { ...plan, applied: false };
    const tx = runTransaction(root, { purpose: `upgrade:${name}`, steps: plan.steps }, token);
    return { ...plan, applied: true, transaction: tx.id };
  });
  if (r.error) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: r.error, message: r.message }, null, 2));
    else console.error(`${r.error}: ${r.message}`);
    process.exit(1);
  }
  const files = r.steps.map((s) => s.path);
  const text = [
    `${r.applied ? 'upgraded' : '[dry run] would upgrade'} ${r.entry.rel} to the linked-intent schema`,
    ...files.map((f) => `  ${r.applied ? 'wrote' : 'would write'} ${f}`),
    'remaining author decisions:',
    ...r.decisions.map((d) => `  - ${d}`),
    r.applied ? `transaction ${r.transaction}` : 'run again with --apply to write these files',
  ].join('\n');
  out({ change: r.entry.slug, applied: r.applied, files, decisions: r.decisions, counts: r.counts, ...(r.transaction ? { transaction: r.transaction } : {}) }, text);
  process.exit(0);
}

// ---------------------------------------------------------------- status
if (cmd === 'status' || cmd === undefined) {
  const r = snapshot('status', () => statusReport(root, { name, staleDays: opts['--stale-days'] }));
  out(r.json, r.text);
  process.exit(0);
}

// ---------------------------------------------------------------- validate
if (cmd === 'validate') {
  const r = snapshot('validate', () => validateReport(root, { name }));
  out(r.json, r.text);
  process.exit(r.failed ? 1 : 0);
}

// ---------------------------------------------------------------- inspect
if (cmd === 'inspect') {
  if (!name) fail('usage: spec.mjs inspect <name-or-uuid> [--task T-01] [--json]');
  const r = snapshot('inspect', () => inspectCloseout(root, name, { task: opts['--task'] ?? null }));
  if (r.error) {
    if (JSON_OUT) console.log(JSON.stringify({ ok: false, error: r.error, message: r.message, ...(r.paths ? { paths: r.paths } : {}) }, null, 2));
    else console.error(`${r.error}: ${r.message}`);
    process.exit(1);
  }
  out(r.projection, inspectText(r.projection));
  process.exit(r.projection.invalid ? 1 : 0);
}

// ---------------------------------------------------------------- baseline
if (cmd === 'baseline') {
  if (!name) fail('usage: spec.mjs baseline <name> [--amend A-1]');
  const located = resolveChange(root, name);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;
  const r = mutate('baseline', (token) => captureBaseline(root, { dir: entry.dir, rel: entry.rel }, { amendment: opts['--amend'] ?? null }, token));
  const text = [
    `${entry.slug}: captured ${r.entries.length} requirement base(s) in ${entry.rel}/spec-base.json`,
    ...r.entries.map((e) => `  ${e.operation} ${e.capability} / ${e.requirement}${e.destination ? ` -> ${e.destination}` : ''} (${e.baseHash ? e.baseHash.slice(0, 12) : 'absent'})`),
  ].join(NL);
  out(r, text);
  process.exit(0);
}

// ---------------------------------------------------------------- conflicts
/** The first line of a requirement block, so a conflict names its three texts without dumping them. */
const firstLine = (text, absent) => (text === null ? absent : `${text.split(NL)[0]} ...`);
if (cmd === 'conflicts') {
  if (!name) fail('usage: spec.mjs conflicts <name>');
  const located = resolveChange(root, name);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;
  const r = snapshot('conflicts', () => compareBases(root, { dir: entry.dir, rel: entry.rel }));
  const text = [
    ...r.diagnostics.map((d) => `diagnostic: ${d.message}`),
    ...r.conflicts.map((c) =>
      [
        `conflict: ${c.operation} ${c.capability} / ${c.requirement}`,
        `  ${c.reason}`,
        `  base:     ${firstLine(c.base, '(absent)')}`,
        `  current:  ${firstLine(c.current, '(absent)')}`,
        `  proposed: ${firstLine(c.proposed, '(removal)')}`,
      ].join(NL)
    ),
    r.conflicts.length || r.diagnostics.length ? '' : 'no conflicts: every delta claim still matches the base it was written against',
  ]
    .filter(Boolean)
    .join(NL);
  out(r, text);
  process.exit(r.conflicts.length || r.diagnostics.length ? 1 : 0);
}

// ---------------------------------------------------------------- review
if (cmd === 'review') {
  const sub = name;
  const changeRef = stageArg;
  if (sub !== 'record' || !changeRef) fail('usage: spec.mjs review record <name> --file <review.json> [--amend A-1]');
  const located = resolveChange(root, changeRef);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;
  const review = readJsonOpt('--file');
  const r = mutate('review-record', (token) => {
    const amendment = opts['--amend'] ?? null;
    // a review of a staged candidate names the candidate's digest, not the live contract's
    const digest = review.contractDigest ?? (amendment ? null : currentContractDigest(root, entry.dir, entry.rel));
    if (!digest) fail('a review of an amendment must name the candidate contractDigest it reviewed');
    return recordReview(root, { dir: entry.dir, rel: entry.rel, review: { ...review, amendment, contractDigest: digest } }, token);
  });
  out(r, `${entry.slug}: recorded review ${r.id} (${r.role} ${r.verdict})${r.independent ? '' : ' [not independent: the reviewer and the writer are the same actor, or one is unnamed]'}`);
  process.exit(0);
}

// ---------------------------------------------------------------- amend
if (cmd === 'amend') {
  const sub = name;
  const changeRef = stageArg;
  if (!sub) fail('usage: spec.mjs amend <propose|apply|cancel|status> <name> [...]');
  const located = resolveChange(root, changeRef ?? '');
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;
  const where = { dir: entry.dir, rel: entry.rel };

  if (sub === 'status') {
    const r = snapshot('amend-status', () => ({ ...amendmentState(entry.dir), digest: currentContractDigest(root, entry.dir, entry.rel) }));
    const text = [
      `${entry.slug}: approved contract ${r.digest.slice(0, 12)}`,
      r.pending ? `pending: ${r.pending.id} (${r.pending.candidate?.type ?? 'unknown type'}) holding ${r.pending.candidate?.affected?.length ?? 0} task(s)` : 'no pending amendment',
      ...r.all.map((a) => `  ${a.id}: ${a.state}${a.candidate ? ` (${a.candidate.type})` : ''}`),
    ].join(NL);
    out(r, text);
    process.exit(0);
  }
  if (sub === 'propose') {
    const candidate = readJsonOpt('--file');
    const r = mutate('amend-propose', (token) => {
      const planned = proposeAmendment(root, { ...where, candidate }, token);
      publish(`amend-propose:${planned.record.id}`, planned.steps);
      return planned.record;
    });
    out(r, [`${entry.slug}: staged amendment ${r.id} (${r.type})`, `  held task(s): ${r.affected.join(', ') || 'none'}`, `  the approved contract stays in force; unaffected tasks may continue`].join(NL));
    process.exit(0);
  }
  if (sub === 'apply') {
    const id = opts['--id'];
    if (!id) fail('usage: spec.mjs amend apply <name> --id A-1');
    const r = mutate('amend-apply', (token) => {
      const planned = applyAmendment(root, { ...where, id }, token);
      publish(`amend-apply:${id}`, planned.steps);
      return planned;
    });
    out({ applied: id, affected: r.affected }, [`${entry.slug}: applied ${id}`, `  reopened task(s): ${r.affected.join(', ') || 'none'}`, '  their evidence links were removed; they need fresh verification'].join(NL));
    process.exit(0);
  }
  if (sub === 'cancel') {
    const id = opts['--id'];
    if (!id) fail('usage: spec.mjs amend cancel <name> --id A-1 [--reason "..."]');
    mutate('amend-cancel', (token) => {
      const planned = cancelAmendment(root, { ...where, id, reason: opts['--reason'] }, token);
      publish(`amend-cancel:${id}`, planned.steps);
      return planned;
    });
    out({ cancelled: id }, [`${entry.slug}: cancelled ${id}; the approved contract is unchanged`, '  tasks that were reopened stay reopened until they are verified again'].join(NL));
    process.exit(0);
  }
  fail('usage: spec.mjs amend <propose|apply|cancel|status> <name> [--file f] [--id A-1]');
}

// ---------------------------------------------------------------- usage
if (cmd === 'usage') {
  const sub = name === 'import' ? 'import' : 'report';
  const changeRef = sub === 'import' ? stageArg : name;
  if (!changeRef) fail('usage: spec.mjs usage <name> [--json] | spec.mjs usage import <name> --file <json>');
  const located = resolveChange(root, changeRef);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;

  if (sub === 'import') {
    const payload = readJsonOpt('--file');
    const r = mutate('usage-import', (token) => {
      const planned = importUsage(root, { dir: entry.dir, rel: entry.rel, payload }, token);
      if (planned.steps.length) publish(`usage:${planned.record.eventId}`, planned.steps);
      return planned;
    });
    out(
      { record: r.record, duplicate: r.duplicate },
      r.duplicate
        ? `${entry.slug}: ${r.record.eventId} was already imported; a replayed event is never counted twice`
        : `${entry.slug}: imported ${r.record.eventId} from ${r.record.source} (${r.record.outcome}, ${r.record.accountingScope ?? 'scope not stated'})`
    );
    process.exit(0);
  }
  const against = (opts['--compare'] ?? '').split(',').map((x) => x.trim()).filter(Boolean);
  const r = snapshot('usage', () => {
    const report = usageReport(entry.dir);
    if (!against.length) return { report, comparison: null };
    const baselines = against.map((ref) => {
      const other = resolveChange(root, ref);
      if (other.error) fail(`${other.error}: ${other.message}`);
      return { slug: other.entry.slug, report: usageReport(other.entry.dir) };
    });
    return { report, comparison: compareUsage(report, baselines, { riskClass: opts['--risk'] ?? null }) };
  });
  const text = [
    renderUsage(r.report, entry.slug),
    ...(r.comparison
      ? [
          `  compared with ${r.comparison.sample.baselines.map((b) => `${b.slug} (${b.events})`).join(', ')} at risk class ${r.comparison.riskClass ?? 'unstated'}`,
          ...r.comparison.absent.map((a) => `  absent: ${a}`),
          `  ${r.comparison.note}`,
        ]
      : []),
  ].join(NL);
  out(r.comparison ? r : r.report, text);
  process.exit(0);
}

// ---------------------------------------------------------------- context packets
if (cmd === 'context') {
  const changeRef = name;
  if (!changeRef) fail('usage: spec.mjs context <name> [--task T-01] [--since <digest>] [--json]');
  const located = resolveChange(root, changeRef);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;
  const since = opts['--since'] ?? null;
  const r = snapshot('context', () => {
    const packet = buildPacket(root, { dir: entry.dir, rel: entry.rel, slug: entry.slug, taskId: opts['--task'] ?? null });
    const previous = since ? readPersisted(root, entry.slug, since, { mode: packet.mode, taskId: packet.taskId }) : null;
    // a digest that names no packet of this lane is refused: silently answering with a full
    // packet would look like "nothing changed" when the truth is "I never saw that version"
    if (since && !previous) {
      throw new IntentIoError(
        'no-such-packet',
        `no ${packet.mode} packet for ${packet.taskId ?? 'the whole change'} has inputs digest ${since}; regenerate without --since, or pass the digest a previous run printed`
      );
    }
    const diff = diffPackets(previous, packet);
    // scratch only: a packet is derived, and is regenerated rather than trusted
    const path = persistPacket(root, entry.slug, packet);
    return { packet, diff, path };
  });
  out({ packet: r.packet, diff: r.diff, path: relative(root, r.path).replace(/\\/g, '/') }, renderPacket(r.packet, r.diff));
  process.exit(r.packet.diagnostics.some((d) => d.severity === 'error') ? 1 : 0);
}

// ---------------------------------------------------------------- review lanes
if (cmd === 'lane') {
  const sub = name;
  const changeRef = stageArg;
  if (!sub || !changeRef) fail('usage: spec.mjs lane <select|set|status> <name> [...]');
  const located = resolveChange(root, changeRef);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;

  if (sub === 'status') {
    const r = snapshot('lane-status', () => ({ ...contractApproval(root, { dir: entry.dir, rel: entry.rel }), history: laneHistory(entry.dir) }));
    const text = [
      r.declared ? `${entry.slug}: ${r.lane} lane, contract ${r.digest.slice(0, 12)}` : `${entry.slug}: no review lane recorded`,
      r.requirements ? `  needs: ${r.requirements.summary}` : '',
      r.approved ? `  approved ${r.via === 'chain' ? `through the applied amendment chain ${r.chain.join(' <- ')}` : 'directly'}` : '  not approved',
      ...r.reasons.map((x) => `  ${x}`),
      ...r.history.map((h) => `  ${h.recordedAt.slice(0, 10)} ${h.direction} -> ${h.lane}${h.forced ? ' (forced)' : ''}: ${h.reason}`),
    ]
      .filter(Boolean)
      .join(NL);
    out(r, text);
    process.exit(r.approved ? 0 : 1);
  }
  if (sub === 'select') {
    // a selection is advice: it says which lane the change belongs in and why, and records nothing
    const input = opts['--file'] ? readJsonOpt('--file') : {};
    const r = snapshot('lane-select', () => {
      const manifest = readManifest(entry.dir);
      return selectLane({ ...input, current: input.current ?? manifest?.review?.lane ?? null, fast: FAST, deliberate: DELIBERATE, go: GO });
    });
    const text = [
      `${entry.slug}: ${r.lane} lane (automatic: ${r.automatic})`,
      ...r.reasons.map((x) => `  ${x}`),
      ...r.refusals.map((x) => `  refused: ${x}`),
      `  needs: ${laneRequirements(r.lane).summary}`,
      '  selecting a lane authorizes nothing; record it, then record the reviews it names',
    ].join(NL);
    out(r, text);
    process.exit(0);
  }
  if (sub === 'set') {
    const lane = opts['--lane'];
    if (!lane) fail('usage: spec.mjs lane set <name> --lane <low|medium|high> --reason "..." [--paths a,b] [--force]');
    const reason = opts['--reason'];
    if (!reason) fail('a recorded lane names the risk rationale it was chosen for: --reason "..."');
    const paths = (opts['--paths'] ?? '').split(',').map((p) => p.trim()).filter(Boolean);
    const r = mutate('lane-set', (token) => {
      const planned = planLaneChange(root, { dir: entry.dir, rel: entry.rel, lane, reason, paths, force: FORCE });
      // the lane is history first, then the manifest field the digest reads
      publish(`lane:${planned.record.sequence}`, planned.steps);
      return { ...updateLifecycle(root, entry.dir, { review: planned.review }, {}, token), lane: planned.record };
    });
    out(
      { slug: entry.slug, review: r.review, revision: r.revision, lane: r.lane },
      [`${entry.slug}: recorded the ${lane} review lane (${r.lane.direction})`, `  ${reason}`, '  the contract digest changed with it, so this lane needs its own reviews'].join(NL)
    );
    process.exit(0);
  }
  fail('usage: spec.mjs lane <select|set|status> <name> [--lane l] [--reason "..."] [--paths a,b] [--file f]');
}

// ---------------------------------------------------------------- findings
if (cmd === 'finding') {
  const sub = name;
  const changeRef = stageArg;
  if (!sub || !changeRef) fail('usage: spec.mjs finding <record|resolve|status> <name> [...]');
  const located = resolveChange(root, changeRef);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;
  const where = { dir: entry.dir, rel: entry.rel };

  if (sub === 'status') {
    const findings = snapshot('finding-status', () => listFindings(entry.dir).map((f) => ({ ...f, escalation: escalationFor(f) })));
    const text = findings.length
      ? findings
          .map((f) =>
            [`${f.id}: ${f.cause}`, `  ${f.escalation.required ? `escalated (${f.escalation.lane})` : 'no escalation'}: ${f.escalation.reason}`, `  tasks: ${f.tasks.join(', ') || 'none'}`].join(NL)
          )
          .join(NL)
      : 'no findings recorded';
    out({ findings }, text);
    process.exit(0);
  }
  if (sub === 'record') {
    const finding = readJsonOpt('--file');
    const r = mutate('finding-record', (token) => {
      const planned = recordFinding(root, { ...where, finding }, token);
      publish(`finding:${planned.record.id}`, planned.steps);
      return planned;
    });
    out({ finding: r.record, escalation: r.escalation }, [`${entry.slug}: ${r.record.id} now has ${r.record.attempts.length} recorded attempt(s)`, `  ${r.escalation.reason}`].join(NL));
    // exit 1 when another attempt must wait for a reviewer, so a script cannot miss it
    process.exit(r.escalation.required ? 1 : 0);
  }
  if (sub === 'resolve') {
    const id = opts['--id'];
    if (!id) fail('usage: spec.mjs finding resolve <name> --id F-1 --review R-1 [--remedy "..."]');
    const r = mutate('finding-resolve', (token) => {
      const planned = resolveFinding(root, { ...where, id, reviewId: opts['--review'], remedy: opts['--remedy'] }, token);
      publish(`finding-resolve:${id}`, planned.steps);
      return planned;
    });
    out(r.record, `${entry.slug}: ${id} resolved by ${r.record.resolvedBy}; the tasks it held are released`);
    process.exit(0);
  }
  fail('usage: spec.mjs finding <record|resolve|status> <name> [--file f] [--id F-1] [--review R-1]');
}

// ---------------------------------------------------------------- evidence
/** The change's own required acceptance criteria and their declared evidence modes. */
const requiredCriteriaOf = (entry) => {
  const intent = readChangeIntentDir(entry.dir, entry.slug, { rel: entry.rel });
  return intent.acceptance.criteria.filter((c) => c.required).map((c) => ({ id: c.id, modes: c.evidenceModes ?? [] }));
};
if (cmd === 'evidence') {
  const sub = name; // spec evidence <sub> <name>
  const changeRef = stageArg;
  if (!sub || !changeRef) fail('usage: spec.mjs evidence <begin|record|cancel|status> <name> [...]');
  const located = resolveChange(root, changeRef);
  if (located.error) fail(`${located.error}: ${located.message}`);
  const entry = located.entry;
  const where = { dir: entry.dir, rel: entry.rel };

  if (sub === 'status') {
    const s = snapshot('evidence-status', () => evidenceStatus(root, where));
    const text = [
      `${entry.slug}: high-water ${s.highWater ?? 'unknown'}; head ${s.head ? `${attemptName(s.head.sequence)} ${s.head.state}${s.head.verdict ? ` ${s.head.verdict}` : ''}` : 'none'}`,
      `eligible for a verified archive: ${s.eligible ? 'yes' : 'no'}`,
      ...s.reasons.map((r) => `  - ${r}`),
      ...(s.missingOlder?.length ? [`  - older attempt(s) no longer on disk: ${s.missingOlder.join(', ')}`] : []),
    ].join('\n');
    out(s, text);
    process.exit(s.eligible ? 0 : 1);
  }
  if (sub === 'begin') {
    // the change's own declared scope is the default: it is the only one `beginAttempt` accepts
    const inputs = opts['--inputs'] ? readJsonOpt('--inputs') : declaredScope(entry.dir);
    const r = mutate('evidence-begin', (token) =>
      beginAttempt(root, { ...where, inputs, requiredCriteria: requiredCriteriaOf(entry), session: opts['--session'] ?? process.env.MY_FLOW_SESSION_ID ?? null, actorId: opts['--actor'] ?? null }, token)
    );
    out(
      { attempt: attemptName(r.sequence), sequence: r.sequence, dir: r.dir, requestDigest: r.requestDigest, implementationDigest: r.request.implementationDigest, acceptanceDigest: r.request.acceptanceDigest },
      `${entry.slug}: opened ${attemptName(r.sequence)}\n  implementation ${r.request.implementationDigest.slice(0, 12)}\n  acceptance     ${r.request.acceptanceDigest.slice(0, 12)}\n  required       ${r.request.requiredCriteria.map((c) => c.id).join(', ') || 'none declared'}`
    );
    process.exit(0);
  }
  if (sub === 'record') {
    const sequence = parseAttemptName(opts['--attempt']);
    if (sequence === null) fail('--attempt V-<n> is required');
    const result = readJsonOpt('--result');
    const reportPath = opts['--report'];
    if (!reportPath || !existsSync(reportPath)) fail('--report <markdown file> is required and must exist');
    const reportText = readFileSync(reportPath, 'utf8');
    const r = mutate('evidence-record', (token) =>
      recordAttempt(root, { ...where, sequence, result, reportText, artifacts: result.artifacts ?? [], requiredCriteria: requiredCriteriaOf(entry) }, token)
    );
    out(r, `${entry.slug}: recorded ${attemptName(sequence)} as ${r.verdict}${r.qualified ? ' (independent)' : ' (unqualified provenance)'}`);
    process.exit(r.verdict === 'PASS' ? 0 : 1);
  }
  if (sub === 'cancel') {
    const sequence = parseAttemptName(opts['--attempt']);
    if (sequence === null) fail('--attempt V-<n> is required');
    const r = mutate('evidence-cancel', (token) => cancelAttempt(root, { ...where, sequence, reason: opts['--reason'] }, token));
    out(r, `${entry.slug}: cancelled ${attemptName(sequence)} as INCOMPLETE (${r.cancelled.reason})`);
    process.exit(0);
  }
  fail('usage: spec.mjs evidence <begin|record|cancel|status> <name> [...]');
}

// ---------------------------------------------------------------- recover
if (cmd === 'recover') {
  const pending = pendingTransactions(root);
  if (!name) {
    out({ pending }, pending.length ? pending.map((p) => `${p.id}: ${p.phase} (${p.purpose ?? 'unknown purpose'})`).join('\n') : 'no unfinished intent transactions');
    process.exit(0);
  }
  const r = guarded(() => recoverTransaction(root, name));
  out(r, [...r.log, `${r.id}: ${r.phase} (${r.applied} step(s) rolled forward)`].join('\n'));
  process.exit(0);
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
  const r = mutate('archive', () => archiveNow());
  // the existing keys are unchanged; `verification` says which guarantee this publication carries
  out({ archived: name, dest: r.dest, log: r.log, verification: r.classification, warnings: r.warnings }, [...r.warnings.map((w) => `warn: ${w}`), ...r.log].join(NL));
  process.exit(0);
}
/**
 * Preflight first, in memory, then publish. `--force` keeps only the pre-v2 escape hatch for a
 * legacy change, and even then the receipt says `unverified-legacy`: it never grants trust.
 */
function archiveNow() {
  const located = resolveChange(root, name);
  if (located.error || located.entry.location !== 'active') fail(`changes/${name} does not exist`);
  const entry = located.entry;
  const pre = archivePreflight(root, { dir: entry.dir, rel: entry.rel, slug: entry.slug, schemaVersion: entry.schemaVersion }, { force: FORCE, date: today() });
  if (!pre.ok) {
    fail(
      [
        'refusing to archive:',
        ...pre.blockers.map((b) => `  ${b.code}: ${b.message}`),
        ...(FORCE && entry.schemaVersion === 2 ? ['  --force cannot bypass these checks for a linked change'] : []),
      ].join(NL)
    );
  }
  // One journalled transaction (C-05, C-09): every spec write, then the relocation, then the
  // receipt at its final home. A crash at any point leaves a journal `spec recover` rolls forward.
  const archivedRel = `changes/archive/${pre.destName}`;
  const steps = [
    ...pre.outputs.map((o) => ({ kind: 'file', path: o.path, content: o.content })),
    { kind: 'move', from: entry.rel, to: archivedRel },
    { kind: 'file', path: `${archivedRel}/archive-receipt.json`, content: JSON.stringify(pre.receipt, null, 2) + '\n' },
  ];
  const tx = publish(`archive:${entry.slug}`, steps);
  const log = [...pre.log, `moved ${entry.rel} -> ${archivedRel}`, `verification: ${pre.classification}`, `transaction ${tx.id}`];
  markArchived(entry.slug);
  return { dest: join(root, archivedRel), log, classification: pre.classification, warnings: pre.warnings, transaction: tx.id };
}
/** The current-change pointer follows the publication; it is state, not part of the transaction. */
function markArchived(slug) {
  try {
    if (readState(root)?.change === slug) setState(root, slug, 'archived');
  } catch {
    /* the pointer is a convenience; a publication is never undone because it could not be updated */
  }
}

// ---------------------------------------------------------------- abandon
if (cmd === 'abandon') {
  if (!name) fail('usage: spec.mjs abandon <name> [--reason "..."] [--force]');
  const { dest, log } = mutate('abandon', () => abandonNow());
  out({ abandoned: name, dest, log }, log.join(NL));
  process.exit(0);
}
function abandonNow() {
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
  // The relocation still goes through the journal, so an interruption is recoverable, and the
  // receipt says `abandoned` so it can never be mistaken for a verified publication.
  const abandonedRel = `changes/archive/${today()}-${name}-abandoned`;
  const receipt = { schemaVersion: 2, change: name, archivedAs: abandonedRel, at: new Date().toISOString(), verification: 'abandoned', reason: reasonLine(), outputs: [] };
  const tx = publish(`abandon:${name}`, [
    { kind: 'move', from: `changes/${name}`, to: abandonedRel },
    { kind: 'file', path: `${abandonedRel}/archive-receipt.json`, content: JSON.stringify(receipt, null, 2) + NL },
  ]);
  const log = [`abandoned changes/${name} (${reasonLine()})`, `moved changes/${name} -> ${abandonedRel}`, `transaction ${tx.id}`];
  markArchived(name);
  return { dest: join(root, abandonedRel), log };
}

// ---------------------------------------------------------------- stage
const STAGES = ['new', 'interview', 'mf-plan', 'execute', 'done', 'archived'];
if (cmd === 'stage') {
  if (!name || !/^[a-z0-9][a-z0-9-]*$/.test(name) || !stageArg) fail(`usage: spec.mjs stage <kebab-case-name> <${STAGES.join('|')}> [--force] [--skip-contract-gate]`);
  if (!STAGES.includes(stageArg)) fail(`unknown stage "${stageArg}" (expected one of: ${STAGES.join(', ')})`);
  const known = existsSync(join(CHANGES, name)) || existsSync(join(root, 'docs', 'changes', `${name}.md`));
  if (!known && !FORCE) fail(`changes/${name} does not exist (use --force to set the state anyway)`);
  const identity = resolveSessionIdentity({ option: opts['--session'] });
  const located = resolveChange(root, name);
  const entry = located.entry ?? null;
  const r = mutate('stage', (token) => {
    // Entering execute is a claim that the contract can be executed and that its lane approved it
    // (C-01, C-06, C-07). A legacy change has no linked contract to check, and an undeclared lane
    // is not held to reviews nobody asked for. The check reads a whole multi-file intent, so it
    // reads it inside the lock the write already holds, like every other read in this file.
    if (stageArg === 'execute' && entry && entry.schemaVersion === 2 && !SKIP_CONTRACT_GATE) {
      const problems = executableContractProblems(entry.dir, entry.rel);
      if (problems.length) {
        throw new IntentIoError('invalid-contract', `${entry.rel} is not an executable contract, so execute cannot start: ${problems.map((p) => p.message).join('; ')} (use --skip-contract-gate to stage it anyway)`);
      }
      const approval = contractApproval(root, { dir: entry.dir, rel: entry.rel });
      if (approval.declared && !approval.approved) {
        throw new IntentIoError(
          'unapproved-contract',
          `${entry.rel} declares the ${approval.lane} review lane, and this contract is not approved for it: ${approval.reasons.join('; ')} (use --skip-contract-gate to stage it anyway)`
        );
      }
    }
    if (identity.source === 'unidentified') {
      // the legacy pointer is a compatibility hint, and only while no session lease can be meant
      const ambiguity = currentSession(root, identity);
      if (ambiguity.ambiguous) {
        throw new IntentIoError('session-required', `${ambiguity.reason}; pass --session <id> (or set MY_FLOW_SESSION_ID) so this stage binds to one session instead of borrowing another`);
      }
      return { state: setState(root, name, stageArg), lease: null, lifecycle: null, identity };
    }
    // an identified session binds itself, and never writes the global pointer
    const lease = acquireLease(root, { key: identity.key, sessionId: identity.sessionId, changeId: entry?.id ?? name, stage: stageArg, takeOver: FORCE }, token);
    let lifecycle = null;
    if (entry && entry.schemaVersion === 2) {
      const expected = opts['--expected-revision'] === undefined ? null : Number(opts['--expected-revision']);
      lifecycle = updateLifecycle(root, entry.dir, { stage: stageArg }, { expectedRevision: Number.isFinite(expected) ? expected : null }, token);
    }
    return { state: null, lease, lifecycle, identity };
  });
  const text = r.state
    ? `${name}: stage ${stageArg} (updated ${r.state.updated})`
    : [
        `${name}: stage ${stageArg} for session ${r.identity.sessionId} (from ${r.identity.source})`,
        `  lease until ${r.lease.leaseUntil}`,
        r.lifecycle ? `  lifecycle revision ${r.lifecycle.revision}` : '  legacy change: no lifecycle metadata to update',
      ].join(NL);
  out(r.state ?? { change: name, stage: stageArg, session: r.identity.sessionId, source: r.identity.source, lease: r.lease, lifecycle: r.lifecycle }, text);
  process.exit(0);
}

// ---------------------------------------------------------------- repo aliases
if (cmd === 'repo') {
  const sub = name;
  if (sub === 'list' || sub === undefined) {
    const repositories = snapshot('repo-list', () => readRepositories(root));
    const rows = Object.entries(repositories);
    out({ repositories }, rows.length ? rows.map(([alias, v]) => `${alias} -> ${v.root}`).join(NL) : 'no repository aliases registered in this checkout');
    process.exit(0);
  }
  if (sub === 'add') {
    if (!stageArg || !opts['--path']) fail('usage: spec.mjs repo add <alias> --path <directory>');
    const r = mutate('repo-add', (token) => addRepository(root, stageArg, opts['--path'], token));
    out(r, `${r.alias} -> ${r.root}`);
    process.exit(0);
  }
  if (sub === 'remove') {
    if (!stageArg) fail('usage: spec.mjs repo remove <alias>');
    const removed = mutate('repo-remove', (token) => removeRepository(root, stageArg, token));
    out({ removed, alias: stageArg }, removed ? `removed the alias ${stageArg}` : `no alias ${stageArg} is registered`);
    process.exit(0);
  }
  fail('usage: spec.mjs repo <list|add <alias> --path <dir>|remove <alias>>');
}
// ---------------------------------------------------------------- session
if (cmd === 'session') {
  const sub = name;
  if (sub === 'new') {
    const id = randomUUID();
    out({ sessionId: id }, `${id}\nexport MY_FLOW_SESSION_ID=${id}   (or pass --session ${id} to every spec command of this session)`);
    process.exit(0);
  }
  const identity = resolveSessionIdentity({ option: opts['--session'] });
  if (sub === 'show' || sub === undefined) {
    const r = snapshot('session-show', () => ({ identity, current: currentSession(root, identity), leases: listLeases(root) }));
    const text = [
      `identity: ${r.identity.sessionId ?? 'unidentified'} (from ${r.identity.source})`,
      `binding: ${r.current.lease ? `${r.current.lease.changeId} at stage ${r.current.lease.stage} until ${r.current.lease.leaseUntil}` : (r.current.reason ?? 'none')}`,
      ...r.leases.map((l) => `  ${l.key.slice(0, 12)} ${l.state}${l.lease ? `: ${l.lease.changeId} (${l.lease.stage})` : ''}`),
    ].join(NL);
    out(r, text);
    process.exit(0);
  }
  if (sub === 'release') {
    if (!identity.key) fail('no session to release: pass --session <id> or set MY_FLOW_SESSION_ID');
    const released = mutate('session-release', (token) => releaseLease(root, identity.key, token));
    out({ released, sessionId: identity.sessionId }, released ? `released the lease of session ${identity.sessionId}` : `session ${identity.sessionId} held no lease`);
    process.exit(0);
  }
  if (sub === 'recover') {
    const key = stageArg;
    if (!key) fail('usage: spec.mjs session recover <lease-key>');
    const r = mutate('session-recover', (token) => recoverExpiredLease(root, key, {}, token));
    out({ recovered: key, previous: r.lease }, `recovered the expired lease ${key.slice(0, 12)} (was ${r.lease?.changeId ?? 'unreadable'})`);
    process.exit(0);
  }
  fail('usage: spec.mjs session <new|show|release|recover <key>> [--session <id>]');
}

fail(
  'usage: spec.mjs <new <name> | status [name] [--stale-days n] | validate [name] | archive <name> | abandon <name> [--reason "..."] | stage <name> <stage> [--session id] | session <new|show|release> | inspect <name-or-uuid> [--task T-01] | upgrade <name> [--apply] | baseline <name> | conflicts <name> | evidence <begin|record|cancel|status> <name> | recover [tx-id]> [--json] [--force] [--lock-timeout ms] [--root dir]'
);
