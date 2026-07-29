import { describe, expect, it, vi } from "vitest";
import { IPC } from "../../shared/ipc-channels";
import { registerDevicePairingIpc } from "./device-pairing-ipc";

describe("Device Pairing IPC", () => {
  it("returns only display-safe pairing data to the renderer", async () => {
    const handlers = new Map<string, (...args: any[]) => Promise<unknown>>();
    const ipcMain = {
      handle: vi.fn((channel: string, handler: (...args: any[]) => Promise<unknown>) => {
        handlers.set(channel, handler);
      }),
    };
    const client = {
      getLocalStatus: vi.fn(async () => ({
        status: "paired" as const,
        deviceId: "desktop-device-1",
        controlPlaneOrigin: "https://control.example.test",
      })),
      bootstrapOwner: vi.fn(async () => ({
        deviceId: "desktop-device-1",
        controlPlaneOrigin: "https://control.example.test",
        ownerRecoveryKey:
          "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      })),
      confirmOwnerRecoveryKey: vi.fn(async () => ({
        status: "CONFIRMED" as const,
        confirmedAt: "2026-07-23T15:30:00.000Z",
      })),
      recoverOwner: vi.fn(async () => ({
        deviceId: "recovered-desktop-1",
        controlPlaneOrigin: "https://control.example.test",
        ownerRecoveryKey:
          "cy_rk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      })),
      beginMobilePairing: vi.fn(async () => ({
        challengeId: "challenge-1",
        pairingLink:
          "cyrene://pair?challengeId=challenge-1&invitation=cy_pi_super-secret",
        shortCode: "CYR-ABC123-654321",
        expiresAt: "2026-07-23T08:02:00.000Z",
      })),
      reviewPairing: vi.fn(async () => ({
        status: "CLAIMED" as const,
        candidate: {
          installationId: "mobile-installation-1",
          kind: "MOBILE" as const,
          label: "Kano 的 Android",
        },
        verificationCode: "123 456",
        expiresAt: "2026-07-23T08:02:00.000Z",
      })),
      decidePairing: vi.fn(async () => ({
        status: "REJECTED" as const,
      })),
    };
    const toDataUrl = vi.fn(async () => "data:image/png;base64,qr");

    registerDevicePairingIpc({ ipcMain, client, toDataUrl });

    const bootstrapped = await handlers.get(IPC.OWNER_BOOTSTRAP)!({}, {
      controlPlaneOrigin: "https://control.example.test",
      deploymentBootstrapCode:
        "cy_db_0123456789abcdef0123456789abcdef0123456789abcdef",
      label: "家中 Mac",
    });
    const recoveryConfirmed = await handlers.get(IPC.OWNER_RECOVERY_CONFIRM)!({}, {
      ownerRecoveryKey:
        "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    });
    const recovered = await handlers.get(IPC.OWNER_RECOVER)!({}, {
      controlPlaneOrigin: "https://control.example.test",
      ownerRecoveryKey:
        "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
      label: "恢复后的 Mac",
    });
    const begun = await handlers.get(IPC.DEVICE_PAIRING_BEGIN)!({});
    const review = await handlers.get(IPC.DEVICE_PAIRING_REVIEW)!({}, {
      challengeId: "challenge-1",
    });
    const decision = await handlers.get(IPC.DEVICE_PAIRING_DECIDE)!({}, {
      challengeId: "challenge-1",
      allow: false,
    });

    expect(bootstrapped).toEqual({
      deviceId: "desktop-device-1",
      controlPlaneOrigin: "https://control.example.test",
      ownerRecoveryKey:
        "cy_rk_abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789",
    });
    expect(JSON.stringify(bootstrapped)).not.toContain("cy_dc_");
    expect(recoveryConfirmed).toEqual({
      status: "CONFIRMED",
      confirmedAt: "2026-07-23T15:30:00.000Z",
    });
    expect(recovered).toEqual({
      deviceId: "recovered-desktop-1",
      controlPlaneOrigin: "https://control.example.test",
      ownerRecoveryKey:
        "cy_rk_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    });
    expect(JSON.stringify(recovered)).not.toContain("cy_dc_");
    expect(begun).toEqual({
      challengeId: "challenge-1",
      qrDataUrl: "data:image/png;base64,qr",
      shortCode: "CYR-ABC123-654321",
      expiresAt: "2026-07-23T08:02:00.000Z",
    });
    expect(JSON.stringify(begun)).not.toContain("cy_pi_super-secret");
    expect(review).toMatchObject({
      status: "CLAIMED",
      verificationCode: "123 456",
    });
    expect(decision).toEqual({ status: "REJECTED" });
    expect(toDataUrl).toHaveBeenCalledWith(
      expect.stringContaining("cy_pi_super-secret"),
      expect.any(Object),
    );
  });
});
