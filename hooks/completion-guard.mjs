#!/usr/bin/env node
/**
 * Stop hook (Claude Code + Codex). Both rules fire only when the last assistant message
 * claims completion ("done", "implemented", "ready for review", ...); a plain answer or a
 * question to the user is never blocked.
 *
 *  1. execute-guard: while the current change is in stage `execute` and its tasks.md still
 *     has unticked tasks that are not marked "blocked:", block the completion claim and list
 *     what remains. The state file must be fresh: `updated` within MY_FLOW_EXECUTE_GUARD_TTL_HOURS
 *     (default 12); a missing, unparseable, or older timestamp means the state is stale and
 *     the rule stays silent. `spec.mjs stage <name> execute` refreshes it. This is a
 *     deterministic backstop for a forgotten /goal, not a replacement for it.
 *  2. completion-guard: block a completion claim when the working-tree diff still contains
 *     fake-completion markers (skipped/focused tests, placeholder TODOs, stub returns,
 *     unimplemented throws). Distilled from oh-my-claudecode's workflow-drift-guard.
 *
 * Output: {} to allow, or {"decision":"block","reason":"..."}. Always exits 0. Honors
 * stop_hook_active so a block never loops. Opt out per rule:
 *   MY_FLOW_SKIP_HOOKS=execute-guard | completion-guard | all
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { readHookInput } from './lib/stdin.mjs';

const allow = () => {
  process.stdout.write('{}');
  process.exit(0);
};

const skip = (process.env.MY_FLOW_SKIP_HOOKS ?? '').split(',').map((s) => s.trim());
const skipExecute = skip.includes('execute-guard') || skip.includes('all');
const skipCompletion = skip.includes('completion-guard') || skip.includes('all');
if (skipExecute && skipCompletion) allow();

const input = await readHookInput();
if (input.stop_hook_active === true) allow(); // never loop on our own block
const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();

// ---- precondition for both rules: the last message claims completion ----
const COMPLETION_CLAIM_RE =
  /\b(?:done|complete[sd]?|finished|implemented|fixed|resolved|all set|ready\s+(?:for\s+(?:review|merge|release|qa|testing)|to\s+(?:merge|ship|release|submit)))\b/i;

function lastAssistantMessage() {
  if (typeof input.last_assistant_message === 'string') return input.last_assistant_message;
  const tp = input.transcript_path;
  if (typeof tp !== 'string' || !existsSync(tp)) return '';
  try {
    const rows = readFileSync(tp, 'utf8').split('\n').filter(Boolean);
    for (let i = rows.length - 1; i >= 0; i--) {
      let row;
      try {
        row = JSON.parse(rows[i]);
      } catch {
        continue;
      }
      const msg = row?.message ?? row;
      if ((row?.type === 'assistant' || msg?.role === 'assistant') && msg?.content) {
        if (typeof msg.content === 'string') return msg.content;
        if (Array.isArray(msg.content)) {
          return msg.content
            .filter((c) => c?.type === 'text' && typeof c.text === 'string')
            .map((c) => c.text)
            .join('\n');
        }
      }
    }
  } catch {
    /* fail open */
  }
  return '';
}

const message = lastAssistantMessage();
if (!message || !COMPLETION_CLAIM_RE.test(message)) allow();

// ---- rule 1: execute-guard ----
const DEFAULT_TTL_HOURS = 12;
const ttlHours = Number(process.env.MY_FLOW_EXECUTE_GUARD_TTL_HOURS);
const TTL_HOURS = Number.isFinite(ttlHours) && ttlHours > 0 ? ttlHours : DEFAULT_TTL_HOURS;
const TTL_MS = TTL_HOURS * 3600 * 1000;
const SPEC_SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'spec.mjs');

function stateIsFresh(state, now = Date.now()) {
  const t = typeof state?.updated === 'string' ? Date.parse(state.updated) : NaN;
  return Number.isFinite(t) && now - t <= TTL_MS; // missing or unparseable -> stale; future -> fresh
}

