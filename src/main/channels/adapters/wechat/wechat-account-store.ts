import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Credentials } from "./ilink-protocol-client";

export type WechatCredentialStatus = "available" | "missing" | "corrupt";

export interface WechatAccountRecord {
  ilinkBotId: string;
  label: string;
  enabled: boolean;
  credentialStatus: WechatCredentialStatus;
  createdAt: number;
  updatedAt: number;
}

export interface WechatCredentialCipher {
  encrypt(plain: string): Buffer;
  decrypt(encrypted: Buffer): string;
}

export interface WechatAccountStoreOptions {
  rootDir: string;
  cipher: WechatCredentialCipher;
  now?: () => number;
}

export interface UpsertWechatAccountInput {
  label?: string;
  enabled?: boolean;
  credentials: Credentials;
}

export interface UpdateWechatAccountInput {
  label?: string;
  enabled?: boolean;
}

interface AccountRegistryFile {
  version: 1;
  accounts: WechatAccountRecord[];
}

const EMPTY_REGISTRY: AccountRegistryFile = { version: 1, accounts: [] };

export class WechatAccountStore {
  readonly #rootDir: string;
  readonly #cipher: WechatCredentialCipher;
  readonly #now: () => number;
  #mutationQueue: Promise<void> = Promise.resolve();

  constructor(options: WechatAccountStoreOptions) {
    this.#rootDir = options.rootDir;
    this.#cipher = options.cipher;
    this.#now = options.now ?? Date.now;
  }

