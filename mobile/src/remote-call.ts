import * as Crypto from "expo-crypto";
import type { StoredMobileDeviceAuthorization } from "./device-authorization-store";
import { resolveControlPlaneOrigin } from "./control-plane-origin";
import { parseRemoteVoiceCall } from "./remote-call-parser";

export type RemoteVoiceCallPhase =
  | "AWAITING_DESKTOP"
  | "CONNECTING_MEDIA"
  | "ACTIVE"
  | "RECONNECTING"
  | "ENDED";

export interface RemoteVoiceCall {
  callId: string;
  phase: RemoteVoiceCallPhase;
  characterId?: string;
  characterName?: string;
  terminationReason?: string;
}

export interface RemoteMediaJoinGrant {
  callId: string;
  endpointDeviceId: string;
  participantIdentity: string;
  peerIdentity: string;
  serverUrl: string;
  participantToken: string;
  e2eeKey: string;
  expiresAt: string;
}

export type RemoteCallRequestResult =
  | { status: "REJECTED"; reason: string }
  | { status: "CALL_CREATED"; call: RemoteVoiceCall };

export async function requestRemoteVoiceCall(
  authorization: StoredMobileDeviceAuthorization,
): Promise<RemoteCallRequestResult> {
  const payload = await authenticatedPost(
    authorization,
    "/v1/calls/request",
    { idempotencyKey: `mobile-${Crypto.randomUUID()}` },
  );
  if (payload.status === "REJECTED" && typeof payload.reason === "string") {
    return { status: "REJECTED", reason: payload.reason };
  }
  if (payload.status !== "CALL_CREATED") throw new Error("REMOTE_CALL_RESPONSE_INVALID");
  return { status: "CALL_CREATED", call: parseRemoteVoiceCall(payload.call) };
}

export async function readRemoteVoiceCall(
  authorization: StoredMobileDeviceAuthorization,
  callId: string,
): Promise<RemoteVoiceCall> {
  const payload = await authenticatedPost(
    authorization,
    "/v1/calls/status",
    { callId },
  );
  return parseRemoteVoiceCall(payload.call);
}

export async function takeRemoteMediaGrant(
  authorization: StoredMobileDeviceAuthorization,
  callId: string,
): Promise<RemoteMediaJoinGrant> {
  const payload = await authenticatedPost(
    authorization,
    "/v1/calls/media-grant",
    { callId },
  );
  return parseGrant(payload.grant);
}

function parseGrant(value: unknown): RemoteMediaJoinGrant {
  if (!value || typeof value !== "object") {
    throw new Error("MEDIA_GRANT_INVALID");
  }
  const input = value as Record<string, unknown>;
  const required = [
    "callId",
    "endpointDeviceId",
    "participantIdentity",
    "peerIdentity",
    "serverUrl",
    "participantToken",
    "e2eeKey",
    "expiresAt",
  ] as const;
  for (const field of required) {
    if (typeof input[field] !== "string" || !input[field]) {
      throw new Error("MEDIA_GRANT_INVALID");
    }
  }
  const serverUrl = input.serverUrl as string;
  const e2eeKey = input.e2eeKey as string;
  const expiresAt = input.expiresAt as string;
  if (
    !serverUrl.startsWith("wss://")
    || !/^[A-Za-z0-9_-]{43}$/.test(e2eeKey)
    || Date.parse(expiresAt) <= Date.now()
  ) {
    throw new Error("E2EE_REQUIRED");
  }
  return {
    callId: input.callId as string,
    endpointDeviceId: input.endpointDeviceId as string,
    participantIdentity: input.participantIdentity as string,
    peerIdentity: input.peerIdentity as string,
    serverUrl,
    participantToken: input.participantToken as string,
    e2eeKey,
    expiresAt,
  };
}

export async function endRemoteVoiceCall(
  authorization: StoredMobileDeviceAuthorization,
  callId: string,
): Promise<void> {
  await authenticatedPost(authorization, "/v1/calls/end", {
    callId,
    reason: "PARTICIPANT_HUNG_UP",
  });
}

export async function reportRemoteMediaReady(
  authorization: StoredMobileDeviceAuthorization,
  callId: string,
  options: { signal?: AbortSignal } = {},
): Promise<RemoteVoiceCall> {
  const payload = await authenticatedPost(
    authorization,
    "/v1/calls/media-ready",
    { callId },
    options,
  );
  return parseRemoteVoiceCall(payload.call);
}

async function authenticatedPost(
  authorization: StoredMobileDeviceAuthorization,
  pathname: string,
  body: Record<string, unknown>,
  options: { signal?: AbortSignal } = {},
): Promise<Record<string, unknown>> {
  const origin = resolveControlPlaneOrigin(authorization.controlPlaneOrigin);
  const response = await fetch(new URL(pathname, origin), {
    method: "POST",
    headers: {
      authorization: `DeviceCredential ${authorization.deviceCredential}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
    signal: options.signal,
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    throw new Error(typeof payload.code === "string"
      ? payload.code
      : "CONTROL_PLANE_REQUEST_FAILED");
  }
  return payload;
}
