export async function takeMediaGrantWhenReady<T>(
  take: () => Promise<T>,
  options: {
    maxAttempts?: number;
    retryDelayMs?: number;
    wait?: (delayMs: number) => Promise<void>;
  } = {},
): Promise<T> {
  const maxAttempts = options.maxAttempts ?? 20;
  const retryDelayMs = options.retryDelayMs ?? 100;
  const wait = options.wait ?? ((delayMs: number) =>
    new Promise<void>((resolve) => setTimeout(resolve, delayMs)));
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("MEDIA_GRANT_RETRY_POLICY_INVALID");
  }
  if (!Number.isFinite(retryDelayMs) || retryDelayMs < 0) {
    throw new Error("MEDIA_GRANT_RETRY_POLICY_INVALID");
  }

  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await take();
    } catch (error) {
      const isTransientGap =
        error instanceof Error
        && error.message === "MEDIA_GRANT_NOT_AVAILABLE";
      if (!isTransientGap || attempt === maxAttempts) throw error;
      await wait(retryDelayMs);
    }
  }
  throw new Error("MEDIA_GRANT_NOT_AVAILABLE");
}
