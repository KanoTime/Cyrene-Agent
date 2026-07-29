import {
  AudioFrame,
  AudioSource,
  AudioStream,
  EncryptionType,
  LocalAudioTrack,
  RemoteAudioTrack,
  Room,
  RoomEvent,
  TrackKind,
  TrackPublishOptions,
  TrackSource,
} from "@livekit/rtc-node";
import { VoiceSession, type VoiceSessionEvent } from "../call/voice-session";
import {
  MOBILE_CALL_CONTROL_TOPIC,
  MOBILE_CALL_CONVERSATION_PAGE_SIZE,
  MOBILE_CALL_EVENT_TOPIC,
  parseMobileCallControl,
  type MobileCallControl,
  type MobileCallConversationEvent,
} from "../../shared/mobile-call-control";
import type {
  VoiceConversation,
  VoiceConversationMeta,
} from "../../shared/voice-conversation";
import { AudioTurnGate } from "./audio-turn-gate";
import {
  LIVEKIT_OUTPUT_SAMPLE_RATE,
  LIVEKIT_SAMPLES_PER_FRAME,
  prepareWavForLiveKit,
} from "./pcm-wav";
import { CallDataCipher } from "./call-data-cipher";

export interface LiveKitVoiceBridgeConfig {
  serverUrl: string;
  agentToken: string;
  mobileIdentity: string;
  vadSilenceMs: number;
  vadThreshold: number;
  /** Formal remote calls require a 32-byte base64url key before connect. */
  e2eeKey?: string;
  /** Formal mobile calls do not admit PCM until a persisted conversation is selected. */
  requireConversationSelection?: boolean;
}

export interface LiveKitVoiceConversationAdapter {
  list(): VoiceConversationMeta[];
  create(title: string): VoiceConversation | null;
  select(id: string): VoiceConversation | null;
  rename(id: string, title: string): VoiceConversation | null;
  delete(id: string): "DELETED" | "ACTIVE" | "NOT_FOUND";
  current(): VoiceConversation | null;
}

export interface LiveKitVoiceBridgeDependencies {
  createVoiceSession(emit: (event: VoiceSessionEvent) => void): VoiceSession;
  conversations?: LiveKitVoiceConversationAdapter;
  onError?(message: string): void;
  onStateChange?(state: LiveKitVoiceBridgeState, message?: string): void;
  onDiagnostic?(event: LiveKitVoiceBridgeDiagnostic): void;
}

export type LiveKitVoiceBridgeStopCause =
  | "EXTERNAL_STOP"
  | "MOBILE_PARTICIPANT_DISCONNECTED"
  | "MOBILE_AUDIO_STREAM_ENDED"
  | "ROOM_DISCONNECTED"
  | "E2EE_ENCRYPTION_ERROR"
  | "E2EE_PEER_NOT_ENCRYPTED"
  | "START_FAILED";

export type LiveKitVoiceBridgeDiagnostic =
  | {
      event: "BRIDGE_STOPPED";
      cause: LiveKitVoiceBridgeStopCause;
      /** Numeric LiveKit enum only; never includes participant or room identity. */
      disconnectReason?: number;
    };

export type LiveKitVoiceBridgeState =
  | "idle"
  | "connecting"
  | "waiting-for-mobile"
  | "connected"
  | "reconnecting"
  | "ended"
  | "error";

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

const LIVEKIT_RATCHET_SALT = new TextEncoder().encode("LKFrameEncryptionKey");
const LIVEKIT_AUDIO_QUEUE_MS = 200;
const LIVEKIT_MEDIA_OPERATION_TIMEOUT_MS = 5_000;
const LIVEKIT_AUDIO_STREAM_REOPEN_LIMIT = 3;
export const LIVEKIT_E2EE_MEDIA_VERIFICATION_GRACE_MS = 1_500;
export const LIVEKIT_MOBILE_RECONNECT_GRACE_MS = 20_000;

async function within<T>(operation: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation,
      new Promise<never>((_resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      }),
    ]);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

