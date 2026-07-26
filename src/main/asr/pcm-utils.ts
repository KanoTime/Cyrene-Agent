export const LOCAL_ASR_SAMPLE_RATE = 16_000;

export function resamplePcm16Mono(pcm: Buffer, sourceRate: number, targetRate = LOCAL_ASR_SAMPLE_RATE): Buffer {
  if (!Number.isFinite(sourceRate) || sourceRate <= 0) throw new Error(`无效采样率: ${sourceRate}`);
  if (pcm.length % 2 !== 0) throw new Error("PCM16 数据长度必须为偶数");
  if (sourceRate === targetRate || pcm.length === 0) return Buffer.from(pcm);

  const sourceSamples = pcm.length / 2;
  const targetSamples = Math.max(1, Math.round(sourceSamples * targetRate / sourceRate));
  const output = Buffer.allocUnsafe(targetSamples * 2);
  for (let index = 0; index < targetSamples; index += 1) {
    const sourcePosition = index * sourceRate / targetRate;
    const left = Math.min(sourceSamples - 1, Math.floor(sourcePosition));
    const right = Math.min(sourceSamples - 1, left + 1);
    const fraction = sourcePosition - left;
    const sample = Math.round(pcm.readInt16LE(left * 2) * (1 - fraction) + pcm.readInt16LE(right * 2) * fraction);
    output.writeInt16LE(Math.max(-32768, Math.min(32767, sample)), index * 2);
  }
  return output;
}
export function pcm16MonoToWav(pcm: Buffer, sampleRate = LOCAL_ASR_SAMPLE_RATE): Buffer {
  if (pcm.length % 2 !== 0) throw new Error("PCM16 数据长度必须为偶数");
  const wav = Buffer.allocUnsafe(44 + pcm.length);
  wav.write("RIFF", 0, "ascii");
  wav.writeUInt32LE(36 + pcm.length, 4);
  wav.write("WAVE", 8, "ascii");
  wav.write("fmt ", 12, "ascii");
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(1, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * 2, 28);
  wav.writeUInt16LE(2, 32);
  wav.writeUInt16LE(16, 34);
  wav.write("data", 36, "ascii");
  wav.writeUInt32LE(pcm.length, 40);
  pcm.copy(wav, 44);
  return wav;
}
