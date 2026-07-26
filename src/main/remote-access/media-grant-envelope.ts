import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
export interface MediaJoinGrant {
  callId: string;
  endpointDeviceId: string;
  participantIdentity: string;
  peerIdentity: string;
  serverUrl: string;
  participantToken: string;
  e2eeKey: string;
  expiresAt: string;
}

export interface MediaGrantEnvelopeContext {
  callId: string;
  endpointDeviceId: string;
  endpointKind: "DESKTOP" | "MOBILE";
  expiresAtMs: number;
}

export interface EncryptedMediaGrantEnvelope {
  version: 1;
  algorithm: "A256GCM";
  nonce: string;
  ciphertext: string;
  authTag: string;
  expiresAtMs: number;
}

export function parseMediaEnvelopeMasterKey(value: string): Buffer {
  const normalized = value.trim();
  if (!/^[A-Za-z0-9_-]{43}$/.test(normalized)) {
    throw new Error("MEDIA_ENVELOPE_MASTER_KEY_INVALID");
  }
  const key = Buffer.from(normalized, "base64url");
  if (key.byteLength !== 32) {
    throw new Error("MEDIA_ENVELOPE_MASTER_KEY_INVALID");
  }
  return key;
}

export function sealMediaGrantEnvelope(input: {
  masterKey: Uint8Array;
  context: MediaGrantEnvelopeContext;
  grant: MediaJoinGrant;
}): EncryptedMediaGrantEnvelope {
  requireMasterKey(input.masterKey);
  validateContextAndGrant(input.context, input.grant);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", input.masterKey, nonce);
  cipher.setAAD(aad(input.context));
  const ciphertext = Buffer.concat([
    cipher.update(JSON.stringify(input.grant), "utf8"),
    cipher.final(),
  ]);
  return {
    version: 1,
    algorithm: "A256GCM",
    nonce: nonce.toString("base64url"),
    ciphertext: ciphertext.toString("base64url"),
    authTag: cipher.getAuthTag().toString("base64url"),
    expiresAtMs: input.context.expiresAtMs,
  };
}

export function openMediaGrantEnvelope(input: {
  masterKey: Uint8Array;
  context: MediaGrantEnvelopeContext;
  envelope: EncryptedMediaGrantEnvelope;
  nowMs: number;
}): MediaJoinGrant {
  requireMasterKey(input.masterKey);
  if (input.nowMs >= input.context.expiresAtMs) {
    throw new Error("MEDIA_GRANT_ENVELOPE_EXPIRED");
  }
  if (
    input.envelope.version !== 1
    || input.envelope.algorithm !== "A256GCM"
    || input.envelope.expiresAtMs !== input.context.expiresAtMs
  ) {
    throw new Error("MEDIA_GRANT_ENVELOPE_INVALID");
  }
  try {
    const decipher = createDecipheriv(
      "aes-256-gcm",
      input.masterKey,
      Buffer.from(input.envelope.nonce, "base64url"),
    );
    decipher.setAAD(aad(input.context));
    decipher.setAuthTag(Buffer.from(input.envelope.authTag, "base64url"));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(input.envelope.ciphertext, "base64url")),
      decipher.final(),
    ]);
    const grant = JSON.parse(plaintext.toString("utf8")) as MediaJoinGrant;
    validateContextAndGrant(input.context, grant);
    return grant;
  } catch (error) {
    if (
      error instanceof Error
      && (error.message === "MEDIA_GRANT_ENVELOPE_INVALID"
        || error.message === "MEDIA_GRANT_INVALID")
    ) {
      throw error;
    }
    throw new Error("MEDIA_GRANT_ENVELOPE_INVALID");
  }
}

function aad(context: MediaGrantEnvelopeContext): Buffer {
  return Buffer.from(JSON.stringify([
    "cyrene-media-grant-envelope-v1",
    context.callId,
    context.endpointDeviceId,
    context.endpointKind,
    context.expiresAtMs,
  ]), "utf8");
}

function requireMasterKey(value: Uint8Array): void {
  if (value.byteLength !== 32) {
    throw new Error("MEDIA_ENVELOPE_MASTER_KEY_INVALID");
  }
}

function validateContextAndGrant(
  context: MediaGrantEnvelopeContext,
  grant: MediaJoinGrant,
): void {
  if (
    !context.callId
    || !context.endpointDeviceId
    || (context.endpointKind !== "DESKTOP" && context.endpointKind !== "MOBILE")
    || !Number.isSafeInteger(context.expiresAtMs)
    || grant.callId !== context.callId
    || grant.endpointDeviceId !== context.endpointDeviceId
    || !grant.participantIdentity
    || !grant.peerIdentity
    || grant.participantIdentity === grant.peerIdentity
    || !/^wss:\/\//.test(grant.serverUrl)
    || !grant.participantToken
    || !grant.e2eeKey
    || !Number.isFinite(Date.parse(grant.expiresAt))
  ) {
    throw new Error("MEDIA_GRANT_INVALID");
  }
}
