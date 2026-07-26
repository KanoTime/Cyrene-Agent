export type UnexpectedDisconnectRecoveryOutcome =
  | "RECOVERED"
  | "FAILED"
  | "CANCELLED";

const DEFAULT_RETRY_DELAYS_MS = [500, 1_500, 3_000] as const;

export async function recoverUnexpectedRoomDisconnect(options: {
  connect: () => Promise<void>;
  enableMicrophone: () => Promise<unknown>;
  isCancelled: () => boolean;
  retryDelaysMs?: readonly number[];
  wait?: (delayMs: number) => Promise<void>;
}): Promise<UnexpectedDisconnectRecoveryOutcome> {
  const retryDelaysMs = options.retryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const wait = options.wait ?? ((delayMs: number) => (
    new Promise<void>((resolve) => setTimeout(resolve, delayMs))
  ));

  for (const delayMs of retryDelaysMs) {
    if (options.isCancelled()) return "CANCELLED";
    await wait(delayMs);
    if (options.isCancelled()) return "CANCELLED";
    try {
      await options.connect();
      await options.enableMicrophone();
      return "RECOVERED";
    } catch {
      // Try the next bounded delay while the desktop keeps the room alive.
    }
  }
  return options.isCancelled() ? "CANCELLED" : "FAILED";
}
