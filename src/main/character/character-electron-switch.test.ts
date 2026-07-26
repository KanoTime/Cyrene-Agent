import { describe, expect, it, vi } from "vitest";
import {
  collectCharacterBlockingActivities,
  createElectronCharacterSwitchAdapters,
  hasUncoordinatedAgentActivity,
} from "./character-electron-switch";

describe("Electron Character Switch lifecycle", () => {
  it("微信在途回复由协调 seam 等待，其他 Agent 活动仍阻止切换", () => {
    expect(hasUncoordinatedAgentActivity(2, 2)).toBe(false);
    expect(hasUncoordinatedAgentActivity(3, 2)).toBe(true);
    expect(hasUncoordinatedAgentActivity(0, 1)).toBe(false);
  });

  it("reports concrete character-bound activities", () => {
    expect(collectCharacterBlockingActivities({
      agentBusy: true,
      callActive: true,
      asrBusy: true,
      ttsBusy: true,
      proactiveBusy: true,
      stateWriteBusy: true,
    })).toEqual([
      { kind: "agent-run", reason: "正在生成回复" },
      { kind: "voice-call", reason: "语音通话正在进行" },
      { kind: "asr", reason: "正在识别语音" },
      { kind: "tts", reason: "正在合成或播放语音" },
      { kind: "proactive-generation", reason: "正在生成主动消息" },
      { kind: "state-write", reason: "正在写入角色状态" },
    ]);
  });

  it("flushes state, shuts down resources, then relaunches and exits exactly once", async () => {
    const calls: string[] = [];
    const adapters = createElectronCharacterSwitchAdapters({
      getActivity: () => ({
        agentBusy: false, callActive: false, asrBusy: false,
        ttsBusy: false, proactiveBusy: false, stateWriteBusy: false,
      }),
      flushState: () => { calls.push("flush"); },
      stopCall: () => { calls.push("call"); },
      disposeAsr: () => { calls.push("asr"); },
      stopScheduler: () => { calls.push("scheduler"); },
      stopOpener: () => { calls.push("opener"); },
      shutdownChannels: async () => { calls.push("channels"); },
      relaunch: () => { calls.push("relaunch"); },
      exit: (code) => { calls.push(`exit:${code}`); },
    });

    await adapters.persistActiveState();
    await adapters.shutdownActiveResources();
    await adapters.requestRelaunch();

    expect(calls).toEqual([
      "flush", "call", "asr", "scheduler", "opener", "channels", "relaunch", "exit:0",
    ]);
  });

  it("does not exit when Electron rejects relaunch", async () => {
    const exit = vi.fn();
    const adapters = createElectronCharacterSwitchAdapters({
      getActivity: () => ({
        agentBusy: false, callActive: false, asrBusy: false,
        ttsBusy: false, proactiveBusy: false, stateWriteBusy: false,
      }),
      flushState: vi.fn(),
      stopCall: vi.fn(),
      disposeAsr: vi.fn(),
      stopScheduler: vi.fn(),
      stopOpener: vi.fn(),
      shutdownChannels: vi.fn(),
      relaunch: () => { throw new Error("relaunch failed"); },
      exit,
    });

    await expect(adapters.requestRelaunch()).rejects.toThrow("relaunch failed");
    expect(exit).not.toHaveBeenCalled();
  });
});
