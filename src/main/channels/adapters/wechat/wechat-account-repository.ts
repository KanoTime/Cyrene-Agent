import path from "node:path";
import { readFile, unlink } from "node:fs/promises";
import type { Credentials } from "./ilink-protocol-client";
import {
  WechatAccountStore,
  type WechatAccountRecord,
  type WechatCredentialCipher,
} from "./wechat-account-store";
import { migrateLegacyWechatAccount } from "./wechat-account-migration";

export interface WechatAccountRepositoryOptions {
  userDataDir: string;
  cipher: WechatCredentialCipher;
}

/**
 * 账号持久化的应用级入口。
 *
 * #34 阶段仍给旧单连接 adapter 返回第一个已启用账号；#35 的连接池将直接消费
 * listAccounts() 并逐账号加载凭据，不再经过 loadPrimaryCredentials()。
 */
export class WechatAccountRepository {
  readonly #store: WechatAccountStore;
  readonly #legacyPath: string;
  readonly #archiveDir: string;
  #legacyCompatibilityCredentials: Credentials | null = null;

  constructor(options: WechatAccountRepositoryOptions) {
    const weixinDir = path.join(options.userDataDir, "weixin");
    this.#store = new WechatAccountStore({
      rootDir: path.join(weixinDir, "accounts"),
      cipher: options.cipher,
    });
    this.#legacyPath = path.join(weixinDir, "credentials.json");
    this.#archiveDir = path.join(weixinDir, "legacy-archive");
  }

  async loadPrimaryCredentials(): Promise<Credentials | null> {
    const account = (await this.listAccounts()).find(
      (candidate) => candidate.enabled && candidate.credentialStatus === "available",
    );
    return account ? this.loadCredentials(account.ilinkBotId) : null;
  }

  async save(credentials: Credentials): Promise<WechatAccountRecord> {
    return this.#store.upsertAccount({
      label: credentials.accountId,
      enabled: true,
      credentials,
    });
  }

  async clearCredentials(ilinkBotId: string): Promise<void> {
    await this.#store.clearCredentials(ilinkBotId);
    try {
      const legacy = JSON.parse(await readFile(this.#legacyPath, "utf8")) as Partial<Credentials>;
      if (legacy.ilinkBotId === ilinkBotId) await unlink(this.#legacyPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException)?.code !== "ENOENT") {
        // 无法确认归属的旧文件必须保留，避免登出一个账号误删另一个账号的凭据。
      }
    }
  }

  async listAccounts(): Promise<WechatAccountRecord[]> {
    await this.#prepareLegacyMigration();
    const accounts = await this.#store.listAccounts();
    const legacy = this.#legacyCompatibilityCredentials;
    if (!legacy) return accounts;
    const existing = accounts.find((account) => account.ilinkBotId === legacy.ilinkBotId);
    if (existing) {
      return accounts.map((account) =>
        account.ilinkBotId === legacy.ilinkBotId
          ? { ...account, enabled: true, credentialStatus: "available" }
          : account,
      );
    }
    const now = Date.now();
    return [
      ...accounts,
      {
        ilinkBotId: legacy.ilinkBotId,
        label: legacy.accountId || legacy.ilinkBotId.split("@", 1)[0] || "微信账号",
        enabled: true,
        credentialStatus: "available",
        createdAt: now,
        updatedAt: now,
      },
    ];
  }

  async loadCredentials(ilinkBotId: string): Promise<Credentials | null> {
    await this.#prepareLegacyMigration();
    if (this.#legacyCompatibilityCredentials?.ilinkBotId === ilinkBotId) {
      return { ...this.#legacyCompatibilityCredentials };
    }
    return this.#store.loadCredentials(ilinkBotId);
  }

  async updateAccount(
    ilinkBotId: string,
    patch: import("./wechat-account-store").UpdateWechatAccountInput,
  ): Promise<WechatAccountRecord | null> {
    return this.#store.updateAccount(ilinkBotId, patch);
  }

  async removeAccount(ilinkBotId: string): Promise<void> {
    await this.#store.removeAccount(ilinkBotId);
  }

  async #prepareLegacyMigration(): Promise<void> {
    const migration = await migrateLegacyWechatAccount({
      legacyPath: this.#legacyPath,
      archiveDir: this.#archiveDir,
      store: this.#store,
    });
    this.#legacyCompatibilityCredentials =
      migration.status === "legacy-compatibility" ? migration.credentials : null;
  }
}
