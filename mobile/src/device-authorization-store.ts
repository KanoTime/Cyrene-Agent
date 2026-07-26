import * as Crypto from "expo-crypto";
import * as SecureStore from "expo-secure-store";

const INSTALLATION_ID_KEY = "cyrene.installation-id.v1";
const DEVICE_AUTHORIZATION_KEY = "cyrene.device-authorization.v1";
const KEYCHAIN_SERVICE = "com.cyrene.agent.device-authorization";

const secureStoreOptions: SecureStore.SecureStoreOptions = {
  keychainService: KEYCHAIN_SERVICE,
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export interface StoredMobileDeviceAuthorization {
  schemaVersion: 1;
  installationId: string;
  deviceId: string;
  deviceCredential: string;
  pairedAt: string;
  controlPlaneOrigin?: string;
}

function isUuid(value: unknown): value is string {
  return typeof value === "string"
    && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function parseStoredAuthorization(value: string): StoredMobileDeviceAuthorization | null {
  try {
    const candidate = JSON.parse(value) as Partial<StoredMobileDeviceAuthorization>;
    if (
      candidate.schemaVersion !== 1
      || !isUuid(candidate.installationId)
      || !isUuid(candidate.deviceId)
      || typeof candidate.deviceCredential !== "string"
      || !/^cy_dc_[A-Za-z0-9_-]{40,}$/.test(candidate.deviceCredential)
      || typeof candidate.pairedAt !== "string"
      || !Number.isFinite(Date.parse(candidate.pairedAt))
    ) {
      return null;
    }
    const controlPlaneOrigin = typeof candidate.controlPlaneOrigin === "string"
      ? normalizeHttpsOrigin(candidate.controlPlaneOrigin)
      : undefined;
    return {
      schemaVersion: 1,
      installationId: candidate.installationId,
      deviceId: candidate.deviceId,
      deviceCredential: candidate.deviceCredential,
      pairedAt: new Date(candidate.pairedAt).toISOString(),
      ...(controlPlaneOrigin ? { controlPlaneOrigin } : {}),
    };
  } catch {
    return null;
  }
}

function normalizeHttpsOrigin(value: string): string | undefined {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password) return undefined;
    return url.origin;
  } catch {
    return undefined;
  }
}

export async function getOrCreateInstallationId(): Promise<string> {
  if (!await SecureStore.isAvailableAsync()) {
    throw new Error("DEVICE_SECURE_STORAGE_UNAVAILABLE");
  }
  const existing = await SecureStore.getItemAsync(INSTALLATION_ID_KEY, secureStoreOptions);
  if (existing) {
    if (!isUuid(existing)) throw new Error("INSTALLATION_ID_INVALID");
    return existing;
  }
  const installationId = Crypto.randomUUID();
  await SecureStore.setItemAsync(INSTALLATION_ID_KEY, installationId, secureStoreOptions);
  return installationId;
}

export async function loadMobileDeviceAuthorization():
Promise<StoredMobileDeviceAuthorization | null> {
  if (!await SecureStore.isAvailableAsync()) return null;
  const stored = await SecureStore.getItemAsync(
    DEVICE_AUTHORIZATION_KEY,
    secureStoreOptions,
  );
  return stored ? parseStoredAuthorization(stored) : null;
}

export async function saveMobileDeviceAuthorization(
  authorization: StoredMobileDeviceAuthorization,
): Promise<void> {
  const normalized = parseStoredAuthorization(JSON.stringify(authorization));
  if (!normalized) throw new Error("DEVICE_AUTHORIZATION_INVALID");
  if (!await SecureStore.isAvailableAsync()) {
    throw new Error("DEVICE_SECURE_STORAGE_UNAVAILABLE");
  }
  await SecureStore.setItemAsync(
    DEVICE_AUTHORIZATION_KEY,
    JSON.stringify(normalized),
    secureStoreOptions,
  );
}

export async function clearMobileDeviceAuthorization(): Promise<void> {
  if (!await SecureStore.isAvailableAsync()) return;
  await SecureStore.deleteItemAsync(DEVICE_AUTHORIZATION_KEY, secureStoreOptions);
  await SecureStore.deleteItemAsync(INSTALLATION_ID_KEY, secureStoreOptions);
}
