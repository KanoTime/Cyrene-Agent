import { decode, isSilk } from "silk-wasm";
import { transcribePcm } from "../../../asr/asr-service";
import type { AsrConfig, PcmAudio } from "../../../asr/types";

export async function decodeWechatVoiceSource(source: Buffer, sampleRate: number): Promise<PcmAudio> {
  if (!Number.isFinite(sampleRate) || sampleRate <= 0) throw new Error(`无效微信语音采样率: ${sampleRate}`);
  if (!isSilk(source)) return { pcm: source, sampleRate };
  const decoded = await decode(source, sampleRate);
  return { pcm: Buffer.from(decoded.data), sampleRate };
}
export async function transcribeWechatVoiceSource(
  source: Buffer,
  sampleRate: number,
  config: AsrConfig,
  signal?: AbortSignal,
): Promise<string> {
  return transcribePcm(await decodeWechatVoiceSource(source, sampleRate), config, signal);
}
