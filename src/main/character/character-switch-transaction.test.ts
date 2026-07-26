import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it, vi } from "vitest";
import {
  createDefaultCharacterRuntime,
  type CharacterActivityKind,
  type CharacterSwitchAdapters,
} from "./character-runtime";

const LUMEN_ID = "fixture.lumen";

function createAdapters(overrides: Partial<CharacterSwitchAdapters> = {}) {
  const calls: string[] = [];
  let blocking: Array<{ kind: CharacterActivityKind; reason: string }> = [];
  const adapters: CharacterSwitchAdapters = {
    getBlockingActivities: () => blocking,
    persistActiveState: async () => { calls.push("persist"); },
    shutdownActiveResources: async () => { calls.push("shutdown"); },
    requestRelaunch: async () => { calls.push("relaunch"); },
    ...overrides,
  };
  return { adapters, calls, setBlocking: (next: typeof blocking) => { blocking = next; } };
}

async function createImportedRuntime(
  userDataRoot: string,
  adapters: CharacterSwitchAdapters,
) {
  const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot, switchAdapters: adapters });
  await runtime.initialize();
  const imported = await runtime.importPackage(path.join(process.cwd(), "test-fixtures", "characters", "lumen"));
  if (!imported.ok) throw new Error("Lumen fixture import failed");
  return runtime;
}

