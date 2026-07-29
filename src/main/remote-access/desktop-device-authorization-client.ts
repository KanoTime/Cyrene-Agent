import { createHmac } from "node:crypto";
import type {
  AuthorizedDeviceSummary,
  PairingCandidateSummary,
  PairingReview,
  VoiceCallView,
} from "./device-authorization";
import type { MediaJoinGrant } from "./media-grant-envelope";
import type { DesktopDeviceCredentialVault } from "./desktop-device-credential-vault";

export interface DesktopAuthorizationHttpRequest {
  authorization: string;
  body: Record<string, unknown>;
}

export interface DesktopAuthorizationHttpResult {
  status: number;
  body: Record<string, unknown>;
}

export type DesktopAuthorizationRequest = (
  url: string,
  request: DesktopAuthorizationHttpRequest,
) => Promise<DesktopAuthorizationHttpResult>;

export interface DesktopPairingChallengeView {
  challengeId: string;
  pairingLink: string;
  shortCode: string;
  expiresAt: string;
}

export type DesktopPairingDecision =
  | { status: "REJECTED" }
  | { status: "APPROVED"; device: AuthorizedDeviceSummary };

export class DesktopDeviceAuthorizationClient {
  readonly #vault: Pick<DesktopDeviceCredentialVault, "load" | "save">;
  readonly #request: DesktopAuthorizationRequest;

  constructor(options: {
    vault: Pick<DesktopDeviceCredentialVault, "load" | "save">;
    request: DesktopAuthorizationRequest;
  }) {
    this.#vault = options.vault;
    this.#request = options.request;
  }

