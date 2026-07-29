import { describe, expect, it, vi } from "vitest";
import { monitorRemoteCallState } from "./remote-call-state-monitor";

describe("remote call state monitor", () => {
  it("ends the local call from the authoritative control-plane terminal state", async () => {
    const onEnded = vi.fn();
    const wait = vi.fn(async () => undefined);
    const ended = {
      callId: "call-1",
      phase: "ENDED" as const,
      terminationReason: "MEDIA_CONNECT_TIMEOUT",
    };
    const states = [
      { callId: "call-1", phase: "ACTIVE" as const },
      ended,
    ];

    await monitorRemoteCallState({
      read: async () => states.shift()!,
      isCurrent: () => true,
      onEnded,
      wait,
    });

    expect(onEnded).toHaveBeenCalledWith(ended);
    expect(wait).toHaveBeenCalledOnce();
  });

  it("keeps monitoring after a transient control-plane read failure", async () => {
    const onEnded = vi.fn();
    const wait = vi.fn(async () => undefined);
    const read = vi.fn()
      .mockRejectedValueOnce(new Error("VPN unavailable"))
      .mockResolvedValueOnce({
        callId: "call-1",
        phase: "ENDED",
        terminationReason: "PARTICIPANT_HUNG_UP",
      });

    await monitorRemoteCallState({
      read,
      isCurrent: () => true,
      onEnded,
      wait,
    });

    expect(read).toHaveBeenCalledTimes(2);
    expect(onEnded).toHaveBeenCalledOnce();
    expect(wait).toHaveBeenCalledOnce();
  });
});
