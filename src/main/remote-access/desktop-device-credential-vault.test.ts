import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopDeviceCredentialVault } from "./desktop-device-credential-vault";

const safeStorage = {
  isEncryptionAvailable: vi.fn(() => true),
  encryptString: vi.fn((plain: string) => Buffer.from(`keychain:${plain}`, "utf8")),
  decryptString: vi.fn((encrypted: Buffer) =>
    encrypted.toString("utf8").replace(/^keychain:/, "")),
};

let rootDir = "";

beforeEach(async () => {
  rootDir = await fs.mkdtemp(path.join(os.tmpdir(), "cyrene-desktop-device-"));
  safeStorage.isEncryptionAvailable.mockReturnValue(true);
  safeStorage.encryptString.mockClear();
  safeStorage.decryptString.mockClear();
});

describe("Desktop Device Credential Vault", () => {
  it("round-trips one desktop identity without writing its credential in plaintext", async () => {
    const vault = new DesktopDeviceCredentialVault({ rootDir, safeStorage });
    const record = {
      controlPlaneOrigin: "https://control.example.test",
      deviceId: "desktop-device-1",
      deviceCredential:
        "cy_dc_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      savedAt: "2026-07-23T06:00:00.000Z",
    };

    await vault.save(record);

    await expect(vault.load()).resolves.toEqual({
      status: "available",
      record,
    });
    const disk = await fs.readFile(path.join(rootDir, "desktop-device.enc"), "utf8");
    expect(disk).not.toContain(record.deviceCredential);
    expect(safeStorage.encryptString).toHaveBeenCalledOnce();
  });

  it("refuses to persist when the OS secure storage is unavailable", async () => {
    safeStorage.isEncryptionAvailable.mockReturnValue(false);
    const vault = new DesktopDeviceCredentialVault({ rootDir, safeStorage });

    await expect(vault.save({
      controlPlaneOrigin: "https://control.example.test",
      deviceId: "desktop-device-1",
      deviceCredential:
        "cy_dc_0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      savedAt: "2026-07-23T06:00:00.000Z",
    })).rejects.toThrow("DESKTOP_SECURE_STORAGE_UNAVAILABLE");
    await expect(fs.stat(path.join(rootDir, "desktop-device.enc")))
      .rejects.toMatchObject({ code: "ENOENT" });
  });

  it("reports a corrupt identity without returning partial credential data", async () => {
    await fs.writeFile(path.join(rootDir, "desktop-device.enc"), "not-json", {
      mode: 0o600,
    });
    const vault = new DesktopDeviceCredentialVault({ rootDir, safeStorage });

    await expect(vault.load()).resolves.toEqual({ status: "corrupt" });
  });
});
