/**
 * Pairing information carried by the desktop-generated QR/deep link.
 *
 * The token is intentionally kept in memory only. Do not log this object or
 * put it in AsyncStorage: it grants one phone access to one short-lived room.
 */
export interface MobileCallCredentials {
  serverUrl: string;
  participantToken: string;
  callId: string;
  expiresAt: string;
}

function invalidPairing(message: string): never {
  throw new Error(`手机配对链接无效：${message}`);
}

function parseServerUrl(value: string | null): string {
  if (!value) invalidPairing("缺少 LiveKit 地址");
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalidPairing("LiveKit 地址格式不正确");
  }
  if (parsed.protocol !== "wss:" && parsed.protocol !== "ws:") {
    invalidPairing("LiveKit 地址必须使用 wss:// 或 ws://");
  }
  return parsed.toString().replace(/\/$/, "");
}

/** Parses, validates, and keeps a desktop pairing link only for this session. */
export function parseMobileCallPairing(value: string): MobileCallCredentials {
  let link: URL;
  try {
    link = new URL(value.trim());
  } catch {
    invalidPairing("不是可识别的链接");
  }

  if (link.protocol !== "cyrene:" || link.hostname !== "call") {
    invalidPairing("请扫描 Cyrene 桌面端生成的通话二维码");
  }

  const participantToken = link.searchParams.get("token")?.trim() ?? "";
  if (participantToken.length < 32 || participantToken.split(".").length !== 3) {
    invalidPairing("缺少有效的通话令牌");
  }

  const callId = link.searchParams.get("callId")?.trim() ?? "";
  if (!callId) invalidPairing("缺少通话标识");

  const expiresAt = link.searchParams.get("expiresAt")?.trim() ?? "";
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) invalidPairing("有效期格式不正确");
  if (expiresAtMs <= Date.now()) invalidPairing("二维码已过期，请回到桌面端重新生成");

  return {
    serverUrl: parseServerUrl(link.searchParams.get("serverUrl")),
    participantToken,
    callId,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}
