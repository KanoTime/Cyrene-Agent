import { describe, expect, it } from "vitest";
import {
  inferPreferredAudioOutput,
  nextAudioOutput,
} from "./audio-output-routing";

describe("mobile call audio output routing", () => {
  it("matches LiveKit's documented Bluetooth-first default order", () => {
    expect(inferPreferredAudioOutput([
      "speaker",
      "earpiece",
      "bluetooth",
    ])).toBe("bluetooth");
    expect(inferPreferredAudioOutput(["earpiece", "speaker"])).toBe("speaker");
  });

  it("switches between Bluetooth and speaker for an immediate quality comparison", () => {
    const outputs = ["speaker", "earpiece", "bluetooth"];
    expect(nextAudioOutput("bluetooth", outputs)).toBe("speaker");
    expect(nextAudioOutput("speaker", outputs)).toBe("bluetooth");
  });

  it("falls back between earpiece and speaker when Bluetooth is unavailable", () => {
    const outputs = ["earpiece", "speaker"];
    expect(nextAudioOutput("speaker", outputs)).toBe("earpiece");
    expect(nextAudioOutput("earpiece", outputs)).toBe("speaker");
  });
});
