import { beforeEach, describe, expect, it, vi } from "vitest";
import { pcm16MonoToWav } from "../asr/pcm-utils";

const liveKit = vi.hoisted(() => {
  const instances: FakeRoom[] = [];
  const audioSources: Array<{ sampleRate: number; channels: number; queueSizeMs: number }> = [];
  const capturedFrames: Array<{
    sampleRate: number;
    channels: number;
    samplesPerChannel: number;
  }> = [];
  let nextConnectError: Error | null = null;
  let nextPublishTrackGate: Promise<void> | null = null;
  let nextAudioStreamEnds = false;
  let nextAudioStreamPauses = false;
  let onCaptureFrame: (() => Promise<void>) | null = null;

  class FakeRoom {
    private readonly listeners = new Map<string, Set<(...args: unknown[]) => void>>();
    readonly remoteParticipants = new Map<string, { identity: string }>();
    readonly localParticipant = {
      publishTrack: vi.fn(async () => {
        const gate = nextPublishTrackGate;
        nextPublishTrackGate = null;
        await gate;
      }),
      publishData: vi.fn(async () => undefined),
    };
    readonly e2eeManager = {
      enabled: false,
      setEnabled: vi.fn((enabled: boolean) => {
        this.e2eeManager.enabled = enabled;
      }),
    };
    connectError: Error | null = null;
    connectOptions: unknown;

    constructor() {
      this.connectError = nextConnectError;
      nextConnectError = null;
      instances.push(this);
    }

    on(event: string, listener: (...args: never[]) => void): this {
      const listeners = this.listeners.get(event) ?? new Set();
      listeners.add(listener as (...args: unknown[]) => void);
      this.listeners.set(event, listeners);
      return this;
    }

    emit(event: string, ...args: unknown[]): void {
      for (const listener of this.listeners.get(event) ?? []) listener(...args);
    }

    async connect(
      _serverUrl?: string,
      _token?: string,
      options?: unknown,
    ): Promise<void> {
      this.connectOptions = options;
      if (this.connectError) throw this.connectError;
    }

    async disconnect(): Promise<void> {}
  }

  return {
    FakeRoom,
    instances,
    audioSources,
    capturedFrames,
    failNextConnect(error: Error) {
      nextConnectError = error;
    },
    holdNextPublishTrack() {
      let release = () => undefined;
      nextPublishTrackGate = new Promise<void>((resolve) => {
        release = resolve;
      });
      return release;
    },
    interruptNextCapture(callback: () => Promise<void>) {
      onCaptureFrame = async () => {
        onCaptureFrame = null;
        await callback();
      };
    },
    endNextAudioStream() {
      nextAudioStreamEnds = true;
    },
    pauseNextAudioStream() {
      nextAudioStreamPauses = true;
    },
    shouldPauseAudioStream() {
      const shouldPause = nextAudioStreamPauses;
      nextAudioStreamPauses = false;
      return shouldPause;
    },
    shouldEndAudioStream() {
      const shouldEnd = nextAudioStreamEnds;
      nextAudioStreamEnds = false;
      return shouldEnd;
    },
    async captureFrame() {
      await onCaptureFrame?.();
    },
  };
});

