import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import type { IncomingMessage } from "../../types";
import type { WechatCredentialCipher } from "./wechat-account-store";

export interface WechatPendingInboundEntry {
  id: string;
  accountId: string;
  participantId: string;
  contextToken: string;
  incoming: IncomingMessage;
}

interface WechatPendingInboundStoreOptions {
  rootDir: string;
  cipher: WechatCredentialCipher;
}

export class WechatPendingInboundStore {
  constructor(private readonly options: WechatPendingInboundStoreOptions) {}

  async save(entry: WechatPendingInboundEntry): Promise<void> {
    assertEntry(entry);
    await mkdir(this.options.rootDir, { recursive: true, mode: 0o700 });
    const payload = JSON.stringify({
      ...entry,
      incoming: {
        ...entry.incoming,
        at: entry.incoming.at.toISOString(),
        _raw: undefined,
      },
    });
    const encrypted = this.options.cipher.encrypt(payload);
    const destination = this.filePath(entry.accountId, entry.id);
    const temporary = `${destination}.${randomUUID()}.tmp`;
    await writeFile(temporary, encrypted, { mode: 0o600 });
    await rename(temporary, destination);
  }

  async list(): Promise<WechatPendingInboundEntry[]> {
    let names: string[];
    try {
      names = (await readdir(this.options.rootDir)).filter((name) => name.endsWith(".bin"));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
    const entries: WechatPendingInboundEntry[] = [];
    for (const name of names) {
      try {
        const encrypted = await readFile(path.join(this.options.rootDir, name));
        const parsed = JSON.parse(this.options.cipher.decrypt(encrypted)) as Omit<WechatPendingInboundEntry, "incoming"> & {
          incoming: Omit<IncomingMessage, "at"> & { at: string };
        };
        const entry: WechatPendingInboundEntry = {
          ...parsed,
          incoming: { ...parsed.incoming, at: new Date(parsed.incoming.at) },
        };
        assertEntry(entry);
        entries.push(entry);
      } catch {
        // 单条损坏不影响其他待恢复消息；保留原文件供诊断。
      }
    }
    return entries.sort((left, right) => left.incoming.at.getTime() - right.incoming.at.getTime());
  }

  async complete(id: string, accountId: string): Promise<void> {
    try {
      await unlink(this.filePath(accountId, id));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
  }

  async removeAccount(accountId: string): Promise<void> {
    const entries = await this.list();
    await Promise.all(entries
      .filter((entry) => entry.accountId === accountId)
      .map((entry) => this.complete(entry.id, entry.accountId)));
  }

  private filePath(accountId: string, id: string): string {
    const key = createHash("sha256").update(`${accountId}\0${id}`).digest("hex");
    return path.join(this.options.rootDir, `${key}.bin`);
  }
}

function assertEntry(entry: WechatPendingInboundEntry): void {
  const identity = entry.incoming.conversationIdentity;
  if (
    !entry.id
    || !entry.accountId
    || !entry.participantId
    || !entry.contextToken
    || entry.incoming.channel !== "wechat"
    || entry.incoming.connectionAccountId !== entry.accountId
    || identity?.channel !== "wechat"
    || identity.connectionAccountId !== entry.accountId
    || identity.participantId !== entry.participantId
    || entry.incoming.senderId !== entry.participantId
    || Number.isNaN(entry.incoming.at.getTime())
  ) {
    throw new Error("微信待恢复入站消息身份无效");
  }
}