/**
 * A LiveKit Adapter for VoiceSession.
 *
 * It consumes only the paired phone's microphone track, performs VAD on the
 * decoded PCM frames, and publishes Cyrene's WAV TTS as a regular LiveKit
 * microphone track. The bridge runs on the desktop so model and TTS secrets
 * remain local.
 */
export class LiveKitVoiceBridge {
  private room: Room | null = null;
  private source: AudioSource | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private voiceSession: VoiceSession | null = null;
  private state: LiveKitVoiceBridgeState = "idle";
  private active = false;
  private peerPresent = false;
  private peerEncrypted = false;
  private playbackQueue: Promise<void> = Promise.resolve();
  private startupReady: Promise<void> | null = null;
  private resolveStartupReady: (() => void) | null = null;
  private mobileAudioGeneration = 0;
  private mobileReconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private dataCipher: CallDataCipher | null = null;
  private mobileAudioPublicationEncrypted: boolean | undefined;
  private decodedMobileAudioFrames = 0;
  private e2eeVerificationTimer: ReturnType<typeof setTimeout> | null = null;
  private e2eeVerificationFrameBaseline = 0;
  private readonly turnGate: AudioTurnGate;

  constructor(
    private readonly config: LiveKitVoiceBridgeConfig,
    private readonly dependencies: LiveKitVoiceBridgeDependencies,
  ) {
    this.turnGate = new AudioTurnGate({
      sampleRate: 16_000,
      threshold: Math.max(0.001, Math.min(0.5, config.vadThreshold)),
      silenceMs: Math.max(300, Math.min(30_000, Math.round(config.vadSilenceMs))),
      minimumSpeechMs: 200,
      preRollMs: 200,
    }, {
      onAudio: (frame) => {
        const pcm = Buffer.from(frame.buffer, frame.byteOffset, frame.byteLength);
        this.voiceSession?.pushAudio(Buffer.from(pcm));
      },
      onTurnEnd: () => { void this.voiceSession?.endTurn(); },
    });
    this.turnGate.setConversationReady(!config.requireConversationSelection);
  }

  get isActive(): boolean {
    // Treat the connection handshake as active too. This prevents a second
    // start request or character switch from racing the first room join.
    return this.active || this.state === "connecting";
  }

  get currentState(): LiveKitVoiceBridgeState {
    return this.state;
  }

