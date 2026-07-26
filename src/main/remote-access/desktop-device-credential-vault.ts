import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { safeStorage as electronSafeStorage } from "electron";

export interface DesktopDeviceCredentialRecord {
  controlPlaneOrigin: string;
  deviceId: string;
  deviceCredential: string;
  savedAt: string;
}

type SafeStorage = Pick<
  typeof electronSafeStorage,
  "isEncryptionAvailable" | "encryptString" | "decryptString"
>;

interface DesktopDeviceCredentialFile {
  version: 1;
  payload: string;
}

export type DesktopDeviceCredentialLoadResult =
  | { status: "missing" }
  | { status: "corrupt" }
  | { status: "available"; record: DesktopDeviceCredentialRecord };

const FILENAME = "desktop-device.enc";
const DEVICE_CREDENTIAL_PATTERN = /^cy_dc_[A-Za-z0-9_-]{40,}$/;

export class DesktopDeviceCredentialVault {
  readonly #rootDir: string;
  readonly #safeStorage: SafeStorage;

  constructor(options: { rootDir: string; safeStorage: SafeStorage }) {
    this.#rootDir = options.rootDir;
    this.#safeStorage = options.safeStorage;
  }

  async save(record: DesktopDeviceCredentialRecord): Promise<void> {
    this.#assertSecureStorageAvailable();
    const normalized = normalizeRecord(record);
    const encrypted = this.#safeStorage.encryptString(JSON.stringify(normalized));
    const file: DesktopDeviceCredentialFile = {
      version: 1,
      payload: encrypted.toString("base64"),
    };
    await mkdir(this.#rootDir, { recursive: true, mode: 0o700 });
    const temporaryPath = `${this.#filePath()}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, JSON.stringify(file), { mode: 0o600 });
    await rename(temporaryPath, this.#filePath());
  }

  async load(): Promise<DesktopDeviceCredentialLoadResult> {
    let raw: string;
    try {
      raw = await readFile(this.#filePath(), "utf8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { status: "missing" };
      }
      return { status: "corrupt" };
    }
    try {
      this.#assertSecureStorageAvailable();
      const file = JSON.parse(raw) as Partial<DesktopDeviceCredentialFile>;
      if (file.version !== 1 || typeof file.payload !== "string" || !file.payload) {
        return { status: "corrupt" };
      }
      const decrypted = this.#safeStorage.decryptString(
        Buffer.from(file.payload, "base64"),
      );
      return {
        status: "available",
        record: normalizeRecord(JSON.parse(decrypted) as DesktopDeviceCredentialRecord),
      };
    } catch {
      return { status: "corrupt" };
    }
  }

  async clear(): Promise<void> {
    try {
      await unlink(this.#filePath());
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  #assertSecureStorageAvailable(): void {
    let available = false;
    try {
      available = this.#safeStorage.isEncryptionAvailable();
    } catch {
      available = false;
    }
    if (!available) throw new Error("DESKTOP_SECURE_STORAGE_UNAVAILABLE");
  }

  #filePath(): string {
    return path.join(this.#rootDir, FILENAME);
  }
}

function normalizeRecord(
  record: DesktopDeviceCredentialRecord,
): DesktopDeviceCredentialRecord {
  const controlPlane = new URL(record.controlPlaneOrigin);
  if (controlPlane.protocol !== "https:") {
    throw new Error("CONTROL_PLANE_HTTPS_REQUIRED");
  }
  const deviceId = record.deviceId.trim();
  if (!deviceId || deviceId.length > 128) {
    throw new Error("DEVICE_ID_INVALID");
  }
  const deviceCredential = record.deviceCredential.trim();
  if (!DEVICE_CREDENTIAL_PATTERN.test(deviceCredential)) {
    throw new Error("DEVICE_CREDENTIAL_INVALID");
  }
  const savedAt = new Date(record.savedAt);
  if (Number.isNaN(savedAt.getTime())) {
    throw new Error("DEVICE_CREDENTIAL_SAVED_AT_INVALID");
  }
  return {
    controlPlaneOrigin: controlPlane.origin,
    deviceId,
    deviceCredential,
    savedAt: savedAt.toISOString(),
  };
}
