import { tamperCiphertext, verifyRfc9180AuthVector } from "./hpke.mjs";
import {
  PROTOTYPE_IDS,
  PrototypeEndpoint,
  prototypeAudit,
  prototypePost,
} from "./endpoint.mjs";

const wait = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));
const waitUntil = async (predicate, timeoutMilliseconds = 5_000) => {
  const deadline = Date.now() + timeoutMilliseconds;
  while (Date.now() < deadline) {
    if (predicate()) return true;
    await wait(25);
  }
  return predicate();
};

export async function createScenario({
  origin,
  runToken,
  onState,
  offlineDurations = [100],
}) {
  const sentinel = `CYRENE_ISSUE69_SENTINEL_${crypto.randomUUID()}`;
  const desktop = new PrototypeEndpoint({ role: "desktop", origin, runToken, sentinel });
  const mobile = new PrototypeEndpoint({ role: "mobile", origin, runToken, sentinel });

  async function reset() {
    desktop.close();
    mobile.close();
    await prototypePost(origin, runToken, "/prototype/data/reset");
    onState?.("reset", { sentinel });
  }

  async function rfcVector() {
    const result = await verifyRfc9180AuthVector();
    onState?.("rfcVector", result);
    if (!result.passed) throw new Error("RFC9180_VECTOR_FAILED");
    return result;
  }

  async function connect() {
    const desktopTicket = await desktop.createTicket();
    await desktop.connect({ ticketOverride: desktopTicket });
    let replayRejected = false;
    try {
      const replay = new PrototypeEndpoint({ role: "desktop", origin, runToken, sentinel });
      await replay.connect({ ticketOverride: desktopTicket });
    } catch {
      replayRejected = true;
    }
    await mobile.connect();
    onState?.("connected", {
      desktopFingerprint: desktop.key.fingerprint,
      mobileFingerprint: mobile.key.fingerprint,
      replayRejected,
    });
    if (!replayRejected) throw new Error("TICKET_REPLAY_ACCEPTED");
  }

  async function roundTrip() {
    await mobile.send({ operationId: "op-roundtrip" });
    await waitUntil(() => desktop.received.some(
      (item) => item.inner?.operationId === "op-roundtrip",
    ));
    const received = desktop.received.find(
      (item) => item.inner?.operationId === "op-roundtrip",
    );
    const passed = received?.inner?.payload?.text === sentinel;
    onState?.("roundTrip", { passed, received: desktop.received.length });
    if (!passed) throw new Error("ROUND_TRIP_FAILED");
  }

  async function hibernationWake() {
    const idleMilliseconds = 12_500;
    await wait(idleMilliseconds);
    await mobile.send({ operationId: "op-hibernation-wake" });
    const passed = await waitUntil(() => desktop.received.some(
      (item) => item.inner?.operationId === "op-hibernation-wake",
    ));
    onState?.("hibernation", { idleMilliseconds, passed });
    if (!passed) throw new Error("HIBERNATION_WAKE_FAILED");
  }

  async function identityAndTamper() {
    const beforeWrongKey = desktop.received.length;
    await mobile.send({ operationId: "op-wrong-key", wrongPeer: true });
    await waitUntil(() => desktop.received.length > beforeWrongKey);
    const wrongKeyRejected = Boolean(desktop.received.at(-1)?.error);
    await mobile.send({
      operationId: "op-wrong-device",
      mutateOuter: (outer) => ({ ...outer, targetDeviceId: "issue69-wrong-target" }),
    });
    await waitUntil(() => mobile.statuses.some(
      (status) => status.code === "ENVELOPE_BINDING_INVALID",
    ));
    const bindingRejected = mobile.statuses.some(
      (status) => status.code === "ENVELOPE_BINDING_INVALID",
    );
    const beforeTamper = desktop.received.length;
    await mobile.send({
      operationId: "op-tampered-ciphertext",
      payload: { text: sentinel },
      transformEnvelope: tamperCiphertext,
    });
    await waitUntil(() => desktop.received.length > beforeTamper);
    const tamperRejected = Boolean(desktop.received.at(-1)?.error);
    onState?.("identity", { wrongKeyRejected, bindingRejected, tamperRejected });
    if (!wrongKeyRejected || !bindingRejected || !tamperRejected) {
      throw new Error("IDENTITY_GATE_FAILED");
    }
  }

  async function replayAndIdempotency() {
    const operationIds = Array.from(
      { length: 100 },
      (_, index) => `op-idempotent-${String(index).padStart(3, "0")}`,
    );
    let lastEnvelope;
    for (const operationId of operationIds) {
      lastEnvelope = await mobile.send({ operationId });
    }
    await waitUntil(
      () => operationIds.every((operationId) => desktop.effects.has(operationId)),
      10_000,
    );
    mobile.socket.send(JSON.stringify(lastEnvelope));
    await waitUntil(() => mobile.statuses.some(
      (status) => status.code === "RELAY_SEQUENCE_REPLAY",
    ));
    const relayReplayRejected = mobile.statuses.some(
      (status) => status.code === "RELAY_SEQUENCE_REPLAY",
    );
    const secondSocket = new PrototypeEndpoint({ role: "mobile", origin, runToken, sentinel });
    await secondSocket.connect();
    for (const operationId of operationIds.toReversed()) {
      await secondSocket.send({ operationId });
    }
    const idempotentDuplicates = await waitUntil(
      () => desktop.received.filter(
        (item) => item.duplicate && operationIds.includes(item.inner?.operationId),
      ).length === operationIds.length,
      10_000,
    );
    secondSocket.socket.send(JSON.stringify(lastEnvelope));
    const endpointReplayRejected = await waitUntil(() => desktop.received.some(
      (item) => item.error === "ENDPOINT_SEQUENCE_REPLAY",
    ));
    secondSocket.close();
    const effects = operationIds.filter((operationId) => desktop.effects.has(operationId)).length;
    onState?.("replay", {
      relayReplayRejected,
      endpointReplayRejected,
      idempotentDuplicates,
      authoritativeEffects: effects,
    });
    if (
      !relayReplayRejected
      || !endpointReplayRejected
      || !idempotentDuplicates
      || effects !== operationIds.length
    ) {
      throw new Error("REPLAY_GATE_FAILED");
    }
  }

  async function offlineRecovery() {
    const results = [];
    for (const [index, durationMilliseconds] of offlineDurations.entries()) {
      const suffix = String(index);
      let desktopReconnects = 0;
      const oldEpoch = mobile.epoch;
      mobile.close();
      await wait(durationMilliseconds);
      const offlineOperationId = `op-offline-${suffix}`;
      if (desktop.socket?.readyState !== 1) {
        await desktop.connect();
        desktopReconnects += 1;
      }
      await desktop.send({
        operationId: offlineOperationId,
        payload: { cursor: index * 10 + 7, text: sentinel },
      });
      const offline = await waitUntil(() => desktop.statuses.some(
        (status) => status.code === "TARGET_OFFLINE"
          && status.operationId === offlineOperationId,
      ));
      await mobile.connect();
      desktop.retirePeerEpoch(oldEpoch);
      await mobile.send({
        operationId: `op-old-epoch-${suffix}`,
        mutateOuter: (outer) => ({ ...outer, channelEpoch: oldEpoch }),
      });
      const oldEpochRejected = await waitUntil(() => desktop.received.some(
        (item) => item.error === "ENDPOINT_EPOCH_RETIRED"
          && item.envelope.operationId === `op-old-epoch-${suffix}`,
      ));
      if (desktop.socket?.readyState !== 1) {
        await desktop.connect();
        desktopReconnects += 1;
      }
      await desktop.send({
        operationId: offlineOperationId,
        payload: { cursor: index * 10 + 7, text: sentinel },
      });
      const outboxRecovered = await waitUntil(() => mobile.effects.has(offlineOperationId));
      const snapshotOperationId = `op-snapshot-${suffix}`;
      await desktop.send({
        operationId: snapshotOperationId,
        kind: "projection_snapshot",
        payload: { cursor: index * 10 + 8, text: sentinel },
      });
      const snapshotRecovered = await waitUntil(() => mobile.effects.has(snapshotOperationId));
      results.push({
        durationMilliseconds,
        desktopReconnects,
        offline,
        outboxRecovered,
        snapshotRecovered,
        oldEpochRejected,
        oldEpoch,
        newEpoch: mobile.epoch,
      });
    }
    const passed = results.every(
      (result) => result.offline
        && result.outboxRecovered
        && result.snapshotRecovered
        && result.oldEpochRejected,
    );
    onState?.("offline", {
      passed,
      results,
    });
    if (!passed) {
      throw new Error("OFFLINE_RECOVERY_FAILED");
    }
  }

  async function backpressure() {
    const chunk = `${sentinel}:${"x".repeat(48 * 1024)}`;
    let produced = 0;
    let maxBuffered = 0;
    let pauses = 0;
    while (produced < 10 * 1024 * 1024) {
      if (mobile.socket.bufferedAmount > 256 * 1024) {
        pauses += 1;
        await wait(10);
        continue;
      }
      await mobile.send({
        operationId: `op-backpressure-${produced}`,
        kind: "chat_chunk",
        payload: { text: chunk },
      });
      produced += chunk.length;
      maxBuffered = Math.max(maxBuffered, mobile.socket.bufferedAmount);
    }
    await waitUntil(() => mobile.socket.bufferedAmount === 0, 10_000);
    await mobile.send({
      operationId: "op-backpressure-drain",
      kind: "flow_control_probe",
      payload: { produced },
    });
    const drained = await waitUntil(() => desktop.effects.has("op-backpressure-drain"), 10_000);
    const passed = maxBuffered <= 1024 * 1024 && drained;
    onState?.("backpressure", { produced, maxBuffered, pauses, drained, passed });
    if (!passed) throw new Error("BACKPRESSURE_GATE_FAILED");
  }

  async function revoke() {
    const result = await prototypePost(origin, runToken, "/prototype/data/revoke", {
      deviceId: PROTOTYPE_IDS.mobile,
    });
    await wait(100);
    let reconnectRejected = false;
    try {
      const revoked = new PrototypeEndpoint({ role: "mobile", origin, runToken, sentinel });
      await revoked.connect();
    } catch {
      reconnectRejected = true;
    }
    onState?.("revoked", { ...result, reconnectRejected });
    if (!reconnectRejected) throw new Error("REVOKED_RECONNECT_ACCEPTED");
  }

  async function audit() {
    const result = await prototypeAudit(origin, runToken);
    const serialized = JSON.stringify(result);
    const sentinelAbsent = !serialized.includes(sentinel);
    const ciphertextAbsent = !result.storage.some(
      (entry) => entry.keyCategory === "ciphertext",
    );
    onState?.("audit", { ...result, sentinelAbsent, ciphertextAbsent });
    if (!sentinelAbsent || !ciphertextAbsent) throw new Error("STORAGE_PLAINTEXT_GATE_FAILED");
    return result;
  }

  async function runAll() {
    await reset();
    await rfcVector();
    await connect();
    await roundTrip();
    await hibernationWake();
    await identityAndTamper();
    await replayAndIdempotency();
    await offlineRecovery();
    await backpressure();
    await revoke();
    return audit();
  }

  return {
    sentinel,
    desktop,
    mobile,
    reset,
    rfcVector,
    connect,
    roundTrip,
    hibernationWake,
    identityAndTamper,
    replayAndIdempotency,
    offlineRecovery,
    backpressure,
    revoke,
    audit,
    runAll,
  };
}
