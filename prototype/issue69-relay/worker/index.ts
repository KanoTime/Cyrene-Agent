// PROTOTYPE ONLY — isolated Issue #69 ciphertext relay. Delete after the gate.

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
  delete(key: string): Promise<boolean>;
  deleteAll(): Promise<void>;
  list<T = unknown>(): Promise<Map<string, T>>;
  transaction<T>(
    callback: (transaction: Pick<DurableObjectStorage, "get" | "put" | "delete">) => Promise<T>,
  ): Promise<T>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
  blockConcurrencyWhile<T>(callback: () => Promise<T>): Promise<T>;
  acceptWebSocket(socket: WebSocket, tags?: string[]): void;
  getWebSockets(tag?: string): WebSocket[];
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

interface PrototypeEnv {
  ISSUE69_RELAY: DurableObjectNamespace;
  ISSUE69_PROTOTYPE_RUN_TOKEN: string;
}

interface TicketRecord {
  ownerId: string;
  deviceId: string;
  peerDeviceId: string;
  deviceType: "DESKTOP" | "MOBILE";
  expiresAt: number;
}

interface SocketAttachment extends TicketRecord {
  connectedAt: number;
  lastChannelEpoch?: string;
  lastSenderSequence?: number;
}

interface RelayMetrics {
  objectStarts: number;
  ticketsIssued: number;
  ticketsConsumed: number;
  socketsAccepted: number;
  framesReceived: number;
  framesForwarded: number;
  rejects: Record<string, number>;
  maxFrameBytes: number;
}

interface RelayEnvelope {
  protocolVersion: 1;
  ownerRoute: string;
  senderDeviceId: string;
  targetDeviceId: string;
  channelEpoch: string;
  senderSequence: number;
  messageType: string;
  operationId: string;
  encapsulatedKey: string;
  ciphertext: string;
}

declare class WebSocketPair {
  0: WebSocket;
  1: WebSocket;
}

const JSON_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};
const MAX_JSON_FRAME_BYTES = 96 * 1024;
const MAX_CIPHERTEXT_BYTES = 64 * 1024;
const TICKET_TTL_MS = 30_000;
const METRICS_KEY = "metrics";

const EMPTY_METRICS: RelayMetrics = {
  objectStarts: 0,
  ticketsIssued: 0,
  ticketsConsumed: 0,
  socketsAccepted: 0,
  framesReceived: 0,
  framesForwarded: 0,
  rejects: {},
  maxFrameBytes: 0,
};

export class Issue69RelayDurableObject {
  readonly #state: DurableObjectState;
  readonly #env: PrototypeEnv;

