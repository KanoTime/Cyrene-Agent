import {
  CloudBaseDeviceAuthorizationAggregateStore,
  type CloudBaseTransactionDatabase,
} from "./cloudbase-device-authorization-store";
import { createDeviceAuthorizationHttpHandler } from "./device-authorization-http";
import type { DeviceAuthorizationMediaGrantService } from "./device-authorization-http";
import { PersistentDeviceAuthorizationModule } from "./persistent-device-authorization";

export interface CloudBaseHttpEvent {
  path?: string;
  httpMethod?: string;
  headers?: Record<string, string | undefined>;
  body?: string;
  isBase64Encoded?: boolean;
}

export interface CloudBaseHttpResponse {
  statusCode: number;
  headers: Record<string, string>;
  body: string;
}

const MAX_BODY_BYTES = 16 * 1024;
const RESPONSE_HEADERS = {
  "content-type": "application/json; charset=utf-8",
  "cache-control": "no-store",
  "x-content-type-options": "nosniff",
};

export function createCloudBaseDeviceAuthorizationFunction(options: {
  database: CloudBaseTransactionDatabase;
  publicOrigin: string;
  deploymentBootstrapCodeHash: string;
  collectionName: string;
  documentId: string;
  gatewayPathPrefix?: string;
  mediaGrantService?: DeviceAuthorizationMediaGrantService;
}): (event: CloudBaseHttpEvent) => Promise<CloudBaseHttpResponse> {
  const store = new CloudBaseDeviceAuthorizationAggregateStore({
    database: options.database,
    collectionName: options.collectionName,
    documentId: options.documentId,
  });
  const authorization = new PersistentDeviceAuthorizationModule({
    store,
  });
  const handleAuthorization = createDeviceAuthorizationHttpHandler({
    authorization,
    publicOrigin: options.publicOrigin,
    deploymentBootstrapCodeHash: options.deploymentBootstrapCodeHash,
    mediaGrantService: options.mediaGrantService,
  });

  return async (event) => {
    if (event.httpMethod !== "POST") {
      return response(405, { code: "METHOD_NOT_ALLOWED" });
    }
    const headers = normalizeHeaders(event.headers);
    if (!/^application\/json(?:\s*;|$)/i.test(headers["content-type"] ?? "")) {
      return response(415, { code: "CONTENT_TYPE_REQUIRED" });
    }
    let rawBody: Buffer;
    try {
      rawBody = event.isBase64Encoded
        ? Buffer.from(event.body ?? "", "base64")
        : Buffer.from(event.body ?? "", "utf8");
    } catch {
      return response(400, { code: "REQUEST_BODY_INVALID" });
    }
    if (rawBody.byteLength > MAX_BODY_BYTES) {
      return response(413, { code: "REQUEST_BODY_TOO_LARGE" });
    }
    let body: unknown;
    try {
      body = rawBody.byteLength === 0
        ? {}
        : JSON.parse(rawBody.toString("utf8"));
    } catch {
      return response(400, { code: "REQUEST_BODY_INVALID" });
    }
    if (!isRecord(body)) {
      return response(400, { code: "REQUEST_BODY_INVALID" });
    }
    const result = await handleAuthorization({
      method: "POST",
      pathname: restoreGatewayPathPrefix(
        event.path ?? "/",
        options.gatewayPathPrefix,
      ),
      authorization: headers.authorization,
      body,
    });
    return response(result.status, result.body);
  };
}

function restoreGatewayPathPrefix(
  pathname: string,
  prefix: string | undefined,
): string {
  if (!prefix) return pathname;
  if (!/^\/[^/]+$/.test(prefix)) {
    throw new Error("GATEWAY_PATH_PREFIX_INVALID");
  }
  if (pathname === prefix || pathname.startsWith(`${prefix}/`)) {
    return pathname;
  }
  return `${prefix}${pathname.startsWith("/") ? pathname : `/${pathname}`}`;
}

function response(
  statusCode: number,
  body: Record<string, unknown>,
): CloudBaseHttpResponse {
  return {
    statusCode,
    headers: { ...RESPONSE_HEADERS },
    body: JSON.stringify(body),
  };
}

function normalizeHeaders(
  input: Record<string, string | undefined> | undefined,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(input ?? {})) {
    if (typeof value === "string") result[key.toLowerCase()] = value;
  }
  return result;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