  async start(): Promise<void> {
    if (this.active || this.state === "connecting") return;
    this.startupReady = new Promise<void>((resolve) => {
      this.resolveStartupReady = resolve;
    });
    this.setState("connecting");

    try {
      const room = new Room();
      const e2eeKey = this.config.e2eeKey
        ? decodeE2eeKey(this.config.e2eeKey)
        : undefined;
      if (this.config.requireConversationSelection && !e2eeKey) {
        throw new Error("E2EE_REQUIRED");
      }
      this.dataCipher = e2eeKey
        ? new CallDataCipher(e2eeKey, "desktop")
        : null;
      // rtc-node 0.13.31 declares only the older subset of these options, but
      // its locked 0.12.60 FFI protobuf marks every field below as required.
      // Supplying the native defaults explicitly keeps the options encodable
      // and matches the Android key-provider defaults.
      const keyProviderOptions = e2eeKey
        ? {
            sharedKey: e2eeKey,
            ratchetSalt: LIVEKIT_RATCHET_SALT,
            ratchetWindowSize: 16,
            failureTolerance: -1,
            keyRingSize: 16,
            keyDerivationFunction: 0,
          }
        : undefined;
      const source = new AudioSource(LIVEKIT_OUTPUT_SAMPLE_RATE, 1, LIVEKIT_AUDIO_QUEUE_MS);
      const track = LocalAudioTrack.createAudioTrack("cyrene-voice", source);
      this.room = room;
      this.source = source;
      this.localTrack = track;
      this.voiceSession = this.dependencies.createVoiceSession((event) => this.handleVoiceSessionEvent(event));

      room
        .on(RoomEvent.ParticipantConnected, (participant) => {
          if (participant.identity !== this.config.mobileIdentity) return;
          this.clearMobileReconnectTimer();
          this.peerPresent = true;
          void this.publishConnectedIfSecure();
        })
        .on(RoomEvent.TrackSubscribed, (remoteTrack, publication, participant) => {
          if (participant.identity !== this.config.mobileIdentity || remoteTrack.kind !== TrackKind.KIND_AUDIO) return;
          this.peerPresent = true;
          this.mobileAudioPublicationEncrypted = publication.encryptionType === EncryptionType.GCM;
          if (this.config.e2eeKey && !this.mobileAudioPublicationEncrypted) {
            this.rejectUnverifiedPeerEncryption();
            return;
          }
          void this.publishConnectedIfSecure();
          const generation = ++this.mobileAudioGeneration;
          void this.consumeMobileAudio(remoteTrack as RemoteAudioTrack, generation);
        })
        .on(RoomEvent.DataReceived, (payload, participant, _kind, topic) => {
          if (
            topic !== MOBILE_CALL_CONTROL_TOPIC
            || participant?.identity !== this.config.mobileIdentity
          ) {
            return;
          }
          let plaintext = payload;
          if (this.dataCipher) {
            try {
              plaintext = this.dataCipher.decrypt(payload);
            } catch {
              return;
            }
          }
          const control = parseMobileCallControl(plaintext);
          if (control) {
            void this.handleControl(control);
          }
        })
        .on(RoomEvent.ParticipantDisconnected, (participant) => {
          if (participant.identity === this.config.mobileIdentity) {
            this.beginMobileReconnectGrace(participant.disconnectReason);
          }
        })
        .on(RoomEvent.Reconnecting, () => {
          if (this.active) this.setState("reconnecting");
        })
        .on(RoomEvent.Reconnected, () => {
          if (!this.active) return;
          this.peerPresent = room.remoteParticipants.has(this.config.mobileIdentity);
          if (!this.peerPresent) {
            this.setState("waiting-for-mobile");
            void this.publishClientEvent({ type: "bridge", state: "waiting-for-mobile" });
          } else {
            void this.publishConnectedIfSecure();
          }
        })
        .on(RoomEvent.Disconnected, (reason) => {
          if (this.active) {
            void this.stop(false, "ended", undefined, "ROOM_DISCONNECTED", reason);
          }
        });
      if (e2eeKey) {
        room
          .on(RoomEvent.EncryptionError, (error) => {
            const message = `E2EE 加密失败：${errorMessage(error)}`;
            this.dependencies.onError?.(message);
            void this.stop(true, "error", message, "E2EE_ENCRYPTION_ERROR");
          })
          .on(RoomEvent.ParticipantEncryptionStatusChanged, (isEncrypted, participant) => {
            if (participant.identity !== this.config.mobileIdentity) return;
            if (!isEncrypted) {
              if (this.mobileAudioPublicationEncrypted) {
                this.beginE2eeMediaVerification();
              } else {
                this.rejectUnverifiedPeerEncryption();
              }
              return;
            }
            this.clearE2eeVerificationTimer();
            this.peerPresent = true;
            this.peerEncrypted = true;
            void this.publishConnectedIfSecure();
          });
      }

      await room.connect(this.config.serverUrl, this.config.agentToken, {
        autoSubscribe: true,
        dynacast: true,
        ...(e2eeKey
          ? {
              encryption: {
                encryptionType: EncryptionType.GCM,
                keyProviderOptions: keyProviderOptions!,
              },
            }
          : {}),
      });
      if (e2eeKey) {
        if (!room.e2eeManager) throw new Error("E2EE_REQUIRED");
        room.e2eeManager.setEnabled(true);
        if (!room.e2eeManager.enabled) throw new Error("E2EE_REQUIRED");
      }
      const participant = room.localParticipant;
      if (!participant) throw new Error("LiveKit 未创建桌面端参与者");
      const publishOptions = new TrackPublishOptions();
      publishOptions.source = TrackSource.SOURCE_MICROPHONE;
      await participant.publishTrack(track, publishOptions);

      this.active = true;
      await this.voiceSession.start();
      this.releaseStartupWaiters();
      this.peerPresent = room.remoteParticipants.has(this.config.mobileIdentity);
      if (this.peerPresent) {
        await this.publishConnectedIfSecure();
      } else {
        this.setState("waiting-for-mobile");
        await this.publishClientEvent({ type: "bridge", state: "waiting-for-mobile" });
      }
    } catch (error) {
      const message = `移动端通话连接失败：${errorMessage(error)}`;
      this.dependencies.onError?.(message);
      await this.stop(true, "error", message, "START_FAILED");
      throw new Error(message);
    }
  }

