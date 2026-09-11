#!/usr/bin/env node
// plugin-demo fixture hook: reads the hook payload from stdin, answers with an empty object.
// Plain Node, no dependencies, so it also runs from a plugin cache without node_modules.
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (chunk) => {
  input += chunk;
});
process.stdin.on('end', () => {
  process.stdout.write('{}\n');
  process.exit(0);
});
process.stdin.resume();
