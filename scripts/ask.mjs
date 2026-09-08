#!/usr/bin/env node
/**
 * Cross-model advisor. Runs the *other* CLI read-only with the prompt on stdin and writes
 * an artifact under .my-flow/ask/.
 *
 *   node scripts/ask.mjs codex  [--diff] [--files a,b] [--timeout ms] [--model m] <question...>
 *   node scripts/ask.mjs claude --prompt-file .my-flow/ask/<ts>-prompt.md
 *
 * Model: --model, else env MY_FLOW_CODEX_MODEL / MY_FLOW_CLAUDE_MODEL, else the CLI default.
 *
 * Design notes (Windows): prompt always goes through stdin (never argv), binaries are
 * resolved with `where`, spawn uses shell:false, explicit timeout + SIGKILL, and an empty
 * result with exit 0 is treated as a failure.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnCli } from './lib/spawn.mjs';

const argv = process.argv.slice(2);
const provider = argv.shift();
if (!['codex', 'claude'].includes(provider)) {
  console.error('usage: ask.mjs <codex|claude> [--diff] [--files a,b] [--timeout ms] [--prompt-file f] <question...>');
  process.exit(2);
}

const opts = {
  diff: false,
  files: [],
  timeout: 300000,
  promptFile: null,
  cwd: process.cwd(),
  // Model override: --model, else MY_FLOW_CODEX_MODEL / MY_FLOW_CLAUDE_MODEL, else the CLI default.
  model: process.env[provider === 'codex' ? 'MY_FLOW_CODEX_MODEL' : 'MY_FLOW_CLAUDE_MODEL'] || null,
};
const words = [];
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === '--diff') opts.diff = true;
  else if (a === '--files') opts.files = (argv[++i] ?? '').split(',').map((s) => s.trim()).filter(Boolean);
  else if (a === '--timeout') opts.timeout = Number(argv[++i]) || opts.timeout;
  else if (a === '--prompt-file') opts.promptFile = argv[++i];
  else if (a === '--model') opts.model = argv[++i] ?? null;
  else if (a === '--cwd') opts.cwd = resolve(argv[++i]);
  else words.push(a);
}

const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19);
const askDir = join(opts.cwd, '.my-flow', 'ask');
mkdirSync(askDir, { recursive: true });

function git(args) {
  const r = spawnSync('git', args, { cwd: opts.cwd, encoding: 'utf8', timeout: 15000, maxBuffer: 16 * 1024 * 1024, windowsHide: true });
  return r.status === 0 ? r.stdout : `(git ${args.join(' ')} failed)`;
}

// ---- prompt ----
let prompt;
let question = words.join(' ').trim();
if (opts.promptFile) {
  prompt = readFileSync(resolve(opts.cwd, opts.promptFile), 'utf8');
  question = question || prompt.split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim() || 'review';
} else {
  if (!question) {
    console.error('ask.mjs: give a question or --prompt-file');
    process.exit(2);
  }
  const parts = [
    'You are a read-only reviewer. Do not modify files. Cite `path:line` for every claim about code.',
    'Answer with these sections: ## Verdict, ## Findings, ## Disagreements, ## Recommendation.',
    '',
    '## Question',
    question,
  ];
  if (opts.diff) parts.push('', '## Diff (git diff HEAD)', '```diff', git(['diff', 'HEAD', '--no-color']), '```');
  for (const f of opts.files) {
    const p = resolve(opts.cwd, f);
    parts.push('', `### ${f}`, '```', existsSync(p) ? readFileSync(p, 'utf8') : '(missing)', '```');
  }
  prompt = parts.join('\n');
  writeFileSync(join(askDir, `${ts}-prompt.md`), prompt, 'utf8');
}

// ---- environment: never let the child think it is nested inside the caller ----
const env = { ...process.env };
for (const k of Object.keys(env)) {
  if (k === 'CLAUDECODE' || k.startsWith('CLAUDE_CODE_') || k === 'CLAUDE_SESSION_ID' || k.startsWith('CODEX_') || k === 'RUST_LOG') delete env[k];
}

const slug = question.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'ask';
const artifact = join(askDir, `${ts}-${provider}-${slug}.md`);
const codexOut = join(askDir, `${ts}-codex.out.md`);

let args;
if (provider === 'codex') {
  args = [
    'exec',
    '-s', 'read-only',
    '-C', opts.cwd,
    '--skip-git-repo-check',
    '--ephemeral',
    '--color', 'never',
    '-c', 'model_reasoning_effort=high',
    ...(opts.model ? ['-m', opts.model] : []),
    '-o', codexOut,
    '-',
  ];
} else {
  args = [
    '-p',
    ...(opts.model ? ['--model', opts.model] : []),
    '--permission-mode', 'plan',
    '--tools', 'Read,Grep,Glob,Bash',
    '--disallowedTools', 'Write,Edit,MultiEdit,NotebookEdit',
    '--output-format', 'text',
    '--no-session-persistence',
    '--max-turns', '25',
  ];
}

const started = Date.now();
const { bin, result: r } = spawnCli(provider, args, {
  cwd: opts.cwd,
  env,
  input: prompt,
  encoding: 'utf8',
  timeout: opts.timeout,
  killSignal: 'SIGKILL',
  maxBuffer: 16 * 1024 * 1024,
});
const elapsed = ((Date.now() - started) / 1000).toFixed(1);

let output = '';
let status = 'ok';
if (r.error?.code === 'ETIMEDOUT' || (r.signal && r.status === null)) {
  status = `timeout after ${opts.timeout} ms`;
} else if (r.error) {
  status = `spawn error: ${r.error.message}`;
} else if (provider === 'codex' && existsSync(codexOut)) {
  output = readFileSync(codexOut, 'utf8').trim();
} else {
  output = (r.stdout ?? '').trim();
}
if (status === 'ok' && r.status !== 0) status = `exit code ${r.status}`;
if (status === 'ok' && !output) status = 'empty output';

const summaryHint = status === 'ok' ? '(fill in after reading: agree / disagree and why)' : status;
const body = [
  `# ask ${provider} - ${ts}`,
  '',
  `- provider: ${provider} (${bin})${opts.model ? ` model ${opts.model}` : ''}`,
  `- status: ${status}`,
  `- elapsed: ${elapsed}s`,
  `- cwd: ${opts.cwd}`,
  '',
  '## Original task',
  question,
  '',
  '## Final prompt',
  '```',
  prompt,
  '```',
  '',
  '## Raw output',
  output || '(none)',
  '',
  ...(status !== 'ok' && r.stderr ? ['### stderr (tail)', '```', r.stderr.trim().slice(-4000), '```', ''] : []),
  '## Summary',
  summaryHint,
  '',
  '## Action items',
  '- ',
  '',
].join('\n');
writeFileSync(artifact, body, 'utf8');

console.log(`artifact: ${artifact}`);
console.log(`status: ${status} (${elapsed}s)`);
console.log('');
console.log(output || '(no output)');
process.exit(status === 'ok' ? 0 : 1);
