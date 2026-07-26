import { StatusBar } from "expo-status-bar";
import * as Linking from "expo-linking";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import {
  AudioSession,
  LiveKitRoom,
  RNE2EEManager,
  RNKeyProvider,
  useLocalParticipant,
  useRoomContext,
} from "@livekit/react-native";
import {
  Room,
  RoomEvent,
  type LocalParticipant,
  type LocalTrackPublication,
  type RemoteParticipant,
  type RemoteTrack,
  type RemoteTrackPublication,
} from "livekit-client";
import {
  loadMobileDeviceAuthorization,
  type StoredMobileDeviceAuthorization,
} from "./src/device-authorization-store";
import {
  claimMobilePairing,
  parseMobilePairingInvitation,
  readMobilePairingOutcome,
  type PendingMobilePairing,
} from "./src/device-pairing";
import { assertSupportedMobileEntryLink } from "./src/entry-link";
import {
  endRemoteVoiceCall,
  readRemoteVoiceCall,
  reportRemoteMediaReady,
  requestRemoteVoiceCall,
  takeRemoteMediaGrant,
  type RemoteMediaJoinGrant,
} from "./src/remote-call";
import { takeMediaGrantWhenReady } from "./src/media-grant-readiness";
import { reportMediaReadyWithRetry } from "./src/media-ready-retry";
import { monitorRemoteCallState } from "./src/remote-call-state-monitor";
import {
  mobileE2eeTransportPolicy,
  toNativeE2eeKeyMaterial,
} from "./src/e2ee-key-material";
import {
  enableE2eeBeforeConnect,
  observeEncryptedAudioPublication,
  type EncryptedAudioPublicationReadiness,
} from "./src/e2ee-session-readiness";
import { createCallTransportStateHandlers } from "./src/call-transport-state";
import { recoverUnexpectedRoomDisconnect } from "./src/unexpected-disconnect-recovery";

type EncryptedCallCredentials = RemoteMediaJoinGrant & { characterName?: string };

type CallEvent =
  | { type: "state"; state: string }
  | { type: "transcript"; partial?: string; final?: string }
  | { type: "error"; message: string }
  | { type: "bridge"; state: string };

const CALL_STATE_LABELS: Record<string, string> = {
  ASR: "正在聆听",
  THINKING: "Cyrene 正在思考…",
  SPEAKING: "Cyrene 正在说话…",
  LISTENING: "正在聆听",
  ERROR: "通话暂时出错",
  ENDED: "通话已结束",
};

function parseCallEvent(payload: Uint8Array): CallEvent | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    if (value.type === "state" && typeof value.state === "string") {
      return { type: "state", state: value.state };
    }
    if (value.type === "transcript") {
      return {
        type: "transcript",
        ...(typeof value.partial === "string" ? { partial: value.partial } : {}),
        ...(typeof value.final === "string" ? { final: value.final } : {}),
      };
    }
    if (value.type === "error" && typeof value.message === "string") {
      return { type: "error", message: value.message };
    }
    if (value.type === "bridge" && typeof value.state === "string") {
      return { type: "bridge", state: value.state };
    }
  } catch {
    // Ignore unrelated data packets in the shared media room.
  }
  return null;
}

