// 桌面通话 Adapter —— 将 Electron IPC 接到平台无关的 VoiceSession。
//
// VoiceSession owns ASR → agent → TTS 的轮次生命周期；本文件只保留
// 桌面窗口、当前配置和 Active Character 的适配。移动端可以复用同一个
// VoiceSession Module，而不依赖 BrowserWindow 或 ipcMain。

import { BrowserWindow, ipcMain } from "electron";
import { IPC } from "../../shared/ipc-channels";
import type { MobileCallStatus } from "../../shared/mobile-call-status";
import { createAsrSession, requireAsrConfig } from "../asr/asr-service";
import { synthesizeByEngine } from "../tts/tts-dispatcher";
import type { TtsEngine } from "../../shared/tts-types";
import { getAdapter, buildVendorUrlByProvider } from "../orchestrator/vendors";
import type { ChatMessage } from "../orchestrator/vendors/types";
import { getActiveCharacter } from "../character/active-character";
import {
  applySpeechRecognitionHints,
  applyVoiceProfileToTtsSettings,
} from "../character/character-speech";
import {
  VoiceSession,
  type VoiceSessionEvent,
  type VoiceSessionState,
} from "./voice-session";
import {
  createMobileCallCredentials,
  normalizeLiveKitServerUrl,
  type LiveKitMobileCallConfig,
  type MobileCallCredentials,
} from "../mobile-call/livekit-call-credentials";
import type {
  LiveKitVoiceBridge,
  LiveKitVoiceBridgeDiagnostic,
} from "../mobile-call/livekit-voice-bridge";
import type { MediaJoinGrant } from "../remote-access/media-grant-envelope";
import { requireActiveCharacterState } from "../character/character-state";
import { VoiceConversationStore } from "./voice-conversation-store";
import { VoiceConversationRuntime } from "./voice-conversation-runtime";

const LOG_PREFIX = "[CallManager]";

export type CallState = VoiceSessionState;

type ModelSettings = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKey: string;
};

type CallTtsSettings = {
  ttsEngine: TtsEngine;
  ttsMinimaxKey: string;
  ttsMinimaxVoiceId: string;
  ttsMinimaxModel: "speech-2.8-hd" | "speech-2.8-turbo";
  ttsSpeed: number;
  ttsVolume: number;
  ttsGptsovitsBaseUrl: string;
  ttsGptsovitsRefAudioPath: string;
  ttsGptsovitsPromptText: string;
  ttsGptsovitsPromptLang: "auto" | "zh" | "en" | "ja";
  ttsGptsovitsTextLang: "auto" | "zh" | "en" | "ja";
  ttsGptsovitsFormat: "wav" | "mp3";
  ttsCustomCloudEndpointUrl: string;
  ttsCustomCloudApiKey: string;
  ttsCustomCloudVoiceId: string;
  ttsCustomCloudFormat: "wav" | "mp3";
  ttsCustomCloudTimeoutMs: number;
  ttsMimoKey: string;
  ttsMimoVoiceAudioPath: string;
  ttsMimoStylePrompt: string;
};

let callWindow: BrowserWindow | null = null;
let callSession: VoiceSession | null = null;
let mobileCallBridge: LiveKitVoiceBridge | null = null;
let mobileConversationRuntime: VoiceConversationRuntime | null = null;
let currentState: CallState = "IDLE";

/** 通话上下文：保留最近 N 轮对话历史（每轮 = user + assistant 一对）。 */
const MAX_CALL_CONTEXT_TURNS = 24;
const callHistory: ChatMessage[] = [];

/** 滑动窗口截断，保证长通话不会无界增长。 */
function trimCallHistory(): void {
  if (callHistory.length > MAX_CALL_CONTEXT_TURNS * 2) {
    callHistory.splice(0, callHistory.length - MAX_CALL_CONTEXT_TURNS * 2);
  }
}

// 配置 getter 由 index.ts 启动时注入，避免 index.ts 的循环依赖。
let modelSettingsGetter: (() => ModelSettings) | null = null;
let ttsSettingsGetter: (() => CallTtsSettings) | null = null;
let systemPromptBuilder: ((userText: string) => Promise<string>) | null = null;
let weatherHandler: ((userText: string) => Promise<string | null>) | null = null;

/** index.ts 启动时注入模型配置、TTS 配置和 system prompt 构建器。 */
export function setCallSettings(
  modelGetter: () => ModelSettings,
  ttsGetter: () => CallTtsSettings,
  systemPromptFn: (userText: string) => Promise<string>,
  weatherFn: (userText: string) => Promise<string | null>,
): void {
  modelSettingsGetter = modelGetter;
  ttsSettingsGetter = ttsGetter;
  systemPromptBuilder = systemPromptFn;
  weatherHandler = weatherFn;
}

