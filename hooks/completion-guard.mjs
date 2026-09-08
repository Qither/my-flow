#!/usr/bin/env node
/**
 * Stop hook (Claude Code + Codex): block a completion claim when the working-tree diff
 * still contains fake-completion markers (skipped/focused tests, placeholder TODOs, stub
 * returns, unimplemented throws). Distilled from oh-my-claudecode's workflow-drift-guard.
 *
 * Output: {} to allow, or {"decision":"block","reason":"..."}. Always exits 0.
 * Opt out: MY_FLOW_SKIP_HOOKS=completion-guard
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { readHookInput } from './lib/stdin.mjs';

const allow = () => {
  process.stdout.write('{}');
  process.exit(0);
};

const skip = (process.env.MY_FLOW_SKIP_HOOKS ?? '').split(',').map((s) => s.trim());
if (skip.includes('completion-guard') || skip.includes('all')) allow();

const input = await readHookInput();
if (input.stop_hook_active === true) allow(); // never loop on our own block
const cwd = typeof input.cwd === 'string' && input.cwd ? input.cwd : process.cwd();

const COMPLETION_CLAIM_RE =
  /\b(?:done|complete[sd]?|finished|implemented|fixed|resolved|all set|ready\s+(?:for\s+(?:review|merge|release|qa|testing)|to\s+(?:merge|ship|release|submit)))\b/i;

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

// ---- last assistant message ----
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
