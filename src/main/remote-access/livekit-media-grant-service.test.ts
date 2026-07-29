import { randomBytes } from "node:crypto";
import { TokenVerifier } from "livekit-server-sdk";
import { describe, expect, it } from "vitest";
import { LiveKitMediaGrantService } from "./livekit-media-grant-service";

describe("LiveKit media grant service", () => {
  it("issues two endpoint-bound encrypted envelopes with one per-call E2EE key", async () => {
    const nowMs = Date.parse("2026-07-23T13:00:00.000Z");
    const service = new LiveKitMediaGrantService({
      serverUrl: "https://example.livekit.cloud",
      apiKey: "api-key",
      apiSecret: "api-secret",
      envelopeMasterKey: randomBytes(32),
      now: () => nowMs,
    });

    const issued = await service.issue({
      callId: "call-123",
      mobileDeviceId: "mobile-123",
      desktopDeviceId: "desktop-123",
      mobileLabel: "Android 手机",
      envelopeNotAfterMs: nowMs + 30_000,
    });

    expect(issued.expiresAtMs).toBe(nowMs + 30_000);
    expect(JSON.stringify(issued)).not.toContain("api-secret");
    const mobile = service.open({
      callId: "call-123",
      endpointDeviceId: "mobile-123",
      endpointKind: "MOBILE",
      expiresAtMs: issued.expiresAtMs,
      envelope: issued.mobileEnvelope,
    });
    const desktop = service.open({
      callId: "call-123",
      endpointDeviceId: "desktop-123",
      endpointKind: "DESKTOP",
      expiresAtMs: issued.expiresAtMs,
      envelope: issued.desktopEnvelope,
    });

    expect(mobile.e2eeKey).toBe(desktop.e2eeKey);
    expect(mobile.participantToken).not.toBe(desktop.participantToken);
    expect(mobile.serverUrl).toBe("wss://example.livekit.cloud");
    const verifier = new TokenVerifier("api-key", "api-secret");
    expect((await verifier.verify(mobile.participantToken)).sub)
      .toContain("cyrene-mobile-");
    expect((await verifier.verify(desktop.participantToken)).sub)
      .toContain("cyrene-desktop-");
  });

  it("caps the encrypted envelope at the call's absolute media deadline", async () => {
    const nowMs = Date.parse("2026-07-23T13:00:00.000Z");
    const service = new LiveKitMediaGrantService({
      serverUrl: "https://example.livekit.cloud",
      apiKey: "api-key",
      apiSecret: "api-secret",
      envelopeMasterKey: randomBytes(32),
      now: () => nowMs,
    });

    const issued = await service.issue({
      callId: "call-deadline-cap",
      mobileDeviceId: "mobile-123",
      desktopDeviceId: "desktop-123",
      mobileLabel: "Android 手机",
      envelopeNotAfterMs: nowMs + 12_345,
    });

    expect(issued.expiresAtMs).toBe(nowMs + 12_345);
    expect(issued.mobileEnvelope.expiresAtMs).toBe(nowMs + 12_345);
    expect(issued.desktopEnvelope.expiresAtMs).toBe(nowMs + 12_345);
  });
});