  async bootstrapOwner(input: {
    controlPlaneOrigin: string;
    deploymentBootstrapCode: string;
    label: string;
  }): Promise<{
    deviceId: string;
    controlPlaneOrigin: string;
    ownerRecoveryKey: string;
  }> {
    const existing = await this.#vault.load();
    if (existing.status === "available") {
      throw new Error("DESKTOP_DEVICE_ALREADY_PAIRED");
    }
    if (existing.status === "corrupt") {
      throw new Error("DESKTOP_DEVICE_CREDENTIAL_CORRUPT");
    }
    const controlPlane = new URL(input.controlPlaneOrigin);
    if (controlPlane.protocol !== "https:") {
      throw new Error("CONTROL_PLANE_HTTPS_REQUIRED");
    }
    const deploymentBootstrapCode = requirePattern(
      input.deploymentBootstrapCode,
      /^cy_db_[A-Za-z0-9_-]{40,}$/,
      "DEPLOYMENT_BOOTSTRAP_CODE_INVALID",
    );
    const label = requireString(input.label, "DEVICE_LABEL_INVALID");
    const response = await this.#request(
      new URL("/v1/owner/bootstrap", controlPlane.origin).toString(),
      {
        authorization: `DeploymentBootstrap ${deploymentBootstrapCode}`,
        body: { label },
      },
    );
    const body = requireSuccessfulBody(response);
    const deviceId = requireString(body.deviceId, "DEVICE_ID_INVALID");
    const deviceCredential = requirePattern(
      body.deviceCredential,
      /^cy_dc_[A-Za-z0-9_-]{40,}$/,
      "DEVICE_CREDENTIAL_INVALID",
    );
    const ownerRecoveryKey = requirePattern(
      body.ownerRecoveryKey,
      /^cy_rk_[A-Za-z0-9_-]{40,}$/,
      "OWNER_RECOVERY_KEY_INVALID",
    );
    await this.#vault.save({
      controlPlaneOrigin: controlPlane.origin,
      deviceId,
      deviceCredential,
      savedAt: new Date().toISOString(),
    });
    return {
      deviceId,
      controlPlaneOrigin: controlPlane.origin,
      ownerRecoveryKey,
    };
  }

  async confirmOwnerRecoveryKey(
    ownerRecoveryKey: string,
  ): Promise<{ status: "CONFIRMED"; confirmedAt: string }> {
    const body = await this.#authenticatedRequest(
      "/v1/owner/recovery-key/confirm",
      {
        ownerRecoveryKey: requirePattern(
          ownerRecoveryKey,
          /^cy_rk_[A-Za-z0-9_-]{40,}$/,
          "OWNER_RECOVERY_KEY_INVALID",
        ),
      },
    );
    if (body.status !== "CONFIRMED") {
      throw new Error("OWNER_RECOVERY_KEY_CONFIRMATION_INVALID");
    }
    return {
      status: "CONFIRMED",
      confirmedAt: requireIsoDate(
        body.confirmedAt,
        "OWNER_RECOVERY_KEY_CONFIRMATION_INVALID",
      ),
    };
  }

  async recoverOwner(input: {
    controlPlaneOrigin: string;
    ownerRecoveryKey: string;
    label: string;
  }): Promise<{
    deviceId: string;
    controlPlaneOrigin: string;
    ownerRecoveryKey: string;
  }> {
    const controlPlane = new URL(input.controlPlaneOrigin);
    if (controlPlane.protocol !== "https:") {
      throw new Error("CONTROL_PLANE_HTTPS_REQUIRED");
    }
    const ownerRecoveryKey = requirePattern(
      input.ownerRecoveryKey,
      /^cy_rk_[A-Za-z0-9_-]{40,}$/,
      "OWNER_RECOVERY_KEY_INVALID",
    );
    const label = requireString(input.label, "DEVICE_LABEL_INVALID");
    const recoveryReceipt = deriveRecoveryReceipt(
      ownerRecoveryKey,
      controlPlane.origin,
    );
    const response = await this.#request(
      new URL("/v1/owner/recover", controlPlane.origin).toString(),
      {
        authorization: `OwnerRecovery ${ownerRecoveryKey}`,
        body: { recoveryReceipt, label },
      },
    );
    const body = requireSuccessfulBody(response);
    const device = parseDeviceSummary(body.device);
    if (device.kind !== "DESKTOP" || device.status !== "ACTIVE") {
      throw new Error("OWNER_RECOVERY_RESPONSE_INVALID");
    }
    const deviceCredential = requirePattern(
      body.deviceCredential,
      /^cy_dc_[A-Za-z0-9_-]{40,}$/,
      "DEVICE_CREDENTIAL_INVALID",
    );
    const replacementRecoveryKey = requirePattern(
      body.ownerRecoveryKey,
      /^cy_rk_[A-Za-z0-9_-]{40,}$/,
      "OWNER_RECOVERY_KEY_INVALID",
    );
    await this.#vault.save({
      controlPlaneOrigin: controlPlane.origin,
      deviceId: device.deviceId,
      deviceCredential,
      savedAt: new Date().toISOString(),
    });
    return {
      deviceId: device.deviceId,
      controlPlaneOrigin: controlPlane.origin,
      ownerRecoveryKey: replacementRecoveryKey,
    };
  }

  async getLocalStatus(): Promise<
    | { status: "not-paired" | "corrupt" }
    | { status: "paired"; deviceId: string; controlPlaneOrigin: string }
  > {
    const identity = await this.#vault.load();
    if (identity.status === "missing") return { status: "not-paired" };
    if (identity.status === "corrupt") return { status: "corrupt" };
    return {
      status: "paired",
      deviceId: identity.record.deviceId,
      controlPlaneOrigin: identity.record.controlPlaneOrigin,
    };
  }

  async reportDesktopAvailability(available: boolean): Promise<
    | { status: "AVAILABLE"; availableUntil: string }
    | { status: "UNAVAILABLE" }
  > {
    const body = await this.#authenticatedRequest(
      "/v1/desktop/availability",
      { available },
    );
    if (available) {
      if (body.status !== "AVAILABLE") {
        throw new Error("DESKTOP_AVAILABILITY_RESPONSE_INVALID");
      }
      return {
        status: "AVAILABLE",
        availableUntil: requireIsoDate(
          body.availableUntil,
          "DESKTOP_AVAILABILITY_RESPONSE_INVALID",
        ),
      };
    }
    if (body.status !== "UNAVAILABLE") {
      throw new Error("DESKTOP_AVAILABILITY_RESPONSE_INVALID");
    }
    return { status: "UNAVAILABLE" };
  }

  async beginMobilePairing(): Promise<DesktopPairingChallengeView> {
    const result = await this.#authenticatedRequest("/v1/pairing/begin", {
      targetKind: "MOBILE",
    });
    return {
      challengeId: requireString(result.challengeId, "PAIRING_CHALLENGE_INVALID"),
      pairingLink: requirePairingLink(result.pairingLink),
      shortCode: requireString(result.shortCode, "PAIRING_SHORT_CODE_INVALID"),
      expiresAt: requireIsoDate(result.expiresAt, "PAIRING_EXPIRY_INVALID"),
    };
  }

  async reviewPairing(challengeId: string): Promise<PairingReview> {
    const body = await this.#authenticatedRequest("/v1/pairing/review", {
      challengeId: requireString(challengeId, "PAIRING_CHALLENGE_NOT_FOUND"),
    });
    return parsePairingReview(body);
  }

  async decidePairing(
    challengeId: string,
    allow: boolean,
  ): Promise<DesktopPairingDecision> {
    const body = await this.#authenticatedRequest("/v1/pairing/decide", {
      challengeId: requireString(challengeId, "PAIRING_CHALLENGE_NOT_FOUND"),
      allow,
    });
    if (body.status === "REJECTED") return { status: "REJECTED" };
    if (body.status !== "APPROVED") throw new Error("PAIRING_DECISION_INVALID");
    return {
      status: "APPROVED",
      device: parseDeviceSummary(body.device),
    };
  }

  async readCurrentVoiceCall(): Promise<VoiceCallView | null> {
    const body = await this.#authenticatedRequest(
      "/v1/desktop/calls/current",
      {},
    );
    return body.call === null ? null : parseVoiceCall(body.call);
  }

  async confirmVoiceCall(input: {
    callId: string;
    characterId: string;
    characterName: string;
  }): Promise<VoiceCallView> {
    const body = await this.#authenticatedRequest(
      "/v1/desktop/calls/confirm",
      input,
    );
    return parseVoiceCall(body.call);
  }

  async takeMediaGrant(callId: string): Promise<MediaJoinGrant> {
    const body = await this.#authenticatedRequest(
      "/v1/calls/media-grant",
      { callId },
    );
    return parseMediaJoinGrant(body.grant);
  }

  async reportMediaReady(callId: string): Promise<VoiceCallView> {
    const body = await this.#authenticatedRequest(
      "/v1/calls/media-ready",
      { callId },
    );
    return parseVoiceCall(body.call);
  }

  async endVoiceCall(
    callId: string,
    reason: "PARTICIPANT_HUNG_UP",
  ): Promise<VoiceCallView> {
    const body = await this.#authenticatedRequest(
      "/v1/calls/end",
      { callId, reason },
    );
    return parseVoiceCall(body.call);
  }

  async #authenticatedRequest(
    pathname: string,
    body: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const identity = await this.#vault.load();
    if (identity.status === "missing") throw new Error("DESKTOP_DEVICE_NOT_PAIRED");
    if (identity.status === "corrupt") throw new Error("DESKTOP_DEVICE_CREDENTIAL_CORRUPT");
    const response = await this.#request(
      new URL(pathname, identity.record.controlPlaneOrigin).toString(),
      {
        authorization: `DeviceCredential ${identity.record.deviceCredential}`,
        body,
      },
    );
    return requireSuccessfulBody(response);
  }
}

