import { describe, expect, it } from "vitest";
import { pcm16MonoToWav, resamplePcm16Mono } from "./pcm-utils";

describe("PCM utilities", () => {
  it("resamples PCM16 mono to 16 kHz", () => {
    const input = Buffer.alloc(8_000 * 2);
    for (let index = 0; index < 8_000; index += 1) input.writeInt16LE(index % 1000, index * 2);
    const output = resamplePcm16Mono(input, 8_000);
    expect(output.length).toBe(16_000 * 2);
  });

  it("wraps PCM in a valid mono WAV header", () => {
    const pcm = Buffer.alloc(320);
    const wav = pcm16MonoToWav(pcm);
    expect(wav.toString("ascii", 0, 4)).toBe("RIFF");
    expect(wav.toString("ascii", 8, 12)).toBe("WAVE");
    expect(wav.readUInt16LE(22)).toBe(1);
    expect(wav.readUInt32LE(24)).toBe(16_000);
    expect(wav.readUInt16LE(34)).toBe(16);
    expect(wav.readUInt32LE(40)).toBe(pcm.length);
  });

  it("rejects malformed PCM16 bytes", () => {
    expect(() => resamplePcm16Mono(Buffer.alloc(3), 8_000)).toThrow("偶数");
  });
});
