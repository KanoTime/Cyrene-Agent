import { describe, expect, it, vi } from "vitest";
import { takeMediaGrantWhenReady } from "../../../mobile/src/media-grant-readiness";

describe("mobile media-grant readiness", () => {
  it("absorbs the transient gap between CONNECTING_MEDIA and envelope attachment", async () => {
    const take = vi.fn()
      .mockRejectedValueOnce(new Error("MEDIA_GRANT_NOT_AVAILABLE"))
      .mockResolvedValueOnce({ callId: "call-1" });

    await expect(takeMediaGrantWhenReady(take, {
      wait: async () => undefined,
    })).resolves.toEqual({
      callId: "call-1",
    });
    expect(take).toHaveBeenCalledTimes(2);
  });

  it("does not retry a terminal or security-sensitive grant failure", async () => {
    const take = vi.fn()
      .mockRejectedValue(new Error("MEDIA_GRANT_ALREADY_CLAIMED"));

    await expect(takeMediaGrantWhenReady(take, {
      wait: async () => undefined,
    })).rejects.toThrow("MEDIA_GRANT_ALREADY_CLAIMED");
    expect(take).toHaveBeenCalledTimes(1);
  });

  it("keeps the transient retry window bounded", async () => {
    const take = vi.fn()
      .mockRejectedValue(new Error("MEDIA_GRANT_NOT_AVAILABLE"));

    await expect(takeMediaGrantWhenReady(take, {
      maxAttempts: 3,
      wait: async () => undefined,
    })).rejects.toThrow("MEDIA_GRANT_NOT_AVAILABLE");
    expect(take).toHaveBeenCalledTimes(3);
  });
});
