import fs from "fs";
import path from "path";
import type { TtsEngine } from "../../shared/tts-types";
import type { AsrConfig } from "../asr/types";

type SpeechLanguage = "auto" | "zh" | "en" | "ja";
export type CharacterVoiceService = Exclude<TtsEngine, "off"> | "legacy-global";

export type CharacterVoiceProfile = Readonly<{
  schemaVersion: 1;
  service: CharacterVoiceService;
  voiceId?: string;
  referenceAudioPath?: string;
  promptText?: string;
  promptLanguage?: SpeechLanguage;
  textLanguage?: SpeechLanguage;
  stylePrompt?: string;
  speed?: number;
  volume?: number;
}>;

export type SpeechRecognitionHints = Readonly<{
  displayName: string;
  terms: readonly string[];
}>;

export type VoiceSelectionResolution =
  | Readonly<{
      status: "available";
      service: Exclude<TtsEngine, "off"> | "legacy-global";
      selection: Readonly<{
        voiceId?: string;
        refAudioPath?: string;
        promptText?: string;
        promptLang?: SpeechLanguage;
        textLang?: SpeechLanguage;
        voiceAudioPath?: string;
        stylePrompt?: string;
        speed?: number;
        volume?: number;
      }>;
    }>
  | Readonly<{
      status: "unavailable";
      reason: "service_unavailable";
      requiredService: Exclude<CharacterVoiceService, "legacy-global">;
      configuredService: TtsEngine;
    }>;

export type CharacterTtsSettingsResolution<T> =
  | Readonly<{ status: "available"; settings: T }>
  | Readonly<{
      status: "unavailable";
      reason: "tts_disabled" | "service_unavailable";
      requiredService?: Exclude<CharacterVoiceService, "legacy-global">;
      configuredService: TtsEngine;
    }>;

const PROFILE_FIELDS = new Set([
  "schemaVersion", "service", "voiceId", "referenceAudio", "promptText",
  "promptLanguage", "textLanguage", "stylePrompt", "speed", "volume",
]);
const SERVICES = new Set<CharacterVoiceService>([
  "legacy-global", "minimax", "gptsovits", "custom-cloud", "mimo", "mossland",
]);
const LANGUAGES = new Set<SpeechLanguage>(["auto", "zh", "en", "ja"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (relative !== ".." && !relative.startsWith(`..${path.sep}`));
}

function optionalString(raw: Record<string, unknown>, field: string): string | undefined {
  if (raw[field] === undefined) return undefined;
  if (typeof raw[field] !== "string" || !raw[field].trim()) throw new Error(`Voice Profile 字段无效：${field}`);
  return raw[field].trim();
}

function optionalNumber(raw: Record<string, unknown>, field: string): number | undefined {
  if (raw[field] === undefined) return undefined;
  const value = raw[field];
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0.5 || value > 2) {
    throw new Error(`Voice Profile 字段无效：${field}`);
  }
  return value;
}

export function readVoiceProfile(
  filePath: string,
  packageRoot: string,
  allowLegacyGlobal: boolean,
): CharacterVoiceProfile {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
  if (!isRecord(parsed) || parsed.schemaVersion !== 1 || typeof parsed.service !== "string"
    || !SERVICES.has(parsed.service as CharacterVoiceService)) {
    throw new Error("Voice Profile 必须使用 schemaVersion 1 和受支持的 service");
  }
  const unknown = Object.keys(parsed).filter((field) => !PROFILE_FIELDS.has(field));
  if (unknown.length > 0) throw new Error(`Voice Profile 包含不允许字段：${unknown.join(", ")}`);
  const service = parsed.service as CharacterVoiceService;
  if (service === "legacy-global" && !allowLegacyGlobal) {
    throw new Error("legacy-global Voice Profile 仅供内置昔涟兼容迁移使用");
  }

  const voiceId = optionalString(parsed, "voiceId");
  const referenceAudio = optionalString(parsed, "referenceAudio");
  const promptText = optionalString(parsed, "promptText");
  const promptLanguage = optionalString(parsed, "promptLanguage") as SpeechLanguage | undefined;
  const textLanguage = optionalString(parsed, "textLanguage") as SpeechLanguage | undefined;
  const stylePrompt = optionalString(parsed, "stylePrompt");
  const speed = optionalNumber(parsed, "speed");
  const volume = optionalNumber(parsed, "volume");
  if (promptLanguage && !LANGUAGES.has(promptLanguage)) throw new Error("Voice Profile 字段无效：promptLanguage");
  if (textLanguage && !LANGUAGES.has(textLanguage)) throw new Error("Voice Profile 字段无效：textLanguage");
  let referenceAudioPath: string | undefined;
  if (referenceAudio) {
    referenceAudioPath = path.resolve(path.dirname(filePath), referenceAudio);
    if (!isPathInside(packageRoot, referenceAudioPath)
      || !fs.existsSync(referenceAudioPath)
      || !fs.statSync(referenceAudioPath).isFile()) {
      throw new Error("Voice Profile 参考音频必须是角色包内存在的文件");
    }
  }
  if ((service === "minimax" || service === "custom-cloud" || service === "mossland") && !voiceId) {
    throw new Error(`Voice Profile ${service} 缺少 voiceId`);
  }
  if (service === "gptsovits" && (!referenceAudioPath || !promptText)) {
    throw new Error("Voice Profile gptsovits 缺少 referenceAudio/promptText");
  }
  if (service === "mimo" && !referenceAudioPath) {
    throw new Error("Voice Profile mimo 缺少 referenceAudio");
  }

  return Object.freeze({
    schemaVersion: 1,
    service,
    ...(voiceId ? { voiceId } : {}),
    ...(referenceAudioPath ? { referenceAudioPath } : {}),
    ...(promptText ? { promptText } : {}),
    ...(promptLanguage ? { promptLanguage } : {}),
    ...(textLanguage ? { textLanguage } : {}),
    ...(stylePrompt ? { stylePrompt } : {}),
    ...(speed !== undefined ? { speed } : {}),
    ...(volume !== undefined ? { volume } : {}),
  });
}

