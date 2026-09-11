#!/usr/bin/env node
/**
 * plugin-demo fixture MCP server: newline-delimited JSON-RPC 2.0 over stdio, plain Node.
 *
 * Handles `initialize` (echoes the requested protocolVersion), `tools/list` (one tool
 * `echo`), `tools/call` for `echo`, and `ping`. Notifications (no `id`) are accepted
 * silently. Anything else answers -32601. Only JSON-RPC responses go to stdout; every
 * log line goes to stderr, because a stray stdout line breaks the transport.
 */
import { createInterface } from 'node:readline';

const SERVER_INFO = { name: 'plugin-demo', version: '0.1.0' };
const TOOLS = [
  {
    name: 'echo',
    description: 'Returns the given text unchanged.',
    inputSchema: {
      type: 'object',
      properties: { text: { type: 'string', description: 'Text to echo back' } },
      required: ['text'],
    },
  },
];

const send = (msg) => process.stdout.write(JSON.stringify(msg) + '\n');
const reply = (id, result) => send({ jsonrpc: '2.0', id, result });
const fail = (id, code, message) => send({ jsonrpc: '2.0', id, error: { code, message } });

function handle(req) {
  const { id, method, params = {} } = req;
  const isNotification = id === undefined || id === null;
  if (isNotification) {
    process.stderr.write(`plugin-demo mcp: notification ${method}\n`);
    return;
  }
  switch (method) {
    case 'initialize':
      return reply(id, {
        protocolVersion: typeof params.protocolVersion === 'string' ? params.protocolVersion : '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: SERVER_INFO,
      });
    case 'ping':
      return reply(id, {});
    case 'tools/list':
      return reply(id, { tools: TOOLS });
    case 'tools/call': {
      if (params.name !== 'echo') return fail(id, -32602, `unknown tool "${params.name}"`);
      const text = params.arguments && typeof params.arguments.text === 'string' ? params.arguments.text : '';
      return reply(id, { content: [{ type: 'text', text }] });
    }
    default:
      return fail(id, -32601, `method not found: ${method}`);
  }
}

const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let req;
  try {
    req = JSON.parse(trimmed);
  } catch (e) {
    process.stderr.write(`plugin-demo mcp: bad JSON (${e.message})\n`);
    return fail(null, -32700, 'parse error');
  }
  try {
    handle(req);
  } catch (e) {
    process.stderr.write(`plugin-demo mcp: ${e.message}\n`);
    if (req && req.id !== undefined) fail(req.id, -32603, 'internal error');
  }
});
rl.on('close', () => process.exit(0));