/** 绑定通话窗口（createCallWindow 调一次）。 */
export function setCallWindow(win: BrowserWindow | null): void {
  callWindow = win;
}

/** 是否正在通话中。 */
export function isCallActive(): boolean {
  return (callSession?.isActive ?? false) || (mobileCallBridge?.isActive ?? false);
}

function sendState(state: CallState): void {
  currentState = state;
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_STATE, { state });
  }
  console.log(LOG_PREFIX, "状态 →", state);
}

function sendError(message: string): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_ERROR, { message });
  }
  console.error(LOG_PREFIX, "错误:", message);
}

function sendAsrResult(partial: string | undefined, final: string | undefined): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_ASR_RESULT, { partial, final });
  }
}

function sendTtsAudio(base64: string): void {
  if (callWindow && !callWindow.isDestroyed()) {
    callWindow.webContents.send(IPC.CALL_TTS_AUDIO, { base64 });
  }
}

function sendVoiceSessionEvent(event: VoiceSessionEvent): void {
  if (event.type === "state") {
    sendState(event.state);
    return;
  }
  if (event.type === "error") {
    sendError(event.message);
    return;
  }
  if (event.type === "transcript") {
    sendAsrResult(event.partial, event.final);
    return;
  }
  if (event.type === "turn") return;
  sendTtsAudio(event.audio.toString("base64"));
}

function createCallVoiceSession(emit: (event: VoiceSessionEvent) => void): VoiceSession {
  return new VoiceSession({
    getAsrConfig: () => applySpeechRecognitionHints(
      requireAsrConfig(),
      getActiveCharacter().speechRecognitionHints,
    ),
    createAsrSession,
    generateReply: runAgentTurn,
    synthesizeReply: synthesizeCallReply,
    emit,
  });
}

function createDesktopVoiceSession(): VoiceSession {
  return createCallVoiceSession(sendVoiceSessionEvent);
}

/** Resolves the active character's voice profile against the current global TTS service. */
function resolveCallTtsSettings(): CallTtsSettings {
  const globalTts = ttsSettingsGetter?.();
  const voiceCapability = getActiveCharacter().capabilities.voice;
  if (!globalTts || globalTts.ttsEngine === "off") {
    throw new Error("TTS 未配置：请在设置中启用 TTS 引擎");
  }
  if (voiceCapability.status !== "available") {
    throw new Error(`当前角色 ${getActiveCharacter().displayName} 未提供 Voice Profile，已禁用 TTS`);
  }
  const voiceResolution = applyVoiceProfileToTtsSettings(voiceCapability.profile, globalTts);
  if (voiceResolution.status !== "available") {
    throw new Error(`当前角色需要 TTS Service ${voiceResolution.requiredService ?? "已启用服务"}，当前为 ${voiceResolution.configuredService}`);
  }
  return voiceResolution.settings;
}

function assertCallTtsSettingsReady(tts: CallTtsSettings): void {
  if (tts.ttsEngine === "minimax" && (!tts.ttsMinimaxKey || !tts.ttsMinimaxVoiceId)) {
    throw new Error("TTS 未配置：请在设置中配置 MiniMax API Key 和音色 ID");
  }
  if (tts.ttsEngine === "gptsovits" && (!tts.ttsGptsovitsBaseUrl || !tts.ttsGptsovitsRefAudioPath || !tts.ttsGptsovitsPromptText)) {
    throw new Error("TTS 未配置：请在设置中配置 GPT-SoVITS baseUrl、参考音频和文本");
  }
  if (tts.ttsEngine === "custom-cloud" && !tts.ttsCustomCloudEndpointUrl) {
    throw new Error("TTS 未配置：请在设置中配置自定义云端 Endpoint URL");
  }
  if (tts.ttsEngine === "mimo" && (!tts.ttsMimoKey || !tts.ttsMimoVoiceAudioPath)) {
    throw new Error("TTS 未配置：请在设置中配置小米 MiMo API Key 和角色参考音频");
  }
}

