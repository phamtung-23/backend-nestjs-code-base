// Budget for one Redis command on the request path
export const REDIS_COMMAND_TIMEOUT_MS = 500;

// node-redis has no reply timeout: its per-command `timeout` stops applying
// once the command is written, so a server that stops answering (paused,
// partitioned) leaves commands pending with isReady still true. Callers on the
// request path bound them with this and fall back or fail fast instead.
export function withTimeout<T>(
  promise: Promise<T>,
  ms = REDIS_COMMAND_TIMEOUT_MS,
): Promise<T> {
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new Error(`Redis did not answer within ${ms} ms`)),
      ms,
    );
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
