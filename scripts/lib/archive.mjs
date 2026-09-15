/**
 * my-flow spec bases, conflict diagnosis and recoverable publication (contracts C-05, C-09).
 *
 * Archive is a publication, not a copy. What makes it safe is that the base each delta was
 * written against is captured *when the plan is finalized*, never re-read at archive time: a
 * requirement that someone else changed in between is then a conflict with three visible texts
 * (base, current, proposed) rather than a silent overwrite.
 *
 * Every function takes `root` explicitly and only reads, except the writers, which require the
 * caller's C-09 lock token.
 */
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { IntentIoError, holdsLock, pendingTransactions, writeFileAtomic } from './intent-io.mjs';
import { overlapIndex, overlapText, sectionBody, splitRequirements, validateSpecText } from './intent.mjs';
import { attemptDir, attemptList, attemptName, attemptProjection, capturedAcceptance, captureTarget, contractApproval, evidenceStatus, executableContractProblems, parseAttemptName, sha256Hex, withoutViaMarkers } from './evidence.mjs';
import { inspectChange, inspectReference, readChangeIntentDir } from './intent-graph.mjs';
import { readManifest, resolveUmbrella } from './intent-state.mjs';

export const BASE_FILE = 'spec-base.json';
export const OPERATIONS = ['ADDED', 'MODIFIED', 'REMOVED', 'RENAMED'];
const RENAMED_FROM_RE = /^-\s*FROM:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/;
const RENAMED_TO_RE = /^-\s*TO:\s*`?###\s*Requirement:\s*(.+?)`?\s*$/;
const lf = (s) => String(s ?? '').replace(/\r\n/g, '\n');
const diag = (code, message, extra = {}) => ({ code, message, ...extra });

/** Normalized requirement text: LF endings, generated provenance markers dropped, trimmed end. */
export const normalizeRequirement = (text) => withoutViaMarkers(lf(text)).trimEnd();
export const requirementHash = (text) => (text === null ? null : sha256Hex(normalizeRequirement(text)));

/**
 * Every requirement this delta claims, as
 * `[{ operation, requirement, destination, proposedText }]`. A RENAMED pair is read from its
 * `- FROM:` / `- TO:` lines, because a rename's source is not a heading in the delta.
 */