vi.mock("@livekit/rtc-node", () => ({
  AudioFrame: class {
    constructor(
      readonly data: Int16Array,
      readonly sampleRate: number,
      readonly channels: number,
      readonly samplesPerChannel: number,
    ) {}
  },
  AudioResampler: class {
    constructor(
      private readonly inputRate: number,
      private readonly outputRate: number,
      private readonly channels: number,
    ) {}
    push(frame: { data: Int16Array }): Array<{
      data: Int16Array;
      sampleRate: number;
      channels: number;
      samplesPerChannel: number;
    }> {
      const outputLength = Math.round(frame.data.length * this.outputRate / this.inputRate);
      return [{
        data: new Int16Array(outputLength),
        sampleRate: this.outputRate,
        channels: this.channels,
        samplesPerChannel: outputLength / this.channels,
      }];
    }
    flush(): never[] {
      return [];
    }
    close(): void {}
  },
  AudioResamplerQuality: { VERY_HIGH: 4 },
  AudioSource: class {
    constructor(sampleRate: number, channels: number, queueSizeMs: number) {
      liveKit.audioSources.push({ sampleRate, channels, queueSizeMs });
    }
    async captureFrame(frame: {
      sampleRate: number;
      channels: number;
      samplesPerChannel: number;
    }): Promise<void> {
      liveKit.capturedFrames.push({
        sampleRate: frame.sampleRate,
        channels: frame.channels,
        samplesPerChannel: frame.samplesPerChannel,
      });
      await liveKit.captureFrame();
    }
    clearQueue(): void {}
    async waitForPlayout(): Promise<void> {}
    async close(): Promise<void> {}
  },
  AudioStream: class {
    async *[Symbol.asyncIterator](): AsyncGenerator<{ data: Int16Array }> {
      if (liveKit.shouldPauseAudioStream()) {
        await new Promise<void>(() => undefined);
      }
      for (let index = 0; index < 10; index += 1) {
        yield { data: new Int16Array(320).fill(index % 2 === 0 ? 4_000 : -4_000) };
      }
      if (liveKit.shouldEndAudioStream()) return;
      await new Promise<void>(() => undefined);
    }
  },
  LocalAudioTrack: class {
    static createAudioTrack(): { close(): Promise<void> } {
      return { close: async () => undefined };
    }
  },
  RemoteAudioTrack: class {},
  Room: liveKit.FakeRoom,
  RoomEvent: {
    ParticipantConnected: "participantConnected",
    TrackSubscribed: "trackSubscribed",
    ParticipantDisconnected: "participantDisconnected",
    Reconnecting: "reconnecting",
    Reconnected: "reconnected",
    Disconnected: "disconnected",
    EncryptionError: "encryptionError",
    ParticipantEncryptionStatusChanged: "participantEncryptionStatusChanged",
    DataReceived: "dataReceived",
  },
  EncryptionType: { GCM: "gcm" },
  TrackKind: { KIND_AUDIO: "audio" },
  TrackPublishOptions: class { source?: string },
  TrackSource: { SOURCE_MICROPHONE: "microphone" },
}));

import {
  LiveKitVoiceBridge,
  LIVEKIT_E2EE_MEDIA_VERIFICATION_GRACE_MS,
  LIVEKIT_MOBILE_RECONNECT_GRACE_MS,
  type LiveKitVoiceBridgeDiagnostic,
  type LiveKitVoiceBridgeState,
} from "./livekit-voice-bridge";
import { CallDataCipher } from "./call-data-cipher";

const TEST_E2EE_KEY = new Uint8Array(32);

function createBridge(states: Array<{ state: LiveKitVoiceBridgeState; message?: string }>) {
  const errors: string[] = [];
  const diagnostics: LiveKitVoiceBridgeDiagnostic[] = [];
  const voiceSession = {
    state: "LISTENING",
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    endTurn: vi.fn(async () => undefined),
    pushAudio: vi.fn(),
    onSpeechFinished: vi.fn(async () => undefined),
  };
  const bridge = new LiveKitVoiceBridge({
    serverUrl: "wss://test.livekit.cloud",
    agentToken: "agent-token",
    mobileIdentity: "cyrene-mobile-test",
    vadSilenceMs: 1_000,
    vadThreshold: 0.01,
  }, {
    createVoiceSession: () => voiceSession as never,
    onError: (message) => errors.push(message),
    onDiagnostic: (event) => diagnostics.push(event),
    onStateChange: (state, message) => states.push({ state, ...(message ? { message } : {}) }),
  });
  return { bridge, voiceSession, errors, diagnostics };
}

function createEncryptedBridge(states: Array<{ state: LiveKitVoiceBridgeState; message?: string }>) {
  const diagnostics: LiveKitVoiceBridgeDiagnostic[] = [];
  const voiceSession = {
    state: "LISTENING",
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    endTurn: vi.fn(async () => undefined),
    pushAudio: vi.fn(),
    onSpeechFinished: vi.fn(async () => undefined),
  };
  const bridge = new LiveKitVoiceBridge({
    serverUrl: "wss://test.livekit.cloud",
    agentToken: "agent-token",
    mobileIdentity: "cyrene-mobile-test",
    vadSilenceMs: 1_000,
    vadThreshold: 0.01,
    e2eeKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
  }, {
    createVoiceSession: () => voiceSession as never,
    onDiagnostic: (event) => diagnostics.push(event),
    onStateChange: (state, message) => states.push({ state, ...(message ? { message } : {}) }),
  });
  return { bridge, voiceSession, diagnostics };
}

