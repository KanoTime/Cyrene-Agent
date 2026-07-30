// PROTOTYPE ONLY — RFC 9180 Auth-mode candidate, not a production key protocol.
import { Buffer } from "react-native-quick-crypto";
import { AeadId, CipherSuite, KdfId, KemId } from "hpke-js";

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();
const suite = new CipherSuite({
  kem: KemId.DhkemX25519HkdfSha256,
  kdf: KdfId.HkdfSha256,
  aead: AeadId.Chacha20Poly1305,
});
const INFO = textEncoder.encode("cyrene-issue69-hpke-auth-v1");

const ROLE_IKM_HEX = {
  desktop: "1111111111111111111111111111111111111111111111111111111111111111",
  mobile: "2222222222222222222222222222222222222222222222222222222222222222",
  wrong: "3333333333333333333333333333333333333333333333333333333333333333",
} as const;

export interface PrototypeRoleKey {
  keyPair: CryptoKeyPair;
  fingerprint: string;
}

export interface RelayOuter {
  protocolVersion: 1;
  ownerRoute: string;
  senderDeviceId: string;
  targetDeviceId: string;
  channelEpoch: string;
  senderSequence: number;
  messageType: string;
  operationId: string;
}

export interface RelayEnvelope extends RelayOuter {
  encapsulatedKey: string;
  ciphertext: string;
}

export async function deriveRole(
  role: keyof typeof ROLE_IKM_HEX,
): Promise<PrototypeRoleKey> {
  const keyPair = await suite.kem.deriveKeyPair(hexToBytes(ROLE_IKM_HEX[role]));
  const publicKey = new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey));
  return { keyPair, fingerprint: base64url(publicKey).slice(0, 16) };
}

export async function sealEnvelope(
  sender: PrototypeRoleKey,
  recipient: PrototypeRoleKey,
  outer: RelayOuter,
  inner: Record<string, unknown>,
): Promise<RelayEnvelope> {
  const result = await suite.seal(
    {
      recipientPublicKey: recipient.keyPair.publicKey,
      senderKey: sender.keyPair,
      info: INFO,
    },
    textEncoder.encode(JSON.stringify(inner)),
    textEncoder.encode(canonicalOuter(outer)),
  );
  return {
    ...outer,
    encapsulatedKey: base64url(new Uint8Array(result.enc)),
    ciphertext: base64url(new Uint8Array(result.ct)),
  };
}

export async function openEnvelope(
  recipient: PrototypeRoleKey,
  sender: PrototypeRoleKey,
  envelope: RelayEnvelope,
): Promise<Record<string, unknown>> {
  const outer: RelayOuter = {
    protocolVersion: envelope.protocolVersion,
    ownerRoute: envelope.ownerRoute,
    senderDeviceId: envelope.senderDeviceId,
    targetDeviceId: envelope.targetDeviceId,
    channelEpoch: envelope.channelEpoch,
    senderSequence: envelope.senderSequence,
    messageType: envelope.messageType,
    operationId: envelope.operationId,
  };
  const plaintext = await suite.open(
    {
      recipientKey: recipient.keyPair,
      senderPublicKey: sender.keyPair.publicKey,
      enc: fromBase64url(envelope.encapsulatedKey),
      info: INFO,
    },
    fromBase64url(envelope.ciphertext),
    textEncoder.encode(canonicalOuter(outer)),
  );
  return JSON.parse(textDecoder.decode(plaintext)) as Record<string, unknown>;
}

export async function verifyRfc9180AuthVector(): Promise<boolean> {
  const vector = {
    info: "4f6465206f6e2061204772656369616e2055726e",
    ikmR: "64835d5ee64aa7aad57c6f2e4f758f7696617f8829e70bc9ac7a5ef95d1c756c",
    ikmS: "9d8f94537d5a3ddef71234c0baedfad4ca6861634d0b94c3007fed557ad17df6",
    ikmE: "938d3daa5a8904540bc24f48ae90eed3f4f7f11839560597b55e7c9598c996c0",
    enc: "f7674cc8cd7baa5872d1f33dbaffe3314239f6197ddf5ded1746760bfc847e0e",
    aad: "436f756e742d30",
    pt: "4265617574792069732074727574682c20747275746820626561757479",
    ct: "ab1a13c9d4f01a87ec3440dbd756e2677bd2ecf9df0ce7ed73869b98e00c09be111cb9fdf077347aeb88e61bdf",
  };
  const recipient = await suite.kem.deriveKeyPair(hexToBytes(vector.ikmR));
  const sender = await suite.kem.deriveKeyPair(hexToBytes(vector.ikmS));
  const result = await suite.seal(
    {
      recipientPublicKey: recipient.publicKey,
      senderKey: sender,
      info: hexToBytes(vector.info),
      ekm: hexToBytes(vector.ikmE),
    },
    hexToBytes(vector.pt),
    hexToBytes(vector.aad),
  );
  return bytesToHex(new Uint8Array(result.enc)) === vector.enc
    && bytesToHex(new Uint8Array(result.ct)) === vector.ct;
}

export function tamperCiphertext(envelope: RelayEnvelope): RelayEnvelope {
  const bytes = fromBase64url(envelope.ciphertext);
  bytes[Math.max(0, bytes.length - 1)] ^= 1;
  return { ...envelope, ciphertext: base64url(bytes) };
}

function canonicalOuter(outer: RelayOuter): string {
  return JSON.stringify({
    protocolVersion: outer.protocolVersion,
    ownerRoute: outer.ownerRoute,
    senderDeviceId: outer.senderDeviceId,
    targetDeviceId: outer.targetDeviceId,
    channelEpoch: outer.channelEpoch,
    senderSequence: outer.senderSequence,
    messageType: outer.messageType,
    operationId: outer.operationId,
  });
}

function hexToBytes(value: string): Uint8Array {
  return Uint8Array.from(value.match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64url(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
