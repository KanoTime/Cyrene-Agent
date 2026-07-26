export interface MediaReadyRetryOptions {
  maxAttempts?: number;
  attemptTimeoutMs?: number;
  retryDelayMs?: number;
}

const wait = (durationMs: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, durationMs));

/**
 * Repeats the idempotent media-ready acknowledgement with a per-attempt
 * deadline. A hung mobile fetch is aborted so it cannot consume the entire
 * control-plane media-connect window.
 */
export async function reportMediaReadyWithRetry(
  attempt: (signal: AbortSignal) => Promise<void>,
  options: MediaReadyRetryOptions = {},
): Promise<void> {
  const maxAttempts = Math.max(1, Math.round(options.maxAttempts ?? 8));
  const attemptTimeoutMs = Math.max(
    250,
    Math.round(options.attemptTimeoutMs ?? 2_000),
  );
  const retryDelayMs = Math.max(0, Math.round(options.retryDelayMs ?? 400));

  for (let attemptNumber = 1; attemptNumber <= maxAttempts; attemptNumber += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), attemptTimeoutMs);
    try {
      await attempt(controller.signal);
      return;
    } catch {
      if (attemptNumber === maxAttempts) {
        throw new Error("MEDIA_READY_REPORT_TIMEOUT");
      }
    } finally {
      clearTimeout(timeout);
    }
    await wait(retryDelayMs);
  }
}
