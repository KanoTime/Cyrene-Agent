import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import { CloudflareDeviceAuthorizationAggregateStore } from "../../src/main/remote-access/cloudflare-device-authorization-store";
import { PersistentDeviceAuthorizationModule } from "../../src/main/remote-access/persistent-device-authorization";
import worker, {
  DeviceAuthorizationDurableObject,
  type Env,
} from "./index";

class MemoryStorage {
  readonly values = new Map<string, unknown>();

  async get<T>(key: string): Promise<T | undefined> {
    const value = this.values.get(key);
    return value === undefined ? undefined : structuredClone(value) as T;
  }

  async put<T>(key: string, value: T): Promise<void> {
    this.values.set(key, structuredClone(value));
  }
}

function envWith(namespace: Env["CYRENE_DEVICE_AUTHORIZATION"]): Env {
  return {
    CYRENE_DEVICE_AUTHORIZATION: namespace,
    CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN: "https://control.example.test",
    CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH: "test-bootstrap-code-hash",
    CYRENE_LIVEKIT_SERVER_URL: "wss://livekit.example.test",
    CYRENE_LIVEKIT_API_KEY: "test-api-key",
    CYRENE_LIVEKIT_API_SECRET: "test-api-secret",
    CYRENE_MEDIA_ENVELOPE_MASTER_KEY: Buffer.alloc(32, 7).toString("base64url"),
  };
}

describe("Cloudflare Device Authorization Worker", () => {
  it("routes HTTPS requests through one owner Durable Object", async () => {
    const storage = new MemoryStorage();
    const authorization = new PersistentDeviceAuthorizationModule({
      store: new CloudflareDeviceAuthorizationAggregateStore(storage),
    });
    const desktop = await authorization.bootstrapOwner({ label: "家中 Mac" });
    const durableObject = new DeviceAuthorizationDurableObject(
      { storage },
      envWith({} as Env["CYRENE_DEVICE_AUTHORIZATION"]),
    );
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: (request: Request) => durableObject.fetch(request),
      }),
    };

    const response = await worker.fetch(new Request(
      "https://control.example.test/v1/pairing/begin",
      {
        method: "POST",
        headers: {
          authorization: `DeviceCredential ${desktop.deviceCredential}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ targetKind: "MOBILE" }),
      },
    ), envWith(namespace));
    const body = await response.json() as Record<string, unknown>;

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(body).toMatchObject({
      challengeId: expect.any(String),
      pairingLink: expect.stringContaining(
        "endpoint=https%3A%2F%2Fcontrol.example.test",
      ),
    });
  });

  it("keeps health checks stateless and rejects non-API routes", async () => {
    let durableObjectCalls = 0;
    const namespace = {
      idFromName: (name: string) => name,
      get: () => ({
        fetch: async () => {
          durableObjectCalls += 1;
          return new Response();
        },
      }),
    };
    const env = envWith(namespace);

    const health = await worker.fetch(
      new Request("https://control.example.test/healthz"),
      env,
    );
    const missing = await worker.fetch(
      new Request("https://control.example.test/not-found"),
      env,
    );

    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ status: "ok" });
    expect(missing.status).toBe(404);
    expect(durableObjectCalls).toBe(0);
  });
});
