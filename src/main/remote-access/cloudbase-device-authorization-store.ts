import type { DeviceAuthorizationPersistentState } from "./device-authorization";
import type { DeviceAuthorizationAggregateStore } from "./persistent-device-authorization";

interface CloudBaseDocumentReference {
  get(): Promise<{
    data?:
      | Record<string, unknown>[]
      | Record<string, unknown>
      | { list: Record<string, unknown>[] }
      | null;
  }>;
  set(data: Record<string, unknown>): Promise<unknown>;
}

interface CloudBaseTransaction {
  collection(name: string): {
    doc(id: string): CloudBaseDocumentReference;
  };
}

export interface CloudBaseTransactionDatabase {
  runTransaction<T>(
    operation: (transaction: CloudBaseTransaction) => Promise<T>,
  ): Promise<T>;
}

interface AuthorizationAggregateDocument {
  schemaVersion: 1;
  revision: number;
  state: DeviceAuthorizationPersistentState;
}

export class CloudBaseDeviceAuthorizationAggregateStore
implements DeviceAuthorizationAggregateStore {
  readonly #database: CloudBaseTransactionDatabase;
  readonly #collectionName: string;
  readonly #documentId: string;

  constructor(options: {
    database: CloudBaseTransactionDatabase;
    collectionName: string;
    documentId: string;
  }) {
    this.#database = options.database;
    this.#collectionName = requireIdentifier(
      options.collectionName,
      "CLOUDBASE_COLLECTION_NAME_INVALID",
    );
    this.#documentId = requireIdentifier(
      options.documentId,
      "CLOUDBASE_DOCUMENT_ID_INVALID",
    );
  }

  transact<T>(
    operation: (
      state: DeviceAuthorizationPersistentState | null,
    ) => Promise<{
      nextState: DeviceAuthorizationPersistentState;
      result: T;
    }>,
  ): Promise<T> {
    return this.#database.runTransaction(async (transaction) => {
      const document = transaction
        .collection(this.#collectionName)
        .doc(this.#documentId);
      const current = await readAggregateDocument(document);
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
      await document.set(nextDocument as unknown as Record<string, unknown>);
      return result;
    });
  }
}

async function readAggregateDocument(
  document: CloudBaseDocumentReference,
): Promise<AuthorizationAggregateDocument | null> {
  try {
    return parseAggregateDocument(await document.get());
  } catch (error) {
    if (hasErrorCode(error, "DOCUMENT_NOT_FOUND")) return null;
    throw error;
  }
}

function parseAggregateDocument(
  result: Awaited<ReturnType<CloudBaseDocumentReference["get"]>>,
): AuthorizationAggregateDocument | null {
  const data = result.data;
  let raw: Record<string, unknown> | null;
  if (Array.isArray(data)) {
    raw = data[0] ?? null;
  } else if (isRecord(data) && "list" in data) {
    if (!Array.isArray(data.list)) {
      throw new Error("DEVICE_AUTHORIZATION_DOCUMENT_INVALID");
    }
    raw = data.list[0] ?? null;
  } else {
    raw = data ?? null;
  }
  if (!raw) return null;
  if (
    raw.schemaVersion !== 1
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

function hasErrorCode(error: unknown, expected: string): boolean {
  const visited = new Set<unknown>();
  let candidate: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object" || visited.has(candidate)) {
      return false;
    }
    visited.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (record.code === expected) return true;
    candidate = record.error ?? record.cause;
  }
  return false;
}

function requireIdentifier(value: string, code: string): string {
  const normalized = value.trim();
  if (!/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(normalized)) {
    throw new Error(code);
  }
  return normalized;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
