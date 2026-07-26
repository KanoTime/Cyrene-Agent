import { beforeEach, describe, expect, it, vi } from "vitest";

const electronState = vi.hoisted(() => ({ available: true }));

vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => electronState.available,
    encryptString: (plain: string) => Buffer.from(`device-bound:${plain}`, "utf8"),
    decryptString: (encrypted: Buffer) =>
      encrypted.toString("utf8").replace(/^device-bound:/, ""),
  },
}));

import {
  WechatCredentialStorageUnavailableError,
  createWechatSafeStorageCipher,
} from "./wechat-credential-cipher";

describe("微信凭据设备绑定加密", () => {
  beforeEach(() => {
    electronState.available = true;
  });

  it("safeStorage 可用时可加密并解密凭据载荷", () => {
    const cipher = createWechatSafeStorageCipher();
    const encrypted = cipher.encrypt("wechat-secret-payload");

    expect(encrypted.toString("utf8")).not.toBe("wechat-secret-payload");
    expect(cipher.decrypt(encrypted)).toBe("wechat-secret-payload");
  });

  it("safeStorage 不可用时拒绝保存，不降级为混淆或明文", () => {
    electronState.available = false;
    const cipher = createWechatSafeStorageCipher();

    expect(() => cipher.encrypt("must-not-fallback")).toThrow(
      WechatCredentialStorageUnavailableError,
    );
  });
});
