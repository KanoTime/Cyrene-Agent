export type AsrEngine = "off" | "aliyun" | "local";
export type AsrLanguage = "zh" | "en" | "auto";

export interface AsrConfig {
  engine: AsrEngine;
  language: AsrLanguage;
  appKey?: string;
  accessKeyId?: string;
  accessKeySecret?: string;
  localRoot?: string;
  localModelPath?: string;
  localTimeoutMs?: number;
  localSystemPrompt?: string;
  speechRecognitionHints?: readonly string[];
}
export interface AsrCallbacks {
  onPartial?: (text: string) => void;
  onFinal?: (text: string) => void;
  onError?: (error: Error) => void;
}

export interface AsrSession {
  start(): Promise<void>;
  sendAudio(frame: Buffer): void;
  finish(): Promise<string>;
  stop(): void;
  dispose(): void;
}

export interface PcmAudio {
  pcm: Buffer;
  sampleRate: number;
}
