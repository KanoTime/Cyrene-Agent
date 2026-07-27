import { describe, expect, it } from "vitest";
import { CallDataCipher as MobileCallDataCipher } from "../../../mobile/src/call-data-cipher";
import { CallDataCipher as DesktopCallDataCipher } from "./call-data-cipher";

const BASE_KEY = new Uint8Array(32).map((_, index) => index);
const FIXED_NONCE = new Uint8Array(24).fill(7);
const MESSAGE = new TextEncoder().encode("晚间闲聊");

describe("CallDataCipher", () => {
  it("interoperates between desktop and mobile with direction-separated keys", () => {
    const desktop = new DesktopCallDataCipher(
      BASE_KEY,
      "desktop",
      () => FIXED_NONCE.slice(),
    );
    const mobile = new MobileCallDataCipher(
      BASE_KEY,
      "mobile",
      () => FIXED_NONCE.slice(),
    );

    expect(mobile.decrypt(desktop.encrypt(MESSAGE))).toEqual(MESSAGE);
    expect(desktop.decrypt(mobile.encrypt(MESSAGE))).toEqual(MESSAGE);
  });

  it("rejects tampering, reflection, malformed envelopes, and oversized plaintext", () => {
    const desktop = new DesktopCallDataCipher(
      BASE_KEY,
      "desktop",
      () => FIXED_NONCE.slice(),
    );
    const encrypted = desktop.encrypt(MESSAGE);
    encrypted[encrypted.length - 1] ^= 1;

    expect(() => desktop.decrypt(encrypted)).toThrow("CALL_DATA_DECRYPT_FAILED");
    expect(() => desktop.decrypt(new Uint8Array([1, 2, 3]))).toThrow(
      "CALL_DATA_ENVELOPE_INVALID",
    );
    expect(() => desktop.encrypt(new Uint8Array(15 * 1024))).toThrow(
      "CALL_DATA_TOO_LARGE",
    );
  });

  it("wipes its derived keys when disposed", () => {
    const desktop = new DesktopCallDataCipher(
      BASE_KEY,
      "desktop",
      () => FIXED_NONCE.slice(),
    );
    desktop.dispose();

    expect(() => desktop.encrypt(MESSAGE)).toThrow("CALL_DATA_CIPHER_DISPOSED");
    expect(() => desktop.decrypt(new Uint8Array(64))).toThrow(
      "CALL_DATA_CIPHER_DISPOSED",
    );
  });

  it("fits a worst-case 12-item catalog inside LiveKit's 15 KiB limit", () => {
    const desktop = new DesktopCallDataCipher(
      BASE_KEY,
      "desktop",
      () => FIXED_NONCE.slice(),
    );
    const catalog = new TextEncoder().encode(JSON.stringify({
      type: "conversation.catalog",
      conversations: Array.from({ length: 12 }, (_, index) => ({
        id: `00000000-0000-4000-8000-${String(index + 1).padStart(12, "0")}`,
        title: "😀".repeat(80),
        createdAt: Number.MAX_SAFE_INTEGER,
        updatedAt: Number.MAX_SAFE_INTEGER,
        turnCount: Number.MAX_SAFE_INTEGER,
        preview: "😀".repeat(120),
      })),
      mode: "automatic",
      replace: true,
    }));

    expect(desktop.encrypt(catalog).byteLength).toBeLessThanOrEqual(15 * 1024);
  });
});