export function deltaClaims(deltaText, { path = 'spec.md' } = {}) {
  const claims = [];
  const diagnostics = [];
  const text = lf(deltaText ?? '');
  for (const operation of ['ADDED', 'MODIFIED', 'REMOVED']) {
    const body = sectionBody(text, `${operation} Requirements`);
    // splitRequirements keys by name, so a repeated heading would silently collapse; count first
    const headings = [...body.matchAll(/^###\s*Requirement:\s*(.+)$/gm)].map((m) => m[1].trim());
    const counted = new Map();
    for (const h of headings) counted.set(h, (counted.get(h) ?? 0) + 1);
    for (const [requirement, n] of counted) {
      if (n > 1) diagnostics.push(diag('duplicate-requirement', `${path}: ${operation} names "${requirement}" twice`, { path, requirement, operation }));
    }
    for (const [requirement, block] of splitRequirements(body).blocks) {
      claims.push({ operation, requirement, destination: null, proposedText: operation === 'REMOVED' ? null : normalizeRequirement(block) });
    }
  }
  // RENAMED: one FROM and the TO that follows it
  const lines = sectionBody(text, 'RENAMED Requirements').split('\n');
  let from = null;
  for (const line of lines) {
    const f = RENAMED_FROM_RE.exec(line);
    if (f) {
      if (from) diagnostics.push(diag('incomplete-rename', `${path}: RENAMED "${from}" has no "- TO:" line`, { path, requirement: from, operation: 'RENAMED' }));
      from = f[1].trim();
      continue;
    }
    const t = RENAMED_TO_RE.exec(line);
    if (t && from) {
      claims.push({ operation: 'RENAMED', requirement: from, destination: t[1].trim(), proposedText: null });
      from = null;
    } else if (t && !from) {
      diagnostics.push(diag('incomplete-rename', `${path}: RENAMED "- TO: ${t[1].trim()}" has no "- FROM:" line above it`, { path, requirement: t[1].trim(), operation: 'RENAMED' }));
    }
  }
  if (from) diagnostics.push(diag('incomplete-rename', `${path}: RENAMED "${from}" has no "- TO:" line`, { path, requirement: from, operation: 'RENAMED' }));

  const keys = new Set();
  for (const c of claims) {
    const key = `${c.operation}/${c.requirement}`;
    if (keys.has(key)) diagnostics.push(diag('duplicate-requirement', `${path}: "${c.requirement}" is claimed twice under ${c.operation}`, { path, requirement: c.requirement, operation: c.operation }));
    keys.add(key);
  }
  return { claims, diagnostics };
}

/** The current text of one requirement in the main spec, or null when it is not there. */
export function currentRequirement(root, capability, requirement) {
  const p = join(root, 'specs', capability, 'spec.md');
  if (!existsSync(p)) return null;
  const { blocks } = splitRequirements(readFileSync(p, 'utf8'));
  const block = blocks.get(requirement);
  return block === undefined ? null : normalizeRequirement(block);
}

/** Every requirement heading of one main spec, with repeats reported rather than merged. */
export function mainRequirements(root, capability) {
  const p = join(root, 'specs', capability, 'spec.md');
  if (!existsSync(p)) return { names: new Set(), diagnostics: [] };
  const text = lf(readFileSync(p, 'utf8'));
  const names = new Set();
  const diagnostics = [];
  for (const line of text.split('\n')) {
    const m = /^###\s*Requirement:\s*(.+)$/.exec(line);
    if (!m) continue;
    const name = m[1].trim();
    if (names.has(name)) diagnostics.push(diag('duplicate-requirement', `specs/${capability}/spec.md: requirement "${name}" appears twice`, { capability, requirement: name }));
    names.add(name);
  }
  return { names, diagnostics };
}

const deltaCapabilities = (dir) => {
  const root_ = join(dir, 'specs');
  return existsSync(root_) ? readdirSync(root_, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name).sort() : [];
};

/**
 * Capture the base every delta claim is written against. This is explicit: it happens when the
 * plan is finalized, and archive compares against it rather than re-reading the spec, so a
 * requirement someone else changed in the meantime becomes a visible conflict.
 */
export function captureBaseline(root, { dir, rel }, { amendment = null } = {}, token) {
  if (!holdsLock(root, token)) throw new IntentIoError('lock-lost', 'baseline capture requires the live intent lock token');
  const existing = readBaseline(dir);
  if (existing && !amendment) {
    throw new IntentIoError('baseline-exists', `${rel}/${BASE_FILE} already records a base; re-basing needs an independently reviewed amendment (--amend <id>)`);
  }
  const entries = [];
  const diagnostics = [];
  for (const capability of deltaCapabilities(dir)) {
    const deltaPath = join(dir, 'specs', capability, 'spec.md');
    const { claims, diagnostics: d } = deltaClaims(readFileSync(deltaPath, 'utf8'), { path: `${rel}/specs/${capability}/spec.md` });
    diagnostics.push(...d);
    const main = mainRequirements(root, capability);
    diagnostics.push(...main.diagnostics);
    for (const claim of claims) {
      const baseText = currentRequirement(root, capability, claim.requirement);
      if (claim.operation === 'ADDED' && baseText !== null) {
        diagnostics.push(diag('added-collision', `${rel}/specs/${capability}/spec.md: ADDED "${claim.requirement}" already exists in specs/${capability}/spec.md; use MODIFIED`, { capability, requirement: claim.requirement, operation: 'ADDED' }));
      }
      if (claim.operation !== 'ADDED' && baseText === null) {
        diagnostics.push(diag('missing-base', `${rel}/specs/${capability}/spec.md: ${claim.operation} "${claim.requirement}" is not in specs/${capability}/spec.md`, { capability, requirement: claim.requirement, operation: claim.operation }));
      }
      if (claim.operation === 'RENAMED' && claim.destination && main.names.has(claim.destination)) {
        diagnostics.push(diag('rename-destination-exists', `${rel}/specs/${capability}/spec.md: RENAMED destination "${claim.destination}" already exists in specs/${capability}/spec.md`, { capability, requirement: claim.requirement, operation: 'RENAMED', destination: claim.destination }));
      }
      entries.push({
        capability,
        requirement: claim.requirement,
        operation: claim.operation,
        destination: claim.destination,
        baseHash: requirementHash(baseText),
        baseText,
      });
    }
  }
  if (diagnostics.length) {
    throw new IntentIoError('baseline-refused', `the base cannot be captured while these remain: ${diagnostics.map((d) => d.message).join('; ')}`, { diagnostics });
  }
  const baseline = {
    schemaVersion: 2,
    capturedAt: new Date().toISOString(),
    ...(amendment ? { rebasedBy: amendment } : {}),
    entries: entries.sort((a, b) => `${a.capability}/${a.operation}/${a.requirement}`.localeCompare(`${b.capability}/${b.operation}/${b.requirement}`)),
  };
  writeFileAtomic(join(dir, BASE_FILE), JSON.stringify(baseline, null, 2) + '\n');
  return baseline;
}

/** Parsed `spec-base.json`, or null when the change has never captured a base. */
export function readBaseline(dir) {
  const p = join(dir, BASE_FILE);
  if (!existsSync(p)) return null;
  try {
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Compare every claimed requirement against its captured base and the spec as it is now.
 * A conflict carries all three texts, so a reader can see what moved and decide, instead of
 * being told only that something went wrong.
 */
export function compareBases(root, { dir, rel }) {
  const baseline = readBaseline(dir);
  const conflicts = [];
  const diagnostics = [];
  if (!baseline) {
    return { baseline: null, conflicts, diagnostics: [diag('no-baseline', `${rel}/${BASE_FILE} does not exist; capture the base with "spec baseline ${rel.split('/').pop()}" before archiving`, { path: `${rel}/${BASE_FILE}` })] };
  }
  // the delta may have changed since the base was captured; both sides are compared
  const claimsByCapability = new Map();
  for (const capability of deltaCapabilities(dir)) {
    const { claims, diagnostics: d } = deltaClaims(readFileSync(join(dir, 'specs', capability, 'spec.md'), 'utf8'), { path: `${rel}/specs/${capability}/spec.md` });
    diagnostics.push(...d);
    claimsByCapability.set(capability, claims);
  }
  const claimKey = (c) => `${c.operation}/${c.requirement}`;
  for (const [capability, claims] of claimsByCapability) {
    const recorded = new Set(baseline.entries.filter((e) => e.capability === capability).map((e) => `${e.operation}/${e.requirement}`));
    for (const claim of claims) {
      if (!recorded.has(claimKey(claim))) {
        conflicts.push({
          capability,
          requirement: claim.requirement,
          operation: claim.operation,
          reason: 'this claim was added after the base was captured; re-capture the base through a reviewed amendment',
          base: null,
          current: currentRequirement(root, capability, claim.requirement),
          proposed: claim.proposedText,
        });
      }
    }
  }
  for (const entry of baseline.entries) {
    const { capability, requirement, operation, destination, baseText } = entry;
    const claims = claimsByCapability.get(capability) ?? [];
    const claim = claims.find((c) => c.operation === operation && c.requirement === requirement);
    const current = currentRequirement(root, capability, requirement);
    const push = (reason) => conflicts.push({ capability, requirement, operation, destination, reason, base: baseText, current, proposed: claim?.proposedText ?? null });
    if (!claim) {
      push('the delta no longer claims this requirement, but the captured base still records it');
      continue;
    }
    if (operation === 'ADDED') {
      if (current !== null) push('ADDED requires the requirement to be absent, and it is now present in the main spec');
      continue;
    }
    if (current === null) {
      push(`${operation} requires the requirement to exist, and it is no longer in the main spec`);
      continue;
    }
    if (requirementHash(current) !== entry.baseHash) {
      push(`${operation} was written against a different text: the main spec changed after the base was captured`);
      continue;
    }
    if (operation === 'RENAMED') {
      const main = mainRequirements(root, capability);
      if (destination && main.names.has(destination)) push(`RENAMED destination "${destination}" now exists in the main spec`);
    }
  }
  return { baseline, conflicts, diagnostics };
}

// ---------------------------------------------------------------- the merge, computed in memory
/**
 * Provenance marker: one `<!-- via: <date>-<change> -->` line directly after the requirement
 * heading. Every existing marker in the block is dropped first, so a merged block carries
 * exactly one even when the delta was copied from the current spec.
 */
export function stampVia(block, via) {
  const lines = lf(block).split('\n').filter((l) => !/^<!-- via: .+ -->\s*$/.test(l));
  lines.splice(1, 0, `<!-- via: ${via} -->`);
  return lines.join('\n');
}

/**
 * The text this capability's main spec would have after the merge, computed without touching a
 * file. RENAMED is applied explicitly here, with both sides checked, rather than left to a hand
 * edit after the fact.
 */
export function mergeCapability(mainText, deltaText, { capability, via }) {
  const log = [];
  let current = mainText;
  if (current === null) {
    const purpose = sectionBody(lf(deltaText), 'Purpose').trim();
    current = `# ${capability} Specification\n\n## Purpose\n${purpose || 'TBD'}\n\n## Requirements\n\n`;
  }
  if (!/^## Requirements/m.test(current)) current = current.trimEnd() + '\n\n## Requirements\n\n';
  const reqStart = current.search(/^## Requirements/m);
  const before = current.slice(0, reqStart);
  const { head, blocks } = splitRequirements(current.slice(reqStart));

  for (const [, b] of splitRequirements(sectionBody(lf(deltaText), 'ADDED Requirements')).blocks) {
    const n = /^### Requirement:\s*(.+)$/m.exec(b)[1].trim();
    if (blocks.has(n)) log.push(`warn: ${capability}: ADDED requirement "${n}" already exists; replaced`);
    blocks.set(n, stampVia(b, via));
  }
  for (const [n, b] of splitRequirements(sectionBody(lf(deltaText), 'MODIFIED Requirements')).blocks) {
    if (!blocks.has(n)) log.push(`warn: ${capability}: MODIFIED requirement "${n}" not found; appended`);
    blocks.set(n, stampVia(b, via));
  }
  for (const [n] of splitRequirements(sectionBody(lf(deltaText), 'REMOVED Requirements')).blocks) {
    if (blocks.delete(n)) log.push(`${capability}: removed requirement "${n}"`);
    else log.push(`warn: ${capability}: REMOVED requirement "${n}" not found`);
  }
  for (const claim of deltaClaims(deltaText).claims.filter((c) => c.operation === 'RENAMED')) {
    const block = blocks.get(claim.requirement);
    if (!block) {
      log.push(`warn: ${capability}: RENAMED source "${claim.requirement}" not found`);
      continue;
    }
    if (blocks.has(claim.destination)) {
      log.push(`warn: ${capability}: RENAMED destination "${claim.destination}" already exists; not renamed`);
      continue;
    }
    // preserve position: rebuild the map with the renamed entry where the source was
    const rebuilt = new Map();
    for (const [n, b] of blocks) {
      if (n === claim.requirement) rebuilt.set(claim.destination, stampVia(b.replace(/^### Requirement:.*$/m, `### Requirement: ${claim.destination}`), via));
      else rebuilt.set(n, b);
    }
    blocks.clear();
    for (const [n, b] of rebuilt) blocks.set(n, b);
    log.push(`${capability}: renamed requirement "${claim.requirement}" to "${claim.destination}"`);
  }
  return { text: before + head.trimEnd() + '\n\n' + [...blocks.values()].join(''), log };
}

// ---------------------------------------------------------------- archive preflight (C-05)
const blocker = (code, message, extra = {}) => ({ code, message, ...extra });

/**
 * The pre-v2 escape hatch, kept exactly as it was: a scratch report under `.my-flow/verify/`
 * whose header says PASS lets a legacy change archive. It is history, not provenance, and the
 * publication receipt classifies it `unverified-legacy` so it never acquires a v2 guarantee.
 */
function legacyScratchPass(root, slug) {
  const verifyDir = join(root, '.my-flow', 'verify');
  if (!existsSync(verifyDir)) return false;
  return readdirSync(verifyDir).some((f) => f.startsWith(`${slug}-`) && /Verdict:\s*PASS/.test(lf(readFileSync(join(verifyDir, f), 'utf8'))));
}

/**
 * Everything archive must know before it writes anything. It acquires nothing and publishes
 * nothing: it reads, computes every output file in memory, and returns the reasons a
 * publication would be wrong. `--force` never removes a v2 check; it only keeps the old escape
 * hatch for a legacy change, and then the receipt says `unverified-legacy` out loud.
 */
export function archivePreflight(root, { dir, rel, slug, schemaVersion }, { force = false, date = new Date().toISOString().slice(0, 10) } = {}) {
  const blockers = [];
  const warnings = [];
  const v2 = schemaVersion === 2;

  // 1. an unfinished transaction or a pending amendment means the repository is mid-operation
  const pending = pendingTransactions(root);
  if (pending.length) blockers.push(blocker('recovery-pending', `an intent transaction is unfinished (${pending.map((p) => p.id).join(', ')}); run "spec recover" first`));
  const amendments = join(dir, 'amendments');
  if (existsSync(amendments)) {
    for (const id of readdirSync(amendments)) {
      const state = join(amendments, id, 'state.json');
      if (!existsSync(state)) continue;
      try {
        if (JSON.parse(readFileSync(state, 'utf8')).state === 'pending') blockers.push(blocker('amendment-pending', `amendment ${id} is still pending; apply or cancel it before archiving`));
      } catch {
        blockers.push(blocker('amendment-unreadable', `amendment ${id} has an unreadable state file`));
      }
    }
  }

  // 2. the destination must be free
  const destName = `${date}-${slug}`;
  const dest = join(root, 'changes', 'archive', destName);
  if (existsSync(dest)) blockers.push(blocker('destination-exists', `changes/archive/${destName} already exists`));

  // 3. the ledger: every box ticked, and (for v2) an executable contract
  const intent = readChangeIntentDir(dir, slug, { rel });
  const open = intent.tasks.tasks.filter((t) => !t.checked);
  // `--force` keeps its pre-v2 meaning for a legacy change, and none of its meaning for a linked one
  const ledger = !v2 && force ? warnings : null;
  const ledgerProblem = (code, message) => (ledger ? ledger.push(`${code}: ${message} (allowed by --force on a legacy change)`) : blockers.push(blocker(code, message)));
  if (!intent.tasks.tasks.length) ledgerProblem('no-tasks', `${rel}/tasks.md has no tasks`);
  if (open.length) ledgerProblem('unfinished-tasks', `${open.length} task(s) still unticked: ${open.map((t) => t.id ?? t.number).join(', ')}`);
  // an unfinished criterion is only a warning while planning; at archive it is a blocker
  if (v2) for (const p of executableContractProblems(dir, rel)) blockers.push(blocker(p.code, p.message));

  // 4. the review lane, when the change declares one: publishing a contract nobody approved
  // would merge unreviewed requirements into the capability specs
  const approval = contractApproval(root, { dir, rel });
  if (approval.declared && !approval.approved) {
    blockers.push(blocker('unapproved-contract', `${rel} declares the ${approval.lane} review lane, and this contract is not approved for it: ${approval.reasons.join('; ')}`));
  }

  // 5. evidence: the durable head, never an older attempt
  const evidence = evidenceStatus(root, { dir, rel });
  let classification = v2 ? 'verified-v2' : 'unverified-legacy';
  if (v2) {
    if (!evidence.eligible) blockers.push(blocker('no-eligible-evidence', `verification is not eligible: ${evidence.reasons.join('; ')}`));
  } else if (!force && !legacyScratchPass(root, slug)) {
    blockers.push(
      blocker(
        'legacy-unverified',
        `${rel}: no PASS verification report under .my-flow/verify/ (run verify, upgrade the change for a version-bound attempt, or use --force to publish it as unverified-legacy)`
      )
    );
  }

  // 6. the inputs the report was taken against must still be the inputs
  if (v2 && evidence.eligible && evidence.head) {
    const requestPath = join(attemptDir(dir, evidence.head.sequence), 'request.json');
    try {
      const request = JSON.parse(readFileSync(requestPath, 'utf8'));
      const now = captureTarget(root, { dir, rel, inputs: request.inputs ?? {} });
      if (now.implementation.digest !== request.implementationDigest) blockers.push(blocker('source-drift', 'the source changed after the verified attempt; run a new attempt'));
      if (now.acceptance.digest !== request.acceptanceDigest) blockers.push(blocker('contract-drift', 'the contract changed after the verified attempt; run a new attempt'));
      for (const key of request.requiredEnvironment ?? []) {
        const then = key in request.environment ? request.environment[key] : request.environment.tools?.[key];
        const nowValue = key in now.environment ? now.environment[key] : now.environment.tools?.[key];
        if (then !== nowValue) blockers.push(blocker('environment-drift', `the required environment input "${key}" changed after the verified attempt (${then} -> ${nowValue})`));
      }
    } catch (e) {
      blockers.push(blocker('unreadable-request', `the verified attempt's request could not be read: ${e.message}`));
    }
  }

  // 7. every delta claim against its captured base
  const capabilities = deltaCapabilities(dir);
  const bases = compareBases(root, { dir, rel });
  if (capabilities.length) {
    if (!bases.baseline) {
      if (v2) blockers.push(blocker('no-baseline', bases.diagnostics[0].message));
      else {
        // a forced legacy archive may still publish what is mechanically checkable
        for (const capability of capabilities) {
          for (const claim of deltaClaims(readFileSync(join(dir, 'specs', capability, 'spec.md'), 'utf8')).claims) {
            if (claim.operation === 'ADDED') {
              if (currentRequirement(root, capability, claim.requirement) !== null) blockers.push(blocker('added-collision', `ADDED "${claim.requirement}" already exists in specs/${capability}/spec.md`));
            } else {
              blockers.push(blocker('no-recorded-base', `${claim.operation} "${claim.requirement}" has no recorded base; upgrade the change and run "spec baseline ${slug}" before archiving it`));
            }
          }
        }
      }
    }
    for (const c of bases.conflicts) blockers.push(blocker('base-conflict', `${c.operation} ${c.capability} / ${c.requirement}: ${c.reason}`, { conflict: c }));
    for (const d of bases.diagnostics.filter((x) => x.code !== 'no-baseline')) blockers.push(blocker(d.code, d.message));
  }

  // 6b. an umbrella integrates children, so an unresolved or abandoned one blocks its closeout
  if (v2) {
    const manifest = readManifest(dir);
    if (manifest?.kind === 'umbrella') {
      const umbrella = resolveUmbrella(root, manifest);
      for (const b of umbrella.blockers) blockers.push(blocker(b.code, b.message));
      for (const c of umbrella.children) {
        if (!c.resolved || !c.state?.tasks) continue;
        if (c.state.tasks.done !== c.state.tasks.total) blockers.push(blocker('child-unfinished', `child ${c.state.slug} still has ${c.state.tasks.total - c.state.tasks.done} unticked task(s)`));
      }
    }
  }

  // 8. two active changes claiming one requirement is a warning, never a deadlock
  for (const o of overlapIndex(root)) if (o.claims.some((c) => c.change === slug)) warnings.push(overlapText(o));

  // 9. every output file, computed in memory and validated before anything is written
  const outputs = [];
  const log = [];
  for (const capability of capabilities) {
    const deltaText = readFileSync(join(dir, 'specs', capability, 'spec.md'), 'utf8');
    const target = join(root, 'specs', capability, 'spec.md');
    const merged = mergeCapability(existsSync(target) ? lf(readFileSync(target, 'utf8')) : null, deltaText, { capability, via: destName });
    log.push(...merged.log, `merged delta into specs/${capability}/spec.md`);
    const errors = validateSpecText(merged.text, `specs/${capability}/spec.md`, false);
    for (const e of errors) blockers.push(blocker('invalid-output', `the merged output would be invalid: ${e}`));
    outputs.push({ path: `specs/${capability}/spec.md`, content: merged.text });
  }

  const receipt = {
    schemaVersion: 2,
    change: slug,
    archivedAs: `changes/archive/${destName}`,
    at: new Date().toISOString(),
    verification: classification,
    attempt: v2 && evidence.head ? attemptName(evidence.head.sequence) : null,
    resultDigest: evidence.head?.resultDigest ?? null,
    baseline: bases.baseline ? { capturedAt: bases.baseline.capturedAt, entries: bases.baseline.entries.length } : null,
    outputs: outputs.map((o) => ({ path: o.path, hash: sha256Hex(o.content) })),
  };
  return { ok: blockers.length === 0, blockers, warnings, outputs, log, classification, destName, dest, receipt, evidence, bases };
}

// ---------------------------------------------------------------- the closeout view (C-02, D-03)
/**
 * The linked projection plus everything closeout needs to be readable: the durable verification
 * head with the reasons it is or is not eligible, every attempt on disk, and any spec-base
 * conflict with its three texts. Composed here because it needs both the graph and the evidence,
 * and composing it in one place is what keeps the CLI and the API from drifting.
 */
export function inspectCloseout(root, ref, { task = null, index = null } = {}) {
  const r = inspectChange(root, ref, { task, index });
  if (r.error) return r;
  const p = r.projection;
  const dir = join(root, p.location.rel);
  const evidence = evidenceStatus(root, { dir, rel: p.location.rel });
  const bases = p.location.location === 'active' ? compareBases(root, { dir, rel: p.location.rel }) : { baseline: readBaseline(dir), conflicts: [], diagnostics: [] };
  return {
    projection: {
      ...p,
      verification: {
        highWater: evidence.highWater,
        head: evidence.head,
        eligible: evidence.eligible,
        corrupt: evidence.corrupt,
        reasons: evidence.reasons,
        missingOlder: evidence.missingOlder ?? [],
        attempts: attemptList(dir, p.location.rel),
      },
      umbrella: p.identity.kind === 'umbrella' ? resolveUmbrella(root, readManifest(dir)) : null,
      specBase: {
        capturedAt: bases.baseline?.capturedAt ?? null,
        entries: bases.baseline?.entries?.length ?? 0,
        conflicts: bases.conflicts,
        diagnostics: bases.diagnostics,
      },
    },
  };
}

/**
 * One typed reference, including the two evidence forms: an attempt, and the acceptance text
 * that attempt captured. Both are served from the attempt's own immutable files, so an old link
 * keeps showing what the report actually claimed even after the change is archived.
 */
export function inspectCloseoutReference(root, ref, type, id, sub = null, { index = null } = {}) {
  if (type !== 'evidence') return inspectReference(root, ref, type, id, { index });
  const r = inspectCloseout(root, ref, { index });
  if (r.error) return r;
  const p = r.projection;
  const sequence = parseAttemptName(id);
  if (sequence === null) return { error: 'no-such-reference', message: `"${id}" is not an attempt name like V-1`, projection: p };
  const dir = join(root, p.location.rel);
  const attempt = attemptProjection(dir, p.location.rel, sequence);
  if (!attempt) return { error: 'no-such-reference', message: `${p.location.rel} has no recorded verification attempt ${id}`, projection: p };
  if (!sub) {
    return { projection: { schemaVersion: p.schemaVersion, identity: p.identity, location: p.location, type: 'evidence', item: attempt, diagnostics: p.diagnostics, invalid: p.invalid } };
  }
  const captured = capturedAcceptance(dir, sequence, sub.id);
  if (!captured) return { error: 'no-such-reference', message: `attempt ${id} captured no acceptance criterion ${sub.id}`, projection: p };
  return {
    projection: {
      schemaVersion: p.schemaVersion,
      identity: p.identity,
      location: p.location,
      type: 'evidence',
      item: { ...attempt, capturedAcceptance: captured },
      diagnostics: p.diagnostics,
      invalid: p.invalid,
    },
  };
}