function remainingTasks() {
  let state;
  try {
    state = JSON.parse(readFileSync(join(cwd, '.my-flow', 'state', 'current-change.json'), 'utf8'));
  } catch {
    return null;
  }
  if (state?.stage !== 'execute' || !state.change) return null;
  if (!stateIsFresh(state)) return null;
  const candidates = [join(cwd, 'changes', state.change, 'tasks.md'), join(cwd, 'docs', 'changes', `${state.change}.md`)];
  const path = candidates.find((p) => existsSync(p));
  if (!path) return null;
  const lines = readFileSync(path, 'utf8').split(/\r?\n/);
  const remaining = [];
  for (let i = 0; i < lines.length; i++) {
    const m = /^\s*- \[ \] (\d+\.\d+ .*)$/.exec(lines[i]);
    if (!m) continue;
    let blocked = false;
    for (let j = i + 1; j < lines.length && /^\s+\S/.test(lines[j]) && !/^\s*- \[/.test(lines[j]); j++) {
      if (/blocked:/i.test(lines[j])) blocked = true;
    }
    if (!blocked) remaining.push(m[1].trim());
  }
  return { change: state.change, path, remaining };
}

if (!skipExecute) {
  const r = remainingTasks();
  if (r && r.remaining.length) {
    const reason =
      `[my-flow execute-guard] The last message claims completion, but change "${r.change}" is in stage execute and tasks.md still has ${r.remaining.length} unticked task(s):\n` +
      r.remaining.slice(0, 5).map((t) => `- ${t}`).join('\n') +
      (r.remaining.length > 5 ? `\n- ... ${r.remaining.length - 5} more` : '') +
      `\nContinue with the next task, or mark it "  - blocked: <reason>" under the task if it cannot proceed. ` +
      `When the final gate has passed, run: node "${SPEC_SCRIPT}" stage ${r.change} done --root "${cwd}". ` +
      `(This guard fires only on a completion claim while the state file is younger than ${TTL_HOURS}h; ` +
      `refresh with "stage ${r.change} execute". Bypass: MY_FLOW_SKIP_HOOKS=execute-guard)`;
    process.stdout.write(JSON.stringify({ decision: 'block', reason }));
    process.exit(0);
  }
}
if (skipCompletion) allow();

// ---- rule 2: completion-guard ----

const BLOCKER_PATTERNS = [
  { kind: 'skipped test', pattern: /\b(?:it|test|describe)\.skip\s*\(/i },
  { kind: 'focused test', pattern: /\b(?:it|test|describe)\.only\s*\(/i },
  {
    kind: 'placeholder TODO',
    pattern: /\bTODO\b(?:\([^)]*\))?\s*:?\s*(?:implement|fix|replace|stub|placeholder|later|follow[- ]?up|wire|add\b|fill)/i,
  },
  { kind: 'unimplemented throw', pattern: /throw\s+new\s+Error\s*\(\s*["'`](?:TODO|Not implemented|unimplemented|stub)/i },
  { kind: 'placeholder return', pattern: /\breturn\s+(?:null|undefined|0|""|'')\s*;?\s*\/\/\s*(?:TODO|stub|placeholder|not implemented)/i },
  { kind: 'placeholder implementation', pattern: /\b(?:stub|placeholder|not implemented|unimplemented)\s+(?:implementation|branch|path|test|coverage)\b/i },
];

const CODE_EXT = /\.(?:[cm]?[jt]sx?|py|rs|go|java|kt|cs|cpp|cc|c|h|hpp|hlsl|usf|ush|glsl|shader|swift|rb|php|lua|sh|ps1)$/i;

// ---- diff scan ----
function git(args) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', timeout: 8000, windowsHide: true });
  return r.status === 0 ? r.stdout : '';
}

const findings = [];
const seen = new Set();
function scanLines(file, lines) {
  for (const line of lines) {
    for (const { kind, pattern } of BLOCKER_PATTERNS) {
      if (pattern.test(line)) {
        const key = `${file}:${kind}`;
        if (!seen.has(key)) {
          seen.add(key);
          findings.push(`${file}: ${kind} -> ${line.trim().slice(0, 100)}`);
        }
      }
    }
  }
}

if (existsSync(join(cwd, '.git')) || git(['rev-parse', '--is-inside-work-tree']).trim() === 'true') {
  const diff = git(['diff', 'HEAD', '--unified=0', '--no-color']);
  let file = '';
  const added = new Map();
  for (const line of diff.split('\n')) {
    if (line.startsWith('+++ ')) {
      file = line.replace(/^\+\+\+ [ab]\//, '').trim();
      continue;
    }
    if (line.startsWith('+') && !line.startsWith('+++') && file && CODE_EXT.test(file)) {
      if (!added.has(file)) added.set(file, []);
      added.get(file).push(line.slice(1));
    }
  }
  for (const [f, lines] of added) scanLines(f, lines);

  const untracked = git(['ls-files', '--others', '--exclude-standard']).split('\n').filter((f) => f && CODE_EXT.test(f));
  for (const f of untracked.slice(0, 200)) {
    try {
      scanLines(f, readFileSync(join(cwd, f), 'utf8').split('\n'));
    } catch {
      /* ignore */
    }
  }
}

if (!findings.length) allow();

const reason =
  `[my-flow completion-guard] The last message claims completion, but the working tree still contains fake-completion markers:\n` +
  findings.slice(0, 5).map((f) => `- ${f}`).join('\n') +
  (findings.length > 5 ? `\n- ... ${findings.length - 5} more` : '') +
  `\nImplement them or report them explicitly as blockers before claiming completion. (Set MY_FLOW_SKIP_HOOKS=completion-guard to bypass.)`;

process.stdout.write(JSON.stringify({ decision: 'block', reason }));
process.exit(0);
