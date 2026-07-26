import { describe, expect, it } from "vitest";
import type { StoredMobileDeviceAuthorization } from "./device-authorization-store";
import { resolveControlPlaneOrigin } from "./control-plane-origin";

function authorization(
  controlPlaneOrigin?: string,
): StoredMobileDeviceAuthorization {
  return {
    schemaVersion: 1,
    installationId: "11111111-1111-4111-8111-111111111111",
    deviceId: "22222222-2222-4222-8222-222222222222",
    deviceCredential: `cy_dc_${"a".repeat(40)}`,
    pairedAt: "2026-07-27T00:00:00.000Z",
    ...(controlPlaneOrigin ? { controlPlaneOrigin } : {}),
  };
}

describe("remote call control-plane routing", () => {
  it("uses the HTTPS origin stored by the approved pairing", () => {
    expect(resolveControlPlaneOrigin(
      authorization("https://voice-control.example.test").controlPlaneOrigin,
    )).toBe("https://voice-control.example.test");
  });

  it("fails closed instead of falling back to an obsolete deployment", () => {
    expect(() => resolveControlPlaneOrigin(authorization().controlPlaneOrigin))
      .toThrow("CONTROL_PLANE_ORIGIN_REQUIRED");
  });
});
