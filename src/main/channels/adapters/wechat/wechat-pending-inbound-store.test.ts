import { describe, expect, it } from "vitest";
import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WechatPendingInboundStore } from "./wechat-pending-inbound-store";
import type { WechatCredentialCipher } from "./wechat-account-store";

const cipher: WechatCredentialCipher = {
  encrypt: (plain) => Buffer.from(`encrypted:${Buffer.from(plain).toString("base64")}`, "utf8"),
  decrypt: (encrypted) => Buffer.from(
    encrypted.toString("utf8").replace(/^encrypted:/, ""),
    "base64",
  ).toString("utf8"),
};

describe("WechatPendingInboundStore", () => {
  it("加密保存尚未完成的入站消息，跨进程实例恢复后可完成删除", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "cyrene-wechat-pending-"));
    const first = new WechatPendingInboundStore({ rootDir, cipher });
    const entry = {
      id: "message-1",
      accountId: "account-a@im.wechat",
      participantId: "owner-a@im.wechat",
      contextToken: "secret-context-token",
      incoming: {
        channel: "wechat" as const,
        connectionAccountId: "account-a@im.wechat",
        conversationIdentity: {
          channel: "wechat" as const,
          connectionAccountId: "account-a@im.wechat",
          participantId: "owner-a@im.wechat",
        },
        senderId: "owner-a@im.wechat",
        chatId: "owner-a@im.wechat",
        text: "角色切换期间的秘密消息",
        at: new Date("2026-07-17T08:00:00.000Z"),
      },
    };

    await first.save(entry);
    const files = await readdir(rootDir);
    expect(files).toHaveLength(1);
    const raw = await readFile(path.join(rootDir, files[0]), "utf8");
    expect(raw).not.toContain(entry.contextToken);
    expect(raw).not.toContain(entry.incoming.text);

    const restarted = new WechatPendingInboundStore({ rootDir, cipher });
    await expect(restarted.list()).resolves.toEqual([entry]);
    await restarted.complete(entry.id, entry.accountId);
    await expect(restarted.list()).resolves.toEqual([]);
  });

  it("损坏密文只隔离单条消息，不阻断其他恢复", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "cyrene-wechat-pending-corrupt-"));
    const store = new WechatPendingInboundStore({ rootDir, cipher });
    await store.save({
      id: "good",
      accountId: "account-a",
      participantId: "owner-a",
      contextToken: "ctx",
      incoming: {
        channel: "wechat",
        connectionAccountId: "account-a",
        conversationIdentity: { channel: "wechat", connectionAccountId: "account-a", participantId: "owner-a" },
        senderId: "owner-a",
        chatId: "owner-a",
        text: "good",
        at: new Date("2026-07-17T08:00:00.000Z"),
      },
    });
    await import("node:fs/promises").then(({ writeFile }) =>
      writeFile(path.join(rootDir, "corrupt.bin"), "not-encrypted", "utf8"));
    await expect(store.list()).resolves.toMatchObject([{ id: "good" }]);
  });
});
