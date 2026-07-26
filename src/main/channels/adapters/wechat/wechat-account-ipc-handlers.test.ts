import { describe, expect, it, vi } from "vitest";
import { createWechatAccountIpcHandlers } from "./wechat-account-ipc-handlers";

describe("微信多账号 IPC handlers", () => {
  it("逐账号命令完整转发显式 ilinkBotId", async () => {
    const service = {
      listAccounts: vi.fn(async () => [{ ilinkBotId: "account-a" }]),
      renameAccount: vi.fn(async () => undefined),
      setAccountEnabled: vi.fn(async () => undefined),
      reconnectAccount: vi.fn(async () => undefined),
      logoutAccount: vi.fn(async () => undefined),
      deleteAccount: vi.fn(async () => undefined),
    };
    const refresh = vi.fn(async () => ({ state: "waiting" as const, sessionId: "qr-2" }));
    const handlers = createWechatAccountIpcHandlers({ service, refreshLogin: refresh });

    await expect(handlers.list()).resolves.toEqual([{ ilinkBotId: "account-a" }]);
    await handlers.rename({ ilinkBotId: "account-a", label: "私人号" });
    await handlers.setEnabled({ ilinkBotId: "account-a", enabled: false });
    await handlers.reconnect("account-b");
    await handlers.rescan("account-b");
    await handlers.logout("account-b");
    await handlers.delete("account-c");

    expect(service.renameAccount).toHaveBeenCalledWith("account-a", "私人号");
    expect(service.setAccountEnabled).toHaveBeenCalledWith("account-a", false);
    expect(service.reconnectAccount).toHaveBeenCalledWith("account-b");
    expect(refresh).toHaveBeenCalledOnce();
    expect(service.logoutAccount).toHaveBeenCalledWith("account-b");
    expect(service.deleteAccount).toHaveBeenCalledWith("account-c");
  });

  it("所有写命令统一返回结果对象，且空账号不会进入服务层", async () => {
    const logoutAccount = vi.fn(async () => undefined);
    const handlers = createWechatAccountIpcHandlers({
      service: {
        listAccounts: vi.fn(async () => []),
        renameAccount: vi.fn(async () => undefined),
        setAccountEnabled: vi.fn(async () => undefined),
        reconnectAccount: vi.fn(async () => undefined),
        logoutAccount,
        deleteAccount: vi.fn(async () => undefined),
      },
      refreshLogin: vi.fn(async () => ({ state: "waiting" as const })),
    });

    await expect(handlers.logout(" ")).resolves.toEqual({ ok: false, error: "必须指定微信账号" });
    expect(logoutAccount).not.toHaveBeenCalled();
  });
});
