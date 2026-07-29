import { describe, expect, it } from "vitest";
import { pcm16MonoToWav } from "../asr/pcm-utils";
import { decodePcm16Wav, downmixPcm16ToMono, prepareWavForLiveKit } from "./pcm-wav";

function tonePcm(sampleRate: number, frequency: number, seconds = 0.1): Buffer {
  const samples = Math.round(sampleRate * seconds);
  const pcm = Buffer.alloc(samples * 2);
  for (let index = 0; index < samples; index += 1) {
    pcm.writeInt16LE(
      Math.round(Math.sin(2 * Math.PI * frequency * index / sampleRate) * 24_000),
      index * 2,
    );
  }
  return pcm;
}

function toneMagnitude(pcm: Buffer, sampleRate: number, frequency: number): number {
  const samples = pcm.length / 2;
  let real = 0;
  let imaginary = 0;
  for (let index = 0; index < samples; index += 1) {
    const phase = 2 * Math.PI * frequency * index / sampleRate;
    const sample = pcm.readInt16LE(index * 2);
    real += sample * Math.cos(phase);
    imaginary -= sample * Math.sin(phase);
  }
  return Math.hypot(real, imaginary) / samples;
}

describe("PCM WAV transport conversion", () => {
  it("decodes PCM16 WAV and resamples it to LiveKit's 48 kHz mono transport", () => {
    const pcm = Buffer.alloc(4);
    pcm.writeInt16LE(1_000, 0);
    pcm.writeInt16LE(-1_000, 2);
    const wav = pcm16MonoToWav(pcm, 8_000);

    expect(decodePcm16Wav(wav)).toMatchObject({ pcm, sampleRate: 8_000, channels: 1 });
    const liveKitPcm = prepareWavForLiveKit(wav, "wav");
    expect(liveKitPcm.sampleRate).toBe(48_000);
    expect(liveKitPcm.pcm.length).toBe(24);
  });

  it("preserves valid GPT-SoVITS high frequencies instead of folding them into audible noise", () => {
    const sourceRate = 32_000;
    const sourceFrequency = 10_000;
    const liveKitPcm = prepareWavForLiveKit(
      pcm16MonoToWav(tonePcm(sourceRate, sourceFrequency), sourceRate),
      "wav",
    );

    expect(liveKitPcm.sampleRate).toBe(48_000);
    expect(toneMagnitude(liveKitPcm.pcm, liveKitPcm.sampleRate, sourceFrequency))
      .toBeGreaterThan(toneMagnitude(liveKitPcm.pcm, liveKitPcm.sampleRate, 6_000) * 20);
  });

  it("downmixes interleaved PCM16 channels without clipping", () => {
    const stereo = Buffer.alloc(8);
    stereo.writeInt16LE(4_000, 0);
    stereo.writeInt16LE(2_000, 2);
    stereo.writeInt16LE(-4_000, 4);
    stereo.writeInt16LE(2_000, 6);

    const mono = downmixPcm16ToMono(stereo, 2);
    expect([mono.readInt16LE(0), mono.readInt16LE(2)]).toEqual([3_000, -1_000]);
  });

  it("rejects encoded formats that cannot be published as a raw LiveKit audio track", () => {
    expect(() => prepareWavForLiveKit(Buffer.from("not-a-wav"), "mp3"))
      .toThrow("仅支持 WAV TTS");
  });
});