describe("Character Switch Transaction", () => {
  it("persists, shuts down and requests one controlled relaunch before binding the target on restart", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-success-"));
    const fake = createAdapters();
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);

    const result = await runtime.requestSwitch(LUMEN_ID);

    expect(result).toEqual({
      ok: true,
      status: "relaunch-requested",
      previousCharacterId: "cyrene",
      targetCharacterId: LUMEN_ID,
      unavailableCapabilities: ["live2d", "semanticActions", "stickers", "openers"],
    });
    expect(fake.calls).toEqual(["persist", "shutdown", "relaunch"]);
    expect(runtime.getSnapshot().activeCharacter?.id).toBe("cyrene");
    const statePath = path.join(userDataRoot, "character-packages", "runtime-state.json");
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).toMatchObject({
      activeCharacterId: "cyrene",
      previousCharacterId: "cyrene",
      pendingCharacterId: LUMEN_ID,
    });
    await expect(runtime.requestSwitch(LUMEN_ID)).resolves.toMatchObject({
      ok: false,
      status: "blocked",
      diagnostics: [{ code: "character.switch.pending" }],
    });
    expect(fake.calls).toEqual(["persist", "shutdown", "relaunch"]);

    const restarted = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    const restartedSnapshot = await restarted.initialize();
    expect(restartedSnapshot.activeCharacter?.id).toBe(LUMEN_ID);
    expect(JSON.parse(fs.readFileSync(statePath, "utf8"))).toEqual({
      schemaVersion: 1,
      activeCharacterId: LUMEN_ID,
    });
  });

  it("reports every busy activity without persisting, shutting down or requesting relaunch", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-busy-"));
    const fake = createAdapters();
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);
    const kinds: CharacterActivityKind[] = ["agent-run", "voice-call", "asr", "tts", "proactive-generation", "state-write"];

    for (const kind of kinds) {
      fake.setBlocking([{ kind, reason: `busy:${kind}` }]);
      await expect(runtime.requestSwitch(LUMEN_ID)).resolves.toEqual({
        ok: false,
        status: "blocked",
        blockingActivities: [{ kind, reason: `busy:${kind}` }],
        diagnostics: [{
          code: "character.switch.busy",
          message: `角色切换暂不可用：busy:${kind}`,
          characterId: "cyrene",
        }],
      });
    }
    expect(fake.calls).toEqual([]);
    expect(fs.existsSync(path.join(userDataRoot, "character-packages", "runtime-state.json"))).toBe(false);
    expect(runtime.getSnapshot().activeCharacter?.id).toBe("cyrene");
  });

  it("allows only one switch transaction to run at a time", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-concurrent-"));
    let releasePersist!: () => void;
    let markPersistStarted!: () => void;
    const persistStarted = new Promise<void>((resolve) => { markPersistStarted = resolve; });
    const fake = createAdapters({
      persistActiveState: () => new Promise<void>((resolve) => {
        releasePersist = resolve;
        markPersistStarted();
      }),
    });
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);

    const first = runtime.requestSwitch(LUMEN_ID);
    await persistStarted;
    const second = await runtime.requestSwitch(LUMEN_ID);
    releasePersist();

    expect(second).toMatchObject({ ok: false, status: "blocked", diagnostics: [{ code: "character.switch.pending" }] });
    await expect(first).resolves.toMatchObject({ ok: true, status: "relaunch-requested" });
  });

  it("does not write pending state when active-state persistence fails", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-persist-fail-"));
    const shutdown = vi.fn();
    const relaunch = vi.fn();
    const fake = createAdapters({
      persistActiveState: async () => { throw new Error("memory flush failed"); },
      shutdownActiveResources: shutdown,
      requestRelaunch: relaunch,
    });
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);

    const result = await runtime.requestSwitch(LUMEN_ID);

    expect(result).toMatchObject({ ok: false, status: "failed", diagnostics: [{ code: "character.switch.persist_failed" }] });
    expect(shutdown).not.toHaveBeenCalled();
    expect(relaunch).not.toHaveBeenCalled();
    expect(fs.existsSync(path.join(userDataRoot, "character-packages", "runtime-state.json"))).toBe(false);
  });

  it("rolls pending selection back when resource shutdown fails", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-shutdown-fail-"));
    const relaunch = vi.fn();
    const fake = createAdapters({
      shutdownActiveResources: async () => { throw new Error("worker shutdown failed"); },
      requestRelaunch: relaunch,
    });
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);

    const result = await runtime.requestSwitch(LUMEN_ID);

    expect(result).toMatchObject({ ok: false, status: "failed", diagnostics: [{ code: "character.switch.shutdown_failed" }] });
    expect(relaunch).not.toHaveBeenCalled();
    expect(JSON.parse(fs.readFileSync(
      path.join(userDataRoot, "character-packages", "runtime-state.json"),
      "utf8",
    ))).toEqual({ schemaVersion: 1, activeCharacterId: "cyrene" });
  });

  it("rolls pending selection back when the relaunch request fails", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-relaunch-fail-"));
    const fake = createAdapters({
      requestRelaunch: async () => { throw new Error("relaunch unavailable"); },
    });
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);

    const result = await runtime.requestSwitch(LUMEN_ID);

    expect(result).toMatchObject({ ok: false, status: "failed", diagnostics: [{ code: "character.switch.relaunch_failed" }] });
    expect(JSON.parse(fs.readFileSync(
      path.join(userDataRoot, "character-packages", "runtime-state.json"),
      "utf8",
    ))).toEqual({ schemaVersion: 1, activeCharacterId: "cyrene" });
  });

  it("revalidates target health before writing pending state", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-preflight-"));
    const fake = createAdapters();
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);
    fs.rmSync(path.join(userDataRoot, "character-packages", "installed", LUMEN_ID, "content", "soul.md"));

    const result = await runtime.requestSwitch(LUMEN_ID);

    expect(result).toMatchObject({ ok: false, status: "failed" });
    expect(result.ok ? [] : result.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "character.switch.target_unhealthy" }),
    ]));
    expect(fake.calls).toEqual([]);
    expect(fs.existsSync(path.join(userDataRoot, "character-packages", "runtime-state.json"))).toBe(false);
  });

  it("restores the previous character when the pending target becomes unhealthy at startup", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-switch-rollback-"));
    const fake = createAdapters();
    const runtime = await createImportedRuntime(userDataRoot, fake.adapters);
    await runtime.requestSwitch(LUMEN_ID);
    fs.rmSync(path.join(userDataRoot, "character-packages", "installed", LUMEN_ID, "content", "soul.md"));

    const restarted = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    const snapshot = await restarted.initialize();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.activeCharacter?.id).toBe("cyrene");
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      code: "character.switch.target_startup_failed",
      characterId: LUMEN_ID,
    }));
    expect(JSON.parse(fs.readFileSync(
      path.join(userDataRoot, "character-packages", "runtime-state.json"),
      "utf8",
    ))).toEqual({ schemaVersion: 1, activeCharacterId: "cyrene" });
  });
});
