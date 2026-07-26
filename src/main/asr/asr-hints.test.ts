import { describe, expect, it } from "vitest";
import { buildLocalAsrSystemPrompt } from "./local-asr-worker-manager";

describe("local ASR character hints", () => {
  it("appends bounded terms to the global transcription instruction", () => {
    expect(buildLocalAsrSystemPrompt("请忠实转写。", ["流明", "Lumen", "Qwen3.5"]))
      .toBe("请忠实转写。\n可能出现以下专有名词：流明、Lumen、Qwen3.5。只在确实听到时按此拼写，不得添加未听见内容。");
  });

  it("has no built-in character name when a different character is active", () => {
    const prompt = buildLocalAsrSystemPrompt("", ["流明"]);
    expect(prompt).toContain("流明");
    expect(prompt).not.toContain("昔涟");
  });
});
