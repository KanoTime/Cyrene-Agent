import { describe, expect, it, vi } from "vitest";
import { WechatAccountSettingsService } from "./wechat-account-settings-service";
import type { WechatAccountRecord } from "./wechat-account-store";

function account(ilinkBotId: string, label: string, enabled = true): WechatAccountRecord {
  return {
    ilinkBotId,
    label,
    enabled,
    credentialStatus: "available",
    createdAt: 1,
    updatedAt: 2,
  };
}

describe("WechatAccountSettingsService", () => {
  it("合并持久账号、独立连接状态和队列数量，并只暴露脱敏 Bot ID", async () => {
    const service = new WechatAccountSettingsService({
      repository: {
        listAccounts: vi.fn(async () => [
          account("personal-sensitive-bot@im.wechat", "日常号"),
          account("work-sensitive-bot@im.wechat", "工作号"),
        ]),
      },
      runtime: {
        getAccountStatuses: () => [
          {
            ilinkBotId: "personal-sensitive-bot@im.wechat",
            label: "日常号",
            enabled: true,
            phase: "running",
            lastConnectedAt: 123,
          },
          {
            ilinkBotId: "work-sensitive-bot@im.wechat",
            label: "工作号",
            enabled: true,
            phase: "error",
            lastError: "微信连接暂时中断，正在重试",
          },
        ],
      },
      getQueueStats: (ilinkBotId) =>
        ilinkBotId.startsWith("personal")
          ? { processing: 1, queued: 2 }
          : { processing: 0, queued: 0 },
    });

    const result = await service.listAccounts();

    expect(result).toEqual([
      expect.objectContaining({
        ilinkBotId: "personal-sensitive-bot@im.wechat",
        maskedBotId: "per…ot@im.wechat",
        label: "日常号",
        phase: "running",
        lastConnectedAt: 123,
        processing: 1,
        queued: 2,
      }),
      expect.objectContaining({
        ilinkBotId: "work-sensitive-bot@im.wechat",
        maskedBotId: "wor…ot@im.wechat",
        label: "工作号",
        phase: "error",
        errorSummary: "微信连接暂时中断，正在重试",
      }),
    ]);
  });

  it("所有修改命令必须显式指定账号，且只作用于该账号", async () => {
    const updateAccount = vi.fn(async (id: string, patch: object) => ({
      ...account(id, "更新后"),
      ...patch,
    }));
    const reconnectAccount = vi.fn(async () => undefined);
    const stopAccount = vi.fn(async () => undefined);
    const logoutAccount = vi.fn(async () => undefined);
    const removeAccount = vi.fn(async () => undefined);
    const archiveAccountTasks = vi.fn(async () => undefined);
    const service = new WechatAccountSettingsService({
      repository: { listAccounts: vi.fn(async () => []), updateAccount },
      runtime: { getAccountStatuses: () => [], reconnectAccount, stopAccount },
      logoutAccount,
      removeAccount,
      archiveAccountTasks,
    });

    await service.renameAccount("account-a@im.wechat", "私人微信");
    await service.setAccountEnabled("account-a@im.wechat", false);
    await service.reconnectAccount("account-b@im.wechat");
    await service.logoutAccount("account-b@im.wechat");
    await service.deleteAccount("account-c@im.wechat");

    expect(updateAccount).toHaveBeenNthCalledWith(1, "account-a@im.wechat", { label: "私人微信" });
    expect(updateAccount).toHaveBeenNthCalledWith(2, "account-a@im.wechat", { enabled: false });
    expect(stopAccount).toHaveBeenCalledWith("account-a@im.wechat");
    expect(reconnectAccount).toHaveBeenCalledWith("account-b@im.wechat");
    expect(logoutAccount).toHaveBeenCalledWith("account-b@im.wechat");
    expect(removeAccount).toHaveBeenCalledWith("account-c@im.wechat");
    expect(archiveAccountTasks).toHaveBeenCalledWith("account-c@im.wechat");
    expect(archiveAccountTasks.mock.invocationCallOrder[0]).toBeLessThan(
      removeAccount.mock.invocationCallOrder[0],
    );
  });

  it("拒绝缺失或空白账号 ID，避免退化成全部账号操作", async () => {
    const service = new WechatAccountSettingsService({
      repository: { listAccounts: vi.fn(async () => []) },
      runtime: { getAccountStatuses: () => [] },
    });

    await expect(service.logoutAccount(" ")).rejects.toThrow("必须指定微信账号");
    await expect(service.deleteAccount("")).rejects.toThrow("必须指定微信账号");
  });

  it("凭据已清除的已启用账号显示为需要登录", async () => {
    const missing = { ...account("logged-out@im.wechat", "已退出"), credentialStatus: "missing" as const };
    const service = new WechatAccountSettingsService({
      repository: { listAccounts: vi.fn(async () => [missing]) },
      runtime: {
        getAccountStatuses: () => [{
          ilinkBotId: missing.ilinkBotId,
          label: missing.label,
          enabled: true,
          phase: "offline",
        }],
      },
    });
    await expect(service.listAccounts()).resolves.toEqual([
      expect.objectContaining({ phase: "config_missing", credentialStatus: "missing" }),
    ]);
  });
});
