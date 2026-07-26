import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WechatAccountStore, type WechatCredentialCipher } from "./wechat-account-store";
import { migrateLegacyWechatAccount } from "./wechat-account-migration";

const tempDirs: string[] = [];
const cipher: WechatCredentialCipher = {
  encrypt: (plain) => Buffer.from([...Buffer.from(plain)].reverse()),
  decrypt: (encrypted) => Buffer.from([...encrypted].reverse()).toString("utf8"),
};

async function fixture(): Promise<{
  rootDir: string;
  legacyPath: string;
  archiveDir: string;
  store: WechatAccountStore;
}> {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "cyrene-wechat-migration-"));
  tempDirs.push(rootDir);
  const legacyPath = path.join(rootDir, "weixin", "credentials.json");
  const archiveDir = path.join(rootDir, "weixin", "legacy-archive");
  await mkdir(path.dirname(legacyPath), { recursive: true });
  await writeFile(
    legacyPath,
    JSON.stringify({
      ilinkBotId: "legacy-bot@im.wechat",
      botToken: "legacy-secret-token",
      baseUrl: "https://legacy.example.test",
      ilinkUserId: "legacy-owner@im.wechat",
    }),
  );
  return {
    rootDir,
    legacyPath,
    archiveDir,
    store: new WechatAccountStore({
      rootDir: path.join(rootDir, "weixin", "accounts"),
      cipher,
      now: () => 1234,
    }),
  };
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("旧版微信单账号迁移", () => {
  it("回读验证新结构后移除明文旧凭据，并留下无敏感信息的归档记录", async () => {
    const f = await fixture();

    const result = await migrateLegacyWechatAccount({
      legacyPath: f.legacyPath,
      archiveDir: f.archiveDir,
      store: f.store,
      legacyHistoryOwnership: "proven",
    });

    expect(result).toMatchObject({
      status: "migrated",
      ilinkBotId: "legacy-bot@im.wechat",
      historyDisposition: "assign-to-migrated-account",
    });
    await expect(stat(f.legacyPath)).rejects.toMatchObject({ code: "ENOENT" });
    expect(await f.store.loadCredentials("legacy-bot@im.wechat")).toMatchObject({
      botToken: "legacy-secret-token",
      ilinkUserId: "legacy-owner@im.wechat",
    });

    if (result.status !== "migrated") throw new Error("预期迁移成功");
    const archive = await readFile(result.archivePath, "utf8");
    expect(archive).not.toContain("legacy-secret-token");
    expect(archive).not.toContain("legacy-owner@im.wechat");

    expect(
      await migrateLegacyWechatAccount({
        legacyPath: f.legacyPath,
        archiveDir: f.archiveDir,
        store: f.store,
      }),
    ).toEqual({ status: "no-legacy" });
    expect(await f.store.listAccounts()).toHaveLength(1);
  });

  it("新结构无法回读时保留旧文件并返回单账号兼容结果", async () => {
    const f = await fixture();
    const unreadableStore = new WechatAccountStore({
      rootDir: path.join(f.rootDir, "weixin", "unreadable-accounts"),
      cipher: {
        encrypt: cipher.encrypt,
        decrypt: () => {
          throw new Error("device key unavailable");
        },
      },
    });

    const result = await migrateLegacyWechatAccount({
      legacyPath: f.legacyPath,
      archiveDir: f.archiveDir,
      store: unreadableStore,
    });

    expect(result).toMatchObject({
      status: "legacy-compatibility",
      credentials: {
        ilinkBotId: "legacy-bot@im.wechat",
        botToken: "legacy-secret-token",
      },
    });
    expect(await readFile(f.legacyPath, "utf8")).toContain("legacy-secret-token");
  });

  it("旧历史归属无法证明时返回独立归档策略", async () => {
    const f = await fixture();
    const result = await migrateLegacyWechatAccount({
      legacyPath: f.legacyPath,
      archiveDir: f.archiveDir,
      store: f.store,
      legacyHistoryOwnership: "unknown",
    });

    expect(result).toMatchObject({
      status: "migrated",
      historyDisposition: "archive-as-legacy",
    });
  });
});
