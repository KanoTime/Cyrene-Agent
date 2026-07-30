// PROTOTYPE ONLY — standalone Android endpoint for Issue #69.
import { StatusBar } from "expo-status-bar";
import * as Crypto from "expo-crypto";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  Button,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";
import {
  deriveRole,
  openEnvelope,
  sealEnvelope,
  tamperCiphertext,
  verifyRfc9180AuthVector,
  type PrototypeRoleKey,
  type RelayEnvelope,
  type RelayOuter,
} from "./issue69-hpke";

const OWNER_ID = "issue69-owner";
const MOBILE_ID = "issue69-mobile";
const DESKTOP_ID = "issue69-desktop";
const PROTOTYPE_ORIGIN =
  "https://cyrene-issue69-e2ee-relay-prototype.cyrene-agent.workers.dev";

export default function Issue69RelayPrototypeApp(): React.JSX.Element {
  const [origin, setOrigin] = useState(PROTOTYPE_ORIGIN);
  const [runToken, setRunToken] = useState("");
  const [connection, setConnection] = useState("未连接");
  const [fingerprint, setFingerprint] = useState("尚未生成");
  const [logs, setLogs] = useState<string[]>([]);
  const [sentinel] = useState(() => `CYRENE_ISSUE69_ANDROID_${Crypto.randomUUID()}`);
  const socketRef = useRef<WebSocket | null>(null);
  const mobileKeyRef = useRef<PrototypeRoleKey | null>(null);
  const desktopKeyRef = useRef<PrototypeRoleKey | null>(null);
  const wrongKeyRef = useRef<PrototypeRoleKey | null>(null);
  const epochRef = useRef("");
  const previousEpochRef = useRef("");
  const sequenceRef = useRef(0);
  const highestIncomingRef = useRef(new Map<string, number>());
  const lastEnvelopeRef = useRef<RelayEnvelope | null>(null);
  const normalizedOrigin = useMemo(() => origin.trim().replace(/\/$/u, ""), [origin]);

  const append = useCallback((message: string) => {
    setLogs((current) => [
      `${new Date().toLocaleTimeString()} ${message}`,
      ...current,
    ].slice(0, 30));
  }, []);

  const prepareKeys = useCallback(async () => {
    const [mobile, desktop, wrong] = await Promise.all([
      deriveRole("mobile"),
      deriveRole("desktop"),
      deriveRole("wrong"),
    ]);
    mobileKeyRef.current = mobile;
    desktopKeyRef.current = desktop;
    wrongKeyRef.current = wrong;
    setFingerprint(mobile.fingerprint);
    return { mobile, desktop };
  }, []);

  const runVector = useCallback(async () => {
    try {
      const passed = await verifyRfc9180AuthVector();
      append(`RFC 9180 Auth 向量：${passed ? "通过" : "失败"}`);
    } catch (error) {
      append(`RFC 向量异常：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [append]);

  const connect = useCallback(async () => {
    try {
      const keys = mobileKeyRef.current && desktopKeyRef.current
        ? { mobile: mobileKeyRef.current, desktop: desktopKeyRef.current }
        : await prepareKeys();
      const response = await fetch(`${normalizedOrigin}/prototype/data/connect-ticket`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-prototype-run-token": runToken.trim(),
        },
        body: JSON.stringify({
          ownerId: OWNER_ID,
          deviceId: MOBILE_ID,
          peerDeviceId: DESKTOP_ID,
          deviceType: "MOBILE",
        }),
      });
      const body = await response.json() as { ticket?: string; code?: string };
      if (!response.ok || !body.ticket) throw new Error(body.code ?? `HTTP_${response.status}`);
      const wsOrigin = normalizedOrigin.replace(/^http/u, "ws");
      const socket = new WebSocket(
        `${wsOrigin}/prototype/data/ws?ticket=${encodeURIComponent(body.ticket)}`,
      );
      socket.onopen = () => {
        socketRef.current = socket;
        previousEpochRef.current = epochRef.current;
        epochRef.current = `android-${Crypto.randomUUID()}`;
        sequenceRef.current = 0;
        setConnection("已连接");
        append(`WebSocket 已连接；mobile fp=${keys.mobile.fingerprint}`);
      };
      socket.onerror = () => {
        setConnection("连接错误");
        append("WebSocket 连接错误");
      };
      socket.onclose = (event) => {
        if (socketRef.current === socket) socketRef.current = null;
        setConnection(`已关闭 ${event.code}`);
        append(`WebSocket 已关闭：${event.code} ${event.reason}`);
      };
      socket.onmessage = (event) => {
        void (async () => {
          const message = JSON.parse(String(event.data)) as RelayEnvelope & {
            type?: string;
            code?: string;
          };
          if (message.type === "relay_status") {
            append(`relay 状态：${message.code ?? "UNKNOWN"}`);
            return;
          }
          try {
            const inner = await openEnvelope(keys.mobile, keys.desktop, message);
            const highest = highestIncomingRef.current.get(message.channelEpoch) ?? -1;
            if (message.senderSequence <= highest) {
              append(`端点拒绝重放：${message.channelEpoch}/${message.senderSequence}`);
              return;
            }
            highestIncomingRef.current.set(message.channelEpoch, message.senderSequence);
            append(`端点解密成功：${JSON.stringify(inner)}`);
          } catch (error) {
            append(`端点拒绝密文：${error instanceof Error ? error.message : String(error)}`);
          }
        })();
      };
    } catch (error) {
      append(`连接失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [append, normalizedOrigin, prepareKeys, runToken]);

  const send = useCallback(async (
    mode: "small" | "large" | "wrong-key" | "tamper" | "old-epoch" = "small",
  ) => {
    const socket = socketRef.current;
    const mobile = mobileKeyRef.current;
    const desktop = desktopKeyRef.current;
    const wrong = wrongKeyRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !mobile || !desktop || !wrong) {
      append("发送失败：端点未连接");
      return;
    }
    try {
      sequenceRef.current += 1;
      const operationId = `android-op-${Crypto.randomUUID()}`;
      const large = mode === "large";
      const channelEpoch = mode === "old-epoch"
        ? previousEpochRef.current
        : epochRef.current;
      if (!channelEpoch) throw new Error("NO_PREVIOUS_EPOCH");
      const outer: RelayOuter = {
        protocolVersion: 1,
        ownerRoute: OWNER_ID,
        senderDeviceId: MOBILE_ID,
        targetDeviceId: DESKTOP_ID,
        channelEpoch,
        senderSequence: sequenceRef.current,
        messageType: large ? "conversation_page" : "chat_chunk",
        operationId,
      };
      let envelope = await sealEnvelope(
        mobile,
        mode === "wrong-key" ? wrong : desktop,
        outer,
        {
        messageId: `message-${operationId}`,
        operationId,
        kind: outer.messageType,
        payload: {
          text: large ? `${sentinel}:${"x".repeat(48 * 1024)}` : sentinel,
        },
      });
      if (mode === "tamper") envelope = tamperCiphertext(envelope);
      lastEnvelopeRef.current = envelope;
      socket.send(JSON.stringify(envelope));
      append(`已发送 ${mode} 密文：${operationId}`);
    } catch (error) {
      append(`加密/发送失败：${error instanceof Error ? error.message : String(error)}`);
    }
  }, [append, sentinel]);

  const replay = useCallback(() => {
    const socket = socketRef.current;
    const envelope = lastEnvelopeRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN || !envelope) {
      append("没有可重放的密文");
      return;
    }
    socket.send(JSON.stringify(envelope));
    append("已重放上一密文；预期 relay 或端点拒绝");
  }, [append]);

  const disconnect = useCallback(() => {
    socketRef.current?.close(1000, "ANDROID_PROTOTYPE_CLOSE");
    socketRef.current = null;
  }, []);

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.title}>Cyrene #69 Relay 原型</Text>
        <Text style={styles.warning}>仅使用假身份、假密钥与 Sentinel；禁止输入正式凭据。</Text>
        <TextInput
          value={origin}
          onChangeText={setOrigin}
          placeholder="https://隔离原型.workers.dev"
          placeholderTextColor="#778"
          autoCapitalize="none"
          style={styles.input}
        />
        <TextInput
          value={runToken}
          onChangeText={setRunToken}
          placeholder="一次原型运行 Token"
          placeholderTextColor="#778"
          autoCapitalize="none"
          secureTextEntry
          style={styles.input}
        />
        <View style={styles.state}>
          <Text style={styles.stateText}>状态：{connection}</Text>
          <Text style={styles.stateText}>Mobile 指纹：{fingerprint}</Text>
          <Text selectable style={styles.sentinel}>Sentinel：{sentinel}</Text>
        </View>
        <View style={styles.buttons}>
          <Button title="1. RFC 向量" onPress={() => { void runVector(); }} />
          <Button title="2. 连接" onPress={() => { void connect(); }} />
          <Button title="3. 发 Sentinel" onPress={() => { void send("small"); }} />
          <Button title="4. 发大帧" onPress={() => { void send("large"); }} />
          <Button title="5. 错 Key" onPress={() => { void send("wrong-key"); }} />
          <Button title="6. 篡改密文" onPress={() => { void send("tamper"); }} />
          <Button title="7. 旧 Epoch" onPress={() => { void send("old-epoch"); }} />
          <Button title="8. 重放" onPress={replay} />
          <Button title="断开" color="#b44" onPress={disconnect} />
        </View>
        <Text style={styles.logTitle}>端点可见状态</Text>
        {logs.map((line, index) => (
          <Text key={`${index}-${line}`} selectable style={styles.log}>{line}</Text>
        ))}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: "#0d1020" },
  content: { padding: 18, gap: 12 },
  title: { color: "#fff", fontSize: 24, fontWeight: "700" },
  warning: { color: "#ffcf70", lineHeight: 20 },
  input: {
    color: "#fff",
    borderColor: "#3e466d",
    borderWidth: 1,
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#171b31",
  },
  state: { backgroundColor: "#171b31", borderRadius: 8, padding: 12, gap: 6 },
  stateText: { color: "#d9def8" },
  sentinel: { color: "#85ddba", fontSize: 12 },
  buttons: { gap: 8 },
  logTitle: { color: "#fff", fontSize: 18, fontWeight: "600", marginTop: 8 },
  log: { color: "#c9cee8", fontFamily: "monospace", fontSize: 11, marginBottom: 4 },
});
