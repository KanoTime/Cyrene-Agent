import { describe, expect, it } from "vitest";
import { TokenVerifier } from "livekit-server-sdk";
import { createMobileCallCredentials, normalizeLiveKitServerUrl } from "./livekit-call-credentials";

describe("mobile LiveKit call credentials", () => {
  it("issues separate least-privilege room tokens and only exposes the phone token in the link", async () => {
    const credentials = await createMobileCallCredentials({
      serverUrl: "https://example.livekit.cloud/",
      apiKey: "api-key",
      apiSecret: "api-secret",
      tokenTtlSeconds: 600,
    }, {
      callId: "call-123",
      now: new Date("2026-07-21T00:00:00.000Z"),
      deviceName: "Kano 的 iPhone",
    });

    const verifier = new TokenVerifier("api-key", "api-secret");
    const mobileClaims = await verifier.verify(credentials.mobileToken);
    const agentClaims = await verifier.verify(credentials.agentToken);

    expect(credentials.roomName).toBe("cyrene-call-call123");
    expect(credentials.expiresAt).toBe("2026-07-21T00:10:00.000Z");
    expect(mobileClaims.sub).toBe("cyrene-mobile-call123");
    expect(mobileClaims.video).toMatchObject({
      room: "cyrene-call-call123",
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishSources: ["microphone"],
    });
    expect(mobileClaims.video?.canPublishData).not.toBe(true);
    expect(agentClaims.sub).toBe("cyrene-desktop-call123");

    const link = new URL(credentials.mobileLink);
    expect(link.protocol).toBe("cyrene:");
    expect(link.searchParams.get("serverUrl")).toBe("wss://example.livekit.cloud");
    expect(link.searchParams.get("token")).toBe(credentials.mobileToken);
    expect(link.search).not.toContain(credentials.agentToken);
  });

  it("normalizes http(s) URLs for LiveKit clients", () => {
    expect(normalizeLiveKitServerUrl("https://livekit.example.com/")).toBe("wss://livekit.example.com");
    expect(normalizeLiveKitServerUrl("ws://127.0.0.1:7880")).toBe("ws://127.0.0.1:7880");
  });
});
