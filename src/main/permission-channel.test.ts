import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("electron", () => ({
  app: { getPath: () => "/tmp/cyrene-permission-test" },
  ipcMain: { handle: vi.fn() },
  BrowserWindow: { getAllWindows: () => [] },
}));

import {
  checkPermission,
  setChannelPermissionResolver,
  setCurrentLevel,
} from "./permission";

describe("channel permission isolation", () => {
  beforeEach(() => {
    setCurrentLevel("full");
    setChannelPermissionResolver(null);
  });

  it("结构化微信使用账号策略，不继承桌面 full 权限", async () => {
    const resolver = vi.fn(async (_accountId: string, risk: string) => risk === "safe");
    setChannelPermissionResolver(resolver);
    const metadata = {
      channel: "wechat",
      connectionAccountId: "account-a@im.wechat",
      participantId: "owner-a@im.wechat",
    };

    await expect(checkPermission({
      toolId: "read_file",
      toolName: "读文件",
      toolDescription: "读文件",
      args: {},
      risk: "fs-read",
      contextMetadata: metadata,
    })).resolves.toMatchObject({ allowed: false });
    await expect(checkPermission({
      toolId: "weather",
      toolName: "天气",
      toolDescription: "天气",
      args: {},
      risk: "safe",
      contextMetadata: metadata,
    })).resolves.toEqual({ allowed: true });
    expect(resolver).toHaveBeenCalledWith("account-a@im.wechat", "fs-read");
  });
});
