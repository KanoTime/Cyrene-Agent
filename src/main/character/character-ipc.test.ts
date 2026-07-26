import { describe, expect, it, vi } from "vitest";
import {
  deleteArchivedCharacterState,
  getCharacterSettingsSnapshot,
  listArchivedCharacterStates,
  requestCharacterSwitch,
  requestCoordinatedCharacterSwitch,
  uninstallCharacterPackage,
} from "./character-ipc";
import type { CharacterRuntime } from "./character-runtime";

describe("character IPC boundary", () => {
  it("returns runtime state and the same live blockers used by switching", () => {
    const runtime = {
      getSnapshot: () => ({
        status: "ready" as const,
        activeCharacter: null,
        packages: [],
        diagnostics: [],
      }),
      getBlockingActivities: () => [{ kind: "voice-call" as const, reason: "语音通话正在进行" }],
      requestSwitch: vi.fn(),
    };

    expect(getCharacterSettingsSnapshot(runtime)).toEqual({
      status: "ready",
      activeCharacter: null,
      packages: [],
      diagnostics: [],
      switching: {
        blockingActivities: [{ kind: "voice-call", reason: "语音通话正在进行" }],
      },
    });
  });

  it("validates the target id before delegating to CharacterRuntime", async () => {
    const requestSwitch = vi.fn().mockResolvedValue({ ok: true, status: "relaunch-requested" });
    const runtime = {
      getSnapshot: vi.fn(),
      getBlockingActivities: vi.fn(),
      requestSwitch,
    };

    expect(() => requestCharacterSwitch(runtime, "../cyrene")).toThrow("角色 ID 格式无效");
    await expect(requestCharacterSwitch(runtime, "fixture.lumen")).resolves.toEqual({
      ok: true,
      status: "relaunch-requested",
    });
    expect(requestSwitch).toHaveBeenCalledOnce();
    expect(requestSwitch).toHaveBeenCalledWith("fixture.lumen");
  });

  it("协调切换先进入微信暂停 seam，再调用角色运行时", async () => {
    const runtime = {
      requestSwitch: vi.fn().mockResolvedValue({ ok: false, status: "failed" }),
    };
    const coordinate = vi.fn(async (
      operation: () => ReturnType<CharacterRuntime["requestSwitch"]>,
    ) => operation());

    await expect(requestCoordinatedCharacterSwitch(runtime, "fixture.lumen", coordinate))
      .resolves.toEqual({ ok: false, status: "failed" });
    expect(coordinate).toHaveBeenCalledOnce();
    expect(runtime.requestSwitch).toHaveBeenCalledWith("fixture.lumen");
  });

  it("validates lifecycle ids and delegates archive operations", async () => {
    const runtime = {
      getSnapshot: vi.fn(),
      getBlockingActivities: vi.fn(),
      requestSwitch: vi.fn(),
      uninstallPackage: vi.fn().mockResolvedValue({ ok: true }),
      listArchivedCharacterStates: vi.fn().mockResolvedValue([{ characterId: "fixture.lumen" }]),
      permanentlyDeleteArchivedState: vi.fn().mockResolvedValue({ ok: true }),
    };

    expect(() => uninstallCharacterPackage(runtime, "../lumen")).toThrow("角色 ID 格式无效");
    expect(() => uninstallCharacterPackage(runtime, "fixture..lumen")).toThrow("角色 ID 格式无效");
    await expect(uninstallCharacterPackage(runtime, "x")).resolves.toEqual({ ok: true });
    await expect(uninstallCharacterPackage(runtime, "fixture.lumen")).resolves.toEqual({ ok: true });
    await expect(listArchivedCharacterStates(runtime)).resolves.toEqual([{ characterId: "fixture.lumen" }]);
    expect(() => deleteArchivedCharacterState(runtime, "fixture.lumen", 123)).toThrow("永久删除确认格式无效");
    await expect(deleteArchivedCharacterState(runtime, "fixture.lumen", "fixture.lumen")).resolves.toEqual({ ok: true });
  });
});
