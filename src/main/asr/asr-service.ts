import { VolcanoAsrStream, getAsrConfig } from "./volcano-asr-engine";
import { localAsrWorker } from "./local-asr-worker-manager";
import { resamplePcm16Mono } from "./pcm-utils";
import type { AsrCallbacks, AsrConfig, AsrSession, PcmAudio } from "./types";

class LocalAsrSession implements AsrSession {
  private frames: Buffer[] = [];
  private controller = new AbortController();
  private finished = false;

  constructor(private readonly config: AsrConfig, private readonly callbacks: AsrCallbacks) {}

  async start(): Promise<void> {
    await localAsrWorker.start(this.config);
  }

  sendAudio(frame: Buffer): void {
    if (!this.finished && frame.length > 0) this.frames.push(Buffer.from(frame));
  }

  async finish(): Promise<string> {
    if (this.finished) throw new Error("ASR 会话已经结束");
    this.finished = true;
    try {
      const result = await localAsrWorker.transcribe(
        { pcm: Buffer.concat(this.frames), sampleRate: 16_000 },
        this.config,
        this.controller.signal,
      );
      this.frames = [];
      if (result.text) this.callbacks.onFinal?.(result.text);
      return result.text;
    } catch (error) {
      const normalized = error instanceof Error ? error : new Error(String(error));
      this.callbacks.onError?.(normalized);
      throw normalized;
    }
  }

  stop(): void {
    this.finished = true;
    this.frames = [];
    this.controller.abort();
  }

  dispose(): void { this.stop(); }
}

class AliyunAsrSession implements AsrSession {
  private finals: string[] = [];
  private readonly stream: VolcanoAsrStream;

  constructor(private readonly config: AsrConfig, callbacks: AsrCallbacks) {
    this.stream = new VolcanoAsrStream(
      (text) => callbacks.onPartial?.(text),
      (text) => { if (text.trim()) this.finals.push(text.trim()); callbacks.onFinal?.(text); },
      (error) => callbacks.onError?.(error),
    );
  }

  async start(): Promise<void> {
    await this.stream.start(this.config.appKey!, this.config.accessKeyId!, this.config.accessKeySecret!, this.config.language);
  }

  sendAudio(frame: Buffer): void { this.stream.sendAudio(frame); }

  async finish(): Promise<string> {
    await this.stream.finish();
    return this.finals.join("").trim();
  }

  stop(): void { this.stream.stop(); }
  dispose(): void { this.stream.stop(); }
}

export function requireAsrConfig(): AsrConfig {
  const config = getAsrConfig();
  if (!config || config.engine === "off") throw new Error("ASR 未启用");
  if (config.engine === "aliyun" && (!config.appKey || !config.accessKeyId || !config.accessKeySecret)) {
    throw new Error("阿里云 ASR 凭据未配置完整");
  }
  return config;
}

export function createAsrSession(callbacks: AsrCallbacks = {}, config = requireAsrConfig()): AsrSession {
  return config.engine === "local" ? new LocalAsrSession(config, callbacks) : new AliyunAsrSession(config, callbacks);
}

export async function transcribePcm(audio: PcmAudio, config = requireAsrConfig(), signal?: AbortSignal): Promise<string> {
  if (config.engine === "local") return (await localAsrWorker.transcribe(audio, config, signal)).text;

  const session = createAsrSession({}, config);
  await session.start();
  session.sendAudio(resamplePcm16Mono(audio.pcm, audio.sampleRate));
  return session.finish();
}

export function disposeAsr(): void {
  localAsrWorker.dispose();
}