export type DesktopAuthorizationFetch = (
  input: string,
  init: RequestInit,
) => Promise<Response>;

export function createDesktopAuthorizationRequest(
  fetchImplementation: DesktopAuthorizationFetch,
): DesktopAuthorizationRequest {
  return async (url, request) => {
    const response = await fetchImplementation(url, {
      method: "POST",
      headers: {
        authorization: request.authorization,
        "content-type": "application/json",
      },
      body: JSON.stringify(request.body),
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    let body: unknown;
    try {
      body = await response.json();
    } catch {
      body = {};
    }
    return {
      status: response.status,
      body: isRecord(body) ? body : {},
    };
  };
}

export const nodeDesktopAuthorizationRequest =
  createDesktopAuthorizationRequest((url, init) => fetch(url, init));

function parsePairingReview(body: Record<string, unknown>): PairingReview {
  switch (body.status) {
    case "OPEN":
      return {
        status: "OPEN",
        expiresAt: requireIsoDate(body.expiresAt, "PAIRING_EXPIRY_INVALID"),
      };
    case "CLAIMED":
      return {
        status: "CLAIMED",
        candidate: parseCandidate(body.candidate),
        verificationCode: requireVerificationCode(body.verificationCode),
        expiresAt: requireIsoDate(body.expiresAt, "PAIRING_EXPIRY_INVALID"),
      };
    case "APPROVED":
      return { status: "APPROVED", device: parseDeviceSummary(body.device) };
    case "REJECTED":
    case "EXPIRED":
    case "INVALIDATED":
    case "ATTEMPT_LIMITED":
      return { status: body.status };
    default:
      throw new Error("PAIRING_REVIEW_INVALID");
  }
}

function parseCandidate(value: unknown): PairingCandidateSummary {
  if (!isRecord(value)) throw new Error("PAIRING_CANDIDATE_INVALID");
  const kind = value.kind;
  if (kind !== "DESKTOP" && kind !== "MOBILE") {
    throw new Error("PAIRING_DEVICE_KIND_INVALID");
  }
  return {
    installationId: requireString(value.installationId, "INSTALLATION_ID_INVALID"),
    kind,
    label: requireString(value.label, "DEVICE_LABEL_INVALID"),
  };
}

function parseDeviceSummary(value: unknown): AuthorizedDeviceSummary {
  if (!isRecord(value)) throw new Error("DEVICE_SUMMARY_INVALID");
  const kind = value.kind;
  if (kind !== "DESKTOP" && kind !== "MOBILE") {
    throw new Error("PAIRING_DEVICE_KIND_INVALID");
  }
  const status = value.status;
  if (
    status !== "ACTIVE"
    && status !== "REVOKED"
    && status !== "EXPIRED"
    && status !== "INVALIDATED"
  ) {
    throw new Error("DEVICE_STATUS_INVALID");
  }
  return {
    deviceId: requireString(value.deviceId, "DEVICE_ID_INVALID"),
    kind,
    label: requireString(value.label, "DEVICE_LABEL_INVALID"),
    status,
    pairedAt: requireIsoDate(value.pairedAt, "DEVICE_PAIRED_AT_INVALID"),
  };
}

function parseVoiceCall(value: unknown): VoiceCallView {
  if (!isRecord(value)) throw new Error("VOICE_CALL_RESPONSE_INVALID");
  const phase = value.phase;
  if (
    phase !== "AWAITING_DESKTOP"
    && phase !== "CONNECTING_MEDIA"
    && phase !== "ACTIVE"
    && phase !== "RECONNECTING"
    && phase !== "ENDED"
  ) {
    throw new Error("VOICE_CALL_RESPONSE_INVALID");
  }
  return {
    callId: requireString(value.callId, "VOICE_CALL_RESPONSE_INVALID"),
    mobileDeviceId: requireString(
      value.mobileDeviceId,
      "VOICE_CALL_RESPONSE_INVALID",
    ),
    desktopDeviceId: requireString(
      value.desktopDeviceId,
      "VOICE_CALL_RESPONSE_INVALID",
    ),
    phase,
    createdAt: requireIsoDate(value.createdAt, "VOICE_CALL_RESPONSE_INVALID"),
    desktopConfirmDeadline: requireIsoDate(
      value.desktopConfirmDeadline,
      "VOICE_CALL_RESPONSE_INVALID",
    ),
    ...(typeof value.mediaConnectDeadline === "string"
      ? {
        mediaConnectDeadline: requireIsoDate(
          value.mediaConnectDeadline,
          "VOICE_CALL_RESPONSE_INVALID",
        ),
      }
      : {}),
    ...(typeof value.activeAt === "string"
      ? { activeAt: requireIsoDate(value.activeAt, "VOICE_CALL_RESPONSE_INVALID") }
      : {}),
    ...(typeof value.characterId === "string"
      ? { characterId: value.characterId }
      : {}),
    ...(typeof value.characterName === "string"
      ? { characterName: value.characterName }
      : {}),
    ...(typeof value.terminationReason === "string"
      ? { terminationReason: value.terminationReason as VoiceCallView["terminationReason"] }
      : {}),
    ...(typeof value.endedAt === "string"
      ? { endedAt: requireIsoDate(value.endedAt, "VOICE_CALL_RESPONSE_INVALID") }
      : {}),
  };
}

function parseMediaJoinGrant(value: unknown): MediaJoinGrant {
  if (!isRecord(value)) throw new Error("MEDIA_GRANT_INVALID");
  const grant: MediaJoinGrant = {
    callId: requireString(value.callId, "MEDIA_GRANT_INVALID"),
    endpointDeviceId: requireString(
      value.endpointDeviceId,
      "MEDIA_GRANT_INVALID",
    ),
    participantIdentity: requireString(
      value.participantIdentity,
      "MEDIA_GRANT_INVALID",
    ),
    peerIdentity: requireString(value.peerIdentity, "MEDIA_GRANT_INVALID"),
    serverUrl: requireString(value.serverUrl, "MEDIA_GRANT_INVALID"),
    participantToken: requireString(
      value.participantToken,
      "MEDIA_GRANT_INVALID",
    ),
    e2eeKey: requirePattern(
      value.e2eeKey,
      /^[A-Za-z0-9_-]{43}$/,
      "E2EE_REQUIRED",
    ),
    expiresAt: requireIsoDate(value.expiresAt, "MEDIA_GRANT_INVALID"),
  };
  if (!grant.serverUrl.startsWith("wss://") || Date.parse(grant.expiresAt) <= Date.now()) {
    throw new Error("MEDIA_GRANT_INVALID");
  }
  return grant;
}

function requirePairingLink(value: unknown): string {
  const link = new URL(requireString(value, "PAIRING_LINK_INVALID"));
  if (link.protocol !== "cyrene:" || link.hostname !== "pair") {
    throw new Error("PAIRING_LINK_INVALID");
  }
  return link.toString();
}

function requireVerificationCode(value: unknown): string {
  const code = requireString(value, "PAIRING_VERIFICATION_CODE_INVALID");
  if (!/^\d{3} \d{3}$/.test(code)) {
    throw new Error("PAIRING_VERIFICATION_CODE_INVALID");
  }
  return code;
}

function requireIsoDate(value: unknown, code: string): string {
  const date = new Date(requireString(value, code));
  if (Number.isNaN(date.getTime())) throw new Error(code);
  return date.toISOString();
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function requirePattern(
  value: unknown,
  pattern: RegExp,
  code: string,
): string {
  const normalized = requireString(value, code);
  if (!pattern.test(normalized)) throw new Error(code);
  return normalized;
}

function requireSuccessfulBody(
  response: DesktopAuthorizationHttpResult,
): Record<string, unknown> {
  if (response.status < 200 || response.status >= 300) {
    const code = typeof response.body.code === "string"
      ? response.body.code
      : "CONTROL_PLANE_REQUEST_FAILED";
    throw new Error(code);
  }
  return response.body;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function deriveRecoveryReceipt(
  ownerRecoveryKey: string,
  controlPlaneOrigin: string,
): string {
  const digest = createHmac("sha256", ownerRecoveryKey)
    .update(
      `cyrene-owner-recovery-receipt-v1:${controlPlaneOrigin}`,
      "utf8",
    )
    .digest("base64url");
  return `cy_rr_${digest}`;
}
