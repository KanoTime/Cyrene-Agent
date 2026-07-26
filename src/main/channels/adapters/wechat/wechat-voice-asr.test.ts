import { afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { encode } from "silk-wasm";
import { disposeAsr } from "../../../asr/asr-service";
import { resamplePcm16Mono } from "../../../asr/pcm-utils";
import type { AsrConfig } from "../../../asr/types";
import { transcribeWechatVoiceSource } from "./wechat-voice-asr";

const ROOT = process.env.CYRENE_QWEN3_ASR_ROOT
  ?? path.join(os.homedir(), "Documents", "local-llms", "qwen3-asr-1.7b");
const config: AsrConfig = {
  engine: "local",
  language: "zh",
  localRoot: ROOT,
  localModelPath: `${ROOT}/model`,
  localTimeoutMs: 30_000,
  localSystemPrompt: "角色名可能包括昔涟。请忠实转写。",
};

afterAll(() => disposeAsr());

describe.skipIf(!existsSync(`${ROOT}/model/model.safetensors`))("WeChat voice local ASR integration", () => {
  it("decodes 24 kHz Silk, resamples and transcribes through the shared local service", async () => {
    const wav = await readFile(`${ROOT}/fixtures/zh_short.wav`);
    const pcm24k = resamplePcm16Mono(wav.subarray(44), 16_000, 24_000);
    const silk = await encode(pcm24k, 24_000);
    const text = await transcribeWechatVoiceSource(Buffer.from(silk.data), 24_000, config);
    expect(text).toContain("昔涟");
  }, 120_000);
});
