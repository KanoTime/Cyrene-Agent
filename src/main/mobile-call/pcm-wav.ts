import {
  AudioFrame,
  AudioResampler,
  AudioResamplerQuality,
} from "@livekit/rtc-node";

export const LIVEKIT_OUTPUT_SAMPLE_RATE = 48_000;
export const LIVEKIT_AUDIO_FRAME_DURATION_MS = 20;
export const LIVEKIT_SAMPLES_PER_FRAME =
  LIVEKIT_OUTPUT_SAMPLE_RATE * LIVEKIT_AUDIO_FRAME_DURATION_MS / 1_000;

export interface DecodedPcmWav {
  pcm: Buffer;
  sampleRate: number;
  channels: number;
}

export interface LiveKitPcmAudio {
  pcm: Buffer;
  sampleRate: typeof LIVEKIT_OUTPUT_SAMPLE_RATE;
}

function requireRange(buffer: Buffer, offset: number, length: number, message: string): void {
  if (offset < 0 || length < 0 || offset + length > buffer.length) throw new Error(message);
}

/** Parses an uncompressed signed PCM16 WAVE file without relying on ffmpeg. */
export function decodePcm16Wav(audio: Buffer): DecodedPcmWav {
  requireRange(audio, 0, 12, "WAV 文件过短");
  if (audio.toString("ascii", 0, 4) !== "RIFF" || audio.toString("ascii", 8, 12) !== "WAVE") {
    throw new Error("移动端通话只支持 RIFF/WAVE 音频");
  }

  let format: { audioFormat: number; channels: number; sampleRate: number; bitsPerSample: number; blockAlign: number } | null = null;
  let pcm: Buffer | null = null;
  let offset = 12;

  while (offset + 8 <= audio.length) {
    const id = audio.toString("ascii", offset, offset + 4);
    const size = audio.readUInt32LE(offset + 4);
    const contentStart = offset + 8;
    requireRange(audio, contentStart, size, `WAV ${id} 区块长度无效`);

    if (id === "fmt ") {
      requireRange(audio, contentStart, 16, "WAV fmt 区块不完整");
      format = {
        audioFormat: audio.readUInt16LE(contentStart),
        channels: audio.readUInt16LE(contentStart + 2),
        sampleRate: audio.readUInt32LE(contentStart + 4),
        blockAlign: audio.readUInt16LE(contentStart + 12),
        bitsPerSample: audio.readUInt16LE(contentStart + 14),
      };
    } else if (id === "data") {
      pcm = Buffer.from(audio.subarray(contentStart, contentStart + size));
    }

    offset = contentStart + size + (size % 2);
  }

  if (!format) throw new Error("WAV 缺少 fmt 区块");
  if (!pcm) throw new Error("WAV 缺少 data 区块");
  if (format.audioFormat !== 1 || format.bitsPerSample !== 16) {
    throw new Error("移动端通话只支持 PCM16 WAV，请将 TTS 输出设为 wav");
  }
  if (!Number.isInteger(format.channels) || format.channels < 1 || format.channels > 8) {
    throw new Error("WAV 声道数无效");
  }
  if (!Number.isFinite(format.sampleRate) || format.sampleRate < 8_000 || format.sampleRate > 96_000) {
    throw new Error("WAV 采样率无效");
  }
  if (format.blockAlign !== format.channels * 2 || pcm.length % format.blockAlign !== 0) {
    throw new Error("WAV PCM 数据未按 PCM16 帧对齐");
  }

  return { pcm, sampleRate: format.sampleRate, channels: format.channels };
}

export function downmixPcm16ToMono(pcm: Buffer, channels: number): Buffer {
  if (!Number.isInteger(channels) || channels < 1) throw new Error("PCM 声道数无效");
  const frameSize = channels * 2;
  if (pcm.length % frameSize !== 0) throw new Error("PCM 数据未按声道帧对齐");
  if (channels === 1) return Buffer.from(pcm);

  const frames = pcm.length / frameSize;
  const mono = Buffer.allocUnsafe(frames * 2);
  for (let frame = 0; frame < frames; frame += 1) {
    let sum = 0;
    for (let channel = 0; channel < channels; channel += 1) {
      sum += pcm.readInt16LE(frame * frameSize + channel * 2);
    }
    mono.writeInt16LE(Math.max(-32_768, Math.min(32_767, Math.round(sum / channels))), frame * 2);
  }
  return mono;
}

function resamplePcm16MonoForLiveKit(pcm: Buffer, sourceRate: number): Buffer {
  if (sourceRate === LIVEKIT_OUTPUT_SAMPLE_RATE || pcm.length === 0) return Buffer.from(pcm);

  const sourceSamples = new Int16Array(
    pcm.buffer,
    pcm.byteOffset,
    pcm.byteLength / Int16Array.BYTES_PER_ELEMENT,
  );
  const resampler = new AudioResampler(
    sourceRate,
    LIVEKIT_OUTPUT_SAMPLE_RATE,
    1,
    AudioResamplerQuality.VERY_HIGH,
  );
  try {
    const frames = [
      ...resampler.push(new AudioFrame(sourceSamples, sourceRate, 1, sourceSamples.length)),
      ...resampler.flush(),
    ];
    return Buffer.concat(frames.map((frame) => (
      Buffer.from(frame.data.buffer, frame.data.byteOffset, frame.data.byteLength)
    )));
  } finally {
    resampler.close();
  }
}

/** Converts supported TTS output into the PCM format consumed by LiveKit's AudioSource. */
export function prepareWavForLiveKit(audio: Buffer, format: "wav" | "mp3"): LiveKitPcmAudio {
  if (format !== "wav") {
    throw new Error("移动端通话当前仅支持 WAV TTS；请在 TTS 设置中选择 wav 输出");
  }
  const decoded = decodePcm16Wav(audio);
  const mono = downmixPcm16ToMono(decoded.pcm, decoded.channels);
  return {
    pcm: resamplePcm16MonoForLiveKit(mono, decoded.sampleRate),
    sampleRate: LIVEKIT_OUTPUT_SAMPLE_RATE,
  };
}
