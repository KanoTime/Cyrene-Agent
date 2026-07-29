import { afterEach, describe, expect, it, vi } from "vitest";
import { reportMediaReadyWithRetry } from "../../../mobile/src/media-ready-retry";

describe("reportMediaReadyWithRetry", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("retries transient failures until the control plane confirms readiness", async () => {
    const attempt = vi.fn()
      .mockRejectedValueOnce(new Error("temporary"))
      .mockRejectedValueOnce(new Error("temporary"))
      .mockResolvedValueOnce(undefined);

    await reportMediaReadyWithRetry(attempt, {
      maxAttempts: 3,
      retryDelayMs: 0,
    });

    expect(attempt).toHaveBeenCalledTimes(3);
  });

  it("aborts a hung fetch before retrying and eventually fails closed", async () => {
    vi.useFakeTimers();
    const attempt = vi.fn((signal: AbortSignal) => new Promise<void>(
      (_resolve, reject) => {
        signal.addEventListener("abort", () => reject(new Error("aborted")));
      },
    ));

    const result = reportMediaReadyWithRetry(attempt, {
      maxAttempts: 2,
      attemptTimeoutMs: 250,
      retryDelayMs: 0,
    });
    const assertion = expect(result).rejects.toThrow("MEDIA_READY_REPORT_TIMEOUT");
    await vi.runAllTimersAsync();
    await assertion;
    expect(attempt).toHaveBeenCalledTimes(2);
  });
});
