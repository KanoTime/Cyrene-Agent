import { describe, expect, it } from "vitest";
import { CloudBaseDeviceAuthorizationAggregateStore } from "./cloudbase-device-authorization-store";
import type { DeviceAuthorizationPersistentState } from "./device-authorization";

function emptyState(revision: number): DeviceAuthorizationPersistentState {
  return {
    version: 1,
    revision,
    ownerBootstrapped: false,
    devices: [],
    challenges: [],
  };
}

describe("CloudBase Device Authorization Aggregate Store", () => {
  it("updates the single-owner aggregate inside one database transaction", async () => {
    let document: Record<string, unknown> | null = null;
    let transactionCalls = 0;
    const database = {
      runTransaction: async <T>(
        operation: (transaction: {
          collection(name: string): {
            doc(id: string): {
              get(): Promise<{ data: Record<string, unknown>[] }>;
              set(data: Record<string, unknown>): Promise<void>;
            };
          };
        }) => Promise<T>,
      ): Promise<T> => {
        transactionCalls += 1;
        return operation({
          collection: (name) => {
            expect(name).toBe("cyrene_device_authorization");
            return {
              doc: (id) => {
                expect(id).toBe("owner_v1");
                return {
                  get: async () => ({ data: document ? [structuredClone(document)] : [] }),
                  set: async (data) => {
                    document = structuredClone(data);
                  },
                };
              },
            };
          },
        });
      },
    };
    const store = new CloudBaseDeviceAuthorizationAggregateStore({
      database,
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });

    const first = await store.transact(async (state) => ({
      nextState: emptyState((state?.revision ?? 0) + 1),
      result: "first",
    }));
    const second = await store.transact(async (state) => ({
      nextState: {
        ...state!,
        revision: state!.revision + 1,
        ownerBootstrapped: true,
      },
      result: state!.revision,
    }));

    expect(first).toBe("first");
    expect(second).toBe(1);
    expect(transactionCalls).toBe(2);
    expect(document).toMatchObject({
      schemaVersion: 1,
      revision: 2,
      state: {
        version: 1,
        revision: 2,
        ownerBootstrapped: true,
      },
    });
  });

  it("rejects a write that does not advance the aggregate revision exactly once", async () => {
    const database = {
      runTransaction: async <T>(operation: (transaction: any) => Promise<T>): Promise<T> =>
        operation({
          collection: () => ({
            doc: () => ({
              get: async () => ({ data: [] }),
              set: async () => undefined,
            }),
          }),
        }),
    };
    const store = new CloudBaseDeviceAuthorizationAggregateStore({
      database,
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });

    await expect(store.transact(async () => ({
      nextState: emptyState(2),
      result: undefined,
    }))).rejects.toThrow("DEVICE_AUTHORIZATION_REVISION_INVALID");
  });

  it("treats CloudBase DOCUMENT_NOT_FOUND as an empty first-owner aggregate", async () => {
    let written: Record<string, unknown> | null = null;
    const database = {
      runTransaction: async <T>(operation: (transaction: any) => Promise<T>): Promise<T> =>
        operation({
          collection: () => ({
            doc: () => ({
              get: async () => Promise.reject({ code: "DOCUMENT_NOT_FOUND" }),
              set: async (data: Record<string, unknown>) => {
                written = structuredClone(data);
              },
            }),
          }),
        }),
    };
    const store = new CloudBaseDeviceAuthorizationAggregateStore({
      database,
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });

    const result = await store.transact(async (state) => ({
      nextState: emptyState((state?.revision ?? 0) + 1),
      result: state,
    }));

    expect(result).toBeNull();
    expect(written).toMatchObject({
      schemaVersion: 1,
      revision: 1,
    });
  });

  it("does not suppress other CloudBase document read failures", async () => {
    const denied = { code: "DATABASE_PERMISSION_DENIED" };
    const database = {
      runTransaction: async <T>(operation: (transaction: any) => Promise<T>): Promise<T> =>
        operation({
          collection: () => ({
            doc: () => ({
              get: async () => Promise.reject(denied),
              set: async () => undefined,
            }),
          }),
        }),
    };
    const store = new CloudBaseDeviceAuthorizationAggregateStore({
      database,
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });

    await expect(store.transact(async () => ({
      nextState: emptyState(1),
      result: undefined,
    }))).rejects.toBe(denied);
  });

  it("reads the CloudBase gateway transaction list envelope", async () => {
    let written: Record<string, unknown> | null = null;
    const persistedState = emptyState(1);
    const database = {
      runTransaction: async <T>(operation: (transaction: any) => Promise<T>): Promise<T> =>
        operation({
          collection: () => ({
            doc: () => ({
              get: async () => ({
                data: {
                  list: [{
                    _id: "owner_v1",
                    schemaVersion: 1,
                    revision: 1,
                    state: persistedState,
                  }],
                },
              }),
              set: async (data: Record<string, unknown>) => {
                written = structuredClone(data);
              },
            }),
          }),
        }),
    };
    const store = new CloudBaseDeviceAuthorizationAggregateStore({
      database,
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });

    const previousRevision = await store.transact(async (state) => ({
      nextState: {
        ...state!,
        revision: state!.revision + 1,
      },
      result: state!.revision,
    }));

    expect(previousRevision).toBe(1);
    expect(written).toMatchObject({
      schemaVersion: 1,
      revision: 2,
      state: {
        version: 1,
        revision: 2,
      },
    });
  });
});
