import { afterEach, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { LocalAsrWorkerManager } from "./local-asr-worker-manager";
import type { AsrConfig } from "./types";

const ROOT = process.env.CYRENE_QWEN3_ASR_ROOT
  ?? path.join(os.homedir(), "Documents", "local-llms", "qwen3-asr-1.7b");
const config: AsrConfig = {
  engine: "local",
  language: "zh",
  localRoot: ROOT,
  localModelPath: `${ROOT}/model`,
  localTimeoutMs: 30_000,
  localSystemPrompt: "角色名可能包括昔涟，技术名词可能包括 Qwen3.5。请忠实转写。",
};

const managers: LocalAsrWorkerManager[] = [];

async function fixture(name: string): Promise<{ pcm: Buffer; sampleRate: number }> {
  const wav = await readFile(`${ROOT}/fixtures/${name}.wav`);
  return { pcm: wav.subarray(44), sampleRate: wav.readUInt32LE(24) };
}

async function waitForProcessExit(pid: number, timeoutMs = 2_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      process.kill(pid, 0);
    } catch {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
  throw new Error(`ASR worker ${pid} did not exit within ${timeoutMs}ms`);
}

afterEach(async () => {
  await Promise.all(managers.splice(0).map((manager) => manager.shutdown()));
});

describe.skipIf(!existsSync(`${ROOT}/model/model.safetensors`))("LocalAsrWorkerManager real integration", () => {
  it("preloads once and transcribes consecutive requests", async () => {
    const manager = new LocalAsrWorkerManager();
    managers.push(manager);
    await manager.start(config);
    const before = await manager.health(config);
    const first = await manager.transcribe(await fixture("zh_short"), config);
    const second = await manager.transcribe(await fixture("en"), { ...config, language: "en" });
    const after = await manager.health(config);
    expect(first.text).toContain("昔涟");
    expect(second.text.toLowerCase()).toContain("local speech recognition test");
    expect(after.pid).toBe(before.pid);
    expect(after.ready).toBe(true);
  }, 120_000);

  it("cancels active inference by terminating it and restarts on demand", async () => {
    const manager = new LocalAsrWorkerManager();
    managers.push(manager);
    const controller = new AbortController();
    const pending = manager.transcribe(await fixture("long"), config, controller.signal);
    setTimeout(() => controller.abort(), 50);
    await expect(pending).rejects.toThrow(/取消/);
    const recovered = await manager.health(config);
    expect(recovered.ready).toBe(true);
  }, 120_000);

  it("recovers after an unexpected worker crash", async () => {
    const manager = new LocalAsrWorkerManager();
    managers.push(manager);
    await manager.start(config);
    const before = await manager.health(config);
    expect(before.pid).toBeTypeOf("number");
    process.kill(before.pid!, "SIGKILL");
    await new Promise((resolve) => setTimeout(resolve, 200));
    const after = await manager.health(config);
    expect(after.ready).toBe(true);
    expect(after.pid).not.toBe(before.pid);
  }, 120_000);

  it("times out without hanging and leaves no worker after dispose", async () => {
    const manager = new LocalAsrWorkerManager();
    await expect(manager.transcribe(await fixture("long"), { ...config, localTimeoutMs: 1 })).rejects.toThrow(/超时/);
    const recovered = await manager.health(config);
    const pid = recovered.pid!;
    await manager.shutdown();
    await expect(waitForProcessExit(pid)).resolves.toBeUndefined();
  }, 120_000);
});