/** Fails before creating a short-lived room when desktop-only dependencies are not ready. */
function assertMobileCallReadiness(): void {
  // Use the same Active Character hints as the eventual VoiceSession so a
  // disabled/misconfigured ASR is reported before the user scans a QR code.
  applySpeechRecognitionHints(requireAsrConfig(), getActiveCharacter().speechRecognitionHints);

  const modelSettings = modelSettingsGetter?.();
  if (!modelSettings?.apiKey.trim()) {
    throw new Error("模型配置缺失或未填写 API Key");
  }
  if (!modelSettings.baseUrl.trim() || !modelSettings.model.trim()) {
    throw new Error("模型配置缺少 Base URL 或模型名");
  }
  if (!getAdapter(modelSettings.provider)) {
    throw new Error(`不支持的模型 provider: ${modelSettings.provider}`);
  }

  const tts = resolveCallTtsSettings();
  assertCallTtsSettingsReady(tts);
  if (tts.ttsEngine === "gptsovits" && tts.ttsGptsovitsFormat !== "wav") {
    throw new Error("手机通话要求 GPT-SoVITS 输出 PCM16 WAV；请在 TTS 设置中选择 wav");
  }
  if (tts.ttsEngine === "custom-cloud" && tts.ttsCustomCloudFormat !== "wav") {
    throw new Error("手机通话要求自定义云端 TTS 输出 PCM16 WAV；请在 TTS 设置中选择 wav");
  }
}

export function assertRemoteMobileCallReadiness(): void {
  if (callSession?.isActive || mobileCallBridge?.isActive) {
    throw new Error("OWNER_BUSY");
  }
  assertMobileCallReadiness();
}

/** 开始通话：初始化 ASR 流，进入 LISTENING。 */
export async function startCall(): Promise<void> {
  if (mobileCallBridge?.isActive) {
    sendError("手机实时通话正在进行，请先在设置中结束手机通话");
    return;
  }
  if (callSession?.isActive) return;
  callHistory.length = 0;
  mobileConversationRuntime = null;
  const session = createDesktopVoiceSession();
  callSession = session;
  await session.start();
}

/** 结束本轮（VAD 静默）：VoiceSession 负责 ASR → agent → TTS。 */
export async function endTurn(): Promise<void> {
  await callSession?.endTurn();
}

/** TTS 播完后恢复 LISTENING。 */
export function onTtsDone(): void {
  void callSession?.onSpeechFinished();
}

/** 挂断：清理一切。 */
export function stopCall(): void {
  callHistory.length = 0;
  mobileConversationRuntime = null;
  const session = callSession;
  callSession = null;
  const bridge = mobileCallBridge;
  mobileCallBridge = null;
  if (session) {
    session.stop();
  } else if (currentState !== "ENDED") {
    sendState("ENDED");
  }
  // `CALL_STOP` is also used by shared application lifecycle paths. Ensure a
  // mobile bridge cannot outlive a desktop "hang up" or shutdown request.
  if (bridge) void bridge.stop();
}

export type MobileCallPairing = Pick<
  MobileCallCredentials,
  "callId" | "roomName" | "expiresAt"
>;

type MobileCallPairingWithLink = MobileCallPairing & Pick<MobileCallCredentials, "mobileLink">;

/**
 * Starts a personal mobile-call room. The desktop joins as Cyrene and keeps
 * ASR, model, character state, and TTS local; only a short-lived mobile token
 * is returned to the caller for pairing via QR/deep link.
 */
export async function startMobileCall(
  config: LiveKitMobileCallConfig,
  deviceName?: string,
  vad: { silenceMs: number; threshold: number } = { silenceMs: 1_000, threshold: 0.01 },
  onStatus?: (status: MobileCallStatus) => void,
): Promise<MobileCallPairingWithLink> {
  if (callSession?.isActive || mobileCallBridge?.isActive) {
    throw new Error("已有语音通话正在进行，请先挂断后再连接手机");
  }

  assertMobileCallReadiness();
  // 手机与桌面通话都复用角色对话上下文；新会话必须从空历史开始，避免
  // 前一通电话的内容越过角色边界或泄露到下一次配对。
  callHistory.length = 0;
  mobileConversationRuntime = null;
  const serverUrl = normalizeLiveKitServerUrl(config.serverUrl);
  const credentials = await createMobileCallCredentials({ ...config, serverUrl }, { deviceName });
  const { LiveKitVoiceBridge } = await import("../mobile-call/livekit-voice-bridge");
  const bridge = new LiveKitVoiceBridge({
    serverUrl,
    agentToken: credentials.agentToken,
    mobileIdentity: credentials.mobileIdentity,
    vadSilenceMs: vad.silenceMs,
    vadThreshold: vad.threshold,
  }, {
    createVoiceSession: createCallVoiceSession,
    onError: sendError,
    onStateChange: (state, message) => onStatus?.({ state, ...(message ? { message } : {}) }),
  });

  mobileCallBridge = bridge;
  try {
    await bridge.start();
  } catch (error) {
    if (mobileCallBridge === bridge) mobileCallBridge = null;
    throw error;
  }

  return {
    callId: credentials.callId,
    roomName: credentials.roomName,
    expiresAt: credentials.expiresAt,
    mobileLink: credentials.mobileLink,
  };
}

