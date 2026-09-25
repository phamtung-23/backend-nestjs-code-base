import { Logger } from '@nestjs/common';

// Starts work that must not delay the response (emails, best-effort writes).
// It isn't awaited, so failures are logged here instead of reaching the client.
export function runInBackground(
  logger: Logger,
  task: () => Promise<unknown>,
): void {
  void task().catch((error: unknown) => {
    logger.error(
      'Background task failed',
      error instanceof Error ? error.stack : String(error),
    );
  });
}
