import { randomUUID } from "node:crypto";
import { AccessToken, TrackSource } from "livekit-server-sdk";

/** Local-only configuration. The API secret is never returned to a phone. */
export interface LiveKitMobileCallConfig {
  serverUrl: string;
  apiKey: string;
  apiSecret: string;
  /** Short-lived room join credentials. V1 caps this at one hour. */
  tokenTtlSeconds?: number;
}

export interface MobileCallCredentials {
  callId: string;
  roomName: string;
  mobileIdentity: string;
  agentIdentity: string;
  /** Only give this token to the paired phone. */
  mobileToken: string;
  /** Used by the desktop bridge, never put into the mobile link. */
  agentToken: string;
  expiresAt: string;
  /** A short-lived deep link that the mobile companion can consume. */
  mobileLink: string;
}

export interface CreateMobileCallCredentialsOptions {
  callId?: string;
  now?: Date;
  deviceName?: string;
}

function requireSetting(value: string, name: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`移动端通话缺少 ${name}`);
  return normalized;
}

export function normalizeLiveKitServerUrl(value: string): string {
  const original = requireSetting(value, "LiveKit Server URL");
  let parsed: URL;
  try {
    parsed = new URL(original);
  } catch {
    throw new Error("LiveKit Server URL 无效，应为 wss:// 或 ws:// 地址");
  }

  if (parsed.protocol === "https:") parsed.protocol = "wss:";
  if (parsed.protocol === "http:") parsed.protocol = "ws:";
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    throw new Error("LiveKit Server URL 必须使用 wss:// 或 ws:// 协议");
  }
  return parsed.toString().replace(/\/$/, "");
}

function normalizeTtlSeconds(value: number | undefined): number {
  if (value === undefined) return 10 * 60;
  if (!Number.isFinite(value)) throw new Error("移动端通话 Token 有效期无效");
  return Math.max(60, Math.min(60 * 60, Math.floor(value)));
}

/**
 * Issues a one-room, one-phone access token and a separate desktop-agent token.
 * It deliberately does not contain any application-model or TTS credentials.
 */
export async function createMobileCallCredentials(
  config: LiveKitMobileCallConfig,
  options: CreateMobileCallCredentialsOptions = {},
): Promise<MobileCallCredentials> {
  const serverUrl = normalizeLiveKitServerUrl(config.serverUrl);
  const apiKey = requireSetting(config.apiKey, "LiveKit API Key");
  const apiSecret = requireSetting(config.apiSecret, "LiveKit API Secret");
  const callId = options.callId ?? randomUUID();
  const compactCallId = callId.replace(/[^a-zA-Z0-9]/g, "");
  if (!compactCallId) throw new Error("移动端通话 ID 无效");

  const roomName = `cyrene-call-${compactCallId}`;
  const mobileIdentity = `cyrene-mobile-${compactCallId}`;
  const agentIdentity = `cyrene-desktop-${compactCallId}`;
  const ttl = normalizeTtlSeconds(config.tokenTtlSeconds);
  const issuedAt = options.now ?? new Date();
  const expiresAt = new Date(issuedAt.getTime() + ttl * 1_000).toISOString();

  const mobile = new AccessToken(apiKey, apiSecret, {
    identity: mobileIdentity,
    name: options.deviceName?.trim() || "Cyrene Mobile",
    ttl,
  });
  mobile.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishSources: [TrackSource.MICROPHONE],
  });

  const agent = new AccessToken(apiKey, apiSecret, {
    identity: agentIdentity,
    name: "Cyrene",
    ttl,
  });
  agent.addGrant({
    roomJoin: true,
    room: roomName,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
    canPublishSources: [TrackSource.MICROPHONE],
  });

  const mobileToken = await mobile.toJwt();
  const agentToken = await agent.toJwt();
  const link = new URL("cyrene://call");
  link.searchParams.set("serverUrl", serverUrl);
  link.searchParams.set("token", mobileToken);
  link.searchParams.set("callId", callId);
  link.searchParams.set("expiresAt", expiresAt);

  return {
    callId,
    roomName,
    mobileIdentity,
    agentIdentity,
    mobileToken,
    agentToken,
    expiresAt,
    mobileLink: link.toString(),
  };
}
