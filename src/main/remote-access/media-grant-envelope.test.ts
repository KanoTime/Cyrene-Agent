import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  openMediaGrantEnvelope,
  sealMediaGrantEnvelope,
  type MediaGrantEnvelopeContext,
  type MediaJoinGrant,
} from "./media-grant-envelope";

describe("short-lived media grant envelope", () => {
  const context: MediaGrantEnvelopeContext = {
    callId: "019c-call",
    endpointDeviceId: "mobile-device",
    endpointKind: "MOBILE",
    expiresAtMs: Date.parse("2026-07-23T12:00:30.000Z"),
  };
  const grant: MediaJoinGrant = {
    callId: context.callId,
    endpointDeviceId: context.endpointDeviceId,
    participantIdentity: "cyrene-mobile-call",
    peerIdentity: "cyrene-desktop-call",
    serverUrl: "wss://media.example.test",
    participantToken: "sensitive-livekit-token",
    e2eeKey: "sensitive-e2ee-key",
    expiresAt: "2026-07-23T12:05:00.000Z",
  };

  it("round-trips with AES-256-GCM without exposing plaintext in the envelope", () => {
    const masterKey = randomBytes(32);
    const envelope = sealMediaGrantEnvelope({ masterKey, context, grant });
    const serialized = JSON.stringify(envelope);

    expect(serialized).not.toContain(grant.participantToken);
    expect(serialized).not.toContain(grant.e2eeKey);
    expect(openMediaGrantEnvelope({
      masterKey,
      context,
      envelope,
      nowMs: Date.parse("2026-07-23T12:00:10.000Z"),
    })).toEqual(grant);
  });

  it("fails closed for another endpoint, a modified envelope, or expiry", () => {
    const masterKey = randomBytes(32);
    const envelope = sealMediaGrantEnvelope({ masterKey, context, grant });

    expect(() => openMediaGrantEnvelope({
      masterKey,
      context: { ...context, endpointDeviceId: "desktop-device" },
      envelope,
      nowMs: Date.parse("2026-07-23T12:00:10.000Z"),
    })).toThrow("MEDIA_GRANT_ENVELOPE_INVALID");

    expect(() => openMediaGrantEnvelope({
      masterKey,
      context,
      envelope: {
        ...envelope,
        ciphertext: `${envelope.ciphertext.startsWith("A") ? "B" : "A"}${envelope.ciphertext.slice(1)}`,
      },
      nowMs: Date.parse("2026-07-23T12:00:10.000Z"),
    })).toThrow("MEDIA_GRANT_ENVELOPE_INVALID");

    expect(() => openMediaGrantEnvelope({
      masterKey,
      context,
      envelope,
      nowMs: context.expiresAtMs,
    })).toThrow("MEDIA_GRANT_ENVELOPE_EXPIRED");
  });
});
