/**
 * Timeout-protected stdin reader for hook scripts (adapted from oh-my-claudecode
 * scripts/lib/stdin.mjs). Blocking `for await` on stdin can hang forever when the parent
 * never closes the pipe; this resolves with whatever arrived before the timeout.
 */
export async function readStdin(timeoutMs = 3000) {
  return new Promise((resolve) => {
    const chunks = [];
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(Buffer.concat(chunks).toString('utf8'));
    };
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      process.stdin.removeAllListeners();
      process.stdin.destroy();
      resolve(Buffer.concat(chunks).toString('utf8'));
    }, timeoutMs);
    process.stdin.on('data', (c) => chunks.push(c));
    process.stdin.on('end', finish);
    process.stdin.on('error', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve('');
    });
    if (process.stdin.readableEnded) finish();
  });
}

export async function readHookInput(timeoutMs = 3000) {
  const raw = await readStdin(timeoutMs);
  if (!raw.trim()) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}
