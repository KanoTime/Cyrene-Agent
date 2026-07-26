import { createCloudBaseDeviceAuthorizationFunction } from "../../src/main/remote-access/cloudbase-device-authorization-function";
import type { CloudBaseTransactionDatabase } from "../../src/main/remote-access/cloudbase-device-authorization-store";
import { LiveKitMediaGrantService } from "../../src/main/remote-access/livekit-media-grant-service";
import { parseMediaEnvelopeMasterKey } from "../../src/main/remote-access/media-grant-envelope";

const cloudbase = require("@cloudbase/node-sdk") as {
  SYMBOL_CURRENT_ENV: symbol;
  init(options: { env: symbol }): {
    database(): CloudBaseTransactionDatabase;
  };
};

let handler:
  | ReturnType<typeof createCloudBaseDeviceAuthorizationFunction>
  | undefined;

function getHandler(): ReturnType<typeof createCloudBaseDeviceAuthorizationFunction> {
  if (handler) return handler;
  const publicOrigin = process.env.CYRENE_CONTROL_PLANE_PUBLIC_ORIGIN?.trim();
  const deploymentBootstrapCodeHash =
    process.env.CYRENE_DEPLOYMENT_BOOTSTRAP_CODE_HASH?.trim();
  const liveKitServerUrl = process.env.CYRENE_LIVEKIT_SERVER_URL?.trim();
  const liveKitApiKey = process.env.CYRENE_LIVEKIT_API_KEY?.trim();
  const liveKitApiSecret = process.env.CYRENE_LIVEKIT_API_SECRET?.trim();
  const mediaEnvelopeMasterKey =
    process.env.CYRENE_MEDIA_ENVELOPE_MASTER_KEY?.trim();
  if (!publicOrigin) throw new Error("CONTROL_PLANE_PUBLIC_ORIGIN_REQUIRED");
  if (!deploymentBootstrapCodeHash) {
    throw new Error("DEPLOYMENT_BOOTSTRAP_CODE_HASH_REQUIRED");
  }
  if (!liveKitServerUrl || !liveKitApiKey || !liveKitApiSecret) {
    throw new Error("LIVEKIT_CONTROL_PLANE_CONFIG_REQUIRED");
  }
  if (!mediaEnvelopeMasterKey) {
    throw new Error("MEDIA_ENVELOPE_MASTER_KEY_REQUIRED");
  }
  const app = cloudbase.init({ env: cloudbase.SYMBOL_CURRENT_ENV });
  handler = createCloudBaseDeviceAuthorizationFunction({
    database: app.database(),
    publicOrigin,
    deploymentBootstrapCodeHash,
    collectionName: "cyrene_device_authorization",
    documentId: "owner_v1",
    gatewayPathPrefix: "/v1",
    mediaGrantService: new LiveKitMediaGrantService({
      serverUrl: liveKitServerUrl,
      apiKey: liveKitApiKey,
      apiSecret: liveKitApiSecret,
      envelopeMasterKey: parseMediaEnvelopeMasterKey(mediaEnvelopeMasterKey),
    }),
  });
  return handler;
}

exports.main = async (event: unknown) =>
  getHandler()(event as Parameters<ReturnType<typeof getHandler>>[0]);