function createConversationBridge(
  states: Array<{ state: LiveKitVoiceBridgeState; message?: string }>,
  conversationCount = 1,
) {
  const diagnostics: LiveKitVoiceBridgeDiagnostic[] = [];
  const voiceSession = {
    state: "LISTENING",
    start: vi.fn(async () => undefined),
    stop: vi.fn(),
    endTurn: vi.fn(async () => undefined),
    pushAudio: vi.fn(),
    onSpeechFinished: vi.fn(async () => undefined),
  };
  const conversation = {
    id: "00000000-0000-4000-8000-000000000001",
    title: "晚间闲聊",
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 1 as const,
    turns: [],
  };
  let conversationMetas = Array.from({ length: conversationCount }, (_, index) => ({
    id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
    title: index === 0 ? conversation.title : `历史 ${index + 1}`,
    createdAt: index + 1,
    updatedAt: conversationCount - index,
    turnCount: 0,
    preview: "",
  }));
  let selected = false;
  const deleteConversation = vi.fn((id: string) => {
    if (selected && id === conversation.id) return "ACTIVE" as const;
    if (!conversationMetas.some((item) => item.id === id)) return "NOT_FOUND" as const;
    conversationMetas = conversationMetas.filter((item) => item.id !== id);
    return "DELETED" as const;
  });
  const bridge = new LiveKitVoiceBridge({
    serverUrl: "wss://test.livekit.cloud",
    agentToken: "agent-token",
    mobileIdentity: "cyrene-mobile-test",
    vadSilenceMs: 1_000,
    vadThreshold: 0.01,
    e2eeKey: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    requireConversationSelection: true,
  }, {
    createVoiceSession: () => voiceSession as never,
    conversations: {
      list: () => conversationMetas,
      create: vi.fn(() => conversation),
      select: vi.fn((id: string) => {
        selected = id === conversation.id;
        return selected ? conversation : null;
      }),
      rename: vi.fn(() => conversation),
      delete: deleteConversation,
      current: () => selected ? conversation : null,
    },
    onDiagnostic: (event) => diagnostics.push(event),
    onStateChange: (state, message) => states.push({ state, ...(message ? { message } : {}) }),
  });
  return {
    bridge,
    voiceSession,
    conversation,
    deleteConversation,
    diagnostics,
    mobileCipher: new CallDataCipher(TEST_E2EE_KEY, "mobile"),
  };
}

function sendMobileControl(
  room: InstanceType<typeof liveKit.FakeRoom>,
  mobile: { identity: string },
  control: Record<string, unknown>,
  cipher?: CallDataCipher,
): void {
  const plaintext = new TextEncoder().encode(JSON.stringify(control));
  room.emit(
    "dataReceived",
    cipher ? cipher.encrypt(plaintext) : plaintext,
    mobile,
    0,
    "cyrene.call.control",
  );
}

