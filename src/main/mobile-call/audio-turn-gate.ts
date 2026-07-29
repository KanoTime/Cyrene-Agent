import { calculatePcm16Rms } from "./pcm-vad";

export type VoiceTurnInputMode = "automatic" | "manual";

export interface AudioTurnGateOptions {
  sampleRate: number;
  threshold: number;
  silenceMs: number;
  minimumSpeechMs: number;
  preRollMs: number;
}

export interface AudioTurnGateHandlers {
  onAudio(frame: Int16Array): void;
  onTurnEnd(): void;
}

/**
 * Owns the admission decision between decoded mobile PCM and ASR.
 *
 * Callers only choose the mode, mark whether a Voice Conversation has been
 * selected, and push frames. Automatic onset buffering and manual turn
 * lifecycle stay behind this interface.
 */
export class AudioTurnGate {
  private conversationReady = false;
  private mode: VoiceTurnInputMode = "automatic";
  private manualOpen = false;
  private automaticSpeaking = false;
  private candidateDurationMs = 0;
  private silenceDurationMs = 0;
  private noiseFloor: number;
  private preRoll: Int16Array[] = [];
  private candidate: Int16Array[] = [];
  private candidatePreRoll: Int16Array[] = [];

  constructor(
    private readonly options: AudioTurnGateOptions,
    private readonly handlers: AudioTurnGateHandlers,
  ) {
    this.noiseFloor = Math.max(0.0005, options.threshold / 5);
  }

  get inputMode(): VoiceTurnInputMode {
    return this.mode;
  }

  get isManualTurnOpen(): boolean {
    return this.manualOpen;
  }

  setConversationReady(ready: boolean): void {
    if (this.conversationReady === ready) return;
    this.conversationReady = ready;
    this.resetTurn();
  }

  setMode(mode: VoiceTurnInputMode): void {
    if (this.mode === mode) return;
    this.mode = mode;
    this.resetTurn();
  }

  beginManualTurn(): boolean {
    if (!this.conversationReady || this.mode !== "manual" || this.manualOpen) {
      return false;
    }
    this.resetTurn();
    this.manualOpen = true;
    return true;
  }

  commitManualTurn(): boolean {
    if (!this.conversationReady || this.mode !== "manual" || !this.manualOpen) {
      return false;
    }
    this.manualOpen = false;
    this.handlers.onTurnEnd();
    return true;
  }

  push(frame: Int16Array): void {
    if (!this.conversationReady || frame.length === 0) return;
    if (this.mode === "manual") {
      if (this.manualOpen) this.handlers.onAudio(cloneFrame(frame));
      return;
    }
    this.pushAutomatic(frame);
  }

  reset(): void {
    this.conversationReady = false;
    this.mode = "automatic";
    this.resetTurn();
  }

  cancelCurrentTurn(): void {
    this.resetTurn();
  }

  private pushAutomatic(frame: Int16Array): void {
    const current = cloneFrame(frame);
    const durationMs = current.length / this.options.sampleRate * 1_000;
    const level = calculatePcm16Rms(current);
    const startThreshold = Math.max(
      this.options.threshold,
      Math.min(0.2, this.noiseFloor * 2.5),
    );

    if (this.automaticSpeaking) {
      this.handlers.onAudio(current);
      if (level >= Math.max(this.options.threshold * 0.65, this.noiseFloor * 1.5)) {
        this.silenceDurationMs = 0;
        return;
      }
      this.silenceDurationMs += durationMs;
      if (this.silenceDurationMs + 0.001 >= this.options.silenceMs) {
        this.handlers.onTurnEnd();
        this.resetAutomaticTurn();
      }
      return;
    }

    if (level >= startThreshold) {
      if (this.candidate.length === 0) {
        this.candidatePreRoll = this.preRoll.map(cloneFrame);
      }
      this.candidate.push(current);
      this.candidateDurationMs += durationMs;
      if (this.candidateDurationMs + 0.001 >= this.options.minimumSpeechMs) {
        this.automaticSpeaking = true;
        for (const buffered of this.candidatePreRoll) this.handlers.onAudio(buffered);
        for (const buffered of this.candidate) this.handlers.onAudio(buffered);
        this.preRoll = [];
        this.candidate = [];
        this.candidatePreRoll = [];
        this.candidateDurationMs = 0;
      }
      return;
    }

    if (this.candidate.length > 0) {
      // Frames that failed the minimum-speech requirement are deliberately not
      // recycled into pre-roll; otherwise a rejected collision can leak into
      // the next valid utterance.
      this.candidate = [];
      this.candidatePreRoll = [];
      this.candidateDurationMs = 0;
      this.preRoll = [];
    }

    this.noiseFloor = this.noiseFloor * 0.95 + level * 0.05;
    this.preRoll.push(current);
    const maximumFrames = Math.max(
      1,
      Math.ceil(this.options.preRollMs / Math.max(durationMs, 1)),
    );
    if (this.preRoll.length > maximumFrames) {
      this.preRoll.splice(0, this.preRoll.length - maximumFrames);
    }
  }

  private resetTurn(): void {
    this.manualOpen = false;
    this.resetAutomaticTurn();
  }

  private resetAutomaticTurn(): void {
    this.automaticSpeaking = false;
    this.candidateDurationMs = 0;
    this.silenceDurationMs = 0;
    this.preRoll = [];
    this.candidate = [];
    this.candidatePreRoll = [];
  }
}

function cloneFrame(frame: Int16Array): Int16Array {
  return new Int16Array(frame);
}