function ActiveCall({
  onHangUp,
  onRemoteEndHint,
  characterName = "Cyrene",
  secureMediaReady = true,
}: {
  onHangUp: () => void;
  onRemoteEndHint?: () => void;
  characterName?: string;
  secureMediaReady?: boolean;
}): React.JSX.Element {
  const room = useRoomContext();
  const { isMicrophoneEnabled, localParticipant, lastMicrophoneError } = useLocalParticipant();
  const [callState, setCallState] = useState("正在连接语音通话…");
  const [transcript, setTranscript] = useState("");
  const secureMediaReadyRef = useRef(secureMediaReady);
  secureMediaReadyRef.current = secureMediaReady;

  useEffect(() => {
    const {
      onConnected,
      onReconnecting,
      onReconnected,
      onDisconnected,
    } = createCallTransportStateHandlers(secureMediaReadyRef, setCallState);
    const onData = (payload: Uint8Array, _participant: unknown, _kind: unknown, topic?: string) => {
      if (topic !== "cyrene.call.event") return;
      const event = parseCallEvent(payload);
      if (!event) return;
      if (event.type === "state") setCallState(CALL_STATE_LABELS[event.state] ?? event.state);
      if (event.type === "transcript") setTranscript(event.final ?? event.partial ?? "");
      if (event.type === "error") setCallState(`通话出错：${event.message}`);
      if (event.type === "bridge") {
        if (event.state === "connected" && secureMediaReady) {
          setCallState("正在聆听");
        }
        if (event.state === "reconnecting") setCallState("网络波动，正在自动重连…");
        if (event.state === "ended") {
          setCallState("正在确认通话状态…");
          onRemoteEndHint?.();
        }
      }
    };
    room.on(RoomEvent.Connected, onConnected);
    room.on(RoomEvent.SignalReconnecting, onReconnecting);
    room.on(RoomEvent.Reconnecting, onReconnecting);
    room.on(RoomEvent.Reconnected, onReconnected);
    room.on(RoomEvent.Disconnected, onDisconnected);
    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.Connected, onConnected);
      room.off(RoomEvent.SignalReconnecting, onReconnecting);
      room.off(RoomEvent.Reconnecting, onReconnecting);
      room.off(RoomEvent.Reconnected, onReconnected);
      room.off(RoomEvent.Disconnected, onDisconnected);
      room.off(RoomEvent.DataReceived, onData);
    };
  }, [onRemoteEndHint, room, secureMediaReady]);

  useEffect(() => {
    if (secureMediaReady) setCallState("正在聆听");
  }, [secureMediaReady]);

  useEffect(() => {
    if (lastMicrophoneError) {
      Alert.alert("无法打开麦克风", lastMicrophoneError.message);
    }
  }, [lastMicrophoneError]);

  const toggleMicrophone = useCallback(async () => {
    try {
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
    } catch (error) {
      Alert.alert("麦克风切换失败", error instanceof Error ? error.message : String(error));
    }
  }, [isMicrophoneEnabled, localParticipant]);

  const hangUp = useCallback(async () => {
    onHangUp();
  }, [onHangUp]);

  return (
    <View style={styles.callContainer}>
      <View style={styles.avatar} accessibilityLabel="Cyrene">
        <Text style={styles.avatarText}>C</Text>
      </View>
      <Text style={styles.characterName}>{characterName}</Text>
      <Text style={styles.callState}>{callState}</Text>
      {transcript ? <Text style={styles.transcript} numberOfLines={3}>{transcript}</Text> : null}
      <Text style={styles.hint}>通话由已配对的桌面端 Cyrene 处理。保持桌面端在线，才能继续对话。</Text>

      <View style={styles.controls}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={isMicrophoneEnabled ? "静音" : "打开麦克风"}
          onPress={() => void toggleMicrophone()}
          style={[styles.secondaryButton, isMicrophoneEnabled && styles.secondaryButtonActive]}
        >
          <Text style={styles.secondaryButtonText}>{isMicrophoneEnabled ? "静音" : "开麦"}</Text>
        </Pressable>
        <Pressable accessibilityRole="button" accessibilityLabel="挂断" onPress={() => void hangUp()} style={styles.hangUpButton}>
          <Text style={styles.hangUpButtonText}>挂断</Text>
        </Pressable>
      </View>
    </View>
  );
}

function CallRoom({
  credentials,
  onHangUp,
  onError,
  onSecureConnected,
  onRemoteEndHint,
}: {
  credentials: EncryptedCallCredentials;
  onHangUp: () => void;
  onError: (message: string) => void;
  onSecureConnected?: () => void;
  onRemoteEndHint?: () => void;
}): React.JSX.Element {
  return (
    <EncryptedCallRoom
      credentials={credentials}
      onHangUp={onHangUp}
      onError={onError}
      onSecureConnected={onSecureConnected}
      onRemoteEndHint={onRemoteEndHint}
    />
  );
}

