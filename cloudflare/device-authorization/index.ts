import { CloudflareDeviceAuthorizationAggregateStore } from "../../src/main/remote-access/cloudflare-device-authorization-store";
import { createDeviceAuthorizationHttpHandler } from "../../src/main/remote-access/device-authorization-http";
import { LiveKitMediaGrantService } from "../../src/main/remote-access/livekit-media-grant-service";
import { parseMediaEnvelopeMasterKey } from "../../src/main/remote-access/media-grant-envelope";
import { PersistentDeviceAuthorizationModule } from "../../src/main/remote-access/persistent-device-authorization";

interface DurableObjectStorage {
  get<T = unknown>(key: string): Promise<T | undefined>;
  put<T = unknown>(key: string, value: T): Promise<void>;
}

interface DurableObjectState {
  storage: DurableObjectStorage;
}

interface DurableObjectStub {
  fetch(request: Request): Promise<Response>;
}

interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}

export interface Env {
  CYRENE_DEVICE_AUTHORIZATION: DurableObjectNamespace;
  CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN?: string;
  CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH: string;
  CYRENE_LIVEKIT_SERVER_URL: string;
  CYRENE_LIVEKIT_API_KEY: string;
  CYRENE_LIVEKIT_API_SECRET: string;
  CYRENE_MEDIA_ENVELOPE_MASTER_KEY: string;
}

const MAX_BODY_BYTES = 16 * 1024;
const RESPONSE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export class DeviceAuthorizationDurableObject {
  readonly #env: Env;
  readonly #authorization: PersistentDeviceAuthorizationModule;
  readonly #mediaGrantService: LiveKitMediaGrantService;
  readonly #handlers = new Map<
    string,
    ReturnType<typeof createDeviceAuthorizationHttpHandler>
  >();

  constructor(state: DurableObjectState, env: Env) {
    this.#env = env;
    this.#authorization = new PersistentDeviceAuthorizationModule({
      store: new CloudflareDeviceAuthorizationAggregateStore(state.storage),
    });
    this.#mediaGrantService = new LiveKitMediaGrantService({
      serverUrl: requireSecret(env.CYRENE_LIVEKIT_SERVER_URL),
      apiKey: requireSecret(env.CYRENE_LIVEKIT_API_KEY),
      apiSecret: requireSecret(env.CYRENE_LIVEKIT_API_SECRET),
      envelopeMasterKey: parseMediaEnvelopeMasterKey(
        requireSecret(env.CYRENE_MEDIA_ENVELOPE_MASTER_KEY),
      ),
    });
  }

  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return jsonResponse(405, { code: "METHOD_NOT_ALLOWED" });
    }
    if (
      !/^application\/json(?:\s*;|$)/i.test(
        request.headers.get("content-type") ?? "",
      )
    ) {
      return jsonResponse(415, { code: "CONTENT_TYPE_REQUIRED" });
    }
    const declaredLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(declaredLength) && declaredLength > MAX_BODY_BYTES) {
      return jsonResponse(413, { code: "REQUEST_BODY_TOO_LARGE" });
    }
    let rawBody: ArrayBuffer;
    try {
      rawBody = await request.arrayBuffer();
    } catch {
      return jsonResponse(400, { code: "REQUEST_BODY_INVALID" });
    }
    if (rawBody.byteLength > MAX_BODY_BYTES) {
      return jsonResponse(413, { code: "REQUEST_BODY_TOO_LARGE" });
    }
    let body: unknown;
    try {
      body = rawBody.byteLength === 0
        ? {}
        : JSON.parse(new TextDecoder().decode(rawBody));
    } catch {
      return jsonResponse(400, { code: "REQUEST_BODY_INVALID" });
    }
    if (!isRecord(body)) {
      return jsonResponse(400, { code: "REQUEST_BODY_INVALID" });
    }

    const url = new URL(request.url);
    const publicOrigin = resolvePublicOrigin(this.#env, url.origin);
    let handler = this.#handlers.get(publicOrigin);
    if (!handler) {
      handler = createDeviceAuthorizationHttpHandler({
        authorization: this.#authorization,
        publicOrigin,
        deploymentBootstrapCodeHash: requireSecret(
          this.#env.CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH,
        ),
        mediaGrantService: this.#mediaGrantService,
      });
      this.#handlers.set(publicOrigin, handler);
    }
    const result = await handler({
      method: "POST",
      pathname: url.pathname,
      authorization: request.headers.get("authorization") ?? undefined,
      body,
    });
    return jsonResponse(result.status, result.body);
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/healthz") {
      return jsonResponse(200, { status: "ok" });
    }
    if (!url.pathname.startsWith("/v1/")) {
      return jsonResponse(404, { code: "NOT_FOUND" });
    }
    try {
      const id = env.CYRENE_DEVICE_AUTHORIZATION.idFromName("owner_v1");
      return await env.CYRENE_DEVICE_AUTHORIZATION.get(id).fetch(request);
    } catch {
      return jsonResponse(503, { code: "CONTROL_PLANE_UNAVAILABLE" });
    }
  },
};

function resolvePublicOrigin(env: Env, requestOrigin: string): string {
  const configured = env.CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN?.trim();
  const candidate = configured || requestOrigin;
  const url = new URL(candidate);
  if (url.protocol !== "https:" || url.username || url.password) {
    throw new Error("CONTROL_PLANE_PUBLIC_ORIGIN_INVALID");
  }
  return url.origin;
}

function requireSecret(value: string | undefined): string {
  const normalized = value?.trim();
  if (!normalized) throw new Error("CONTROL_PLANE_CONFIG_REQUIRED");
  return normalized;
}

function jsonResponse(
  status: number,
  body: Record<string, unknown>,
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: RESPONSE_HEADERS,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
