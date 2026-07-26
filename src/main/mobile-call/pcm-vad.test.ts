import { describe, expect, it } from "vitest";
import { calculatePcm16Rms, PcmVad } from "./pcm-vad";

describe("PcmVad", () => {
  it("does not create an empty turn before speech", () => {
    let now = 0;
    const endTurn = () => { throw new Error("should not end an empty turn"); };
    const vad = new PcmVad({ threshold: 0.01, silenceMs: 800, clock: () => now }, endTurn);

    vad.push(new Int16Array(320));
    now += 1_000;
    vad.push(new Int16Array(320));
  });

  it("ends a turn only after observed speech is followed by configured silence", () => {
    let now = 0;
    let turns = 0;
    const vad = new PcmVad({ threshold: 0.01, silenceMs: 800, clock: () => now }, () => { turns += 1; });

    vad.push(new Int16Array([1_000, -1_000]));
    now = 100;
    vad.push(new Int16Array(320));
    now = 899;
    vad.push(new Int16Array(320));
    expect(turns).toBe(0);
    now = 900;
    vad.push(new Int16Array(320));
    expect(turns).toBe(1);
  });

  it("reports normalized PCM RMS levels", () => {
    expect(calculatePcm16Rms(new Int16Array([16_384, -16_384]))).toBeCloseTo(0.5, 5);
  });
});
