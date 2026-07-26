import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import {
  migrateLegacyCyreneState,
  resolveCharacterStateLayout,
} from "./character-state";

describe("Character State Root", () => {
  it("fails closed when business code asks for state before the active character is configured", async () => {
    const state = await import("./character-state");
    expect(() => state.requireActiveCharacterState()).toThrow("活动角色状态目录尚未就绪");
  });

  it("resolves physically distinct state layouts for different Character IDs", () => {
    const userDataRoot = "/tmp/cyrene-user-data";

    const cyrene = resolveCharacterStateLayout(userDataRoot, "cyrene");
    const lumen = resolveCharacterStateLayout(userDataRoot, "fixture.lumen");

    expect(cyrene).toMatchObject({
      root: path.join(userDataRoot, "characters", "cyrene"),
      chatsRoot: path.join(userDataRoot, "characters", "cyrene", "chats"),
      channelHistoryRoot: path.join(userDataRoot, "characters", "cyrene", "chats", "channels", "history"),
      channelLogFile: path.join(userDataRoot, "characters", "cyrene", "chats", "channels", "log.jsonl"),
      memoryFile: path.join(userDataRoot, "characters", "cyrene", "memory", "memory.json"),
      entityGraphFile: path.join(userDataRoot, "characters", "cyrene", "memory", "entity-graph.json"),
      memoryTraceFile: path.join(userDataRoot, "characters", "cyrene", "memory", "memory-trace.log"),
      ragRoot: path.join(userDataRoot, "characters", "cyrene", "memory", "rag"),
      relationshipFile: path.join(userDataRoot, "characters", "cyrene", "relationship", "relationship-log.json"),
      worldbookStateFile: path.join(userDataRoot, "characters", "cyrene", "worldbook", "state.json"),
      proactiveStateFile: path.join(userDataRoot, "characters", "cyrene", "proactive", "opener-state.json"),
      ttsCacheRoot: path.join(userDataRoot, "characters", "cyrene", "tts", "cache"),
    });
    expect(lumen.root).not.toBe(cyrene.root);
    expect(lumen.memoryFile).not.toBe(cyrene.memoryFile);
  });

  it("copies representative legacy data into Cyrene state once and records a migration marker", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-state-migration-"));
    fs.mkdirSync(path.join(userDataRoot, "cyrene-chats", "sessions"), { recursive: true });
    fs.writeFileSync(path.join(userDataRoot, "cyrene-chats", "index.json"), "[]");
    fs.writeFileSync(path.join(userDataRoot, "cyrene-chats", "sessions", "chat.json"), '{"messages":[]}');
    fs.mkdirSync(path.join(userDataRoot, "channels", "history"), { recursive: true });
    fs.writeFileSync(path.join(userDataRoot, "channels", "history", "wechat.jsonl"), '{"content":"legacy channel history"}\n');
    fs.writeFileSync(path.join(userDataRoot, "channels", "log.jsonl"), '{"text":"legacy channel log"}\n');
    fs.writeFileSync(path.join(userDataRoot, "memory.json"), '{"schemaVersion":2,"l2":[]}');
    fs.mkdirSync(path.join(userDataRoot, "rag-data"));
    fs.writeFileSync(path.join(userDataRoot, "rag-data", "memory-store.json"), "[]");
    fs.writeFileSync(path.join(userDataRoot, "relationship-log.json"), '{"entries":[]}');
    fs.writeFileSync(path.join(userDataRoot, "opener-state.json"), '{"globalDesire":7}');
    fs.mkdirSync(path.join(userDataRoot, "cyrene-tts-cache"));
    fs.writeFileSync(path.join(userDataRoot, "cyrene-tts-cache", "voice.wav"), "audio");

    const first = await migrateLegacyCyreneState({ userDataRoot, characterId: "cyrene", now: () => 100 });
    const layout = resolveCharacterStateLayout(userDataRoot, "cyrene");

    expect(first).toMatchObject({ status: "migrated", migratedEntries: 8, diagnostics: [] });
    expect(fs.readFileSync(layout.memoryFile, "utf8")).toContain('"schemaVersion":2');
    expect(fs.readFileSync(path.join(layout.chatsRoot, "sessions", "chat.json"), "utf8")).toContain("messages");
    expect(fs.readFileSync(path.join(layout.channelHistoryRoot, "wechat.jsonl"), "utf8")).toContain("legacy channel history");
    expect(fs.readFileSync(layout.channelLogFile, "utf8")).toContain("legacy channel log");
    expect(fs.readFileSync(path.join(layout.ragRoot, "memory-store.json"), "utf8")).toBe("[]");
    expect(fs.readFileSync(layout.proactiveStateFile, "utf8")).toContain("globalDesire");
    expect(fs.readFileSync(path.join(layout.ttsCacheRoot, "voice.wav"), "utf8")).toBe("audio");
    expect(JSON.parse(fs.readFileSync(path.join(layout.root, "migration.json"), "utf8"))).toMatchObject({
      schemaVersion: 1,
      characterId: "cyrene",
      completedAt: 100,
    });

    fs.writeFileSync(path.join(userDataRoot, "memory.json"), "legacy changed after migration");
    const second = await migrateLegacyCyreneState({ userDataRoot, characterId: "cyrene", now: () => 200 });
    expect(second).toMatchObject({ status: "already-migrated", migratedEntries: 0, diagnostics: [] });
    expect(fs.readFileSync(layout.memoryFile, "utf8")).toContain('"schemaVersion":2');
  });

  it("keeps legacy data and a backup recoverable when staging copy fails", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-state-failure-"));
    const legacyMemory = path.join(userDataRoot, "memory.json");
    fs.writeFileSync(legacyMemory, "important memory");

    const result = await migrateLegacyCyreneState({
      userDataRoot,
      characterId: "cyrene",
      now: () => 300,
      copyEntry: (source, target, phase) => {
        if (phase === "staging") throw new Error("simulated disk failure");
        fs.cpSync(source, target, { recursive: true, errorOnExist: true, force: false });
      },
    });

    expect(result).toEqual({
      status: "failed",
      migratedEntries: 0,
      diagnostics: [{
        code: "character.state_migration.failed",
        message: "昔涟旧状态迁移失败：simulated disk failure",
        characterId: "cyrene",
        resourcePath: legacyMemory,
      }],
    });
    expect(fs.readFileSync(legacyMemory, "utf8")).toBe("important memory");
    expect(fs.readFileSync(
      path.join(userDataRoot, "character-state-migration-backups", "cyrene", "300", "memory.json"),
      "utf8",
    )).toBe("important memory");
    expect(fs.existsSync(path.join(userDataRoot, "characters", "cyrene"))).toBe(false);

    const recovered = await migrateLegacyCyreneState({
      userDataRoot,
      characterId: "cyrene",
      now: () => 301,
    });
    expect(recovered).toMatchObject({ status: "migrated", migratedEntries: 1, diagnostics: [] });
    expect(fs.readFileSync(
      resolveCharacterStateLayout(userDataRoot, "cyrene").memoryFile,
      "utf8",
    )).toBe("important memory");
  });

  it("does not assign Cyrene legacy data to another Character ID", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-state-other-"));
    fs.writeFileSync(path.join(userDataRoot, "memory.json"), "cyrene only");

    const result = await migrateLegacyCyreneState({ userDataRoot, characterId: "fixture.lumen" });

    expect(result).toEqual({ status: "not-applicable", migratedEntries: 0, diagnostics: [] });
    expect(fs.existsSync(path.join(userDataRoot, "characters", "fixture.lumen"))).toBe(false);
  });
});
