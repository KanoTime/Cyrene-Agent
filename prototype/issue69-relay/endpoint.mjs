import WebSocket from "ws";
import { HttpsProxyAgent } from "https-proxy-agent";
import { deriveRole, openEnvelope, sealEnvelope } from "./hpke.mjs";

const OWNER_ID = "issue69-owner";
const DESKTOP_ID = "issue69-desktop";
const MOBILE_ID = "issue69-mobile";

export class PrototypeEndpoint {
  constructor({ role, origin, runToken, sentinel }) {
    this.role = role;
    this.origin = origin.replace(/\/$/u, "");
    this.runToken = runToken;
    this.sentinel = sentinel;
    this.deviceId = role === "desktop" ? DESKTOP_ID : MOBILE_ID;
    this.peerDeviceId = role === "desktop" ? MOBILE_ID : DESKTOP_ID;
    this.socket = null;
    this.key = null;
    this.peerKey = null;
    this.wrongKey = null;
    this.epoch = "";
    this.sequence = 0;
    this.received = [];
    this.statuses = [];
    this.effects = new Map();
    this.retiredPeerEpochs = new Set();
    this.highestPeerSequenceByEpoch = new Map();
  }

  async prepare() {
    this.key = await deriveRole(this.role);
    this.peerKey = await deriveRole(this.role === "desktop" ? "mobile" : "desktop");
    this.wrongKey = await deriveRole("wrong");
  }

  async connect({ ticketOverride } = {}) {
    if (!this.key) await this.prepare();
    const ticket = ticketOverride ?? await this.#ticket();
    const wsOrigin = this.origin.replace(/^http/u, "ws");
    const proxyUrl = process.env.HTTPS_PROXY ?? process.env.https_proxy;
    const socketOptions = {
      headers: { "x-prototype-run-token": this.runToken },
      ...(wsOrigin.startsWith("wss:") && proxyUrl
        ? { agent: new HttpsProxyAgent(proxyUrl) }
        : {}),
    };
    const socket = new WebSocket(
      `${wsOrigin}/prototype/data/ws?ticket=${encodeURIComponent(ticket)}`,
      socketOptions,
    );
    await new Promise((resolve, reject) => {
      socket.once("open", resolve);
      socket.once("error", reject);
      socket.once("unexpected-response", (_request, response) => {
        reject(new Error(`WEBSOCKET_REJECTED_${response.statusCode}`));
      });
    });
    this.socket = socket;
    this.epoch = `epoch-${crypto.randomUUID()}`;
    this.sequence = 0;
    socket.on("message", async (data) => {
      const message = JSON.parse(data.toString());
      if (message.type === "relay_status") {
        this.statuses.push(message);
        return;
      }
      try {
        const inner = await openEnvelope({
          recipient: this.key,
          sender: this.peerKey,
          envelope: message,
        });
        if (this.retiredPeerEpochs.has(message.channelEpoch)) {
          throw new Error("ENDPOINT_EPOCH_RETIRED");
        }
        const peerSequenceKey = `${message.senderDeviceId}:${message.channelEpoch}`;
        const highestPeerSequence = this.highestPeerSequenceByEpoch.get(peerSequenceKey) ?? 0;
        if (message.senderSequence <= highestPeerSequence) {
          throw new Error("ENDPOINT_SEQUENCE_REPLAY");
        }
        this.highestPeerSequenceByEpoch.set(peerSequenceKey, message.senderSequence);
        const prior = this.effects.get(inner.operationId);
        if (!prior) this.effects.set(inner.operationId, inner);
        this.received.push({ envelope: message, inner, duplicate: Boolean(prior) });
      } catch (error) {
        this.received.push({
          envelope: message,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    });
    return ticket;
  }

  async createTicket() {
    return this.#ticket();
  }

  async send({
    operationId,
    kind = "chat_chunk",
    payload = { text: this.sentinel },
    sequence,
    wrongPeer = false,
    mutateOuter,
    transformEnvelope,
  }) {
    if (!this.socket || this.socket.readyState !== WebSocket.OPEN) {
      throw new Error("ENDPOINT_OFFLINE");
    }
    const nextSequence = sequence ?? this.sequence + 1;
    const outer = {
      protocolVersion: 1,
      ownerRoute: OWNER_ID,
      senderDeviceId: this.deviceId,
      targetDeviceId: this.peerDeviceId,
      channelEpoch: this.epoch,
      senderSequence: nextSequence,
      messageType: kind,
      operationId,
    };
    let envelope = await sealEnvelope({
      sender: this.key,
      recipient: wrongPeer ? this.wrongKey : this.peerKey,
      outer: mutateOuter ? mutateOuter(outer) : outer,
      inner: {
        messageId: `message-${operationId}`,
        operationId,
        kind,
        payload,
      },
    });
    if (transformEnvelope) envelope = transformEnvelope(envelope);
    this.socket.send(JSON.stringify(envelope));
    if (sequence === undefined) this.sequence = nextSequence;
    return envelope;
  }

  retirePeerEpoch(epoch) {
    this.retiredPeerEpochs.add(epoch);
  }

  close() {
    if (this.socket) this.socket.close(1000, "PROTOTYPE_CLIENT_CLOSE");
    this.socket = null;
  }

  async #ticket() {
    const response = await fetch(`${this.origin}/prototype/data/connect-ticket`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-prototype-run-token": this.runToken,
      },
      body: JSON.stringify({
        ownerId: OWNER_ID,
        deviceId: this.deviceId,
        peerDeviceId: this.peerDeviceId,
        deviceType: this.role === "desktop" ? "DESKTOP" : "MOBILE",
      }),
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.code ?? `TICKET_HTTP_${response.status}`);
    return body.ticket;
  }
}

export async function prototypePost(origin, runToken, pathname, body = {}) {
  const response = await fetch(`${origin}${pathname}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-prototype-run-token": runToken,
    },
    body: JSON.stringify(body),
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

export async function prototypeAudit(origin, runToken) {
  const response = await fetch(`${origin}/prototype/data/audit`, {
    headers: { "x-prototype-run-token": runToken },
  });
  const payload = await response.json();
  if (!response.ok) throw new Error(payload.code ?? `HTTP_${response.status}`);
  return payload;
}

export const PROTOTYPE_IDS = { owner: OWNER_ID, desktop: DESKTOP_ID, mobile: MOBILE_ID };
