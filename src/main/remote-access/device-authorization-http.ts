import { createHash, timingSafeEqual } from "node:crypto";
import {
  type DeviceKind,
  InMemoryDeviceAuthorizationModule,
  type PairingCandidateSummary,
} from "./device-authorization";
import type {
  EncryptedMediaGrantEnvelope,
  MediaGrantEnvelopeContext,
  MediaJoinGrant,
} from "./media-grant-envelope";

type Awaitable<T> = T | Promise<T>;
type AuthorizationMethod<Name extends keyof InMemoryDeviceAuthorizationModule> =
  InMemoryDeviceAuthorizationModule[Name] extends (...args: infer Args) => infer Result
    ? (...args: Args) => Awaitable<Result>
    : never;

export interface DeviceAuthorizationHttpService {
  bootstrapOwner: AuthorizationMethod<"bootstrapOwner">;
  confirmOwnerRecoveryKey: AuthorizationMethod<"confirmOwnerRecoveryKey">;
  reportDesktopAvailability: AuthorizationMethod<"reportDesktopAvailability">;
  recoverOwner: AuthorizationMethod<"recoverOwner">;
  beginPairing: AuthorizationMethod<"beginPairing">;
  claimPairing: AuthorizationMethod<"claimPairing">;
  getPairingReview: AuthorizationMethod<"getPairingReview">;
  decidePairing: AuthorizationMethod<"decidePairing">;
  readPairingOutcome: AuthorizationMethod<"readPairingOutcome">;
  requestVoiceCall: AuthorizationMethod<"requestVoiceCall">;
  confirmVoiceCall: AuthorizationMethod<"confirmVoiceCall">;
  readVoiceCall: AuthorizationMethod<"readVoiceCall">;
  readPendingDesktopVoiceCall: AuthorizationMethod<"readPendingDesktopVoiceCall">;
  attachMediaGrantEnvelopes: AuthorizationMethod<"attachMediaGrantEnvelopes">;
  takeMediaGrantEnvelope: AuthorizationMethod<"takeMediaGrantEnvelope">;
  reportVoiceCallMediaReady: AuthorizationMethod<"reportVoiceCallMediaReady">;
  terminateVoiceCall: AuthorizationMethod<"terminateVoiceCall">;
}

export interface DeviceAuthorizationMediaGrantService {
  issue(input: {
    callId: string;
    mobileDeviceId: string;
    desktopDeviceId: string;
    mobileLabel: string;
    envelopeNotAfterMs: number;
  }): Promise<{
    expiresAtMs: number;
    mobileEnvelope: EncryptedMediaGrantEnvelope;
    desktopEnvelope: EncryptedMediaGrantEnvelope;
  }>;
  open(input: MediaGrantEnvelopeContext & {
    envelope: EncryptedMediaGrantEnvelope;
  }): MediaJoinGrant;
}

export interface DeviceAuthorizationHttpRequest {
  method: "POST";
  pathname: string;
  authorization?: string;
  body: Record<string, unknown>;
}

export interface DeviceAuthorizationHttpResponse {
  status: number;
  body: Record<string, unknown>;
}

const SAFE_ERROR_CODE = /^[A-Z][A-Z0-9_.-]{2,80}$/;

function extractSafeErrorCode(error: unknown): string {
  const visited = new Set<unknown>();
  let candidate: unknown = error;
  for (let depth = 0; depth < 3; depth += 1) {
    if (!candidate || typeof candidate !== "object" || visited.has(candidate)) break;
    visited.add(candidate);
    const record = candidate as Record<string, unknown>;
    if (typeof record.code === "string" && SAFE_ERROR_CODE.test(record.code)) {
      return record.code;
    }
    if (
      candidate instanceof Error
      && typeof candidate.message === "string"
      && SAFE_ERROR_CODE.test(candidate.message)
    ) {
      return candidate.message;
    }
    candidate = record.error ?? record.cause;
  }
  return "PAIRING_REQUEST_FAILED";
}