  async stop(
    disconnectRoom = true,
    finalState: Extract<LiveKitVoiceBridgeState, "ended" | "error"> = "ended",
    message?: string,
    cause: LiveKitVoiceBridgeStopCause = "EXTERNAL_STOP",
    disconnectReason?: number,
  ): Promise<void> {
    if (this.state === "ended" || this.state === "error") return;
    try {
      this.dependencies.onDiagnostic?.({
        event: "BRIDGE_STOPPED",
        cause,
        ...(typeof disconnectReason === "number" ? { disconnectReason } : {}),
      });
    } catch {
      // Content-free diagnostics must never change media lifecycle behavior.
    }
    if (this.active && finalState === "ended") {
      await this.publishClientEvent({ type: "bridge", state: "ended" });
    }
    this.active = false;
    this.clearMobileReconnectTimer();
    this.clearE2eeVerificationTimer();
    this.mobileAudioGeneration += 1;
    this.peerPresent = false;
    this.peerEncrypted = false;
    this.mobileAudioPublicationEncrypted = undefined;
    this.decodedMobileAudioFrames = 0;
    this.releaseStartupWaiters();
    this.setState(finalState, message);
    this.turnGate.reset();
    this.voiceSession?.stop();
    this.voiceSession = null;
    this.dataCipher?.dispose();
    this.dataCipher = null;

    const room = this.room;
    const track = this.localTrack;
    const source = this.source;
    this.room = null;
    this.localTrack = null;
    this.source = null;

    try { await track?.close(); } catch { /* best-effort cleanup */ }
    try { await source?.close(); } catch { /* best-effort cleanup */ }
    if (disconnectRoom) {
      try { await room?.disconnect(); } catch { /* best-effort cleanup */ }
    }
  }

  private async consumeMobileAudio(track: RemoteAudioTrack, generation: number): Promise<void> {
    try {
      const startupReady = this.startupReady;
      if (startupReady) await startupReady;
      if (!this.active || !this.voiceSession) return;

      for (let attempt = 0; attempt < LIVEKIT_AUDIO_STREAM_REOPEN_LIMIT; attempt += 1) {
        if (!this.active || !this.voiceSession || generation !== this.mobileAudioGeneration) return;
        const audio = new AudioStream(track, { sampleRate: 16_000, numChannels: 1, frameSizeMs: 20 });
        for await (const frame of audio) {
          if (!this.active || !this.voiceSession || generation !== this.mobileAudioGeneration) return;
          this.decodedMobileAudioFrames += 1;
          this.confirmE2eeWithDecodedAudio();
          if (this.voiceSession.state !== "LISTENING") {
            this.turnGate.cancelCurrentTurn();
            continue;
          }
          this.turnGate.push(frame.data);
        }

        // rtc-node can occasionally finish the decoded stream while the
        // participant and track remain subscribed. Recreate the adapter from
        // the same remote track instead of leaving the UI falsely LISTENING.
        this.turnGate.cancelCurrentTurn();
      }

      if (this.active && generation === this.mobileAudioGeneration) {
        const message = "移动端音频流已结束，请重新呼叫";
        this.reportError(message);
        await this.stop(true, "error", message, "MOBILE_AUDIO_STREAM_ENDED");
      }
    } catch (error) {
      if (this.active) this.reportError(`移动端音频流中断：${errorMessage(error)}`);
    }
  }

