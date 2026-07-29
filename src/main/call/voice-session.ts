import type { AsrCallbacks, AsrConfig, AsrSession } from "../asr/types";

/**
 * A platform-neutral, single-participant voice conversation.
 *
 * The caller only needs to provide PCM input, signal that playback completed,
 * and render the emitted events. ASR, reply generation, and synthesis stay
 * behind this Module's Interface so Electron and mobile transports use the
 * same turn lifecycle.
 */
export type VoiceSessionState = "IDLE" | "LISTENING" | "ASR" | "THINKING" | "SPEAKING" | "ERROR" | "ENDED";

export type VoiceSessionEvent =
  | { type: "state"; state: VoiceSessionState }
  | { type: "transcript"; partial?: string; final?: string }
  | { type: "turn"; userText: string; assistantText: string }
  | { type: "audio"; audio: Buffer; format: "wav" | "mp3" }
  | { type: "error"; message: string };

export interface VoiceSessionDependencies {
  /** Returns a ready-to-use config, including any Active Character ASR hints. */
  getAsrConfig(): AsrConfig;
  createAsrSession(callbacks: AsrCallbacks, config: AsrConfig): AsrSession;
  generateReply(userText: string): Promise<string | null>;
  synthesizeReply(text: string): Promise<{ audio: Buffer; format: "wav" | "mp3" }>;
  emit(event: VoiceSessionEvent): void;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/**
 * Owns one call's ASR → reply → TTS lifecycle.
 *
 * A session is deliberately not coupled to Electron IPC, a BrowserWindow, or a
 * media provider. Those details are adapters at the seam represented by
 * `VoiceSessionDependencies` and `VoiceSessionEvent`.
 */
export class VoiceSession {
  private asrSession: AsrSession | null = null;
  private active = false;
  private generation = 0;
  private currentState: VoiceSessionState = "IDLE";

  constructor(private readonly dependencies: VoiceSessionDependencies) {}

  get isActive(): boolean {
    return this.active;
  }

  get state(): VoiceSessionState {
    return this.currentState;
  }

  async start(): Promise<void> {
    if (this.active) return;

    let config: AsrConfig;
    try {
      config = this.dependencies.getAsrConfig();
    } catch (error) {
      this.emitError(errorMessage(error));
      this.emitState("ERROR");
      return;
    }

    this.active = true;
    const generation = ++this.generation;
    this.emitState("ASR");

    try {
      await this.openAsrSession(config, generation);
      if (this.isCurrent(generation)) this.emitState("LISTENING");
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.active = false;
      this.disposeAsrSession();
      this.emitError(`ASR 启动失败：${errorMessage(error)}`);
      this.emitState("ERROR");
    }
  }

  /** Accepts 16-bit mono PCM frames while the user is speaking. */
  pushAudio(frame: Buffer): void {
    if (this.active && this.currentState === "LISTENING" && frame.length > 0) {
      this.asrSession?.sendAudio(frame);
    }
  }

  /** Ends the current user turn. Duplicate signals are ignored by state. */
  async endTurn(): Promise<void> {
    if (!this.active || this.currentState !== "LISTENING") return;

    this.emitState("ASR");
    const generation = this.generation;
    const session = this.asrSession;

    let text: string;
    try {
      text = (await session?.finish() ?? "").trim();
    } catch (error) {
      this.releaseFinishedAsrSession(session);
      if (!this.isCurrent(generation)) return;
      this.emitError(`ASR 识别失败：${errorMessage(error)}`);
      await this.restartListening();
      return;
    }

    this.releaseFinishedAsrSession(session);
    if (!this.isCurrent(generation)) return;
    if (!text) {
      await this.restartListening();
      return;
    }

    this.emitState("THINKING");
    let reply: string | null;
    try {
      reply = await this.dependencies.generateReply(text);
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.emitError(`通话出错：${errorMessage(error)}`);
      await this.restartListening();
      return;
    }

    if (!this.isCurrent(generation)) return;
    if (!reply) {
      this.emitError("未收到 agent 回复");
      await this.restartListening();
      return;
    }

    this.dependencies.emit({
      type: "turn",
      userText: text,
      assistantText: reply,
    });
    this.emitState("SPEAKING");
    try {
      const result = await this.dependencies.synthesizeReply(reply);
      if (!this.isCurrent(generation)) return;
      this.dependencies.emit({ type: "audio", audio: result.audio, format: result.format });
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.emitError(`TTS 合成失败：${errorMessage(error)}`);
      await this.restartListening();
    }
  }

  /** The transport calls this after it has finished playing the synthesized reply. */
  async onSpeechFinished(): Promise<void> {
    if (!this.active || this.currentState !== "SPEAKING") return;
    await this.restartListening();
  }

  stop(): void {
    this.active = false;
    this.generation += 1;
    this.disposeAsrSession();
    this.emitState("ENDED");
  }

  private async restartListening(): Promise<void> {
    if (!this.active) return;

    let config: AsrConfig;
    try {
      config = this.dependencies.getAsrConfig();
    } catch (error) {
      this.emitError(`ASR 重启失败：${errorMessage(error)}`);
      this.emitState("ERROR");
      return;
    }

    const generation = this.generation;
    this.disposeAsrSession();
    this.emitState("ASR");

    try {
      await this.openAsrSession(config, generation);
      if (this.isCurrent(generation)) this.emitState("LISTENING");
    } catch (error) {
      if (!this.isCurrent(generation)) return;
      this.disposeAsrSession();
      this.emitError(`ASR 重启失败：${errorMessage(error)}`);
      this.emitState("ERROR");
    }
  }

  private async openAsrSession(config: AsrConfig, generation: number): Promise<void> {
    let session: AsrSession | null = null;
    const callbacks: AsrCallbacks = {
      onPartial: (text) => {
        if (session && this.isCurrent(generation) && this.asrSession === session) {
          this.dependencies.emit({ type: "transcript", partial: text });
        }
      },
      onFinal: (text) => {
        if (session && this.isCurrent(generation) && this.asrSession === session) {
          this.dependencies.emit({ type: "transcript", final: text });
        }
      },
      onError: (error) => {
        if (session && this.isCurrent(generation) && this.asrSession === session) {
          this.emitError(`ASR 错误：${error.message}`);
        }
      },
    };

    session = this.dependencies.createAsrSession(callbacks, config);
    this.asrSession = session;
    await session.start();
  }

  private disposeAsrSession(): void {
    this.asrSession?.dispose();
    this.asrSession = null;
  }

  private releaseFinishedAsrSession(session: AsrSession | null): void {
    if (!session || this.asrSession !== session) return;
    session.dispose();
    this.asrSession = null;
  }

  private isCurrent(generation: number): boolean {
    return this.active && generation === this.generation;
  }

  private emitState(state: VoiceSessionState): void {
    this.currentState = state;
    this.dependencies.emit({ type: "state", state });
  }

  private emitError(message: string): void {
    this.dependencies.emit({ type: "error", message });
  }
}
