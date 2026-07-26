import { afterEach, describe, it, expect, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { synthesize } from "./gptsovits-engine";

afterEach(() => vi.restoreAllMocks());

describe("gptsovits-engine synthesize 输入校验", () => {
  it("缺 baseUrl 时抛错", async () => {
    await expect(synthesize({
      baseUrl: "",
      refAudioPath: "C:/x.wav",
      promptText: "hi",
      text: "hello",
    })).rejects.toThrow(/API 地址/);
  });

  it("缺 refAudioPath 时抛错", async () => {
    await expect(synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "",
      promptText: "hi",
      text: "hello",
    })).rejects.toThrow(/参考音频/);
  });

  it("缺 promptText 时抛错", async () => {
    await expect(synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "C:/nonexistent.wav",
      promptText: "",
      text: "hello",
    })).rejects.toThrow(/参考音频.*文本|参考文本/);
  });

  it("缺 text 时抛错", async () => {
    await expect(synthesize({
      baseUrl: "http://localhost:9880",
      refAudioPath: "C:/nonexistent.wav",
      promptText: "hi",
      text: "",
    })).rejects.toThrow(/合成文本|text/);
  });

  it("passes separate Japanese reference and Chinese output languages to api_v2", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "gptsovits-lang-"));
    const refAudioPath = path.join(dir, "ref.wav");
    writeFileSync(refAudioPath, "RIFF");
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(Buffer.from("RIFFdata"), { status: 200 }));
    try {
      await synthesize({
        baseUrl: "http://127.0.0.1:9880",
        refAudioPath,
        promptText: "ほほえましい光景だねー。",
        promptLang: "ja",
        text: "你好，这是语音测试。",
        textLang: "zh",
      });
      const body = JSON.parse(String(fetchMock.mock.calls[0]?.[1]?.body));
      expect(body.prompt_lang).toBe("ja");
      expect(body.text_lang).toBe("zh");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