  constructor(state: DurableObjectState, env: PrototypeEnv) {
    this.#state = state;
    this.#env = env;
    state.blockConcurrencyWhile(async () => {
      const metrics = await state.storage.get<RelayMetrics>(METRICS_KEY)
        ?? structuredClone(EMPTY_METRICS);
      metrics.objectStarts = (metrics.objectStarts ?? 0) + 1;
      await state.storage.put(METRICS_KEY, metrics);
    });
  }

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/prototype/data/ws") {
      return this.#acceptSocket(request, url);
    }
    if (!await validRunToken(request, this.#env.ISSUE69_PROTOTYPE_RUN_TOKEN)) {
      return json(401, { code: "PROTOTYPE_AUTH_REQUIRED" });
    }
    if (request.method === "POST" && url.pathname === "/prototype/data/connect-ticket") {
      return this.#issueTicket(request);
    }
    if (request.method === "POST" && url.pathname === "/prototype/data/revoke") {
      return this.#revoke(request);
    }
    if (request.method === "POST" && url.pathname === "/prototype/data/reset") {
      return this.#reset();
    }
    if (request.method === "GET" && url.pathname === "/prototype/data/audit") {
      return this.#audit();
    }
    return json(404, { code: "NOT_FOUND" });
  }

  async webSocketMessage(socket: WebSocket, message: string | ArrayBuffer): Promise<void> {
    const attachment = socket.deserializeAttachment() as SocketAttachment | null;
    if (!attachment) {
      socket.close(1011, "ATTACHMENT_MISSING");
      return;
    }
    if (await this.#state.storage.get<boolean>(`revoked:${attachment.deviceId}`)) {
      await this.#reject(socket, "DEVICE_REVOKED");
      socket.close(4003, "DEVICE_REVOKED");
      return;
    }
    if (typeof message !== "string") {
      await this.#reject(socket, "TEXT_ENVELOPE_REQUIRED");
      return;
    }
    const frameBytes = new TextEncoder().encode(message).byteLength;
    if (frameBytes > MAX_JSON_FRAME_BYTES) {
      await this.#reject(socket, "FRAME_TOO_LARGE");
      return;
    }
    let envelope: RelayEnvelope;
    try {
      envelope = JSON.parse(message) as RelayEnvelope;
    } catch {
      await this.#reject(socket, "ENVELOPE_INVALID");
      return;
    }
    const rejection = validateEnvelope(envelope, attachment);
    if (rejection) {
      await this.#reject(socket, rejection);
      return;
    }
    if (base64urlDecodedLength(envelope.ciphertext) > MAX_CIPHERTEXT_BYTES) {
      await this.#reject(socket, "CIPHERTEXT_TOO_LARGE");
      return;
    }
    if (
      attachment.lastChannelEpoch === envelope.channelEpoch
      && typeof attachment.lastSenderSequence === "number"
      && envelope.senderSequence <= attachment.lastSenderSequence
    ) {
      await this.#reject(socket, "RELAY_SEQUENCE_REPLAY");
      return;
    }
    attachment.lastChannelEpoch = envelope.channelEpoch;
    attachment.lastSenderSequence = envelope.senderSequence;
    socket.serializeAttachment(attachment);

    const metrics = await this.#metrics();
    metrics.framesReceived += 1;
    metrics.maxFrameBytes = Math.max(metrics.maxFrameBytes, frameBytes);
    const targets = this.#state.getWebSockets(`device:${envelope.targetDeviceId}`)
      .filter((target) => target.readyState === 1);
    if (targets.length === 0) {
      await this.#state.storage.put(METRICS_KEY, metrics);
      socket.send(JSON.stringify({
        type: "relay_status",
        code: "TARGET_OFFLINE",
        operationId: envelope.operationId,
      }));
      return;
    }
    for (const target of targets) target.send(message);
    metrics.framesForwarded += 1;
    await this.#state.storage.put(METRICS_KEY, metrics);
    socket.send(JSON.stringify({
      type: "relay_status",
      code: "FORWARDED",
      operationId: envelope.operationId,
    }));
  }

  async webSocketClose(
    socket: WebSocket,
    code: number,
    reason: string,
    _wasClean: boolean,
  ): Promise<void> {
    if (socket.readyState < 2) socket.close(code, reason);
  }

  async #issueTicket(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (
      !body
      || !isSafeId(body.ownerId)
      || !isSafeId(body.deviceId)
      || !isSafeId(body.peerDeviceId)
      || (body.deviceType !== "DESKTOP" && body.deviceType !== "MOBILE")
      || body.deviceId === body.peerDeviceId
    ) {
      return json(400, { code: "TICKET_REQUEST_INVALID" });
    }
    if (await this.#state.storage.get<boolean>(`revoked:${body.deviceId}`)) {
      return json(403, { code: "DEVICE_REVOKED" });
    }
    const ticket = randomToken();
    const ticketHash = await sha256(ticket);
    const record: TicketRecord = {
      ownerId: body.ownerId,
      deviceId: body.deviceId,
      peerDeviceId: body.peerDeviceId,
      deviceType: body.deviceType,
      expiresAt: Date.now() + TICKET_TTL_MS,
    };
    await this.#state.storage.put(`ticket:${ticketHash}`, record);
    const metrics = await this.#metrics();
    metrics.ticketsIssued += 1;
    await this.#state.storage.put(METRICS_KEY, metrics);
    return json(200, { ticket, expiresAt: new Date(record.expiresAt).toISOString() });
  }

  async #acceptSocket(request: Request, url: URL): Promise<Response> {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") {
      return json(426, { code: "WEBSOCKET_UPGRADE_REQUIRED" });
    }
    const ticket = url.searchParams.get("ticket") ?? "";
    if (!/^[A-Za-z0-9_-]{40,}$/.test(ticket)) {
      return json(401, { code: "TICKET_INVALID" });
    }
    const ticketHash = await sha256(ticket);
    const record = await this.#state.storage.transaction(async (storage) => {
      const key = `ticket:${ticketHash}`;
      const value = await storage.get<TicketRecord>(key);
      if (value) await storage.delete(key);
      return value;
    });
    if (!record || record.expiresAt <= Date.now()) {
      return json(401, { code: "TICKET_EXPIRED_OR_CONSUMED" });
    }
    if (await this.#state.storage.get<boolean>(`revoked:${record.deviceId}`)) {
      return json(403, { code: "DEVICE_REVOKED" });
    }
    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    this.#state.acceptWebSocket(server, [
      `owner:${record.ownerId}`,
      `device:${record.deviceId}`,
      `type:${record.deviceType.toLowerCase()}`,
    ]);
    const attachment: SocketAttachment = { ...record, connectedAt: Date.now() };
    server.serializeAttachment(attachment);
    const metrics = await this.#metrics();
    metrics.ticketsConsumed += 1;
    metrics.socketsAccepted += 1;
    await this.#state.storage.put(METRICS_KEY, metrics);
    return new Response(null, {
      status: 101,
      webSocket: client,
    } as ResponseInit & { webSocket: WebSocket });
  }

  async #revoke(request: Request): Promise<Response> {
    const body = await readJson(request);
    if (!body || !isSafeId(body.deviceId)) {
      return json(400, { code: "REVOKE_REQUEST_INVALID" });
    }
    await this.#state.storage.put(`revoked:${body.deviceId}`, true);
    const sockets = this.#state.getWebSockets(`device:${body.deviceId}`);
    for (const socket of sockets) {
      if (socket.readyState === 1) {
        socket.send(JSON.stringify({ type: "relay_status", code: "REVOKED" }));
      }
      socket.close(4003, "DEVICE_REVOKED");
    }
    return json(200, { status: "REVOKED", closedSockets: sockets.length });
  }

  async #reset(): Promise<Response> {
    const sockets = this.#state.getWebSockets();
    for (const socket of sockets) socket.close(4000, "PROTOTYPE_RESET");
    await this.#state.storage.deleteAll();
    return json(200, { status: "RESET", closedSockets: sockets.length });
  }

  async #audit(): Promise<Response> {
    const values = await this.#state.storage.list();
    const storage = [...values.entries()].map(([key, value]) => ({
      keyCategory: key.split(":")[0],
      value,
    }));
    return json(200, {
      metrics: await this.#metrics(),
      activeSockets: this.#state.getWebSockets()
        .filter((socket) => socket.readyState === 1).length,
      storage,
    });
  }

  async #metrics(): Promise<RelayMetrics> {
    const stored = await this.#state.storage.get<RelayMetrics>(METRICS_KEY);
    return stored
      ? { ...structuredClone(EMPTY_METRICS), ...stored }
      : structuredClone(EMPTY_METRICS);
  }

  async #reject(socket: WebSocket, code: string): Promise<void> {
    const metrics = await this.#metrics();
    metrics.rejects[code] = (metrics.rejects[code] ?? 0) + 1;
    await this.#state.storage.put(METRICS_KEY, metrics);
    if (socket.readyState === 1) {
      socket.send(JSON.stringify({ type: "relay_status", code }));
    }
  }
}

