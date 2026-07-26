import { describe, expect, it } from "vitest";
import { computeRmsLevel } from "./vad-level";

describe("computeRmsLevel", () => {
  it("classifies a quiet time-domain frame below the default 0.01 threshold", () => {
    const quietFrame = Float32Array.from({ length: 256 }, (_, index) => index % 2 === 0 ? 0.008 : -0.008);

    // The former frequency-byte average can be around 0.2 for this microphone
    // while its true waveform amplitude is quiet. VAD must compare like units.
    expect(0.2).toBeGreaterThan(0.01);
    expect(computeRmsLevel(quietFrame)).toBeCloseTo(0.008, 6);
    expect(computeRmsLevel(quietFrame)).toBeLessThan(0.01);
  });

  it("classifies a spoken frame above the default threshold", () => {
    const spokenFrame = Float32Array.from({ length: 256 }, (_, index) => index % 2 === 0 ? 0.04 : -0.04);
    expect(computeRmsLevel(spokenFrame)).toBeGreaterThan(0.01);
  });
});
