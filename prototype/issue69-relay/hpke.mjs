// PROTOTYPE ONLY — RFC 9180 Auth-mode candidate, not a production key protocol.
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
};

export async function deriveRole(role) {
  const keyPair = await suite.kem.deriveKeyPair(hexToBytes(ROLE_IKM_HEX[role]));
  const publicKey = new Uint8Array(await suite.kem.serializePublicKey(keyPair.publicKey));
  return { role, keyPair, publicKey, fingerprint: base64url(publicKey).slice(0, 16) };
}

export async function sealEnvelope({
  sender,
  recipient,
  outer,
  inner,
  deterministicEkm,
}) {
  const aad = canonicalOuter(outer);
  const result = await suite.seal(
    {
      recipientPublicKey: recipient.keyPair.publicKey,
      senderKey: sender.keyPair,
      info: INFO,
      ...(deterministicEkm ? { ekm: deterministicEkm } : {}),
    },
    textEncoder.encode(JSON.stringify(inner)),
    textEncoder.encode(aad),
  );
  return {
    ...outer,
    encapsulatedKey: base64url(new Uint8Array(result.enc)),
    ciphertext: base64url(new Uint8Array(result.ct)),
  };
}

export async function openEnvelope({ recipient, sender, envelope }) {
  const outer = {
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
  return JSON.parse(textDecoder.decode(plaintext));
}

export async function verifyRfc9180AuthVector() {
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
  const enc = bytesToHex(new Uint8Array(result.enc));
  const ct = bytesToHex(new Uint8Array(result.ct));
  const opened = await suite.open(
    {
      recipientKey: recipient,
      senderPublicKey: sender.publicKey,
      enc: result.enc,
      info: hexToBytes(vector.info),
    },
    result.ct,
    hexToBytes(vector.aad),
  );
  return {
    passed: enc === vector.enc
      && ct === vector.ct
      && bytesToHex(new Uint8Array(opened)) === vector.pt,
    enc,
    ct,
  };
}

export function tamperCiphertext(envelope) {
  const bytes = fromBase64url(envelope.ciphertext);
  bytes[Math.max(0, bytes.length - 1)] ^= 1;
  return { ...envelope, ciphertext: base64url(bytes) };
}

function canonicalOuter(outer) {
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

function hexToBytes(value) {
  if (value.length % 2 !== 0) throw new Error("HEX_INVALID");
  return Uint8Array.from(value.match(/../gu) ?? [], (byte) => Number.parseInt(byte, 16));
}

function bytesToHex(bytes) {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function base64url(bytes) {
  return Buffer.from(bytes).toString("base64url");
}

function fromBase64url(value) {
  return new Uint8Array(Buffer.from(value, "base64url"));
}