function statusForErrorCode(code: string): number {
  if (
    code === "DESKTOP_AUTHORIZATION_REQUIRED"
    || code === "DEPLOYMENT_BOOTSTRAP_REQUIRED"
  ) {
    return 401;
  }
  if (
    code === "PAIRING_REQUEST_FAILED"
    || code.startsWith("DATABASE_")
    || code.startsWith("CLOUDBASE_")
    || code === "DEVICE_AUTHORIZATION_DOCUMENT_INVALID"
    || code === "DEVICE_AUTHORIZATION_REVISION_INVALID"
    || code === "DEVICE_AUTHORIZATION_STATE_INVALID"
  ) {
    return 500;
  }
  return 400;
}

function requireString(value: unknown, code: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(code);
  return value.trim();
}

function requireTimestamp(value: unknown, code: string): number {
  if (typeof value !== "string") throw new Error(code);
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error(code);
  return timestamp;
}

function requireDeviceKind(value: unknown): DeviceKind {
  if (value !== "DESKTOP" && value !== "MOBILE") {
    throw new Error("PAIRING_DEVICE_KIND_INVALID");
  }
  return value;
}

function requireBoolean(value: unknown, code: string): boolean {
  if (typeof value !== "boolean") throw new Error(code);
  return value;
}

function requireCandidate(value: unknown): PairingCandidateSummary {
  if (!value || typeof value !== "object") throw new Error("PAIRING_CANDIDATE_INVALID");
  const candidate = value as Record<string, unknown>;
  return {
    installationId: requireString(candidate.installationId, "INSTALLATION_ID_INVALID"),
    kind: requireDeviceKind(candidate.kind),
    label: requireString(candidate.label, "DEVICE_LABEL_INVALID"),
  };
}

function requireDesktopCredential(value: string | undefined): string {
  const credential = requireDeviceCredential(value, "DESKTOP_AUTHORIZATION_REQUIRED");
  return credential;
}

function requireDeviceCredential(
  value: string | undefined,
  code = "DEVICE_AUTHORIZATION_INVALID",
): string {
  const match = /^DeviceCredential (cy_dc_[A-Za-z0-9_-]{40,})$/.exec(value ?? "");
  if (!match) throw new Error(code);
  return match[1];
}

function requireDeploymentBootstrapCode(
  value: string | undefined,
  expectedHash: string | undefined,
): void {
  const match = /^DeploymentBootstrap (cy_db_[A-Za-z0-9_-]{40,})$/.exec(value ?? "");
  if (!match || !expectedHash) throw new Error("DEPLOYMENT_BOOTSTRAP_REQUIRED");
  const actual = createHash("sha256").update(match[1], "utf8").digest();
  const expected = Buffer.from(expectedHash, "base64url");
  if (expected.byteLength !== actual.byteLength || !timingSafeEqual(actual, expected)) {
    throw new Error("DEPLOYMENT_BOOTSTRAP_REQUIRED");
  }
}

function requireOwnerRecoveryKey(value: string | undefined): string {
  const match = /^OwnerRecovery (cy_rk_[A-Za-z0-9_-]{40,})$/.exec(value ?? "");
  if (!match) throw new Error("OWNER_RECOVERY_KEY_INVALID");
  return match[1];
}

function pairingLink(
  publicOrigin: string,
  invitation: {
    challengeId: string;
    invitation: string;
    expiresAt: string;
  },
): string {
  const link = new URL("cyrene://pair");
  link.searchParams.set("endpoint", publicOrigin);
  link.searchParams.set("challengeId", invitation.challengeId);
  link.searchParams.set("invitation", invitation.invitation);
  link.searchParams.set("expiresAt", invitation.expiresAt);
  return link.toString();
}

