import { randomBytes } from "node:crypto";
import { createMobileCallCredentials } from "../mobile-call/livekit-call-credentials";
import {
  type EncryptedMediaGrantEnvelope,
  type MediaGrantEnvelopeContext,
  type MediaJoinGrant,
  openMediaGrantEnvelope,
  sealMediaGrantEnvelope,
} from "./media-grant-envelope";

const ENVELOPE_TTL_MS = 30 * 1000;

export interface IssuedMediaGrantEnvelopes {
  expiresAtMs: number;
  mobileEnvelope: EncryptedMediaGrantEnvelope;
  desktopEnvelope: EncryptedMediaGrantEnvelope;
}

export class LiveKitMediaGrantService {
  readonly #serverUrl: string;
  readonly #apiKey: string;
  readonly #apiSecret: string;
  readonly #envelopeMasterKey: Uint8Array;
  readonly #now: () => number;

  constructor(options: {
    serverUrl: string;
    apiKey: string;
    apiSecret: string;
    envelopeMasterKey: Uint8Array;
    now?: () => number;
  }) {
    this.#serverUrl = options.serverUrl;
    this.#apiKey = options.apiKey;
    this.#apiSecret = options.apiSecret;
    this.#envelopeMasterKey = options.envelopeMasterKey;
    this.#now = options.now ?? Date.now;
  }

  async issue(input: {
    callId: string;
    mobileDeviceId: string;
    desktopDeviceId: string;
    mobileLabel: string;
    envelopeNotAfterMs: number;
  }): Promise<IssuedMediaGrantEnvelopes> {
    const issuedAtMs = this.#now();
    const credentials = await createMobileCallCredentials({
      serverUrl: this.#serverUrl,
      apiKey: this.#apiKey,
      apiSecret: this.#apiSecret,
      tokenTtlSeconds: 5 * 60,
    }, {
      callId: input.callId,
      now: new Date(issuedAtMs),
      deviceName: input.mobileLabel,
    });
    const e2eeKey = randomBytes(32).toString("base64url");
    const expiresAtMs = Math.min(
      issuedAtMs + ENVELOPE_TTL_MS,
      input.envelopeNotAfterMs,
    );
    if (!Number.isSafeInteger(expiresAtMs) || expiresAtMs <= issuedAtMs) {
      throw new Error("MEDIA_GRANT_ISSUANCE_FAILED");
    }
    const mobileContext: MediaGrantEnvelopeContext = {
      callId: input.callId,
      endpointDeviceId: input.mobileDeviceId,
      endpointKind: "MOBILE",
      expiresAtMs,
    };
    const desktopContext: MediaGrantEnvelopeContext = {
      callId: input.callId,
      endpointDeviceId: input.desktopDeviceId,
      endpointKind: "DESKTOP",
      expiresAtMs,
    };
    return {
      expiresAtMs,
      mobileEnvelope: sealMediaGrantEnvelope({
        masterKey: this.#envelopeMasterKey,
        context: mobileContext,
        grant: {
          callId: input.callId,
          endpointDeviceId: input.mobileDeviceId,
          participantIdentity: credentials.mobileIdentity,
          peerIdentity: credentials.agentIdentity,
          serverUrl: credentialsServerUrl(credentials.mobileLink),
          participantToken: credentials.mobileToken,
          e2eeKey,
          expiresAt: credentials.expiresAt,
        },
      }),
      desktopEnvelope: sealMediaGrantEnvelope({
        masterKey: this.#envelopeMasterKey,
        context: desktopContext,
        grant: {
          callId: input.callId,
          endpointDeviceId: input.desktopDeviceId,
          participantIdentity: credentials.agentIdentity,
          peerIdentity: credentials.mobileIdentity,
          serverUrl: credentialsServerUrl(credentials.mobileLink),
          participantToken: credentials.agentToken,
          e2eeKey,
          expiresAt: credentials.expiresAt,
        },
      }),
    };
  }

  open(input: MediaGrantEnvelopeContext & {
    envelope: EncryptedMediaGrantEnvelope;
  }): MediaJoinGrant {
    const { envelope, ...context } = input;
    return openMediaGrantEnvelope({
      masterKey: this.#envelopeMasterKey,
      context,
      envelope,
      nowMs: this.#now(),
    });
  }
}

function credentialsServerUrl(mobileLink: string): string {
  const value = new URL(mobileLink).searchParams.get("serverUrl");
  if (!value) throw new Error("MEDIA_GRANT_ISSUANCE_FAILED");
  return value;
}
