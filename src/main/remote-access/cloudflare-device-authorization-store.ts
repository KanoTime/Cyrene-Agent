import type { DeviceAuthorizationPersistentState } from "./device-authorization";
import type { DeviceAuthorizationAggregateStore } from "./persistent-device-authorization";

export interface CloudflareDurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

interface AuthorizationAggregateDocument {
  schemaVersion: 1;
  revision: number;
  state: DeviceAuthorizationPersistentState;
}

const AGGREGATE_KEY = "authorizationAggregate";

export class CloudflareDeviceAuthorizationAggregateStore
implements DeviceAuthorizationAggregateStore {
  readonly #storage: CloudflareDurableObjectStorage;
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(storage: CloudflareDurableObjectStorage) {
    this.#storage = storage;
  }

  transact<T>(
    operation: (
      state: DeviceAuthorizationPersistentState | null,
    ) => Promise<{
      nextState: DeviceAuthorizationPersistentState;
      result: T;
    }>,
  ): Promise<T> {
    const pending = this.#mutationQueue.then(async () => {
      const current = parseAggregateDocument(
        await this.#storage.get(AGGREGATE_KEY),
      );
      const { nextState, result } = await operation(
        current ? structuredClone(current.state) : null,
      );
      const expectedRevision = (current?.revision ?? 0) + 1;
      if (
        nextState.version !== 1
        || nextState.revision !== expectedRevision
        || !Number.isSafeInteger(nextState.revision)
      ) {
        throw new Error("DEVICE_AUTHORIZATION_REVISION_INVALID");
      }
      const nextDocument: AuthorizationAggregateDocument = {
        schemaVersion: 1,
        revision: nextState.revision,
        state: structuredClone(nextState),
      };
      await this.#storage.put(AGGREGATE_KEY, nextDocument);
      return result;
    });
    this.#mutationQueue = pending.then(
      () => undefined,
      () => undefined,
    );
    return pending;
  }
}

function parseAggregateDocument(
  raw: unknown,
): AuthorizationAggregateDocument | null {
  if (raw === undefined) return null;
  if (
    !isRecord(raw)
    || raw.schemaVersion !== 1
    || !Number.isSafeInteger(raw.revision)
    || !isRecord(raw.state)
  ) {
    throw new Error("DEVICE_AUTHORIZATION_DOCUMENT_INVALID");
  }
  const state = raw.state as unknown as DeviceAuthorizationPersistentState;
  if (state.version !== 1 || state.revision !== raw.revision) {
    throw new Error("DEVICE_AUTHORIZATION_DOCUMENT_INVALID");
  }
  return {
    schemaVersion: 1,
    revision: raw.revision as number,
    state: structuredClone(state),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