  async upsertAccount(input: UpsertWechatAccountInput): Promise<WechatAccountRecord> {
    return this.#mutate(async () => {
      const ilinkBotId = input.credentials.ilinkBotId.trim();
      if (!ilinkBotId) throw new Error("ilinkBotId 不能为空");
      if (!input.credentials.botToken.trim()) throw new Error("botToken 不能为空");
      if (!input.credentials.baseUrl.trim()) throw new Error("baseUrl 不能为空");
      if (!input.credentials.ilinkUserId.trim()) throw new Error("ilinkUserId 不能为空");
      const credentials: Credentials = {
        ...input.credentials,
        ilinkBotId,
        botToken: input.credentials.botToken.trim(),
        baseUrl: input.credentials.baseUrl.trim(),
        ilinkUserId: input.credentials.ilinkUserId.trim(),
      };

      const registry = await this.#loadRegistry();
      const existing = registry.accounts.find((account) => account.ilinkBotId === ilinkBotId);
      const now = this.#now();
      const account: WechatAccountRecord = {
        ilinkBotId,
        label: input.label?.trim() || existing?.label || displayId(ilinkBotId),
        enabled: input.enabled ?? existing?.enabled ?? true,
        credentialStatus: "available",
        createdAt: existing?.createdAt ?? now,
        updatedAt: now,
      };

      await this.#writeCredentials(credentials);
      if (existing) Object.assign(existing, account);
      else registry.accounts.push(account);
      await this.#writeJsonAtomic(this.#registryPath(), registry);
      return { ...account };
    });
  }

  async updateAccount(
    ilinkBotId: string,
    patch: UpdateWechatAccountInput,
  ): Promise<WechatAccountRecord | null> {
    return this.#mutate(async () => {
      const registry = await this.#loadRegistry();
      const account = registry.accounts.find((candidate) => candidate.ilinkBotId === ilinkBotId);
      if (!account) return null;
      if (typeof patch.label === "string" && patch.label.trim()) account.label = patch.label.trim();
      if (typeof patch.enabled === "boolean") account.enabled = patch.enabled;
      account.updatedAt = this.#now();
      await this.#writeJsonAtomic(this.#registryPath(), registry);
      return { ...account };
    });
  }

  async clearCredentials(ilinkBotId: string): Promise<void> {
    await this.#mutate(async () => {
      try {
        await unlink(this.#credentialPath(ilinkBotId));
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      const registry = await this.#loadRegistry();
      const account = registry.accounts.find((candidate) => candidate.ilinkBotId === ilinkBotId);
      if (account) {
        account.credentialStatus = "missing";
        account.updatedAt = this.#now();
        await this.#writeJsonAtomic(this.#registryPath(), registry);
      }
    });
  }

  async removeAccount(ilinkBotId: string): Promise<void> {
    await this.#mutate(async () => {
      try {
        await unlink(this.#credentialPath(ilinkBotId));
      } catch (error) {
        if (!isMissingFile(error)) throw error;
      }
      const registry = await this.#loadRegistry();
      const accounts = registry.accounts.filter((account) => account.ilinkBotId !== ilinkBotId);
      if (accounts.length !== registry.accounts.length) {
        await this.#writeJsonAtomic(this.#registryPath(), { ...registry, accounts });
      }
    });
  }

  async getAccount(ilinkBotId: string): Promise<WechatAccountRecord | null> {
    const account = (await this.listAccounts()).find(
      (candidate) => candidate.ilinkBotId === ilinkBotId,
    );
    return account ? { ...account } : null;
  }

  async listAccounts(): Promise<WechatAccountRecord[]> {
    const registry = await this.#loadRegistry();
    return Promise.all(
      registry.accounts.map(async (account) => {
        const result = await this.#readCredentials(account.ilinkBotId);
        return { ...account, credentialStatus: result.status };
      }),
    );
  }

  async loadCredentials(ilinkBotId: string): Promise<Credentials | null> {
    const result = await this.#readCredentials(ilinkBotId);
    return result.status === "available" ? result.credentials : null;
  }

  async #loadRegistry(): Promise<AccountRegistryFile> {
    try {
      const parsed = JSON.parse(await readFile(this.#registryPath(), "utf8")) as AccountRegistryFile;
      if (parsed.version !== 1 || !Array.isArray(parsed.accounts)) return { ...EMPTY_REGISTRY, accounts: [] };
      return parsed;
    } catch (error) {
      if (isMissingFile(error)) return { ...EMPTY_REGISTRY, accounts: [] };
      throw error;
    }
  }

  async #writeCredentials(credentials: Credentials): Promise<void> {
    const encrypted = this.#cipher.encrypt(JSON.stringify(credentials));
    await this.#writeAtomic(this.#credentialPath(credentials.ilinkBotId), encrypted);
  }

  #mutate<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.#mutationQueue.then(operation);
    this.#mutationQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }

  async #readCredentials(
    ilinkBotId: string,
  ): Promise<
    | { status: "available"; credentials: Credentials }
    | { status: "missing" | "corrupt" }
  > {
    try {
      const encrypted = await readFile(this.#credentialPath(ilinkBotId));
      const credentials = JSON.parse(this.#cipher.decrypt(encrypted)) as Partial<Credentials>;
      if (
        credentials.ilinkBotId !== ilinkBotId ||
        !credentials.botToken ||
        !credentials.baseUrl ||
        !credentials.ilinkUserId
      ) {
        return { status: "corrupt" };
      }
      return { status: "available", credentials: credentials as Credentials };
    } catch (error) {
      return { status: isMissingFile(error) ? "missing" : "corrupt" };
    }
  }

  async #writeJsonAtomic(filePath: string, value: unknown): Promise<void> {
    await this.#writeAtomic(filePath, Buffer.from(JSON.stringify(value, null, 2), "utf8"));
  }

  async #writeAtomic(filePath: string, content: Buffer): Promise<void> {
    await mkdir(path.dirname(filePath), { recursive: true, mode: 0o700 });
    const temporaryPath = `${filePath}.${randomUUID()}.tmp`;
    await writeFile(temporaryPath, content, { mode: 0o600 });
    await rename(temporaryPath, filePath);
  }

  #registryPath(): string {
    return path.join(this.#rootDir, "accounts.json");
  }

  #credentialPath(ilinkBotId: string): string {
    const key = createHash("sha256").update(ilinkBotId).digest("hex");
    return path.join(this.#rootDir, "credentials", `${key}.bin`);
  }
}

function displayId(ilinkBotId: string): string {
  return ilinkBotId.split("@", 1)[0] || "微信账号";
}

function isMissingFile(error: unknown): boolean {
  return (error as NodeJS.ErrnoException)?.code === "ENOENT";
}
