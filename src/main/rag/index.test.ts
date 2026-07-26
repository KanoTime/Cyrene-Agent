import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import type { EmbeddingProvider } from "./embedding";
import { configureActiveCharacterState, resolveCharacterStateLayout } from "../character/character-state";
import { configureActiveCharacter } from "../character/active-character";
import { createDefaultCharacterRuntime } from "../character/character-runtime";

const provider: EmbeddingProvider = {
  name: "deterministic",
  dims: 2,
  async embed(text: string): Promise<number[]> {
    return text.includes("paragraph") ? [0, 1] : [1, 0];
  },
  async embedBatch(texts: string[]): Promise<number[][]> {
    return Promise.all(texts.map((text) => this.embed(text)));
  },
};

const { userDataDir, appPath } = vi.hoisted(() => ({ userDataDir: { value: "" }, appPath: { value: "" } }));

vi.mock("electron", () => ({
  app: {
    getPath: () => userDataDir.value,
    getAppPath: () => appPath.value,
  },
}));

vi.mock("./embedding", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./embedding")>()),
  getEmbeddingProvider: () => provider,
}));

import {
  addL2MemoryVector,
  addMemory,
  deleteUserMemoryVectors,
  getEntriesBySource,
  hasImportedDocumentChunks,
  importDocumentForTurn,
  initRAG,
  isUserMemoryVectorStoreReady,
  resetRAG,
  searchMemoryEntries,
  searchImportedDocumentChunksForImportIds,
} from "./index";

let tmpDir = "";

beforeEach(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rag-index-test-"));
  userDataDir.value = tmpDir;
  appPath.value = tmpDir;
  const snapshot = await createDefaultCharacterRuntime({
    appRoot: process.cwd(),
    userDataRoot: tmpDir,
  }).initialize();
  if (snapshot.status !== "ready" || !snapshot.activeCharacter) {
    throw new Error(`测试角色初始化失败: ${JSON.stringify(snapshot.diagnostics)}`);
  }
  configureActiveCharacter(snapshot.activeCharacter);
  configureActiveCharacterState(snapshot.activeCharacter.state);
  await initRAG();
});

afterEach(() => {
  resetRAG();
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

describe("turn document imports", () => {
  it("reports that user memory vectors are writable after RAG initialization", () => {
    expect(isUserMemoryVectorStoreReady()).toBe(true);
  });

  it("returns an importId and chunk count for a turn document import", async () => {
    const result = await importDocumentForTurn("one paragraph\n\ntwo paragraph", "turn-doc.md");

    expect(result.importId).toMatch(/^import-/);
    expect(result.chunkCount).toBeGreaterThan(0);

    const chunks = await searchImportedDocumentChunksForImportIds("paragraph", [result.importId], 3);
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.importId === result.importId)).toBe(true);
  });

  it("reports whether an importId still has stored document chunks", async () => {
    expect(hasImportedDocumentChunks("import-missing")).toBe(false);

    const result = await importDocumentForTurn("one paragraph", "turn-doc.md");

    expect(hasImportedDocumentChunks(result.importId)).toBe(true);
  });

  it("shares imported documents across characters while keeping inferred memory private", async () => {
    const imported = await importDocumentForTurn("shared paragraph about launch procedures", "shared.md");
    await addMemory("Cyrene-only inferred preference", "user_memory");

    resetRAG();
    configureActiveCharacterState(resolveCharacterStateLayout(tmpDir, "fixture.lumen"));
    await initRAG();

    const chunks = await searchImportedDocumentChunksForImportIds("paragraph", [imported.importId], 3);
    expect(chunks.map((chunk) => chunk.fileName)).toContain("shared.md");
    expect(getEntriesBySource("user_memory")).toEqual([]);
    expect(fs.existsSync(path.join(tmpDir, "global", "documents", "rag", "memory-store.json"))).toBe(true);
  });

  it("copies legacy imported chunks into the Global Document Library without moving private data", async () => {
    resetRAG();
    const legacyFile = path.join(tmpDir, "characters", "cyrene", "memory", "rag", "memory-store.json");
    fs.mkdirSync(path.dirname(legacyFile), { recursive: true });
    fs.writeFileSync(legacyFile, JSON.stringify([{
      id: "legacy-doc-chunk",
      text: "legacy paragraph",
      embedding: [0, 1],
      source: "imported_doc",
      weight: 1,
      createdAt: 1,
      lastRecalledAt: 1,
      metadata: { fileName: "legacy.md", importId: "legacy-import", chunkIndex: 0 },
    }, {
      id: "private-memory",
      text: "Cyrene private",
      embedding: [1, 0],
      source: "user_memory",
      weight: 1,
      createdAt: 1,
      lastRecalledAt: 1,
    }]), "utf8");

    await initRAG();

    expect((await searchImportedDocumentChunksForImportIds("paragraph", ["legacy-import"], 3))[0]?.fileName)
      .toBe("legacy.md");
    const globalRaw = fs.readFileSync(path.join(tmpDir, "global", "documents", "rag", "memory-store.json"), "utf8");
    expect(globalRaw).toContain("legacy-doc-chunk");
    expect(globalRaw).not.toContain("private-memory");
    expect(fs.readFileSync(legacyFile, "utf8")).toContain("private-memory");
  });
});

describe("user memory retrieval", () => {
  it("creates a distinct vector for every L2 even when contents are identical", async () => {
    const firstId = await addL2MemoryVector("用户喜欢香菇", "l2_first", { source: "test" });
    const secondId = await addL2MemoryVector("用户喜欢香菇", "l2_second", { source: "test" });

    expect(secondId).not.toBe(firstId);
    expect(getEntriesBySource("user_memory").map((entry) => ({ id: entry.id, l2Id: entry.metadata?.l2Id })))
      .toEqual([
        { id: firstId, l2Id: "l2_first" },
        { id: secondId, l2Id: "l2_second" },
      ]);
  });

  it("deletes only the requested user memory vectors", async () => {
    const firstId = await addL2MemoryVector("第一条", "l2_first");
    const secondId = await addL2MemoryVector("第二条", "l2_second");

    expect(deleteUserMemoryVectors([firstId])).toBe(1);
    expect(getEntriesBySource("user_memory").map((entry) => entry.id)).toEqual([secondId]);
  });

  it("returns only consistently mapped, recallable L2 vectors", async () => {
    const { memoryStore } = await import("../memory/memory-store");
    const active = await memoryStore.addL2Memory({
      content: "alpha active memory",
      triggerText: "active",
      sourceConversationId: "test",
      isPinned: false,
      syncStatus: "pending_sync",
    });
    const activeRagId = await addMemory(active.content, "user_memory", { l2Id: active.id });
    await memoryStore.markL2SyncStatus(active.id, "synced", activeRagId);

    const archived = await memoryStore.addL2Memory({
      content: "paragraph archived memory",
      triggerText: "archived",
      sourceConversationId: "test",
      isPinned: false,
      syncStatus: "pending_sync",
    });
    const archivedRagId = await addMemory(archived.content, "user_memory", { l2Id: archived.id });
    await memoryStore.markL2SyncStatus(archived.id, "synced", archivedRagId);
    await memoryStore.updateL2Status([archived.id], "archived");

    const results = await searchMemoryEntries("memory", "user_memory", 5);

    expect(results.map((entry) => entry.id)).toEqual([activeRagId]);
    expect(results.some((entry) => entry.id === archivedRagId)).toBe(false);
  });
});