function EncryptedCallRoom({
  credentials,
  onHangUp,
  onError,
  onSecureConnected,
  onRemoteEndHint,
}: {
  credentials: EncryptedCallCredentials;
  onHangUp: () => void;
  onError: (message: string) => void;
  onSecureConnected?: () => void;
  onRemoteEndHint?: () => void;
}): React.JSX.Element {
  const [{ room, keyProvider }] = useState(() => {
    const transportPolicy = mobileE2eeTransportPolicy();
    const provider = new RNKeyProvider({});
    const e2eeManager = new RNE2EEManager(
      provider,
      transportPolicy.dataChannelEncryption,
    );
    return {
      keyProvider: provider,
      room: new Room({
        [transportPolicy.roomOption]: { e2eeManager },
      }),
    };
  });
  const [e2eeReady, setE2eeReady] = useState(false);
  const [secureMediaReady, setSecureMediaReady] = useState(false);
  const secureConnectedReported = useRef(false);
  const intentionalHangUp = useRef(false);
  const mounted = useRef(true);
  const reconnecting = useRef(false);
  const publicationReadiness = useRef<EncryptedAudioPublicationReadiness>({
    localEncryptedAudioPublished: false,
    peerEncryptedAudioSubscribed: false,
  });

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        await keyProvider.setSharedKey(
          toNativeE2eeKeyMaterial(credentials.e2eeKey),
        );
      } catch {
        if (!cancelled) onError("E2EE_KEY_SETUP_FAILED");
        return;
      }
      try {
        await enableE2eeBeforeConnect(room);
        if (!cancelled) setE2eeReady(true);
      } catch {
        if (!cancelled) onError("E2EE_ENABLE_FAILED");
      }
    })();
    return () => {
      cancelled = true;
      void room.disconnect();
      keyProvider.dispose();
    };
  }, [credentials.e2eeKey, keyProvider, room]);

  const observeAudioPublication = useCallback((input: {
    participantIdentity: string;
    kind: string;
    isEncrypted: boolean;
    isSubscribed: boolean;
  }) => {
      const observed = observeEncryptedAudioPublication({
        current: publicationReadiness.current,
        localIdentity: credentials.participantIdentity,
        peerIdentity: credentials.peerIdentity,
        ...input,
      });
      publicationReadiness.current = observed.next;
      if (observed.verdict === "FAILED") {
        onError("E2EE_PUBLICATION_NOT_ENCRYPTED");
        return;
      }
      if (observed.verdict !== "READY") return;
      if (secureConnectedReported.current) return;
      secureConnectedReported.current = true;
      setSecureMediaReady(true);
      onSecureConnected?.();
  }, [
    credentials.participantIdentity,
    credentials.peerIdentity,
    onError,
    onSecureConnected,
  ]);

  const checkCurrentAudioPublications = useCallback(() => {
    room.localParticipant.audioTrackPublications.forEach((publication) => {
      observeAudioPublication({
        participantIdentity: room.localParticipant.identity,
        kind: publication.kind,
        isEncrypted: publication.isEncrypted,
        isSubscribed: false,
      });
    });
    const peer = room.remoteParticipants.get(credentials.peerIdentity);
    peer?.audioTrackPublications.forEach((publication) => {
      observeAudioPublication({
        participantIdentity: peer.identity,
        kind: publication.kind,
        isEncrypted: publication.isEncrypted,
        isSubscribed: publication.isSubscribed,
      });
    });
  }, [credentials.peerIdentity, observeAudioPublication, room]);

  useEffect(() => {
    const onLocalTrackPublished = (
      publication: LocalTrackPublication,
      participant: LocalParticipant,
    ) => {
      observeAudioPublication({
        participantIdentity: participant.identity,
        kind: publication.kind,
        isEncrypted: publication.isEncrypted,
        isSubscribed: false,
      });
    };
    const onTrackSubscribed = (
      track: RemoteTrack,
      publication: RemoteTrackPublication,
      participant: RemoteParticipant,
    ) => {
      observeAudioPublication({
        participantIdentity: participant.identity,
        kind: track.kind,
        isEncrypted: publication.isEncrypted,
        isSubscribed: true,
      });
    };
    room.on(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
    room.on(RoomEvent.TrackSubscribed, onTrackSubscribed);
    checkCurrentAudioPublications();
    return () => {
      room.off(RoomEvent.LocalTrackPublished, onLocalTrackPublished);
      room.off(RoomEvent.TrackSubscribed, onTrackSubscribed);
    };
  }, [checkCurrentAudioPublications, observeAudioPublication, room]);

  useEffect(() => {
    mounted.current = true;
    const onUnexpectedDisconnect = () => {
      if (intentionalHangUp.current || reconnecting.current || !mounted.current) return;
      reconnecting.current = true;
      setSecureMediaReady(false);
      secureConnectedReported.current = false;
      publicationReadiness.current = {
        localEncryptedAudioPublished: false,
        peerEncryptedAudioSubscribed: false,
      };
      void recoverUnexpectedRoomDisconnect({
        connect: () => room.connect(
          credentials.serverUrl,
          credentials.participantToken,
        ),
        enableMicrophone: () => room.localParticipant.setMicrophoneEnabled(true),
        isCancelled: () => intentionalHangUp.current || !mounted.current,
      }).then((outcome) => {
        reconnecting.current = false;
        if (outcome === "RECOVERED") {
          checkCurrentAudioPublications();
        }
        if (outcome === "FAILED" && mounted.current && !intentionalHangUp.current) {
          intentionalHangUp.current = true;
          onError("媒体连接失败");
        }
      });
    };
    room.on(RoomEvent.Disconnected, onUnexpectedDisconnect);
    return () => {
      mounted.current = false;
      room.off(RoomEvent.Disconnected, onUnexpectedDisconnect);
    };
  }, [
    credentials.participantToken,
    credentials.serverUrl,
    checkCurrentAudioPublications,
    onError,
    room,
  ]);

  const hangUpIntentionally = useCallback(() => {
    intentionalHangUp.current = true;
    onHangUp();
  }, [onHangUp]);

  if (!e2eeReady) {
    return (
      <View style={styles.callContainer}>
        <ActivityIndicator color="#f2ecff" />
        <Text style={styles.callState}>正在建立端到端加密…</Text>
      </View>
    );
  }
  return (
    <LiveKitRoom
      room={room}
      serverUrl={credentials.serverUrl}
      token={credentials.participantToken}
      connect
      audio
      video={false}
      onError={() => onError("媒体连接失败")}
      onEncryptionError={() => onError("E2EE_MEDIA_ERROR")}
      onMediaDeviceFailure={() =>
        onError("麦克风不可用，请在系统设置中允许 Cyrene Voice 使用麦克风。")}
    >
      <ActiveCall
        onHangUp={hangUpIntentionally}
        onRemoteEndHint={onRemoteEndHint}
        characterName={credentials.characterName}
        secureMediaReady={secureMediaReady}
      />
    </LiveKitRoom>
  );
}

