import { safeStorage } from "electron";
import type { WechatCredentialCipher } from "./wechat-account-store";

export class WechatCredentialStorageUnavailableError extends Error {
  constructor() {
    super("系统安全存储当前不可用，无法保存微信登录凭据");
    this.name = "WechatCredentialStorageUnavailableError";
  }
}

export function createWechatSafeStorageCipher(): WechatCredentialCipher {
  const assertAvailable = (): void => {
    let available = false;
    try {
      available = safeStorage.isEncryptionAvailable();
    } catch {
      available = false;
    }
    if (!available) throw new WechatCredentialStorageUnavailableError();
  };

  return {
    encrypt(plain: string): Buffer {
      assertAvailable();
      return safeStorage.encryptString(plain);
    },
    decrypt(encrypted: Buffer): string {
      assertAvailable();
      return safeStorage.decryptString(encrypted);
    },
  };
}