export function resolveVoiceSelection(
  profile: CharacterVoiceProfile,
  configuredService: TtsEngine,
): VoiceSelectionResolution {
  if (profile.service !== "legacy-global" && profile.service !== configuredService) {
    return Object.freeze({
      status: "unavailable",
      reason: "service_unavailable",
      requiredService: profile.service,
      configuredService,
    });
  }
  return Object.freeze({
    status: "available",
    service: profile.service,
    selection: Object.freeze({
      ...(profile.voiceId ? { voiceId: profile.voiceId } : {}),
      ...(profile.service === "gptsovits" && profile.referenceAudioPath
        ? { refAudioPath: profile.referenceAudioPath }
        : {}),
      ...(profile.promptText ? { promptText: profile.promptText } : {}),
      ...(profile.promptLanguage ? { promptLang: profile.promptLanguage } : {}),
      ...(profile.textLanguage ? { textLang: profile.textLanguage } : {}),
      ...(profile.service === "mimo" && profile.referenceAudioPath
        ? { voiceAudioPath: profile.referenceAudioPath }
        : {}),
      ...(profile.stylePrompt ? { stylePrompt: profile.stylePrompt } : {}),
      ...(profile.speed !== undefined ? { speed: profile.speed } : {}),
      ...(profile.volume !== undefined ? { volume: profile.volume } : {}),
    }),
  });
}

export function applyVoiceProfileToTtsSettings<T extends { ttsEngine: TtsEngine }>(
  profile: CharacterVoiceProfile,
  globalSettings: T,
): CharacterTtsSettingsResolution<T> {
  if (globalSettings.ttsEngine === "off") {
    return Object.freeze({ status: "unavailable", reason: "tts_disabled", configuredService: "off" });
  }
  const resolution = resolveVoiceSelection(profile, globalSettings.ttsEngine);
  if (resolution.status === "unavailable") return resolution;
  if (profile.service === "legacy-global") {
    return Object.freeze({ status: "available", settings: { ...globalSettings } });
  }

  const settings: Record<string, unknown> = { ...globalSettings };
  if (profile.service === "minimax") settings["ttsMinimaxVoiceId"] = profile.voiceId;
  if (profile.service === "gptsovits") {
    settings["ttsGptsovitsRefAudioPath"] = profile.referenceAudioPath;
    settings["ttsGptsovitsPromptText"] = profile.promptText;
    if (profile.promptLanguage) settings["ttsGptsovitsPromptLang"] = profile.promptLanguage;
    if (profile.textLanguage) settings["ttsGptsovitsTextLang"] = profile.textLanguage;
  }
  if (profile.service === "custom-cloud") settings["ttsCustomCloudVoiceId"] = profile.voiceId;
  if (profile.service === "mossland") settings["ttsMosslandVoiceId"] = profile.voiceId;
  if (profile.service === "mimo") {
    settings["ttsMimoVoiceAudioPath"] = profile.referenceAudioPath;
    settings["ttsMimoStylePrompt"] = profile.stylePrompt ?? "";
  }
  if (profile.speed !== undefined) settings["ttsSpeed"] = profile.speed;
  if (profile.volume !== undefined) settings["ttsVolume"] = profile.volume;
  return Object.freeze({ status: "available", settings: settings as T });
}

function validateHint(value: string): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > 40 || !/^[\p{L}\p{N} ._+#-]+$/u.test(normalized)) {
    throw new Error(`ASR 提示词无效：${value}`);
  }
  return normalized;
}

export function createSpeechRecognitionHints(
  displayName: string,
  declared: Readonly<{ aliases?: readonly string[]; terms?: readonly string[] }> = {},
): SpeechRecognitionHints {
  if ((declared.aliases?.length ?? 0) > 8 || (declared.terms?.length ?? 0) > 24) {
    throw new Error("ASR 提示词数量超出限制");
  }
  const terms = [...new Set([
    validateHint(displayName),
    ...(declared.aliases ?? []).map(validateHint),
    ...(declared.terms ?? []).map(validateHint),
  ])];
  return Object.freeze({ displayName, terms: Object.freeze(terms) });
}

export function applySpeechRecognitionHints(
  config: AsrConfig,
  hints: SpeechRecognitionHints,
): AsrConfig {
  return { ...config, speechRecognitionHints: [...hints.terms] };
}
