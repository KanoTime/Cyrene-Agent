import { randomBytes } from "node:crypto";
import { xchacha20poly1305 } from "@noble/ciphers/chacha";
import { hkdf } from "@noble/hashes/hkdf";
import { sha256 } from "@noble/hashes/sha256";

export type CallDataCipherRole = "desktop" | "mobile";

const ENVELOPE_VERSION = 1;
const NONCE_BYTES = 24;
const AUTH_TAG_BYTES = 16;
const MAX_LIVEKIT_RELIABLE_BYTES = 15 * 1024;
const MAX_PLAINTEXT_BYTES =
  MAX_LIVEKIT_RELIABLE_BYTES - 1 - NONCE_BYTES - AUTH_TAG_BYTES;
const KDF_SALT = new TextEncoder().encode("cyrene-livekit-call-data-v1");
const DESKTOP_TO_MOBILE_INFO = new TextEncoder().encode(
  "cyrene-call-data/desktop-to-mobile",
);
const MOBILE_TO_DESKTOP_INFO = new TextEncoder().encode(
  "cyrene-call-data/mobile-to-desktop",
);
const DESKTOP_TO_MOBILE_AAD = new TextEncoder().encode(
  "cyrene-call-data-v1|desktop-to-mobile",
);
const MOBILE_TO_DESKTOP_AAD = new TextEncoder().encode(
  "cyrene-call-data-v1|mobile-to-desktop",
);

type NonceSource = (length: number) => Uint8Array;

/**
 * Application-layer AEAD for LiveKit data packets.
 *
 * LiveKit frame E2EE protects media but rtc-node does not encrypt user data
 * packets. This class derives independent directional keys from the per-call
 * media key and authenticates every control/event packet.
 */
export class CallDataCipher {
  private readonly sendKey: Uint8Array;
  private readonly receiveKey: Uint8Array;
  private readonly sendAad: Uint8Array;
  private readonly receiveAad: Uint8Array;
  private disposed = false;

  constructor(
    baseKey: Uint8Array,
    role: CallDataCipherRole,
    private readonly nonceSource: NonceSource = (length) => randomBytes(length),
  ) {
    if (baseKey.byteLength !== 32) throw new Error("CALL_DATA_KEY_INVALID");
    const desktopToMobileKey = hkdf(
      sha256,
      baseKey,
      KDF_SALT,
      DESKTOP_TO_MOBILE_INFO,
      32,
    );
    const mobileToDesktopKey = hkdf(
      sha256,
      baseKey,
      KDF_SALT,
      MOBILE_TO_DESKTOP_INFO,
      32,
    );
    if (role === "desktop") {
      this.sendKey = desktopToMobileKey;
      this.receiveKey = mobileToDesktopKey;
      this.sendAad = DESKTOP_TO_MOBILE_AAD;
      this.receiveAad = MOBILE_TO_DESKTOP_AAD;
    } else {
      this.sendKey = mobileToDesktopKey;
      this.receiveKey = desktopToMobileKey;
      this.sendAad = MOBILE_TO_DESKTOP_AAD;
      this.receiveAad = DESKTOP_TO_MOBILE_AAD;
    }
  }

  encrypt(plaintext: Uint8Array): Uint8Array {
    this.assertActive();
    if (plaintext.byteLength > MAX_PLAINTEXT_BYTES) {
      throw new Error("CALL_DATA_TOO_LARGE");
    }
    const nonce = this.nonceSource(NONCE_BYTES);
    if (nonce.byteLength !== NONCE_BYTES) throw new Error("CALL_DATA_NONCE_INVALID");
    const ciphertext = xchacha20poly1305(
      this.sendKey,
      nonce,
      this.sendAad,
    ).encrypt(plaintext);
    const envelope = new Uint8Array(1 + NONCE_BYTES + ciphertext.byteLength);
    envelope[0] = ENVELOPE_VERSION;
    envelope.set(nonce, 1);
    envelope.set(ciphertext, 1 + NONCE_BYTES);
    return envelope;
  }

  decrypt(envelope: Uint8Array): Uint8Array {
    this.assertActive();
    if (
      envelope.byteLength < 1 + NONCE_BYTES + AUTH_TAG_BYTES
      || envelope.byteLength > MAX_LIVEKIT_RELIABLE_BYTES
      || envelope[0] !== ENVELOPE_VERSION
    ) {
      throw new Error("CALL_DATA_ENVELOPE_INVALID");
    }
    const nonce = envelope.slice(1, 1 + NONCE_BYTES);
    const ciphertext = envelope.slice(1 + NONCE_BYTES);
    try {
      return xchacha20poly1305(
        this.receiveKey,
        nonce,
        this.receiveAad,
      ).decrypt(ciphertext);
    } catch {
      throw new Error("CALL_DATA_DECRYPT_FAILED");
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.sendKey.fill(0);
    this.receiveKey.fill(0);
  }

  private assertActive(): void {
    if (this.disposed) throw new Error("CALL_DATA_CIPHER_DISPOSED");
  }
}