  private handleVoiceSessionEvent(event: VoiceSessionEvent): void {
    if (event.type === "turn") {
      void this.publishConversationTurn();
      return;
    }
    if (event.type === "audio") {
      this.playbackQueue = this.playbackQueue
        .then(() => this.publishSynthesizedAudio(event.audio, event.format))
        .catch((error) => this.reportError(`移动端语音播放失败：${errorMessage(error)}`));
      return;
    }
    void this.publishClientEvent(event);
  }

  private async publishConversationTurn(): Promise<void> {
    const conversations = this.dependencies.conversations;
    const current = conversations?.current();
    const meta = current
      ? conversations?.list().find((candidate) => candidate.id === current.id)
      : undefined;
    if (!meta) return;
    await this.publishClientEvent({
      type: "conversation.updated",
      conversation: meta,
    });
  }

  private async publishSynthesizedAudio(audio: Buffer, format: "wav" | "mp3"): Promise<void> {
    if (!this.active || !this.source || !this.voiceSession) return;
    const source = this.source;
    const voiceSession = this.voiceSession;
    try {
      const prepared = prepareWavForLiveKit(audio, format);
      const samples = new Int16Array(prepared.pcm.buffer, prepared.pcm.byteOffset, prepared.pcm.byteLength / 2);
      for (
        let offset = 0;
        offset < samples.length && this.active && this.source === source;
        offset += LIVEKIT_SAMPLES_PER_FRAME
      ) {
        const frameSamples = new Int16Array(LIVEKIT_SAMPLES_PER_FRAME);
        frameSamples.set(samples.subarray(
          offset,
          Math.min(offset + LIVEKIT_SAMPLES_PER_FRAME, samples.length),
        ));
        await within(
          source.captureFrame(new AudioFrame(
            frameSamples,
            LIVEKIT_OUTPUT_SAMPLE_RATE,
            1,
            frameSamples.length,
          )),
          LIVEKIT_MEDIA_OPERATION_TIMEOUT_MS,
          "LIVEKIT_CAPTURE_FRAME_TIMEOUT",
        );
      }
      if (!this.active || this.source !== source) return;
      await within(
        source.waitForPlayout(),
        LIVEKIT_MEDIA_OPERATION_TIMEOUT_MS,
        "LIVEKIT_PLAYOUT_TIMEOUT",
      );
    } catch (error) {
      if (!this.active || this.source !== source) return;
      try { source.clearQueue(); } catch { /* best-effort queue recovery */ }
      this.reportError(`移动端语音播放失败：${errorMessage(error)}`);
    } finally {
      if (this.active && this.voiceSession === voiceSession) {
        await voiceSession.onSpeechFinished();
      }
    }
  }

  private async publishClientEvent(
    event:
      | VoiceSessionEvent
      | MobileCallConversationEvent
      | { type: "bridge"; state: LiveKitVoiceBridgeState },
  ): Promise<void> {
    const participant = this.room?.localParticipant;
    if (!participant) return;
    const plaintext = Buffer.from(JSON.stringify(event), "utf8");
    try {
      const payload = this.dataCipher
        ? this.dataCipher.encrypt(plaintext)
        : plaintext;
      await participant.publishData(payload, {
        reliable: true,
        destination_identities: [this.config.mobileIdentity],
        topic: MOBILE_CALL_EVENT_TOPIC,
      });
    } catch (error) {
      if (this.active) this.dependencies.onError?.(`移动端状态同步失败：${errorMessage(error)}`);
    }
  }

  private reportError(message: string): void {
    this.dependencies.onError?.(message);
    void this.publishClientEvent({ type: "error", message });
  }

