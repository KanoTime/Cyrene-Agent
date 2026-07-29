import * as Crypto from "expo-crypto";
import {
  getOrCreateInstallationId,
  saveMobileDeviceAuthorization,
} from "./device-authorization-store";

export interface MobilePairingInvitation {
  controlPlaneOrigin: string;
  challengeId: string;
  invitation: string;
  expiresAt: string;
}

export interface PendingMobilePairing {
  controlPlaneOrigin: string;
  challengeId: string;
  candidateReceipt: string;
  verificationCode: string;
  expiresAt: string;
}

export type MobilePairingOutcome =
  | { status: "CLAIMED"; verificationCode: string; expiresAt: string }
  | { status: "REJECTED" | "EXPIRED" | "INVALIDATED" | "ATTEMPT_LIMITED" }
  | { status: "APPROVED"; deviceId: string; pairedAt: string };

function invalidPairing(message: string): never {
  throw new Error(`长期配对邀请无效：${message}`);
}

function parseHttpsOrigin(value: string | null): string {
  if (!value) invalidPairing("缺少控制面地址");
  let endpoint: URL;
  try {
    endpoint = new URL(value);
  } catch {
    invalidPairing("控制面地址格式不正确");
  }
  if (endpoint.protocol !== "https:" || endpoint.username || endpoint.password) {
    invalidPairing("控制面必须使用不含凭据的 HTTPS 地址");
  }
  return endpoint.origin;
}

export function parseMobilePairingInvitation(value: string): MobilePairingInvitation {
  let link: URL;
  try {
    link = new URL(value.trim());
  } catch {
    invalidPairing("不是可识别的链接");
  }
  if (link.protocol !== "cyrene:" || link.hostname !== "pair") {
    invalidPairing("请扫描 Cyrene 桌面端生成的长期配对二维码");
  }
  const challengeId = link.searchParams.get("challengeId")?.trim() ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(challengeId)) invalidPairing("缺少挑战标识");
  const invitation = link.searchParams.get("invitation")?.trim() ?? "";
  if (!/^cy_pi_[A-Za-z0-9_-]{40,}$/.test(invitation)) invalidPairing("缺少配对邀请");
  const expiresAt = link.searchParams.get("expiresAt")?.trim() ?? "";
  const expiresAtMs = Date.parse(expiresAt);
  if (!Number.isFinite(expiresAtMs)) invalidPairing("有效期格式不正确");
  if (expiresAtMs <= Date.now()) invalidPairing("邀请已过期，请在桌面端重新生成");
  return {
    controlPlaneOrigin: parseHttpsOrigin(link.searchParams.get("endpoint")),
    challengeId,
    invitation,
    expiresAt: new Date(expiresAtMs).toISOString(),
  };
}

function randomCandidateReceipt(): string {
  const bytes = Crypto.getRandomBytes(32);
  return `cy_pr_${Array.from(bytes, (value) => value.toString(16).padStart(2, "0")).join("")}`;
}

async function postJson(
  origin: string,
  pathname: string,
  body: Record<string, unknown>,
): Promise<Record<string, unknown>> {
  const response = await fetch(new URL(pathname, origin), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    const code = typeof payload.code === "string" ? payload.code : "PAIRING_REQUEST_FAILED";
    throw new Error(code);
  }
  return payload;
}

export async function claimMobilePairing(
  pairing: MobilePairingInvitation,
  label: string,
): Promise<PendingMobilePairing> {
  const installationId = await getOrCreateInstallationId();
  const candidateReceipt = randomCandidateReceipt();
  const payload = await postJson(pairing.controlPlaneOrigin, "/v1/pairing/claim", {
    challengeId: pairing.challengeId,
    invitation: pairing.invitation,
    candidateReceipt,
    candidate: { installationId, kind: "MOBILE", label: label.trim() },
  });
  if (
    payload.status !== "CLAIMED"
    || typeof payload.verificationCode !== "string"
    || typeof payload.expiresAt !== "string"
  ) {
    throw new Error("PAIRING_RESPONSE_INVALID");
  }
  return {
    controlPlaneOrigin: pairing.controlPlaneOrigin,
    challengeId: pairing.challengeId,
    candidateReceipt,
    verificationCode: payload.verificationCode,
    expiresAt: payload.expiresAt,
  };
}

export async function readMobilePairingOutcome(
  pending: PendingMobilePairing,
): Promise<MobilePairingOutcome> {
  const payload = await postJson(pending.controlPlaneOrigin, "/v1/pairing/outcome", {
    challengeId: pending.challengeId,
    candidateReceipt: pending.candidateReceipt,
  });
  if (payload.status === "CLAIMED") {
    if (typeof payload.verificationCode !== "string" || typeof payload.expiresAt !== "string") {
      throw new Error("PAIRING_RESPONSE_INVALID");
    }
    return {
      status: "CLAIMED",
      verificationCode: payload.verificationCode,
      expiresAt: payload.expiresAt,
    };
  }
  if (
    payload.status === "REJECTED"
    || payload.status === "EXPIRED"
    || payload.status === "INVALIDATED"
    || payload.status === "ATTEMPT_LIMITED"
  ) {
    return { status: payload.status };
  }
  if (
    payload.status !== "APPROVED"
    || typeof payload.deviceId !== "string"
    || typeof payload.deviceCredential !== "string"
    || typeof payload.pairedAt !== "string"
  ) {
    throw new Error("PAIRING_RESPONSE_INVALID");
  }
  const installationId = await getOrCreateInstallationId();
  await saveMobileDeviceAuthorization({
    schemaVersion: 1,
    installationId,
    deviceId: payload.deviceId,
    deviceCredential: payload.deviceCredential,
    pairedAt: payload.pairedAt,
    controlPlaneOrigin: pending.controlPlaneOrigin,
  });
  return {
    status: "APPROVED",
    deviceId: payload.deviceId,
    pairedAt: payload.pairedAt,
  };
}