/**
 * Starts a formal paired-device call from a control-plane Media Join Grant.
 * Unlike the legacy QR path, this function never signs a token locally and
 * refuses to connect unless a valid per-call E2EE key is already in memory.
 */
export async function startRemoteMobileCall(
  grant: MediaJoinGrant,
  vad: { silenceMs: number; threshold: number } = {
    silenceMs: 1_000,
    threshold: 0.01,
  },
  onStatus?: (status: MobileCallStatus) => void,
  onDiagnostic?: (event: LiveKitVoiceBridgeDiagnostic) => void,
): Promise<void> {
  if (callSession?.isActive || mobileCallBridge?.isActive) {
    throw new Error("已有语音通话正在进行，请先挂断后再连接手机");
  }
  if (
    !grant.callId
    || !grant.participantToken
    || !grant.peerIdentity
    || !/^[A-Za-z0-9_-]{43}$/.test(grant.e2eeKey)
    || Date.parse(grant.expiresAt) <= Date.now()
  ) {
    throw new Error("E2EE_REQUIRED");
  }

  assertMobileCallReadiness();
  callHistory.length = 0;
  const conversationRuntime = new VoiceConversationRuntime(
    new VoiceConversationStore(requireActiveCharacterState().voiceConversationsRoot),
    {
      onSelected: (turns) => {
        callHistory.length = 0;
        for (const turn of turns) {
          callHistory.push({ role: "user", content: turn.userText });
          callHistory.push({ role: "assistant", content: turn.assistantText });
        }
        trimCallHistory();
      },
    },
  );
  mobileConversationRuntime = conversationRuntime;
  const { LiveKitVoiceBridge } = await import("../mobile-call/livekit-voice-bridge");
  const bridge = new LiveKitVoiceBridge({
    serverUrl: normalizeLiveKitServerUrl(grant.serverUrl),
    agentToken: grant.participantToken,
    mobileIdentity: grant.peerIdentity,
    e2eeKey: grant.e2eeKey,
    vadSilenceMs: vad.silenceMs,
    vadThreshold: vad.threshold,
    requireConversationSelection: true,
  }, {
    createVoiceSession: createCallVoiceSession,
    conversations: conversationRuntime,
    onError: sendError,
    onDiagnostic,
    onStateChange: (state, message) =>
      onStatus?.({ state, ...(message ? { message } : {}) }),
  });

  mobileCallBridge = bridge;
  try {
    await bridge.start();
  } catch (error) {
    if (mobileCallBridge === bridge) mobileCallBridge = null;
    if (mobileConversationRuntime === conversationRuntime) {
      mobileConversationRuntime = null;
    }
    throw error;
  }
}

export async function stopMobileCall(): Promise<void> {
  const bridge = mobileCallBridge;
  mobileCallBridge = null;
  mobileConversationRuntime = null;
  callHistory.length = 0;
  await bridge?.stop();
}

/** 处理桌面 renderer 送来的 PCM 音频帧。 */
export function handleAudioFrame(frame: Buffer): void {
  callSession?.pushAudio(frame);
}