export function createDeviceAuthorizationHttpHandler(options: {
  authorization: DeviceAuthorizationHttpService;
  publicOrigin: string;
  deploymentBootstrapCodeHash?: string;
  mediaGrantService?: DeviceAuthorizationMediaGrantService;
}): (request: DeviceAuthorizationHttpRequest) => Promise<DeviceAuthorizationHttpResponse> {
  const publicEndpoint = new URL(options.publicOrigin);
  if (publicEndpoint.protocol !== "https:") {
    throw new Error("CONTROL_PLANE_HTTPS_REQUIRED");
  }
  const publicOrigin = publicEndpoint.origin;
  return async (request) => {
    if (request.method !== "POST") {
      return { status: 405, body: { code: "METHOD_NOT_ALLOWED" } };
    }
    try {
      switch (request.pathname) {
        case "/v1/owner/bootstrap": {
          requireDeploymentBootstrapCode(
            request.authorization,
            options.deploymentBootstrapCodeHash,
          );
          const result = await options.authorization.bootstrapOwner({
            label: requireString(request.body.label, "DEVICE_LABEL_INVALID"),
          });
          return { status: 200, body: { ...result } };
        }
        case "/v1/owner/recovery-key/confirm": {
          const result = await options.authorization.confirmOwnerRecoveryKey({
            authorizingCredential: requireDesktopCredential(request.authorization),
            ownerRecoveryKey: requireString(
              request.body.ownerRecoveryKey,
              "OWNER_RECOVERY_KEY_INVALID",
            ),
          });
          return { status: 200, body: { ...result } };
        }
        case "/v1/owner/recover": {
          const result = await options.authorization.recoverOwner({
            ownerRecoveryKey: requireOwnerRecoveryKey(request.authorization),
            recoveryReceipt: requireString(
              request.body.recoveryReceipt,
              "OWNER_RECOVERY_RECEIPT_INVALID",
            ),
            label: requireString(request.body.label, "DEVICE_LABEL_INVALID"),
          });
          return {
            status: 200,
            body: {
              device: result.device,
              deviceCredential: result.deviceCredential,
              ownerRecoveryKey: result.ownerRecoveryKey,
            },
          };
        }
        case "/v1/desktop/availability": {
          const result = await options.authorization.reportDesktopAvailability({
            authorizingCredential: requireDesktopCredential(request.authorization),
            available: requireBoolean(
              request.body.available,
              "DESKTOP_AVAILABILITY_INVALID",
            ),
          });
          return { status: 200, body: { ...result } };
        }
        case "/v1/calls/request": {
          const result = await options.authorization.requestVoiceCall({
            authorizingCredential: requireDeviceCredential(request.authorization),
            idempotencyKey: requireString(
              request.body.idempotencyKey,
              "CALL_IDEMPOTENCY_KEY_INVALID",
            ),
            replaceOwnedCall: request.body.replaceOwnedCall === undefined
              ? false
              : requireBoolean(
                  request.body.replaceOwnedCall,
                  "CALL_REPLACE_OWNED_INVALID",
                ),
          });
          return { status: 200, body: result };
        }
        case "/v1/calls/status": {
          const call = await options.authorization.readVoiceCall({
            authorizingCredential: requireDeviceCredential(request.authorization),
            callId: requireString(request.body.callId, "VOICE_CALL_NOT_FOUND"),
          });
          return { status: 200, body: { call } };
        }
        case "/v1/calls/media-grant": {
          if (!options.mediaGrantService) {
            throw new Error("MEDIA_GRANT_SERVICE_UNAVAILABLE");
          }
          const claimed = await options.authorization.takeMediaGrantEnvelope({
            authorizingCredential: requireDeviceCredential(request.authorization),
            callId: requireString(request.body.callId, "VOICE_CALL_NOT_FOUND"),
          });
          const grant = options.mediaGrantService.open({
            callId: claimed.callId,
            endpointDeviceId: claimed.endpointDeviceId,
            endpointKind: claimed.endpointKind,
            expiresAtMs: claimed.expiresAtMs,
            envelope: claimed.envelope,
          });
          return { status: 200, body: { grant } };
        }
        case "/v1/calls/end": {
          const requestedReason = requireString(
            request.body.reason,
            "CALL_TERMINATION_REASON_INVALID",
          );
          if (
            requestedReason !== "CALLER_CANCELLED"
            && requestedReason !== "PARTICIPANT_HUNG_UP"
            && requestedReason !== "BACKGROUND_TIMEOUT"
          ) {
            throw new Error("CALL_TERMINATION_REASON_INVALID");
          }
          const call = await options.authorization.terminateVoiceCall({
            authorizingCredential: requireDeviceCredential(request.authorization),
            callId: requireString(request.body.callId, "VOICE_CALL_NOT_FOUND"),
            reason: requestedReason,
          });
          return { status: 200, body: { call } };
        }
        case "/v1/calls/media-ready": {
          const call = await options.authorization.reportVoiceCallMediaReady({
            authorizingCredential: requireDeviceCredential(request.authorization),
            callId: requireString(request.body.callId, "VOICE_CALL_NOT_FOUND"),
          });
          return { status: 200, body: { call } };
        }
        case "/v1/desktop/calls/current": {
          const call = await options.authorization.readPendingDesktopVoiceCall({
            authorizingCredential: requireDesktopCredential(request.authorization),
          });
          return { status: 200, body: { call } };
        }
        case "/v1/desktop/calls/confirm": {
          const authorizingCredential = requireDesktopCredential(
            request.authorization,
          );
          let call = await options.authorization.confirmVoiceCall({
            authorizingCredential,
            callId: requireString(request.body.callId, "VOICE_CALL_NOT_FOUND"),
            characterId: requireString(
              request.body.characterId,
              "CHARACTER_ID_INVALID",
            ),
            characterName: requireString(
              request.body.characterName,
              "CHARACTER_NAME_INVALID",
            ),
          });
          if (call.phase === "CONNECTING_MEDIA" && options.mediaGrantService) {
            try {
              const issued = await options.mediaGrantService.issue({
                callId: call.callId,
                mobileDeviceId: call.mobileDeviceId,
                desktopDeviceId: call.desktopDeviceId,
                mobileLabel: "Cyrene Mobile",
                envelopeNotAfterMs: requireTimestamp(
                  call.mediaConnectDeadline,
                  "MEDIA_GRANT_ISSUANCE_FAILED",
                ),
              });
              call = await options.authorization.attachMediaGrantEnvelopes({
                authorizingCredential,
                callId: call.callId,
                ...issued,
              });
            } catch {
              call = await options.authorization.terminateVoiceCall({
                authorizingCredential,
                callId: call.callId,
                reason: "E2EE_REQUIRED",
              });
            }
          }
          return { status: 200, body: { call } };
        }
        case "/v1/pairing/begin": {
          const result = await options.authorization.beginPairing({
            authorizingCredential: requireDesktopCredential(request.authorization),
            targetKind: requireDeviceKind(request.body.targetKind),
          });
          return {
            status: 200,
            body: {
              ...result,
              pairingLink: pairingLink(publicOrigin, result),
            },
          };
        }
        case "/v1/pairing/claim": {
          const result = await options.authorization.claimPairing({
            challengeId: requireString(
              request.body.challengeId,
              "PAIRING_CHALLENGE_NOT_FOUND",
            ),
            invitation: requireString(
              request.body.invitation,
              "PAIRING_INVITATION_INVALID",
            ),
            candidateReceipt: requireString(
              request.body.candidateReceipt,
              "PAIRING_CANDIDATE_RECEIPT_INVALID",
            ),
            candidate: requireCandidate(request.body.candidate),
          });
          const { candidateReceipt: _, ...publicResult } = result;
          return { status: 200, body: publicResult };
        }
        case "/v1/pairing/review": {
          const result = await options.authorization.getPairingReview({
            authorizingCredential: requireDesktopCredential(request.authorization),
            challengeId: requireString(
              request.body.challengeId,
              "PAIRING_CHALLENGE_NOT_FOUND",
            ),
          });
          return { status: 200, body: result };
        }
        case "/v1/pairing/decide": {
          const result = await options.authorization.decidePairing({
            authorizingCredential: requireDesktopCredential(request.authorization),
            challengeId: requireString(
              request.body.challengeId,
              "PAIRING_CHALLENGE_NOT_FOUND",
            ),
            allow: requireBoolean(request.body.allow, "PAIRING_DECISION_INVALID"),
          });
          return { status: 200, body: result };
        }
        case "/v1/pairing/outcome": {
          const result = await options.authorization.readPairingOutcome({
            challengeId: requireString(
              request.body.challengeId,
              "PAIRING_CHALLENGE_NOT_FOUND",
            ),
            candidateReceipt: requireString(
              request.body.candidateReceipt,
              "PAIRING_CANDIDATE_RECEIPT_INVALID",
            ),
          });
          if (result.status !== "APPROVED") {
            return { status: 200, body: result };
          }
          return {
            status: 200,
            body: {
              status: result.status,
              deviceId: result.device.deviceId,
              pairedAt: result.device.pairedAt,
              deviceCredential: result.deviceCredential,
            },
          };
        }
        default:
          return { status: 404, body: { code: "NOT_FOUND" } };
      }
    } catch (error) {
      const code = extractSafeErrorCode(error);
      return { status: statusForErrorCode(code), body: { code } };
    }
  };
}