describe("LiveKitVoiceBridge lifecycle", () => {
  beforeEach(() => {
    liveKit.instances.length = 0;
    liveKit.audioSources.length = 0;
    liveKit.capturedFrames.length = 0;
    vi.clearAllMocks();
  });

  it("surfaces waiting, connected, reconnecting, recovered, and ended states", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge, voiceSession } = createBridge(states);

    await bridge.start();
    expect(liveKit.audioSources).toEqual([
      { sampleRate: 48_000, channels: 1, queueSizeMs: 200 },
    ]);
    const room = liveKit.instances[0];
    expect(states.map((entry) => entry.state)).toEqual(["connecting", "waiting-for-mobile"]);

    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantConnected", mobile);
    room.emit("reconnecting");
    room.emit("reconnected");
    await bridge.stop();

    expect(states.map((entry) => entry.state)).toEqual([
      "connecting",
      "waiting-for-mobile",
      "connected",
      "reconnecting",
      "connected",
      "ended",
    ]);
    expect(voiceSession.stop).toHaveBeenCalledOnce();
    expect(room.localParticipant.publishData).toHaveBeenCalled();
  });

  it("keeps a failed connection in the error terminal state", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge } = createBridge(states);
    liveKit.failNextConnect(new Error("network unavailable"));

    await expect(bridge.start()).rejects.toThrow("移动端通话连接失败");
    expect(states.at(-1)).toEqual({
      state: "error",
      message: "移动端通话连接失败：network unavailable",
    });
    expect(bridge.currentState).toBe("error");
  });

  it("does not report a formal call connected until the mobile participant is encrypted", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge } = createEncryptedBridge(states);

    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantConnected", mobile);
    expect(states.at(-1)?.state).toBe("waiting-for-mobile");

    room.emit("participantEncryptionStatusChanged", true, mobile);
    expect(states.at(-1)?.state).toBe("connected");
    expect(room.e2eeManager.setEnabled).toHaveBeenCalledWith(true);
  });

  it("passes rtc-node's required GCM encryption type before connecting", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge } = createEncryptedBridge(states);

    await bridge.start();

    expect(liveKit.instances[0].connectOptions).toMatchObject({
      encryption: {
        encryptionType: "gcm",
        keyProviderOptions: {
          sharedKey: expect.any(Uint8Array),
          ratchetSalt: expect.any(Uint8Array),
          ratchetWindowSize: 16,
          failureTolerance: -1,
          keyRingSize: 16,
          keyDerivationFunction: 0,
        },
      },
    });
  });

  it("keeps a GCM call alive when a new audio frame decrypts after a transient false status", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-28T15:00:00.000Z"));
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const {
      bridge,
      diagnostics,
      mobileCipher,
    } = createConversationBridge(states);

    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantEncryptionStatusChanged", true, mobile);
    room.emit(
      "trackSubscribed",
      { kind: "audio" },
      { encryptionType: "gcm" },
      mobile,
    );
    room.emit("participantEncryptionStatusChanged", false, mobile);
    sendMobileControl(room, mobile, { type: "conversation.list" }, mobileCipher);
    await vi.advanceTimersByTimeAsync(250);

    expect(bridge.isActive).toBe(true);
    expect(diagnostics).not.toContainEqual(expect.objectContaining({
      event: "BRIDGE_STOPPED",
    }));
    vi.useRealTimers();
  });

  it("ends a GCM-labelled call when no new audio frame can verify the transient status", async () => {
    vi.useFakeTimers();
    const { bridge, diagnostics } = createEncryptedBridge([]);
    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantEncryptionStatusChanged", true, mobile);
    liveKit.pauseNextAudioStream();
    room.emit(
      "trackSubscribed",
      { kind: "audio" },
      { encryptionType: "gcm" },
      mobile,
    );
    room.emit("participantEncryptionStatusChanged", false, mobile);

    await vi.advanceTimersByTimeAsync(
      LIVEKIT_E2EE_MEDIA_VERIFICATION_GRACE_MS - 1,
    );
    expect(bridge.isActive).toBe(true);
    await vi.advanceTimersByTimeAsync(1);

    expect(bridge.isActive).toBe(false);
    expect(diagnostics).toContainEqual({
      event: "BRIDGE_STOPPED",
      cause: "E2EE_PEER_NOT_ENCRYPTED",
    });
    vi.useRealTimers();
  });

  it("rejects a subscribed mobile audio publication that is not GCM", async () => {
    const { bridge, diagnostics } = createEncryptedBridge([]);
    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantEncryptionStatusChanged", true, mobile);
    room.emit(
      "trackSubscribed",
      { kind: "audio" },
      { encryptionType: "none" },
      mobile,
    );

    await vi.waitFor(() => expect(bridge.isActive).toBe(false));
    expect(diagnostics).toContainEqual({
      event: "BRIDGE_STOPPED",
      cause: "E2EE_PEER_NOT_ENCRYPTED",
    });
    vi.useRealTimers();
  });

  it("does not drop a microphone track subscribed while desktop startup is still publishing", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge, voiceSession } = createEncryptedBridge(states);
    const releasePublishTrack = liveKit.holdNextPublishTrack();

    const start = bridge.start();
    await vi.waitFor(() => {
      expect(liveKit.instances[0]?.localParticipant.publishTrack).toHaveBeenCalledOnce();
    });

    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("trackSubscribed", { kind: "audio" }, { encryptionType: "gcm" }, mobile);

    releasePublishTrack();
    await start;

    await vi.waitFor(() => {
      expect(voiceSession.pushAudio).toHaveBeenCalled();
    });
  });

  it("reopens the mobile audio stream when rtc-node ends it without disconnecting the call", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge, voiceSession } = createBridge(states);
    await bridge.start();
    liveKit.endNextAudioStream();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };

    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("trackSubscribed", { kind: "audio" }, { encryptionType: "gcm" }, mobile);

    await vi.waitFor(() => {
      expect(voiceSession.pushAudio.mock.calls.length).toBeGreaterThanOrEqual(20);
    });
  });

  it("keeps ASR closed until the mobile selects a persisted Voice Conversation", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const {
      bridge,
      voiceSession,
      conversation,
      mobileCipher,
    } = createConversationBridge(states);
    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantConnected", mobile);
    room.emit("trackSubscribed", { kind: "audio" }, { encryptionType: "gcm" }, mobile);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voiceSession.pushAudio).not.toHaveBeenCalled();

    sendMobileControl(room, mobile, {
      type: "conversation.select",
      conversationId: conversation.id,
    }, mobileCipher);
    room.emit("trackSubscribed", { kind: "audio" }, { encryptionType: "gcm" }, mobile);

    await vi.waitFor(() => {
      expect(voiceSession.pushAudio).toHaveBeenCalled();
    });
    const events = room.localParticipant.publishData.mock.calls
      .map(([payload]) => JSON.parse(new TextDecoder().decode(
        mobileCipher.decrypt(payload as Uint8Array),
      )) as { type: string });
    expect(events).toContainEqual(expect.objectContaining({ type: "conversation.catalog" }));
    expect(events).toContainEqual(expect.objectContaining({ type: "conversation.selected" }));
  });

  it("manual mode forwards only an explicitly opened turn and commits immediately", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const {
      bridge,
      voiceSession,
      conversation,
      mobileCipher,
    } = createConversationBridge(states);
    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantConnected", mobile);
    sendMobileControl(room, mobile, {
      type: "conversation.select",
      conversationId: conversation.id,
    }, mobileCipher);
    sendMobileControl(
      room,
      mobile,
      { type: "turn.mode", mode: "manual" },
      mobileCipher,
    );
    room.emit("trackSubscribed", { kind: "audio" }, { encryptionType: "gcm" }, mobile);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(voiceSession.pushAudio).not.toHaveBeenCalled();

    sendMobileControl(room, mobile, { type: "turn.begin" }, mobileCipher);
    room.emit("trackSubscribed", { kind: "audio" }, { encryptionType: "gcm" }, mobile);
    await vi.waitFor(() => {
      expect(voiceSession.pushAudio).toHaveBeenCalled();
    });
    sendMobileControl(room, mobile, { type: "turn.commit" }, mobileCipher);
    await vi.waitFor(() => {
      expect(voiceSession.endTurn).toHaveBeenCalledOnce();
    });
  });

  it("paginates conversation metadata within the reliable packet limit", async () => {
    const {
      bridge,
      mobileCipher,
    } = createConversationBridge([], 13);
    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };

    sendMobileControl(room, mobile, { type: "conversation.list" }, mobileCipher);
    await vi.waitFor(() => {
      expect(room.localParticipant.publishData.mock.calls.length).toBeGreaterThan(1);
    });
    const firstPage = room.localParticipant.publishData.mock.calls
      .map(([payload]) => JSON.parse(new TextDecoder().decode(
        mobileCipher.decrypt(payload as Uint8Array),
      )) as {
        type: string;
        conversations?: unknown[];
        replace?: boolean;
        nextCursor?: string;
      })
      .find((event) => event.type === "conversation.catalog");

    expect(firstPage).toMatchObject({
      replace: true,
      conversations: expect.any(Array),
      nextCursor: "00000000-0000-4000-8000-000000000012",
    });
    expect(firstPage?.conversations).toHaveLength(12);

    sendMobileControl(room, mobile, {
      type: "conversation.list",
      after: firstPage?.nextCursor,
    }, mobileCipher);
    await vi.waitFor(() => {
      const catalogs = room.localParticipant.publishData.mock.calls.filter(([payload]) => {
        const event = JSON.parse(new TextDecoder().decode(
          mobileCipher.decrypt(payload as Uint8Array),
        )) as { type: string };
        return event.type === "conversation.catalog";
      });
      expect(catalogs).toHaveLength(2);
    });
    const secondPage = JSON.parse(new TextDecoder().decode(
      mobileCipher.decrypt(
        room.localParticipant.publishData.mock.calls.at(-1)?.[0] as Uint8Array,
      ),
    )) as {
      conversations: unknown[];
      replace: boolean;
      nextCursor?: string;
    };
    expect(secondPage).toMatchObject({
      replace: false,
      conversations: expect.any(Array),
    });
    expect(secondPage.conversations).toHaveLength(1);
    expect(secondPage.nextCursor).toBeUndefined();
  });

  it("deletes an inactive conversation and republishes the catalog", async () => {
    const {
      bridge,
      deleteConversation,
      mobileCipher,
    } = createConversationBridge([]);
    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test" };
    const conversationId = "00000000-0000-4000-8000-000000000001";

    sendMobileControl(room, mobile, {
      type: "conversation.delete",
      conversationId,
    }, mobileCipher);

    await vi.waitFor(() => {
      expect(deleteConversation).toHaveBeenCalledExactlyOnceWith(conversationId);
    });
    const catalog = room.localParticipant.publishData.mock.calls
      .map(([payload]) => JSON.parse(new TextDecoder().decode(
        mobileCipher.decrypt(payload as Uint8Array),
      )) as { type: string; conversations?: unknown[] })
      .findLast((event) => event.type === "conversation.catalog");
    expect(catalog?.conversations).toEqual([]);
  });

  it("does not leave the call permanently speaking when rtc-node frame capture stalls", async () => {
    vi.useFakeTimers();
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge, voiceSession } = createBridge(states);
    await bridge.start();
    let releaseCapture = () => undefined;
    liveKit.interruptNextCapture(() => new Promise<void>((resolve) => {
      releaseCapture = resolve;
    }));
    const pcm = Buffer.alloc(640, 1);

    const playback = (bridge as unknown as {
      publishSynthesizedAudio(audio: Buffer, format: "wav"): Promise<void>;
    }).publishSynthesizedAudio(pcm16MonoToWav(pcm, 16_000), "wav");
    await vi.advanceTimersByTimeAsync(5_100);

    expect(voiceSession.onSpeechFinished).toHaveBeenCalledOnce();

    releaseCapture();
    await playback;
    vi.useRealTimers();
  });

  it("does not misreport a normal disconnect during synthesized playback as invalid WAV", async () => {
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge, errors } = createBridge(states);
    await bridge.start();
    liveKit.interruptNextCapture(() => bridge.stop());
    const pcm = Buffer.alloc(640, 1);

    await (bridge as unknown as {
      publishSynthesizedAudio(audio: Buffer, format: "wav"): Promise<void>;
    }).publishSynthesizedAudio(pcm16MonoToWav(pcm, 16_000), "wav");

    expect(errors).toEqual([]);
  });

  it("publishes synthesized speech as 20 ms 48 kHz mono frames", async () => {
    const { bridge } = createBridge([]);
    await bridge.start();
    const pcm = Buffer.alloc(640, 1);

    await (bridge as unknown as {
      publishSynthesizedAudio(audio: Buffer, format: "wav"): Promise<void>;
    }).publishSynthesizedAudio(pcm16MonoToWav(pcm, 16_000), "wav");

    expect(liveKit.capturedFrames).toEqual([
      { sampleRate: 48_000, channels: 1, samplesPerChannel: 960 },
    ]);
  });

  it("waits for a reconnect grace period before ending when the mobile participant leaves", async () => {
    vi.useFakeTimers();
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge, diagnostics } = createBridge(states);
    await bridge.start();
    const mobile = { identity: "cyrene-mobile-test", disconnectReason: 1 };

    liveKit.instances[0].emit("participantDisconnected", mobile);
    expect(states.at(-1)?.state).toBe("reconnecting");
    expect(diagnostics).toEqual([]);

    await vi.advanceTimersByTimeAsync(LIVEKIT_MOBILE_RECONNECT_GRACE_MS);
    expect(diagnostics).toContainEqual({
      event: "BRIDGE_STOPPED",
      cause: "MOBILE_PARTICIPANT_DISCONNECTED",
      disconnectReason: 1,
    });
    vi.useRealTimers();
  });

  it("keeps the call alive when the mobile participant returns within the grace period", async () => {
    vi.useFakeTimers();
    const states: Array<{ state: LiveKitVoiceBridgeState; message?: string }> = [];
    const { bridge, diagnostics } = createBridge(states);
    await bridge.start();
    const room = liveKit.instances[0];
    const mobile = { identity: "cyrene-mobile-test", disconnectReason: 1 };

    room.emit("participantDisconnected", mobile);
    room.remoteParticipants.set(mobile.identity, mobile);
    room.emit("participantConnected", mobile);
    await vi.advanceTimersByTimeAsync(LIVEKIT_MOBILE_RECONNECT_GRACE_MS);

    expect(bridge.isActive).toBe(true);
    expect(diagnostics).toEqual([]);
    vi.useRealTimers();
  });
});
