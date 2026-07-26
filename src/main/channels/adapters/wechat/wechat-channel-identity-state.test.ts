import { describe, expect, it } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WechatChannelIdentityStateStore } from "./wechat-channel-identity-state";

const identityA = {
  channel: "wechat" as const,
  connectionAccountId: "account-a@im.wechat",
  participantId: "owner@im.wechat",
};
const identityB = { ...identityA, connectionAccountId: "account-b@im.wechat" };

describe("WechatChannelIdentityStateStore", () => {
  it("渠道资料按账号与绑定者隔离，默认不继承桌面资料", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "cyrene-channel-state-"));
    const store = new WechatChannelIdentityStateStore({ rootDir });
    expect(await store.loadProfile(identityA)).toEqual({});

    await store.updateProfile(identityA, { nickname: "A 用户", defaultCity: "杭州" });
    expect(await store.loadProfile(identityA)).toEqual({ nickname: "A 用户", defaultCity: "杭州" });
    expect(await store.loadProfile(identityB)).toEqual({});
  });

  it("权限策略按连接账号隔离，默认只允许 safe 工具", async () => {
    const rootDir = await mkdtemp(path.join(os.tmpdir(), "cyrene-channel-policy-"));
    const store = new WechatChannelIdentityStateStore({ rootDir });
    expect(await store.loadPermissionPolicy(identityA.connectionAccountId)).toEqual({
      allowedRisks: ["safe"],
    });
    await store.savePermissionPolicy(identityA.connectionAccountId, {
      allowedRisks: ["safe", "network"],
    });
    expect(await store.isToolRiskAllowed(identityA.connectionAccountId, "network")).toBe(true);
    expect(await store.isToolRiskAllowed(identityA.connectionAccountId, "fs-read")).toBe(false);
    expect(await store.isToolRiskAllowed(identityB.connectionAccountId, "network")).toBe(false);
  });
});
