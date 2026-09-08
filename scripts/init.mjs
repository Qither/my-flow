#!/usr/bin/env node
/**
 * my-flow init [--simple] [--tools claude,codex] [dir]
 *
 * Sets up a project for the my-flow workflow:
 *   - runs `openspec init --tools <tools>` when the CLI is available (unless --simple)
 *   - appends the project CLAUDE.md / AGENTS.md blocks and .claude/rules/openspec.md
 *   - creates .my-flow/ and git-ignores it
 *   - --simple: no OpenSpec; creates docs/changes/ with a single-file change template
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnCli } from './lib/spawn.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const SIMPLE = argv.includes('--simple');
let tools = 'claude,codex';
const rest = [];
for (let i = 0; i < argv.length; i++) {
  if (argv[i] === '--tools') tools = argv[++i] ?? tools;
  else if (!argv[i].startsWith('--')) rest.push(argv[i]);
}
const project = resolve(rest[0] ?? process.cwd());
const T = join(ROOT, 'templates');
const START_RE = /<!-- MY-FLOW:PROJECT:START[^>]*-->/;
const END = '<!-- MY-FLOW:PROJECT:END -->';

function upsert(path, block) {
  const existing = existsSync(path) ? readFileSync(path, 'utf8').replace(/\r\n/g, '\n') : '';
  const s = existing.search(START_RE);
  const e = existing.indexOf(END);
  let out;
  if (s !== -1 && e !== -1) out = existing.slice(0, s) + block.trimEnd() + existing.slice(e + END.length);
  else out = (existing.trimEnd() ? existing.trimEnd() + '\n\n' : '') + block.trimEnd() + '\n';
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, out, 'utf8');
  console.log(`${s !== -1 ? 'updated' : 'wrote'} ${path}`);
}

console.log(`my-flow init -> ${project}${SIMPLE ? ' (simple mode)' : ''}`);

// 1. OpenSpec
if (!SIMPLE) {
  const has = spawnCli('openspec', ['--version'], { encoding: 'utf8' }).result;
  if (has.status === 0) {
    if (existsSync(join(project, 'openspec'))) {
      console.log('openspec/ already exists; skipping openspec init (run `openspec update` yourself if needed)');
    } else {
      const r = spawnCli('openspec', ['init', '--tools', tools, project], { stdio: 'inherit' }).result;
      if (r.status !== 0) console.log('openspec init failed; continuing with templates only');
    }
  } else {
    console.log('openspec CLI not found. Install with: npm i -g @fission-ai/openspec   (continuing with templates only)');
    mkdirSync(join(project, 'openspec', 'specs'), { recursive: true });
    mkdirSync(join(project, 'openspec', 'changes', 'archive'), { recursive: true });
  }
  // my-flow change templates (design.md carries the two required sections)
  const dest = join(project, 'openspec', 'templates');
  mkdirSync(dest, { recursive: true });
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) cpSync(join(T, 'openspec', f), join(dest, f));
  console.log(`wrote ${dest}/{proposal,design,tasks}.md`);
} else {
  const dest = join(project, 'docs', 'changes');
  mkdirSync(dest, { recursive: true });
  cpSync(join(T, 'simple', 'change.md'), join(dest, '_template.md'));
  console.log(`wrote ${dest}/_template.md`);
}

// 2. project blocks
if (tools.includes('claude')) {
  upsert(join(project, 'CLAUDE.md'), readFileSync(join(T, 'project', 'CLAUDE.md'), 'utf8'));
  const rule = join(project, '.claude', 'rules', 'openspec.md');
  if (!existsSync(rule)) {
    mkdirSync(dirname(rule), { recursive: true });
    cpSync(join(T, 'project', 'rules', 'openspec.md'), rule);
    console.log(`wrote ${rule}`);
  }
}
if (tools.includes('codex')) {
  upsert(join(project, 'AGENTS.md'), readFileSync(join(T, 'project', 'AGENTS.md'), 'utf8'));
}

// 3. scratch dir + gitignore
for (const d of ['ask', 'interviews', 'verify', 'learned', 'state']) mkdirSync(join(project, '.my-flow', d), { recursive: true });
const gi = join(project, '.gitignore');
const giText = existsSync(gi) ? readFileSync(gi, 'utf8') : '';
if (!/^\.my-flow\/?$/m.test(giText)) {
  appendFileSync(gi, (giText && !giText.endsWith('\n') ? '\n' : '') + '.my-flow/\n');
  console.log(`updated ${gi}`);
}

console.log(`
Done. Start with:
  interview -> plan -> run -> verify   (Claude: /my-flow:<skill>, Codex: $my-flow-<skill>)
Fill in the "Project facts" section of CLAUDE.md / AGENTS.md before the first plan.`);