async function synthesizeCallReply(reply: string): Promise<{ audio: Buffer; format: "wav" | "mp3" }> {
  const tts = resolveCallTtsSettings();
  assertCallTtsSettingsReady(tts);

  // LiveKit's desktop bridge consumes PCM16 WAV. MiniMax can generate WAV
  // directly, MiMo already returns WAV, and the other engines retain their
  // explicit output setting for ordinary desktop calls.
  const format = tts.ttsEngine === "custom-cloud"
    ? tts.ttsCustomCloudFormat
    : tts.ttsEngine === "gptsovits"
      ? tts.ttsGptsovitsFormat
      : "wav";

  const result = await synthesizeByEngine(tts.ttsEngine, {
    text: reply,
    speed: tts.ttsSpeed,
    volume: tts.ttsVolume,
    apiKey: tts.ttsEngine === "mimo"
      ? tts.ttsMimoKey
      : tts.ttsEngine === "custom-cloud"
        ? tts.ttsCustomCloudApiKey
        : tts.ttsMinimaxKey,
    voiceId: tts.ttsEngine === "mimo"
      ? ""
      : tts.ttsEngine === "custom-cloud"
        ? tts.ttsCustomCloudVoiceId
        : tts.ttsMinimaxVoiceId,
    model: tts.ttsMinimaxModel,
    baseUrl: tts.ttsGptsovitsBaseUrl,
    refAudioPath: tts.ttsGptsovitsRefAudioPath,
    promptText: tts.ttsGptsovitsPromptText,
    promptLang: tts.ttsGptsovitsPromptLang,
    textLang: tts.ttsGptsovitsTextLang,
    format,
    endpointUrl: tts.ttsCustomCloudEndpointUrl,
    timeoutMs: tts.ttsCustomCloudTimeoutMs,
    voiceAudioPath: tts.ttsMimoVoiceAudioPath,
    stylePrompt: tts.ttsMimoStylePrompt,
  });
  if (result.format === "pcm") {
    throw new Error("通话 TTS 暂不接受缺少采样率信息的裸 PCM；请改用 wav 或 mp3");
  }
  return { audio: result.audio, format: result.format };
}

/** 天气关键词正则匹配。 */
const WEATHER_REGEX = /天气|今天.*热|今天.*冷|下雨|下雪|气温|几度|多少度|穿什么/;

/**
 * 获取通话回复。
 * 1. 天气走快捷路径。
 * 2. 其余请求用通话专用 system prompt 直接调模型。
 * 3. 不让表情包标记进入 TTS。
 */
async function runAgentTurn(userText: string): Promise<string | null> {
  try {
    if (WEATHER_REGEX.test(userText) && weatherHandler) {
      const weatherReply = await weatherHandler(userText);
      if (weatherReply) {
        recordCallTurn(userText, weatherReply);
        return weatherReply;
      }
    }

    const modelSettings = modelSettingsGetter?.();
    if (!modelSettings || !modelSettings.apiKey) {
      throw new Error("模型配置缺失或未填写 API Key");
    }

    const adapter = getAdapter(modelSettings.provider);
    if (!adapter) {
      throw new Error(`不支持的模型 provider: ${modelSettings.provider}`);
    }

    const url = buildVendorUrlByProvider(modelSettings.provider, modelSettings.baseUrl);
    const systemPrompt = await systemPromptBuilder?.(userText) ?? "";
    const messages: ChatMessage[] = [
      { role: "system", content: systemPrompt },
      ...callHistory.slice(-MAX_CALL_CONTEXT_TURNS * 2),
      { role: "user", content: userText },
    ];

    const request = adapter.buildRequest(
      { model: modelSettings.model, messages, temperature: 0.8 },
      {
        provider: modelSettings.provider,
        baseUrl: modelSettings.baseUrl,
        model: modelSettings.model,
        apiKey: modelSettings.apiKey,
      },
    );

    const httpResponse = await fetch(url, {
      method: "POST",
      headers: { ...request.headers, "Content-Type": "application/json" },
      body: request.body,
      signal: AbortSignal.timeout(30_000),
    });

    if (!httpResponse.ok) {
      throw new Error(`LLM 请求失败: ${httpResponse.status}`);
    }

    const raw = await httpResponse.json();
    const response = adapter.parseResponse(raw);
    const reply = (response.text || "").replace(/\[sticker:[^\]]+\]/g, "").trim();

    if (reply) {
      recordCallTurn(userText, reply);
    }

    return reply || null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(LOG_PREFIX, "LLM 调用失败:", message);
    throw new Error(`LLM 调用失败: ${message}`);
  }
}

function recordCallTurn(userText: string, assistantText: string): void {
  if (mobileConversationRuntime) {
    const persisted = mobileConversationRuntime.appendTurn(userText, assistantText);
    if (!persisted) throw new Error("请先选择或创建语音对话");
  }
  callHistory.push({ role: "user", content: userText });
  callHistory.push({ role: "assistant", content: assistantText });
  trimCallHistory();
}

/** 注册桌面通话 IPC handlers（main 启动时调一次）。 */
export function registerCallIpc(): void {
  ipcMain.on(IPC.CALL_START, () => void startCall());
  ipcMain.on(IPC.CALL_AUDIO_FRAME, (_event, frame: ArrayBuffer) => handleAudioFrame(Buffer.from(frame)));
  ipcMain.on(IPC.CALL_TURN_END, () => void endTurn());
  ipcMain.on(IPC.CALL_TTS_DONE, () => onTtsDone());
  ipcMain.on(IPC.CALL_STOP, () => stopCall());
}
