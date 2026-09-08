#!/usr/bin/env node
/**
 * my-flow init [--simple] [--tools claude,codex] [dir]
 *
 * Sets up a project for the my-flow workflow. No external tools are required.
 *   default : creates specs/ (current truth) and changes/ (intent per change) with templates
 *   --simple: no specs/ or changes/; one markdown file per change under docs/changes/
 * Both modes append the project CLAUDE.md / AGENTS.md blocks, add .claude/rules/specs.md,
 * create .my-flow/ and git-ignore it.
 */
import { appendFileSync, cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

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
function copyIfMissing(from, to) {
  if (existsSync(to)) return false;
  mkdirSync(dirname(to), { recursive: true });
  cpSync(from, to);
  console.log(`wrote ${to}`);
  return true;
}

console.log(`my-flow init -> ${project}${SIMPLE ? ' (simple mode)' : ''}`);

// 1. intent layer
if (!SIMPLE) {
  mkdirSync(join(project, 'specs'), { recursive: true });
  mkdirSync(join(project, 'changes', 'archive'), { recursive: true });
  copyIfMissing(join(T, 'specs-README.md'), join(project, 'specs', 'README.md'));
  for (const f of ['proposal.md', 'design.md', 'tasks.md']) {
    copyIfMissing(join(T, 'change', f), join(project, 'changes', '.templates', f));
  }
  for (const d of ['specs', 'changes/archive']) {
    const keep = join(project, d, '.gitkeep');
    if (!existsSync(keep)) writeFileSync(keep, '');
  }
} else {
  copyIfMissing(join(T, 'simple', 'change.md'), join(project, 'docs', 'changes', '_template.md'));
}

// 2. project blocks
if (tools.includes('claude')) {
  upsert(join(project, 'CLAUDE.md'), readFileSync(join(T, 'project', 'CLAUDE.md'), 'utf8'));
  copyIfMissing(join(T, 'project', 'rules', 'specs.md'), join(project, '.claude', 'rules', 'specs.md'));
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
  new change: node "${join(ROOT, 'scripts', 'spec.mjs')}" new <name>
Fill in the "Project facts" section of CLAUDE.md / AGENTS.md before the first plan.`);
