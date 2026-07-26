import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { WechatCredentialCipher } from "./wechat-account-store";
import { WechatAccountRepository } from "./wechat-account-repository";

const tempDirs: string[] = [];
const cipher: WechatCredentialCipher = {
  encrypt: (plain) => Buffer.from([...Buffer.from(plain)].reverse()),
  decrypt: (encrypted) => Buffer.from([...encrypted].reverse()).toString("utf8"),
};

async function tempUserData(): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "cyrene-wechat-repository-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("WechatAccountRepository", () => {
  it("新扫码凭据写入账号仓储后可供现有单连接入口加载和清除", async () => {
    const userDataDir = await tempUserData();
    const repository = new WechatAccountRepository({ userDataDir, cipher });
    const credentials = {
      ilinkBotId: "current-bot@im.wechat",
      botToken: "current-token",
      baseUrl: "https://ilink.example.test",
      ilinkUserId: "current-owner@im.wechat",
    };

    await repository.save(credentials);
    expect(await repository.loadPrimaryCredentials()).toEqual(credentials);

    await repository.clearCredentials(credentials.ilinkBotId);
    expect(await repository.loadPrimaryCredentials()).toBeNull();
    expect(await repository.listAccounts()).toEqual([
      expect.objectContaining({
        ilinkBotId: credentials.ilinkBotId,
        credentialStatus: "missing",
      }),
    ]);
  });

  it("加密迁移失败时仍向现有单连接入口提供旧凭据", async () => {
    const userDataDir = await tempUserData();
    const legacyPath = path.join(userDataDir, "weixin", "credentials.json");
    await mkdir(path.dirname(legacyPath), { recursive: true });
    await writeFile(
      legacyPath,
      JSON.stringify({
        ilinkBotId: "fallback-bot@im.wechat",
        botToken: "fallback-token",
        baseUrl: "https://legacy.example.test",
        ilinkUserId: "fallback-owner@im.wechat",
      }),
    );
    const repository = new WechatAccountRepository({
      userDataDir,
      cipher: {
        encrypt: cipher.encrypt,
        decrypt: () => {
          throw new Error("safeStorage unavailable");
        },
      },
    });

    expect(await repository.loadPrimaryCredentials()).toMatchObject({
      ilinkBotId: "fallback-bot@im.wechat",
      botToken: "fallback-token",
    });

    await repository.clearCredentials("fallback-bot@im.wechat");
    expect(await repository.loadPrimaryCredentials()).toBeNull();
  });
});
