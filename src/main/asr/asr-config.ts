export interface AliyunAsrConfig {
  engine: "aliyun";
  appKey: string;
  accessKeyId: string;
  accessKeySecret: string;
  language: import("./types").AsrLanguage;
}

export interface MosslandAsrConfig {
  engine: "mossland";
  apiKey: string;
}

export interface MiniMaxAsrConfig {
  engine: "minimax";
  apiKey: string;
}

import type { AsrConfig as LegacyAsrConfig } from "./types";
export type LocalAsrConfig = LegacyAsrConfig & { engine: "local" };
export type AsrConfig = (AliyunAsrConfig | MosslandAsrConfig | MiniMaxAsrConfig | LocalAsrConfig) & { speechRecognitionHints?: readonly string[] };

let asrConfigGetter: (() => AsrConfig | null) | null = null;

export function setAsrConfig(getter: () => AsrConfig | null): void {
  asrConfigGetter = getter;
}

export function getAsrConfig(): AsrConfig | null {
  return asrConfigGetter?.() ?? null;
}