  private beginE2eeMediaVerification(): void {
    if (this.e2eeVerificationTimer || !this.active) return;
    this.e2eeVerificationFrameBaseline = this.decodedMobileAudioFrames;
    this.e2eeVerificationTimer = setTimeout(() => {
      this.e2eeVerificationTimer = null;
      if (!this.active) return;
      this.rejectUnverifiedPeerEncryption();
    }, LIVEKIT_E2EE_MEDIA_VERIFICATION_GRACE_MS);
  }

  private confirmE2eeWithDecodedAudio(): void {
    if (
      !this.e2eeVerificationTimer
      || this.decodedMobileAudioFrames <= this.e2eeVerificationFrameBaseline
    ) {
      return;
    }
    this.clearE2eeVerificationTimer();
    this.peerEncrypted = true;
    void this.publishConnectedIfSecure();
  }

  private rejectUnverifiedPeerEncryption(): void {
    const message = "E2EE_REQUIRED";
    this.dependencies.onError?.(message);
    void this.stop(true, "error", message, "E2EE_PEER_NOT_ENCRYPTED");
  }

  private clearE2eeVerificationTimer(): void {
    if (!this.e2eeVerificationTimer) return;
    clearTimeout(this.e2eeVerificationTimer);
    this.e2eeVerificationTimer = null;
  }

  private beginMobileReconnectGrace(disconnectReason?: number): void {
    if (!this.active || this.mobileReconnectTimer) return;
    this.peerPresent = false;
    this.peerEncrypted = false;
    this.clearE2eeVerificationTimer();
    this.mobileAudioGeneration += 1;
    this.turnGate.cancelCurrentTurn();
    this.setState("reconnecting");
    void this.publishClientEvent({ type: "bridge", state: "reconnecting" });
    this.mobileReconnectTimer = setTimeout(() => {
      this.mobileReconnectTimer = null;
      if (!this.active || this.peerPresent) return;
      void this.stop(
        true,
        "ended",
        undefined,
        "MOBILE_PARTICIPANT_DISCONNECTED",
        disconnectReason,
      );
    }, LIVEKIT_MOBILE_RECONNECT_GRACE_MS);
  }

  private clearMobileReconnectTimer(): void {
    if (!this.mobileReconnectTimer) return;
    clearTimeout(this.mobileReconnectTimer);
    this.mobileReconnectTimer = null;
  }

  private async publishConnectedIfSecure(): Promise<void> {
    if (!this.active || !this.peerPresent) return;
    if (this.config.e2eeKey && !this.peerEncrypted) {
      this.setState("waiting-for-mobile");
      return;
    }
    this.setState("connected");
    await this.publishClientEvent({ type: "bridge", state: "connected" });
    await this.publishConversationCatalog();
  }

  private setState(state: LiveKitVoiceBridgeState, message?: string): void {
    if (this.state === state && message === undefined) return;
    this.state = state;
    try {
      this.dependencies.onStateChange?.(state, message);
    } catch {
      // A diagnostics listener must never break the media bridge.
    }
  }

