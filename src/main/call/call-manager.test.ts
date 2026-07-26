import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  let finishResolve: (text: string) => void = () => {};
  const session = {
    start: vi.fn(async () => {}),
    sendAudio: vi.fn(),
    finish: vi.fn(() => new Promise<string>((resolve) => { finishResolve = resolve; })),
    stop: vi.fn(),
    dispose: vi.fn(),
  };
  return {
    session,
    createSession: vi.fn(() => session),
    resolveFinish: (text: string) => finishResolve(text),
    synthesize: vi.fn(async () => ({ audio: Buffer.from("test-audio") })),
  };
});
vi.mock("electron", () => ({ ipcMain: { on: vi.fn() }, BrowserWindow: class {} }));
vi.mock("../asr/asr-service", () => ({
  createAsrSession: mocks.createSession,
  requireAsrConfig: vi.fn(() => ({ engine: "local", language: "zh" })),
}));
vi.mock("../character/active-character", () => ({
  getActiveCharacter: () => ({
    displayName: "昔涟",
    speechRecognitionHints: { displayName: "流明", terms: ["流明", "Lumen", "Qwen3.5"] },
    capabilities: {
      voice: { status: "available", profile: { schemaVersion: 1, service: "legacy-global" } },
    },
  }),
}));
vi.mock("../asr/volcano-asr-engine", () => ({
  getAsrConfig: vi.fn(() => ({ engine: "local", language: "zh" })),
}));
vi.mock("../tts/tts-dispatcher", () => ({ synthesizeByEngine: mocks.synthesize }));
vi.mock("../orchestrator", () => ({ runFunctionCallingLoop: vi.fn() }));
vi.mock("../orchestrator/vendors", () => ({
  buildVendorUrlByProvider: () => "http://127.0.0.1:8080/v1/chat/completions",
  getAdapter: () => ({
    buildRequest: (input: unknown) => ({ headers: {}, body: JSON.stringify(input) }),
    parseResponse: (raw: { choices?: Array<{ message?: { content?: string } }> }) => ({
      text: raw.choices?.[0]?.message?.content ?? "",
    }),
  }),
}));

import {
  endTurn,
  handleAudioFrame,
  setCallSettings,
  setCallWindow,
  startCall,
  stopCall,
} from "./call-manager";

describe("call manager ASR sequencing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    stopCall();
  });

  it("awaits final ASR once before sending its text to the LLM and TTS", async () => {
    const sent: Array<{ channel: string; payload: unknown }> = [];
    setCallWindow({
      isDestroyed: () => false,
      webContents: { send: (channel: string, payload: unknown) => sent.push({ channel, payload }) },
    } as never);
    setCallSettings(
      () => ({ provider: "openai", baseUrl: "http://127.0.0.1:8080/v1", model: "qwen3.5-9b", apiKey: "local" }),
      () => ({
        ttsEngine: "gptsovits", ttsMinimaxKey: "", ttsMinimaxVoiceId: "", ttsMinimaxModel: "speech-2.8-hd",
        ttsSpeed: 1, ttsVolume: 1, ttsGptsovitsBaseUrl: "http://127.0.0.1:9880",
        ttsGptsovitsRefAudioPath: "/tmp/ref.wav", ttsGptsovitsPromptText: "ref", ttsGptsovitsFormat: "wav",
        ttsGptsovitsPromptLang: "ja", ttsGptsovitsTextLang: "zh",
        ttsCustomCloudEndpointUrl: "", ttsCustomCloudApiKey: "", ttsCustomCloudVoiceId: "",
        ttsCustomCloudFormat: "wav", ttsCustomCloudTimeoutMs: 30_000,
        ttsMimoKey: "", ttsMimoVoiceAudioPath: "", ttsMimoStylePrompt: "",
      }),
      async () => "system",
      async () => null,
    );
    const fetchMock = vi.fn(async (_url: string, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { messages: Array<{ role: string; content: string }> };
      expect(body.messages.at(-1)).toEqual({ role: "user", content: "你好昔涟" });
      return new Response(JSON.stringify({ choices: [{ message: { content: "你好呀" } }] }), { status: 200 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await startCall();
    expect(mocks.createSession).toHaveBeenCalledWith(expect.any(Object), expect.objectContaining({
      engine: "local",
      speechRecognitionHints: ["流明", "Lumen", "Qwen3.5"],
    }));
    handleAudioFrame(Buffer.alloc(640));
    const first = endTurn();
    const duplicate = endTurn();
    expect(mocks.session.finish).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    mocks.resolveFinish("你好昔涟");
    await Promise.all([first, duplicate]);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(mocks.synthesize).toHaveBeenCalledTimes(1);
    expect(mocks.synthesize).toHaveBeenCalledWith("gptsovits", expect.objectContaining({
      promptLang: "ja",
      textLang: "zh",
    }));
    expect(sent.some((entry) => (entry.payload as { state?: string }).state === "ASR")).toBe(true);
    expect(sent.some((entry) => entry.channel.includes("tts-audio"))).toBe(true);
    stopCall();
  });
});
