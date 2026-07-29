import { describe, expect, it } from "vitest";
import { assertSupportedMobileEntryLink } from "./entry-link";

describe("mobile entry link policy", () => {
  it("accepts only long-term device pairing invitations", () => {
    expect(() => assertSupportedMobileEntryLink(
      "cyrene://pair?challengeId=123e4567-e89b-12d3-a456-426614174000"
      + "&invitation=cy_pi_0123456789abcdefghijklmnopqrstuvwxyzABCD"
      + "&endpoint=https%3A%2F%2Fcontrol.example.test"
      + "&expiresAt=2099-01-01T00%3A00%3A00.000Z",
    )).not.toThrow();
  });

  it("rejects the legacy direct-call link instead of joining without E2EE", () => {
    expect(() => assertSupportedMobileEntryLink(
      "cyrene://call?serverUrl=wss%3A%2F%2Fexample.test&token=header.payload.signature&callId=legacy&expiresAt=2099-01-01T00%3A00%3A00.000Z",
    )).toThrow("LEGACY_DIRECT_CALL_DISABLED");
  });
});
