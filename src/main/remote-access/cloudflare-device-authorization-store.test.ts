import { describe, expect, it } from "vitest";
import type { DeviceAuthorizationPersistentState } from "./device-authorization";
import {
  CloudflareDeviceAuthorizationAggregateStore,
  type CloudflareDurableObjectStorage,
} from "./cloudflare-device-authorization-store";

class MemoryStorage implements CloudflareDurableObjectStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

function state(revision: number): DeviceAuthorizationPersistentState {
  return {
    version: 1,
    revision,
    owner: null,
    pairingChallenges: [],
    deviceCredentialFamilies: [],
    voiceCalls: [],
  };
}

describe("Cloudflare Device Authorization Aggregate Store", () => {
  it("persists one revisioned aggregate in Durable Object storage", async () => {
    const storage = new MemoryStorage();
    const first = new CloudflareDeviceAuthorizationAggregateStore(storage);
    const second = new CloudflareDeviceAuthorizationAggregateStore(storage);

    await first.transact(async (current) => {
      expect(current).toBeNull();
      return { nextState: state(1), result: undefined };
    });
    const revision = await second.transact(async (current) => {
      expect(current?.revision).toBe(1);
      return { nextState: state(2), result: 2 };
    });

    expect(revision).toBe(2);
    expect(storage.values.get("authorizationAggregate")).toMatchObject({
      schemaVersion: 1,
      revision: 2,
      state: { version: 1, revision: 2 },
    });
  });

  it("rejects malformed persisted data and invalid revision changes", async () => {
    const malformed = new MemoryStorage();
    malformed.values.set("authorizationAggregate", { schemaVersion: 99 });
    const malformedStore = new CloudflareDeviceAuthorizationAggregateStore(
      malformed,
    );
    await expect(malformedStore.transact(async () => ({
      nextState: state(1),
      result: undefined,
    }))).rejects.toThrow("DEVICE_AUTHORIZATION_DOCUMENT_INVALID");

    const storage = new MemoryStorage();
    const store = new CloudflareDeviceAuthorizationAggregateStore(storage);
    await expect(store.transact(async () => ({
      nextState: state(2),
      result: undefined,
    }))).rejects.toThrow("DEVICE_AUTHORIZATION_REVISION_INVALID");
  });
});