export default {
  async fetch(request: Request, env: PrototypeEnv): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return json(200, { status: "ok", prototype: "issue69" });
    }
    if (!url.pathname.startsWith("/prototype/data/")) {
      return json(404, { code: "NOT_FOUND" });
    }
    try {
      const id = env.ISSUE69_RELAY.idFromName("issue69_owner");
      return await env.ISSUE69_RELAY.get(id).fetch(request);
    } catch {
      return json(503, { code: "PROTOTYPE_RELAY_UNAVAILABLE" });
    }
  },
};

function validateEnvelope(
  envelope: RelayEnvelope,
  attachment: SocketAttachment,
): string | null {
  if (
    envelope.protocolVersion !== 1
    || envelope.ownerRoute !== attachment.ownerId
    || envelope.senderDeviceId !== attachment.deviceId
    || envelope.targetDeviceId !== attachment.peerDeviceId
    || !isSafeId(envelope.channelEpoch)
    || !Number.isSafeInteger(envelope.senderSequence)
    || envelope.senderSequence < 0
    || !isSafeId(envelope.messageType)
    || !isSafeId(envelope.operationId)
    || !/^[A-Za-z0-9_-]{40,}$/.test(envelope.encapsulatedKey)
    || !/^[A-Za-z0-9_-]+$/.test(envelope.ciphertext)
  ) {
    return "ENVELOPE_BINDING_INVALID";
  }
  return null;
}

async function validRunToken(request: Request, expected: string): Promise<boolean> {
  const actual = request.headers.get("x-prototype-run-token") ?? "";
  if (!actual || !expected) return false;
  const [actualHash, expectedHash] = await Promise.all([sha256Bytes(actual), sha256Bytes(expected)]);
  if (actualHash.byteLength !== expectedHash.byteLength) return false;
  let difference = 0;
  for (let index = 0; index < actualHash.byteLength; index += 1) {
    difference |= actualHash[index] ^ expectedHash[index];
  }
  return difference === 0;
}

async function sha256(value: string): Promise<string> {
  const bytes = await sha256Bytes(value);
  return base64url(bytes);
}

async function sha256Bytes(value: string): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  ));
}

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return `p69_${base64url(bytes)}`;
}

function base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/u, "");
}

function base64urlDecodedLength(value: string): number {
  return Math.floor(value.length * 3 / 4);
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    const body = await request.json();
    return isRecord(body) ? body : null;
  } catch {
    return null;
  }
}

function isSafeId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_.:-]{1,80}$/.test(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function json(status: number, body: Record<string, unknown>): Response {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}
