import { mkdtemp, readFile, readdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  WechatAccountStore,
  type WechatCredentialCipher,
} from "./wechat-account-store";

const tempDirs: string[] = [];

async function createTempDir(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cyrene-wechat-accounts-"));
  tempDirs.push(dir);
  return dir;
}

const testCipher: WechatCredentialCipher = {
  encrypt: (plain) => Buffer.from([...Buffer.from(plain)].reverse()),
  decrypt: (encrypted) => Buffer.from([...encrypted].reverse()).toString("utf8"),
};

async function readTree(rootDir: string): Promise<string> {
  const entries = await readdir(rootDir, { recursive: true, withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile());
  return (
    await Promise.all(files.map((entry) => readFile(path.join(entry.parentPath, entry.name), "utf8")))
  ).join("\n");
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WechatAccountStore", () => {
  it("保存后可跨实例读取账号与凭据，且敏感字段不以明文落盘", async () => {
    const rootDir = await createTempDir();
    const first = new WechatAccountStore({ rootDir, cipher: testCipher });

    await first.upsertAccount({
      label: "我的微信",
      enabled: true,
      credentials: {
        ilinkBotId: "bot-001@im.wechat",
        botToken: "secret-token-001",
        baseUrl: "https://ilink.example.test",
        ilinkUserId: "owner-001@im.wechat",
      },
    });

    const reloaded = new WechatAccountStore({ rootDir, cipher: testCipher });
    expect(await reloaded.getAccount("bot-001@im.wechat")).toMatchObject({
      ilinkBotId: "bot-001@im.wechat",
      label: "我的微信",
      enabled: true,
      credentialStatus: "available",
    });
    expect(await reloaded.loadCredentials("bot-001@im.wechat")).toEqual({
      ilinkBotId: "bot-001@im.wechat",
      botToken: "secret-token-001",
      baseUrl: "https://ilink.example.test",
      ilinkUserId: "owner-001@im.wechat",
    });

    const persisted = await readTree(rootDir);
    expect(persisted).not.toContain("secret-token-001");
    expect(persisted).not.toContain("https://ilink.example.test");
    expect(persisted).not.toContain("owner-001@im.wechat");
  });

  it("相同 ilinkBotId 再次扫码只更新既有账号", async () => {
    const rootDir = await createTempDir();
    const store = new WechatAccountStore({ rootDir, cipher: testCipher, now: () => 100 });
    await store.upsertAccount({
      label: "旧备注",
      enabled: false,
      credentials: {
        ilinkBotId: "same-bot@im.wechat",
        botToken: "old-token",
        baseUrl: "https://old.example.test",
        ilinkUserId: "same-owner@im.wechat",
      },
    });

    const refreshed = new WechatAccountStore({ rootDir, cipher: testCipher, now: () => 200 });
    await refreshed.upsertAccount({
      label: "新备注",
      enabled: true,
      credentials: {
        ilinkBotId: "same-bot@im.wechat",
        botToken: "new-token",
        baseUrl: "https://new.example.test",
        ilinkUserId: "same-owner@im.wechat",
      },
    });

    expect(await refreshed.listAccounts()).toEqual([
      expect.objectContaining({
        ilinkBotId: "same-bot@im.wechat",
        label: "新备注",
        enabled: true,
        createdAt: 100,
        updatedAt: 200,
      }),
    ]);
    expect(await refreshed.loadCredentials("same-bot@im.wechat")).toMatchObject({
      botToken: "new-token",
      baseUrl: "https://new.example.test",
    });
  });

  it("恶意 ilinkBotId 不能让凭据文件逃出账号存储目录", async () => {
    const parentDir = await createTempDir();
    const rootDir = path.join(parentDir, "accounts");
    const store = new WechatAccountStore({ rootDir, cipher: testCipher });
    const maliciousId = "../../escaped@im.wechat";

    await store.upsertAccount({
      credentials: {
        ilinkBotId: maliciousId,
        botToken: "path-token",
        baseUrl: "https://safe.example.test",
        ilinkUserId: "path-owner@im.wechat",
      },
    });

    expect(await store.loadCredentials(maliciousId)).toMatchObject({ ilinkBotId: maliciousId });
    expect(await readdir(parentDir)).toEqual(["accounts"]);
  });

  it("单账号凭据损坏只标记该账号，其他账号仍可加载", async () => {
    const rootDir = await createTempDir();
    const store = new WechatAccountStore({ rootDir, cipher: testCipher });
    for (const id of ["broken-bot@im.wechat", "healthy-bot@im.wechat"]) {
      await store.upsertAccount({
        credentials: {
          ilinkBotId: id,
          botToken: `${id}-token`,
          baseUrl: "https://ilink.example.test",
          ilinkUserId: `${id}-owner`,
        },
      });
    }

    const credentialDir = path.join(rootDir, "credentials");
    for (const fileName of await readdir(credentialDir)) {
      const filePath = path.join(credentialDir, fileName);
      const plain = testCipher.decrypt(await readFile(filePath));
      if (plain.includes("broken-bot@im.wechat")) await writeFile(filePath, "not-encrypted-json");
    }

    expect(await store.listAccounts()).toEqual([
      expect.objectContaining({
        ilinkBotId: "broken-bot@im.wechat",
        credentialStatus: "corrupt",
      }),
      expect.objectContaining({
        ilinkBotId: "healthy-bot@im.wechat",
        credentialStatus: "available",
      }),
    ]);
    expect(await store.loadCredentials("broken-bot@im.wechat")).toBeNull();
    expect(await store.loadCredentials("healthy-bot@im.wechat")).toMatchObject({
      botToken: "healthy-bot@im.wechat-token",
    });
  });

  it("并发写入不同账号不会互相覆盖", async () => {
    const rootDir = await createTempDir();
    const store = new WechatAccountStore({ rootDir, cipher: testCipher });

    await Promise.all(
      ["parallel-a@im.wechat", "parallel-b@im.wechat"].map((ilinkBotId) =>
        store.upsertAccount({
          credentials: {
            ilinkBotId,
            botToken: `${ilinkBotId}-token`,
            baseUrl: "https://ilink.example.test",
            ilinkUserId: `${ilinkBotId}-owner`,
          },
        }),
      ),
    );

    expect((await store.listAccounts()).map((account) => account.ilinkBotId).sort()).toEqual([
      "parallel-a@im.wechat",
      "parallel-b@im.wechat",
    ]);
  });

  it("支持更新元数据、清除凭据和删除账号", async () => {
    const rootDir = await createTempDir();
    const store = new WechatAccountStore({ rootDir, cipher: testCipher });
    await store.upsertAccount({
      credentials: {
        ilinkBotId: "lifecycle@im.wechat",
        botToken: "lifecycle-token",
        baseUrl: "https://ilink.example.test",
        ilinkUserId: "lifecycle-owner@im.wechat",
      },
    });

    await store.updateAccount("lifecycle@im.wechat", { label: "工作号", enabled: false });
    expect(await store.getAccount("lifecycle@im.wechat")).toMatchObject({
      label: "工作号",
      enabled: false,
      credentialStatus: "available",
    });

    await store.clearCredentials("lifecycle@im.wechat");
    expect(await store.getAccount("lifecycle@im.wechat")).toMatchObject({
      label: "工作号",
      credentialStatus: "missing",
    });

    await store.removeAccount("lifecycle@im.wechat");
    expect(await store.getAccount("lifecycle@im.wechat")).toBeNull();
  });

  it("缺少绑定者身份的扫码凭据会在落盘前被拒绝", async () => {
    const rootDir = await createTempDir();
    const store = new WechatAccountStore({ rootDir, cipher: testCipher });

    await expect(
      store.upsertAccount({
        credentials: {
          ilinkBotId: "no-owner@im.wechat",
          botToken: "no-owner-token",
          baseUrl: "https://ilink.example.test",
          ilinkUserId: "",
        },
      }),
    ).rejects.toThrow("ilinkUserId");
    expect(await store.listAccounts()).toEqual([]);
  });
});
