import { describe, expect, it, vi } from "vitest";
import {
  createDesktopAuthorizationRequest,
  DesktopDeviceAuthorizationClient,
} from "./desktop-device-authorization-client";
import type {
  DesktopDeviceCredentialLoadResult,
  DesktopDeviceCredentialVault,
} from "./desktop-device-credential-vault";

const identity = {
  controlPlaneOrigin: "https://control.example.test",
  deviceId: "desktop-device-1",
  deviceCredential:
    "cy_dc_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
  savedAt: "2026-07-23T06:00:00.000Z",
};

function createVault(
  result: DesktopDeviceCredentialLoadResult = { status: "available", record: identity },
): Pick<DesktopDeviceCredentialVault, "load" | "save"> {
  return {
    load: vi.fn(async () => result),
    save: vi.fn(async () => undefined),
  };
}

describe("Desktop Device Authorization Client", () => {
  it("uses the injected transport for control-plane requests", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const request = createDesktopAuthorizationRequest(async (url, init) => {
      calls.push({ url, init });
      return new Response(JSON.stringify({ status: "OPEN" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });

    const response = await request("https://control.example.test/v1/test", {
      authorization: "DeviceCredential test",
      body: { value: 1 },
    });

    expect(response).toEqual({ status: 200, body: { status: "OPEN" } });
    expect(calls).toHaveLength(1);
    expect(calls[0]?.url).toBe("https://control.example.test/v1/test");
    expect(calls[0]?.init).toMatchObject({
      method: "POST",
      redirect: "error",
      body: JSON.stringify({ value: 1 }),
    });
    expect(calls[0]?.init.signal).toBeInstanceOf(AbortSignal);
  });

  it("bootstraps the first desktop, saves its credential before returning the one-time recovery key", async () => {
    const vault = createVault({ status: "missing" });
    const request = vi.fn(async () => ({
      status: 200,
      body: {
        deviceId: "desktop-device-1",
        deviceCredential:
          "cy_dc_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
        ownerRecoveryKey:
          "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      },
    }));
    const client = new DesktopDeviceAuthorizationClient({ vault, request });

    const result = await client.bootstrapOwner({
      controlPlaneOrigin: "https://control.example.test/path-is-ignored",
      deploymentBootstrapCode:
        "cy_db_0123456789abcdef0123456789abcdef0123456789abcdef",
      label: "家中 Mac",
    });

    expect(request).toHaveBeenCalledWith(
      "https://control.example.test/v1/owner/bootstrap",
      {
        authorization:
          "DeploymentBootstrap cy_db_0123456789abcdef0123456789abcdef0123456789abcdef",
        body: { label: "家中 Mac" },
      },
    );
    expect(vault.save).toHaveBeenCalledWith({
      controlPlaneOrigin: "https://control.example.test",
      deviceId: "desktop-device-1",
      deviceCredential:
        "cy_dc_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      savedAt: expect.any(String),
    });
    expect(result).toEqual({
      deviceId: "desktop-device-1",
      controlPlaneOrigin: "https://control.example.test",
      ownerRecoveryKey:
        "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    });
    expect(result).not.toHaveProperty("deviceCredential");
  });

  it("confirms the recovery key using the saved desktop credential", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      body: {
        status: "CONFIRMED",
        confirmedAt: "2026-07-23T15:30:00.000Z",
      },
    }));
    const client = new DesktopDeviceAuthorizationClient({
      vault: createVault(),
      request,
    });

    await expect(client.confirmOwnerRecoveryKey(
      "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    )).resolves.toEqual({
      status: "CONFIRMED",
      confirmedAt: "2026-07-23T15:30:00.000Z",
    });
    expect(request).toHaveBeenCalledWith(
      "https://control.example.test/v1/owner/recovery-key/confirm",
      {
        authorization: `DeviceCredential ${identity.deviceCredential}`,
        body: {
          ownerRecoveryKey:
            "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        },
      },
    );
  });

  it("recovers a missing desktop, saves the rotated credential, and returns only the replacement recovery key", async () => {
    const vault = createVault({ status: "missing" });
    const request = vi.fn(async () => ({
      status: 200,
      body: {
        device: {
          deviceId: "recovered-desktop-1",
          kind: "DESKTOP",
          label: "恢复后的 Mac",
          status: "ACTIVE",
          pairedAt: "2026-07-23T16:00:00.000Z",
        },
        deviceCredential:
          "cy_dc_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        ownerRecoveryKey:
          "cy_rk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      },
    }));
    const client = new DesktopDeviceAuthorizationClient({ vault, request });

    const result = await client.recoverOwner({
      controlPlaneOrigin: "https://control.example.test",
      ownerRecoveryKey:
        "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      label: "恢复后的 Mac",
    });

    expect(request).toHaveBeenCalledWith(
      "https://control.example.test/v1/owner/recover",
      {
        authorization:
          "OwnerRecovery cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
        body: {
          recoveryReceipt: expect.stringMatching(/^cy_rr_[A-Za-z0-9_-]{40,}$/),
          label: "恢复后的 Mac",
        },
      },
    );
    expect(vault.save).toHaveBeenCalledWith({
      controlPlaneOrigin: "https://control.example.test",
      deviceId: "recovered-desktop-1",
      deviceCredential:
        "cy_dc_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      savedAt: expect.any(String),
    });
    expect(result).toEqual({
      deviceId: "recovered-desktop-1",
      controlPlaneOrigin: "https://control.example.test",
      ownerRecoveryKey:
        "cy_rk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    expect(result).not.toHaveProperty("deviceCredential");
  });

  it("begins a mobile challenge with the credential only in the HTTPS authorization header", async () => {
    const request = vi.fn(async () => ({
      status: 200,
      body: {
        challengeId: "challenge-1",
        pairingLink: "cyrene://pair?challengeId=challenge-1",
        shortCode: "CYR-ABC123-654321",
        expiresAt: "2026-07-23T06:02:00.000Z",
      },
    }));
    const client = new DesktopDeviceAuthorizationClient({
      vault: createVault(),
      request,
    });

    const challenge = await client.beginMobilePairing();

    expect(challenge).toEqual({
      challengeId: "challenge-1",
      pairingLink: "cyrene://pair?challengeId=challenge-1",
      shortCode: "CYR-ABC123-654321",
      expiresAt: "2026-07-23T06:02:00.000Z",
    });
    expect(challenge).not.toHaveProperty("deviceCredential");
    expect(request).toHaveBeenCalledWith(
      "https://control.example.test/v1/pairing/begin",
      {
        authorization: `DeviceCredential ${identity.deviceCredential}`,
        body: { targetKind: "MOBILE" },
      },
    );
  });

  it("reports desktop availability with the credential only in the HTTPS authorization header", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: {
          status: "AVAILABLE",
          availableUntil: "2026-07-23T08:00:45.000Z",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: { status: "UNAVAILABLE" },
      });
    const client = new DesktopDeviceAuthorizationClient({
      vault: createVault(),
      request,
    });

    await expect(client.reportDesktopAvailability(true)).resolves.toEqual({
      status: "AVAILABLE",
      availableUntil: "2026-07-23T08:00:45.000Z",
    });
    await expect(client.reportDesktopAvailability(false)).resolves.toEqual({
      status: "UNAVAILABLE",
    });
    expect(request).toHaveBeenNthCalledWith(
      1,
      "https://control.example.test/v1/desktop/availability",
      {
        authorization: `DeviceCredential ${identity.deviceCredential}`,
        body: { available: true },
      },
    );
    expect(request).toHaveBeenNthCalledWith(
      2,
      "https://control.example.test/v1/desktop/availability",
      {
        authorization: `DeviceCredential ${identity.deviceCredential}`,
        body: { available: false },
      },
    );
  });

  it("returns only a display-safe pending review and sends the approval explicitly", async () => {
    const request = vi.fn()
      .mockResolvedValueOnce({
        status: 200,
        body: {
          status: "CLAIMED",
          candidate: {
            installationId: "mobile-installation-1",
            kind: "MOBILE",
            label: "Kano 的 Android",
          },
          verificationCode: "123 456",
          expiresAt: "2026-07-23T06:02:00.000Z",
        },
      })
      .mockResolvedValueOnce({
        status: 200,
        body: {
          status: "APPROVED",
          device: {
            deviceId: "mobile-device-1",
            kind: "MOBILE",
            label: "Kano 的 Android",
            status: "ACTIVE",
            pairedAt: "2026-07-23T06:01:00.000Z",
          },
        },
      });
    const client = new DesktopDeviceAuthorizationClient({
      vault: createVault(),
      request,
    });

    const review = await client.reviewPairing("challenge-1");
    const decision = await client.decidePairing("challenge-1", true);

    expect(review).toMatchObject({
      status: "CLAIMED",
      candidate: { label: "Kano 的 Android", kind: "MOBILE" },
      verificationCode: "123 456",
    });
    expect(review).not.toHaveProperty("deviceCredential");
    expect(decision).toMatchObject({ status: "APPROVED" });
    expect(decision).not.toHaveProperty("deviceCredential");
    expect(request).toHaveBeenLastCalledWith(
      "https://control.example.test/v1/pairing/decide",
      {
        authorization: `DeviceCredential ${identity.deviceCredential}`,
        body: { challengeId: "challenge-1", allow: true },
      },
    );
  });

  it("reports missing local authorization without attempting a network request", async () => {
    const request = vi.fn();
    const client = new DesktopDeviceAuthorizationClient({
      vault: createVault({ status: "missing" }),
      request,
    });

    await expect(client.getLocalStatus()).resolves.toEqual({
      status: "not-paired",
    });
    await expect(client.beginMobilePairing())
      .rejects.toThrow("DESKTOP_DEVICE_NOT_PAIRED");
    expect(request).not.toHaveBeenCalled();
  });
});
