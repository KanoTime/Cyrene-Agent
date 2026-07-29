import { describe, expect, it } from "vitest";
import {
  formatCallDuration,
  getMobileAvatarKind,
  getMobileCallPresentation,
} from "./call-presentation";

describe("mobile call presentation", () => {
  it("shows the desktop listening visuals while the user can speak", () => {
    expect(getMobileCallPresentation({
      phase: "LISTENING",
      characterName: "昔涟",
    })).toEqual({
      label: "正在聆听...",
      tone: "default",
      activity: "listening",
      showAvatarWaveform: true,
      showSpeakingRings: false,
      showMicBars: true,
      timerActive: true,
    });
  });

  it("uses the active character name and desktop visuals for thinking and speaking", () => {
    expect(getMobileCallPresentation({
      phase: "THINKING",
      characterName: "昔涟",
    })).toMatchObject({
      label: "昔涟思考中...",
      tone: "thinking",
      showAvatarWaveform: true,
      showSpeakingRings: false,
      showMicBars: true,
    });

    expect(getMobileCallPresentation({
      phase: "SPEAKING",
      characterName: "昔涟",
    })).toMatchObject({
      label: "昔涟说话中...",
      tone: "default",
      showAvatarWaveform: false,
      showSpeakingRings: true,
      showMicBars: false,
    });
  });

  it("keeps transport detail without implying that the microphone is listening", () => {
    expect(getMobileCallPresentation({
      phase: "RECONNECTING",
      characterName: "昔涟",
      detail: "网络波动，正在自动重连…",
    })).toEqual({
      label: "网络波动，正在自动重连…",
      tone: "thinking",
      activity: "idle",
      showAvatarWaveform: false,
      showSpeakingRings: false,
      showMicBars: false,
      timerActive: true,
    });
  });

  it("stops active visuals and the timer after an error or remote end", () => {
    expect(getMobileCallPresentation({
      phase: "ERROR",
      characterName: "昔涟",
      detail: "通话出错：麦克风不可用",
    })).toMatchObject({
      label: "通话出错：麦克风不可用",
      tone: "error",
      activity: "idle",
      timerActive: false,
    });
    expect(getMobileCallPresentation({
      phase: "ENDED",
      characterName: "昔涟",
    })).toMatchObject({
      label: "通话已结束",
      tone: "default",
      activity: "idle",
      timerActive: false,
    });
  });
});

describe("mobile call avatar identity", () => {
  it("uses the bundled avatar only for the stable built-in Cyrene id", () => {
    expect(getMobileAvatarKind("cyrene")).toBe("cyrene");
    expect(getMobileAvatarKind("custom-cyrene")).toBe("fallback");
    expect(getMobileAvatarKind(undefined)).toBe("fallback");
  });
});

describe("call duration", () => {
  it("matches the desktop MM:SS and HH:MM:SS formats", () => {
    expect(formatCallDuration(0)).toBe("00:00");
    expect(formatCallDuration(65_000)).toBe("01:05");
    expect(formatCallDuration(3_661_000)).toBe("01:01:01");
  });
});
