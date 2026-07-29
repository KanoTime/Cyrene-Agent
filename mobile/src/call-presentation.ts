export type MobileCallPhase =
  | "CONNECTING"
  | "LISTENING"
  | "ASR"
  | "THINKING"
  | "SPEAKING"
  | "RECONNECTING"
  | "ERROR"
  | "ENDED";

export type MobileCallActivity = "idle" | "listening" | "thinking" | "speaking";
export type MobileCallTone = "default" | "thinking" | "error";

export interface MobileCallPresentation {
  label: string;
  tone: MobileCallTone;
  activity: MobileCallActivity;
  showAvatarWaveform: boolean;
  showSpeakingRings: boolean;
  showMicBars: boolean;
  timerActive: boolean;
}

export function getMobileAvatarKind(
  characterId: string | undefined,
): "cyrene" | "fallback" {
  return characterId === "cyrene" ? "cyrene" : "fallback";
}

export function getMobileCallPresentation({
  phase,
  characterName,
  detail,
}: {
  phase: MobileCallPhase;
  characterName: string;
  detail?: string;
}): MobileCallPresentation {
  const presentation = (() => {
    switch (phase) {
      case "LISTENING":
        return {
          label: detail ?? "正在聆听...",
          tone: "default" as const,
          activity: "listening" as const,
          timerActive: true,
        };
      case "ASR":
        return {
          label: detail ?? "正在识别语音...",
          tone: "thinking" as const,
          activity: "thinking" as const,
          timerActive: true,
        };
      case "THINKING":
        return {
          label: detail ?? `${characterName}思考中...`,
          tone: "thinking" as const,
          activity: "thinking" as const,
          timerActive: true,
        };
      case "SPEAKING":
        return {
          label: detail ?? `${characterName}说话中...`,
          tone: "default" as const,
          activity: "speaking" as const,
          timerActive: true,
        };
      case "RECONNECTING":
        return {
          label: detail ?? "网络波动，正在自动重连…",
          tone: "thinking" as const,
          activity: "idle" as const,
          timerActive: true,
        };
      case "ERROR":
        return {
          label: detail ?? "通话出错，请查看错误提示",
          tone: "error" as const,
          activity: "idle" as const,
          timerActive: false,
        };
      case "ENDED":
        return {
          label: detail ?? "通话已结束",
          tone: "default" as const,
          activity: "idle" as const,
          timerActive: false,
        };
      case "CONNECTING":
      default:
        return {
          label: detail ?? "正在连接...",
          tone: "default" as const,
          activity: "idle" as const,
          timerActive: false,
        };
    }
  })();

  return {
    ...presentation,
    showAvatarWaveform:
      presentation.activity === "listening" || presentation.activity === "thinking",
    showSpeakingRings: presentation.activity === "speaking",
    showMicBars:
      presentation.activity === "listening" || presentation.activity === "thinking",
  };
}

export function formatCallDuration(durationMs: number): string {
  const totalSeconds = Math.max(0, Math.floor(durationMs / 1_000));
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  const parts = [minutes, seconds].map((part) => String(part).padStart(2, "0"));
  return hours > 0
    ? [String(hours).padStart(2, "0"), ...parts].join(":")
    : parts.join(":");
}