export default function App(): React.JSX.Element {
  const [credentials, setCredentials] = useState<EncryptedCallCredentials | null>(null);
  const [pairedDevice, setPairedDevice] = useState<StoredMobileDeviceAuthorization | null>(null);
  const [pendingPairing, setPendingPairing] = useState<PendingMobilePairing | null>(null);
  const [pairingStatus, setPairingStatus] = useState("");
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [scannerLocked, setScannerLocked] = useState(false);
  const [cameraPermission, requestCameraPermission] = useCameraPermissions();
  const callActiveRef = useRef(false);
  const remoteCallIdRef = useRef<string | null>(null);
  const mediaReadyReportGenerationRef = useRef(0);

  const clearLocalCall = useCallback(() => {
    mediaReadyReportGenerationRef.current += 1;
    remoteCallIdRef.current = null;
    callActiveRef.current = false;
    setCredentials(null);
    void AudioSession.stopAudioSession();
  }, []);

  const endCall = useCallback(() => {
    const callId = remoteCallIdRef.current;
    clearLocalCall();
    if (callId && pairedDevice) {
      void endRemoteVoiceCall(pairedDevice, callId).catch(() => undefined);
    }
  }, [clearLocalCall, pairedDevice]);

  const finalizeRemoteEndedCall = useCallback((call: {
    callId: string;
    terminationReason?: string;
  }) => {
    if (remoteCallIdRef.current !== call.callId) return;
    const messages: Record<string, string> = {
      CALLER_CANCELLED: "通话已取消。",
      PARTICIPANT_HUNG_UP: "桌面端已结束通话。",
      DESKTOP_CONFIRM_TIMEOUT: "桌面未能及时确认通话。",
      DESKTOP_UNAVAILABLE: "桌面当前已不可接听，通话已结束。",
      MEDIA_CONNECT_TIMEOUT: "加密媒体未能在时限内完成连接，通话已安全终止。",
      MEDIA_CAPACITY_UNAVAILABLE: "媒体服务当前没有可用容量。",
      RECONNECT_TIMEOUT: "媒体网络未能恢复，通话已结束。",
      E2EE_REQUIRED: "端到端加密验证失败，通话已安全终止。",
      DEVICE_REVOKED: "这台设备的授权已被撤销，通话已结束。",
      AUTHORIZATION_REBOOTSTRAP: "设备授权已重建，请重新配对。",
      BACKGROUND_TIMEOUT: "Cyrene Voice 在后台停留过久，通话已结束。",
      IDLE_TIMEOUT: "长时间没有语音交互，通话已结束。",
      MAX_DURATION: "通话已达到最长时限。",
      RUNTIME_FAILURE_LIMIT: "桌面语音运行时连续失败，通话已结束。",
    };
    setError(
      messages[call.terminationReason ?? ""]
      ?? `通话已结束${call.terminationReason ? `（${call.terminationReason}）` : "。"}`,
    );
    clearLocalCall();
  }, [clearLocalCall]);

  const reconcileRemoteCallState = useCallback(async () => {
    const callId = remoteCallIdRef.current;
    if (!callId || !pairedDevice || !callActiveRef.current) return;
    try {
      const call = await readRemoteVoiceCall(pairedDevice, callId);
      if (call.phase === "ENDED") finalizeRemoteEndedCall(call);
    } catch {
      // A LiveKit hint is advisory. The regular control-plane monitor retries.
    }
  }, [finalizeRemoteEndedCall, pairedDevice]);

  const reportSecureMediaReady = useCallback(() => {
    const callId = remoteCallIdRef.current;
    if (!callId || !pairedDevice) {
      setError("无法确认端到端加密媒体已就绪，通话已安全终止。");
      endCall();
      return;
    }
    const generation = ++mediaReadyReportGenerationRef.current;
    void reportMediaReadyWithRetry(
      async (signal) => {
        await reportRemoteMediaReady(pairedDevice, callId, { signal });
      },
      {
        maxAttempts: 8,
        attemptTimeoutMs: 2_000,
        retryDelayMs: 400,
      },
    ).catch(() => {
      if (mediaReadyReportGenerationRef.current !== generation) return;
      setError("无法确认端到端加密媒体已就绪，通话已安全终止。");
      endCall();
    });
  }, [endCall, pairedDevice]);

  const beginRemoteCall = useCallback(async () => {
    if (!pairedDevice || starting || callActiveRef.current) return;
    setStarting(true);
    setError(null);
    try {
      const requested = await requestRemoteVoiceCall(pairedDevice);
      if (requested.status === "REJECTED") {
        const messages: Record<string, string> = {
          DESKTOP_UNAVAILABLE: "桌面当前不可接听，请确认 Cyrene 已登录且处于就绪状态。",
          OWNER_BUSY: "当前已有一通电话，不能排队或自动改呼。",
          DEVICE_NOT_AUTHORIZED: "这台手机的授权已失效，请重新配对。",
          COST_PROTECTION: "控制面已进入成本保护，暂时不能发起新通话。",
          MEDIA_CAPACITY_UNAVAILABLE: "媒体服务当前没有可用容量。",
        };
        setError(messages[requested.reason] ?? "当前无法开始通话。");
        return;
      }
      remoteCallIdRef.current = requested.call.callId;
      const deadline = Date.now() + 12_000;
      let call = requested.call;
      while (Date.now() < deadline) {
        if (call.phase === "CONNECTING_MEDIA") {
          const grant = await takeMediaGrantWhenReady(
            () => takeRemoteMediaGrant(pairedDevice, call.callId),
          );
          await AudioSession.startAudioSession();
          callActiveRef.current = true;
          setCredentials({ ...grant, characterName: call.characterName });
          return;
        }
        if (call.phase === "ENDED") {
          throw new Error(call.terminationReason ?? "DESKTOP_UNAVAILABLE");
        }
        await new Promise((resolve) => setTimeout(resolve, 700));
        call = await readRemoteVoiceCall(pairedDevice, call.callId);
      }
      throw new Error("DESKTOP_CONFIRM_TIMEOUT");
    } catch (callError) {
      const message = callError instanceof Error ? callError.message : String(callError);
      const messages: Record<string, string> = {
        DESKTOP_CONFIRM_TIMEOUT: "桌面未能在 10 秒内就绪。",
        DESKTOP_UNAVAILABLE: "桌面当前不可接听。",
        MEDIA_GRANT_NOT_AVAILABLE: "媒体授权未能及时准备完成，通话已安全终止。",
        E2EE_REQUIRED: "无法通过加入前的端到端加密校验，通话已安全终止（PRECONNECT）。",
      };
      setError(messages[message] ?? `呼叫失败：${message}`);
      const callId = remoteCallIdRef.current;
      remoteCallIdRef.current = null;
      if (callId) void endRemoteVoiceCall(pairedDevice, callId).catch(() => undefined);
      void AudioSession.stopAudioSession();
    } finally {
      setStarting(false);
    }
  }, [pairedDevice, starting]);

  const beginFromLink = useCallback(async (url: string) => {
    if (callActiveRef.current) {
      setError("当前已有一通语音通话，请先挂断后再使用新的配对链接。");
      return;
    }

    setStarting(true);
    setError(null);
    try {
      assertSupportedMobileEntryLink(url);
      const invitation = parseMobilePairingInvitation(url);
      const pending = await claimMobilePairing(invitation, "Android 手机");
      setPendingPairing(pending);
      setPairingStatus("等待桌面确认");
    } catch (startError) {
      setError(startError instanceof Error ? startError.message : String(startError));
      void AudioSession.stopAudioSession();
    } finally {
      setStarting(false);
    }
  }, []);

  useEffect(() => {
    void loadMobileDeviceAuthorization()
      .then(setPairedDevice)
      .catch(() => setError("无法读取设备安全存储，请重新启动应用后再试。"));
  }, []);

  useEffect(() => {
    if (!pendingPairing) return;
    let stopped = false;
    const poll = async () => {
      if (Date.parse(pendingPairing.expiresAt) <= Date.now()) {
        if (!stopped) {
          setPendingPairing(null);
          setError("长期配对邀请已过期，请回到桌面端重新生成。");
        }
        return;
      }
      try {
        const outcome = await readMobilePairingOutcome(pendingPairing);
        if (stopped) return;
        if (outcome.status === "CLAIMED") {
          setPairingStatus("等待桌面确认");
          return;
        }
        if (outcome.status === "APPROVED") {
          const stored = await loadMobileDeviceAuthorization();
          if (stopped) return;
          setPairedDevice(stored);
          setPendingPairing(null);
          setPairingStatus("");
          return;
        }
        const messages: Record<string, string> = {
          REJECTED: "桌面已拒绝这次配对。",
          EXPIRED: "长期配对邀请已过期，请重新生成。",
          INVALIDATED: "桌面已生成新的配对邀请，这个邀请不再有效。",
          ATTEMPT_LIMITED: "短码错误次数过多，请在桌面端重新生成邀请。",
        };
        setPendingPairing(null);
        setError(messages[outcome.status] ?? "长期配对未完成。");
      } catch {
        if (!stopped) setPairingStatus("网络暂时不可用，恢复后会继续确认");
      }
    };
    void poll();
    const timer = setInterval(() => void poll(), 1_500);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [pendingPairing]);

  useEffect(() => {
    const callId = remoteCallIdRef.current;
    if (!credentials || !pairedDevice || !callId) return;
    let stopped = false;
    void monitorRemoteCallState({
      read: () => readRemoteVoiceCall(pairedDevice, callId),
      isCurrent: () =>
        !stopped
        && callActiveRef.current
        && remoteCallIdRef.current === callId,
      onEnded: finalizeRemoteEndedCall,
    });
    return () => {
      stopped = true;
    };
  }, [credentials, finalizeRemoteEndedCall, pairedDevice]);

  useEffect(() => {
    const consume = (url: string | null) => {
      if (url) void beginFromLink(url);
    };
    void Linking.getInitialURL().then(consume).catch(() => undefined);
    const subscription = Linking.addEventListener("url", ({ url }) => consume(url));
    return () => subscription.remove();
  }, [beginFromLink]);

  const openScanner = useCallback(async () => {
    setError(null);
    if (!cameraPermission?.granted) {
      const permission = await requestCameraPermission();
      if (!permission.granted) {
        setError("需要相机权限才能扫描桌面端的配对二维码。");
        return;
      }
    }
    setScannerLocked(false);
    setScannerOpen(true);
  }, [cameraPermission?.granted, requestCameraPermission]);

  const onBarcodeScanned = useCallback(({ data }: { data: string }) => {
    if (scannerLocked) return;
    setScannerLocked(true);
    setScannerOpen(false);
    void beginFromLink(data);
  }, [beginFromLink, scannerLocked]);

  if (credentials) {
    return (
      <CallRoom
        credentials={credentials}
        onHangUp={endCall}
        onSecureConnected={reportSecureMediaReady}
        onRemoteEndHint={() => void reconcileRemoteCallState()}
        onError={(message) => {
          const messages: Record<string, string> = {
            E2EE_KEY_SETUP_FAILED:
              "无法写入端到端加密密钥，通话已安全终止（KEY_SETUP）。",
            E2EE_GRANT_IDENTITY_INVALID:
              "媒体授权缺少加密参与者身份，通话已安全终止（PRECONNECT）。",
            E2EE_ENABLE_FAILED:
              "无法启用端到端媒体加密，通话已安全终止（ENABLE）。",
            E2EE_PUBLICATION_NOT_ENCRYPTED:
              "发现未加密的通话音轨，通话已安全终止（PUBLICATION_VERIFY）。",
            E2EE_MEDIA_ERROR:
              "端到端媒体解密失败，通话已安全终止（MEDIA_CRYPTOR）。",
          };
          setError(messages[message] ?? message);
          endCall();
        }}
      />
    );
  }

  if (scannerOpen) {
    return (
      <SafeAreaView style={styles.scannerContainer}>
        <StatusBar style="light" />
        <CameraView
          facing="back"
          barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
          onBarcodeScanned={scannerLocked ? undefined : onBarcodeScanned}
          style={styles.scanner}
        />
        <View style={styles.scannerOverlay}>
          <Text style={styles.scannerTitle}>扫描桌面端二维码</Text>
          <Text style={styles.scannerHint}>支持长期设备配对和 Beta 0 通话二维码。请勿转发给他人。</Text>
          <Pressable accessibilityRole="button" onPress={() => setScannerOpen(false)} style={styles.secondaryButton}>
            <Text style={styles.secondaryButtonText}>取消</Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  if (pendingPairing) {
    return (
      <SafeAreaView style={styles.container}>
        <StatusBar style="light" />
        <View style={styles.landing}>
          <View style={styles.pairingMark} accessibilityLabel="等待桌面确认">
            <Text style={styles.pairingMarkText}>✓</Text>
          </View>
          <Text style={styles.title}>在桌面确认配对</Text>
          <Text style={styles.subtitle}>确认手机和桌面显示的是同一组数字，再在桌面点击“批准设备”。</Text>
          <Text accessibilityLabel={`配对校验码 ${pendingPairing.verificationCode}`} style={styles.verificationCode}>
            {pendingPairing.verificationCode}
          </Text>
          <Text accessibilityLiveRegion="polite" style={styles.callState}>{pairingStatus}</Text>
          <Text style={styles.privacy}>批准前，这台手机没有设备身份，也不能读取角色、设备或呼叫状态。</Text>
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar style="light" />
      <View style={styles.landing}>
        <View style={styles.avatar} accessibilityLabel="Cyrene">
          <Text style={styles.avatarText}>C</Text>
        </View>
        <Text style={styles.title}>和 Cyrene 通话</Text>
        <Text style={styles.subtitle}>
          {pairedDevice ? "这台手机已完成长期配对" : "首次使用先与桌面完成长期配对"}
        </Text>
        <Text style={pairedDevice ? styles.pairedStatus : styles.privacy}>
          {pairedDevice
            ? "设备凭据已保存在 Android 安全存储中。普通升级不会要求重新配对。"
            : "扫码后仍需在现有桌面明确批准。角色、记忆、模型和 TTS 密钥始终留在桌面端。"}
        </Text>

        {error ? <Text accessibilityRole="alert" style={styles.error}>{error}</Text> : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={pairedDevice ? "呼叫 Cyrene" : "扫描桌面端二维码"}
          disabled={starting}
          onPress={() => void (pairedDevice ? beginRemoteCall() : openScanner())}
          style={[styles.scanButton, starting && styles.disabledButton]}
        >
          {starting ? <ActivityIndicator color="#f2ecff" /> : <Text style={styles.scanButtonText}>
            {pairedDevice ? "呼叫 Cyrene" : "扫描配对二维码"}
          </Text>}
        </Pressable>
        {pairedDevice ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="扫描备用通话二维码"
            disabled={starting}
            onPress={() => void openScanner()}
            style={styles.secondaryButton}
          >
            <Text style={styles.secondaryButtonText}>扫码备用</Text>
          </Pressable>
        ) : null}
        <Text style={styles.smallHint}>
          {pairedDevice
            ? "一键呼叫只在应用前台建立强制 E2EE；桌面不可用时立即拒绝，不排队或自动改呼。"
            : "配对邀请 2 分钟有效；二维码只建立候选，不会自动授权。"}
        </Text>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#130d2a" },
  scannerContainer: { flex: 1, backgroundColor: "#130d2a" },
  scanner: { flex: 1 },
  scannerOverlay: { alignItems: "center", gap: 12, padding: 24, backgroundColor: "#130d2a" },
  scannerTitle: { color: "#fff", fontSize: 20, fontWeight: "700" },
  scannerHint: { color: "#cabfe8", fontSize: 13, textAlign: "center" },
  landing: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28 },
  callContainer: { flex: 1, alignItems: "center", justifyContent: "center", padding: 28, backgroundColor: "#130d2a" },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 56,
    backgroundColor: "#c84bd6",
    borderWidth: 4,
    borderColor: "#f4b9ff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#e26bff",
    shadowOpacity: 0.7,
    shadowRadius: 16,
    elevation: 8,
  },
  avatarText: { color: "#fff", fontSize: 46, fontWeight: "700" },
  pairingMark: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: "#3e315f",
    borderWidth: 2,
    borderColor: "#9d86d4",
    alignItems: "center",
    justifyContent: "center",
  },
  pairingMarkText: { color: "#bba7ed", fontSize: 38, fontWeight: "700" },
  title: { color: "#fff", fontSize: 29, fontWeight: "700", marginTop: 28 },
  characterName: { color: "#fff", fontSize: 28, fontWeight: "700", marginTop: 24 },
  subtitle: { color: "#cabfe8", fontSize: 16, marginTop: 10, textAlign: "center" },
  callState: { color: "#88efbb", fontSize: 18, marginTop: 12, textAlign: "center" },
  transcript: { color: "#e6defa", fontSize: 16, lineHeight: 24, marginTop: 22, textAlign: "center", maxWidth: 340 },
  privacy: { color: "#a99fc3", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 30, maxWidth: 340 },
  pairedStatus: { color: "#9ce8bd", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 24, maxWidth: 340 },
  verificationCode: { color: "#fff", fontSize: 38, fontWeight: "700", letterSpacing: 5, marginTop: 32 },
  hint: { color: "#a99fc3", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 20, maxWidth: 330 },
  smallHint: { color: "#82799f", fontSize: 12, lineHeight: 18, textAlign: "center", marginTop: 16, maxWidth: 330 },
  error: { color: "#ff9eaf", fontSize: 14, lineHeight: 21, textAlign: "center", marginTop: 16, maxWidth: 340 },
  scanButton: { borderWidth: 1, borderColor: "#9d86d4", borderRadius: 28, paddingHorizontal: 28, minWidth: 210, minHeight: 52, alignItems: "center", justifyContent: "center", marginTop: 20 },
  scanButtonText: { color: "#f2ecff", fontSize: 16, fontWeight: "600" },
  disabledButton: { opacity: 0.5 },
  controls: { flexDirection: "row", gap: 18, marginTop: 44 },
  secondaryButton: { minWidth: 100, paddingVertical: 14, borderRadius: 24, borderWidth: 1, borderColor: "#afa0dd", alignItems: "center" },
  secondaryButtonActive: { backgroundColor: "#4d3c78" },
  secondaryButtonText: { color: "#fff", fontSize: 16, fontWeight: "600" },
  hangUpButton: { minWidth: 100, paddingVertical: 14, borderRadius: 24, backgroundColor: "#dc4c62", alignItems: "center" },
  hangUpButtonText: { color: "#fff", fontSize: 16, fontWeight: "700" },
});
