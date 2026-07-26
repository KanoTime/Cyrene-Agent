import { describe, expect, it } from "vitest";
import {
  createCloudBaseDeviceAuthorizationFunction,
  type CloudBaseHttpEvent,
} from "./cloudbase-device-authorization-function";
import { CloudBaseDeviceAuthorizationAggregateStore } from "./cloudbase-device-authorization-store";
import { PersistentDeviceAuthorizationModule } from "./persistent-device-authorization";

function createDatabase() {
  let document: Record<string, unknown> | null = null;
  let queue = Promise.resolve();
  return {
    runTransaction<T>(
      operation: (transaction: any) => Promise<T>,
    ): Promise<T> {
      const pending = queue.then(() => operation({
        collection: () => ({
          doc: () => ({
            get: async () => ({ data: document ? [structuredClone(document)] : [] }),
            set: async (data: Record<string, unknown>) => {
              document = structuredClone(data);
            },
          }),
        }),
      }));
      queue = pending.then(() => undefined, () => undefined);
      return pending;
    },
  };
}

describe("CloudBase Device Authorization HTTP function", () => {
  it("translates a CloudBase gateway event into the vendor-neutral pairing contract", async () => {
    const database = createDatabase();
    const store = new CloudBaseDeviceAuthorizationAggregateStore({
      database,
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });
    const authorization = new PersistentDeviceAuthorizationModule({
      store,
    });
    const desktop = await authorization.bootstrapOwner({ label: "家中 Mac" });
    const handle = createCloudBaseDeviceAuthorizationFunction({
      database,
      publicOrigin: "https://control.example.test",
      deploymentBootstrapCodeHash: "test-bootstrap-code-hash",
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });
    const event: CloudBaseHttpEvent = {
      path: "/v1/pairing/begin",
      httpMethod: "POST",
      headers: {
        authorization: `DeviceCredential ${desktop.deviceCredential}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ targetKind: "MOBILE" }),
      isBase64Encoded: false,
    };

    const response = await handle(event);
    const body = JSON.parse(response.body) as Record<string, unknown>;

    expect(response.statusCode).toBe(200);
    expect(response.headers).toMatchObject({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
    });
    expect(body).toMatchObject({
      challengeId: expect.any(String),
      pairingLink: expect.stringMatching(/^cyrene:\/\/pair\?/),
    });
    expect(body).not.toHaveProperty("deviceCredential");
  });

  it("rejects non-JSON and oversized request bodies before domain handling", async () => {
    const handle = createCloudBaseDeviceAuthorizationFunction({
      database: createDatabase(),
      publicOrigin: "https://control.example.test",
      deploymentBootstrapCodeHash: "test-bootstrap-code-hash",
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
    });

    const invalid = await handle({
      path: "/v1/pairing/claim",
      httpMethod: "POST",
      headers: { "content-type": "text/plain" },
      body: "secret-looking-input",
      isBase64Encoded: false,
    });
    const oversized = await handle({
      path: "/v1/pairing/claim",
      httpMethod: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ value: "x".repeat(17_000) }),
      isBase64Encoded: false,
    });

    expect(invalid.statusCode).toBe(415);
    expect(JSON.parse(invalid.body)).toEqual({ code: "CONTENT_TYPE_REQUIRED" });
    expect(oversized.statusCode).toBe(413);
    expect(JSON.parse(oversized.body)).toEqual({ code: "REQUEST_BODY_TOO_LARGE" });
  });

  it("restores the route prefix stripped by CloudBase HTTP Access Service", async () => {
    const handle = createCloudBaseDeviceAuthorizationFunction({
      database: createDatabase(),
      publicOrigin: "https://control.example.test",
      deploymentBootstrapCodeHash: "test-bootstrap-code-hash",
      collectionName: "cyrene_device_authorization",
      documentId: "owner_v1",
      gatewayPathPrefix: "/v1",
    });

    const stripped = await handle({
      path: "/owner/bootstrap",
      httpMethod: "POST",
      headers: {
        "content-type": "application/json",
        authorization:
          "DeploymentBootstrap cy_db_000000000000000000000000000000000000000000000000",
      },
      body: JSON.stringify({ label: "未授权烟测" }),
    });
    const alreadyPrefixed = await handle({
      path: "/v1/owner/bootstrap",
      httpMethod: "POST",
      headers: {
        "content-type": "application/json",
        authorization:
          "DeploymentBootstrap cy_db_000000000000000000000000000000000000000000000000",
      },
      body: JSON.stringify({ label: "未授权烟测" }),
    });

    expect(stripped.statusCode).toBe(401);
    expect(alreadyPrefixed.statusCode).toBe(401);
    expect(JSON.parse(stripped.body)).toEqual({
      code: "DEPLOYMENT_BOOTSTRAP_REQUIRED",
    });
  });
});
