import { describe, expect, it, vi } from "vitest";
import { recoverUnexpectedRoomDisconnect } from "./unexpected-disconnect-recovery";

describe("unexpected mobile room disconnect recovery", () => {
  it("rejoins and restores the microphone without ending the call", async () => {
    const connect = vi.fn()
      .mockRejectedValueOnce(new Error("vpn switching"))
      .mockResolvedValueOnce(undefined);
    const enableMicrophone = vi.fn(async () => undefined);

    const outcome = await recoverUnexpectedRoomDisconnect({
      connect,
      enableMicrophone,
      isCancelled: () => false,
      retryDelaysMs: [0, 0],
      wait: async () => undefined,
    });

    expect(outcome).toBe("RECOVERED");
    expect(connect).toHaveBeenCalledTimes(2);
    expect(enableMicrophone).toHaveBeenCalledOnce();
  });

  it("does not reconnect after an intentional hangup", async () => {
    const connect = vi.fn(async () => undefined);

    const outcome = await recoverUnexpectedRoomDisconnect({
      connect,
      enableMicrophone: async () => undefined,
      isCancelled: () => true,
      retryDelaysMs: [0],
      wait: async () => undefined,
    });

    expect(outcome).toBe("CANCELLED");
    expect(connect).not.toHaveBeenCalled();
  });
});