  private async handleControl(
    control: MobileCallControl,
  ): Promise<void> {
    if (!control || !this.active) return;
    const conversations = this.dependencies.conversations;

    if (control.type === "conversation.list") {
      await this.publishConversationCatalog(control.after);
      return;
    }
    if (
      control.type === "conversation.create"
      || control.type === "conversation.select"
      || control.type === "conversation.rename"
      || control.type === "conversation.delete"
    ) {
      if (!conversations) {
        this.reportControlError("当前通话不支持持久化语音对话");
        return;
      }
      if (this.voiceSession?.state !== "LISTENING" || this.turnGate.isManualTurnOpen) {
        this.reportControlError("请在角色正在聆听时切换语音对话");
        return;
      }

      if (control.type === "conversation.rename") {
        const renamed = conversations.rename(control.conversationId, control.title);
        if (!renamed) {
          this.reportControlError("找不到指定的语音对话");
          return;
        }
        if (conversations.current()?.id === renamed.id) {
          await this.publishSelectedConversation(renamed);
        }
        await this.publishConversationCatalog();
        return;
      }

      if (control.type === "conversation.delete") {
        const outcome = conversations.delete(control.conversationId);
        if (outcome === "ACTIVE") {
          this.reportControlError("当前正在使用这段对话，请先结束通话再删除");
          return;
        }
        if (outcome === "NOT_FOUND") {
          this.reportControlError("找不到指定的语音对话");
          return;
        }
        await this.publishConversationCatalog();
        return;
      }

      const selected = control.type === "conversation.create"
        ? conversations.create(control.title)
        : conversations.select(control.conversationId);
      if (!selected) {
        this.reportControlError("找不到指定的语音对话");
        return;
      }
      this.turnGate.cancelCurrentTurn();
      this.turnGate.setConversationReady(true);
      await this.publishSelectedConversation(selected);
      await this.publishConversationCatalog();
      return;
    }

    if (this.config.requireConversationSelection && !conversations?.current()) {
      this.reportControlError("请先选择或创建语音对话");
      return;
    }
    if (control.type === "turn.mode") {
      if (this.voiceSession?.state !== "LISTENING") {
        this.reportControlError("请在角色正在聆听时切换输入模式");
        return;
      }
      this.turnGate.setMode(control.mode);
      await this.publishClientEvent({
        type: "turn.mode",
        mode: this.turnGate.inputMode,
        manualTurnOpen: this.turnGate.isManualTurnOpen,
      });
      return;
    }
    if (control.type === "turn.begin") {
      if (this.voiceSession?.state !== "LISTENING" || !this.turnGate.beginManualTurn()) {
        this.reportControlError("当前不能开始手动语音轮次");
        return;
      }
      await this.publishClientEvent({
        type: "turn.mode",
        mode: this.turnGate.inputMode,
        manualTurnOpen: true,
      });
      return;
    }
    if (control.type === "turn.commit") {
      if (!this.turnGate.commitManualTurn()) {
        this.reportControlError("当前没有可提交的手动语音轮次");
        return;
      }
      await this.publishClientEvent({
        type: "turn.mode",
        mode: this.turnGate.inputMode,
        manualTurnOpen: false,
      });
    }
  }

  private async publishConversationCatalog(after?: string): Promise<void> {
    const conversations = this.dependencies.conversations;
    if (!conversations) return;
    const all = conversations.list();
    const afterIndex = after
      ? all.findIndex((conversation) => conversation.id === after)
      : -1;
    const start = after && afterIndex >= 0 ? afterIndex + 1 : 0;
    const page = all.slice(start, start + MOBILE_CALL_CONVERSATION_PAGE_SIZE);
    const hasMore = start + page.length < all.length;
    await this.publishClientEvent({
      type: "conversation.catalog",
      conversations: page,
      selectedId: conversations.current()?.id,
      mode: this.turnGate.inputMode,
      replace: !after,
      ...(hasMore && page.length > 0
        ? { nextCursor: page.at(-1)!.id }
        : {}),
    });
  }

  private reportControlError(message: string): void {
    void this.publishClientEvent({ type: "control.error", message });
  }

  private async publishSelectedConversation(
    conversation: VoiceConversation,
  ): Promise<void> {
    const meta = this.dependencies.conversations?.list()
      .find((candidate) => candidate.id === conversation.id);
    if (!meta) return;
    await this.publishClientEvent({
      type: "conversation.selected",
      conversation: meta,
      mode: this.turnGate.inputMode,
    });
  }

  private releaseStartupWaiters(): void {
    this.resolveStartupReady?.();
    this.resolveStartupReady = null;
    this.startupReady = null;
  }
}

function decodeE2eeKey(value: string): Uint8Array {
  if (!/^[A-Za-z0-9_-]{43}$/.test(value)) {
    throw new Error("E2EE_REQUIRED");
  }
  const key = Buffer.from(value, "base64url");
  if (key.byteLength !== 32) throw new Error("E2EE_REQUIRED");
  return key;
}
