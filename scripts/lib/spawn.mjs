/**
 * Windows-safe synchronous CLI spawn.
 *
 * Node refuses to spawn `.cmd` / `.bat` shims without a shell (EINVAL), and with a shell
 * it warns when args are passed as an array. So: resolve the binary with `where`, prefer a
 * real `.exe`, and when only a `.cmd` exists build one properly quoted command string for
 * cmd.exe. Everywhere else spawn directly with shell:false.
 */
import { spawnSync } from 'node:child_process';

export function resolveBinary(name) {
  if (process.platform !== 'win32') return name;
  const r = spawnSync('where.exe', [name], { encoding: 'utf8', windowsHide: true });
  const candidates = (r.stdout ?? '').split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
  return (
    candidates.find((c) => /\.exe$/i.test(c)) ??
    candidates.find((c) => /\.(cmd|bat)$/i.test(c)) ??
    candidates[0] ??
    name
  );
}

function quoteForCmd(arg) {
  if (arg === '') return '""';
  if (!/[\s"&|<>^()%!]/.test(arg)) return arg;
  return `"${arg.replace(/"/g, '\\"')}"`;
}

export function spawnCli(name, args, options = {}) {
  const bin = resolveBinary(name);
  const needsShell = process.platform === 'win32' && /\.(cmd|bat)$/i.test(bin);
  if (needsShell) {
    const command = [quoteForCmd(bin), ...args.map(quoteForCmd)].join(' ');
    return { bin, result: spawnSync(command, { ...options, shell: true, windowsHide: true }) };
  }
  return { bin, result: spawnSync(bin, args, { ...options, shell: false, windowsHide: true }) };
}
