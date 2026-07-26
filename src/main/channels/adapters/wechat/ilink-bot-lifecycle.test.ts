import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Credentials } from "./ilink-protocol-client";
import type { WechatAccountRecord } from "./wechat-account-store";

const mocks = vi.hoisted(() => ({
  settings: {
    wechat: { enabled: false },
    feishu: { enabled: false },
  },
}));

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/cyrene-wechat-lifecycle" } }));
vi.mock("../../settings-store", () => ({
  loadChannelsSettings: () => mocks.settings,
  saveChannelsSettings: (patch: { wechat?: { enabled?: boolean } }) => {
    if (typeof patch.wechat?.enabled === "boolean") mocks.settings.wechat.enabled = patch.wechat.enabled;
    return mocks.settings;
  },
}));

import { ILinkBotAdapter } from "./ilink-bot-adapter";

describe("ILinkBotAdapter lifecycle respects channel config", () => {
  beforeEach(() => {
    mocks.settings.wechat.enabled = false;
  });

  it("stays offline when WeChat is disabled", async () => {
    const adapter = new ILinkBotAdapter();
    await adapter.start();
    expect(adapter.getStatus()).toEqual({ enabled: false, phase: "offline", message: "未启用" });
  });

  it("does not expose a stale running state after the config is disabled", () => {
    const adapter = new ILinkBotAdapter();
    (adapter as any).status = { enabled: true, phase: "running", message: "微信已连接" };
    expect(adapter.getStatus()).toEqual({ enabled: false, phase: "offline", message: "未启用" });
  });

  it("starts every enabled WeChat account behind one channel adapter", async () => {
    mocks.settings.wechat.enabled = true;
    const accounts: WechatAccountRecord[] = ["multi-a@im.wechat", "multi-b@im.wechat"].map(
      (ilinkBotId, index) => ({
        ilinkBotId,
        label: `账号${index + 1}`,
        enabled: true,
        credentialStatus: "available",
        createdAt: 1,
        updatedAt: 1,
      }),
    );
    const credentialsById = new Map<string, Credentials>(
      accounts.map((account) => [
        account.ilinkBotId,
        {
          ilinkBotId: account.ilinkBotId,
          botToken: `${account.ilinkBotId}-token`,
          baseUrl: "https://ilink.example.test",
          ilinkUserId: `${account.ilinkBotId}-owner`,
        },
      ]),
    );
    const clients: string[] = [];
    const clearCredentials = vi.fn(async () => undefined);
    const adapter = new (ILinkBotAdapter as any)({
      accountRepository: {
        listAccounts: async () => accounts,
        loadCredentials: async (ilinkBotId: string) => credentialsById.get(ilinkBotId) ?? null,
        clearCredentials,
      },
      createClient: (credentials: Credentials) => {
        clients.push(credentials.ilinkBotId);
        return {
          getUpdates: (_buf: string, signal: AbortSignal) =>
            new Promise((_resolve, reject) => {
              signal.addEventListener(
                "abort",
                () => reject(new DOMException("aborted", "AbortError")),
                { once: true },
              );
            }),
        };
      },
    }) as ILinkBotAdapter;

    await adapter.start();

    expect(clients.sort()).toEqual(["multi-a@im.wechat", "multi-b@im.wechat"]);
    expect(adapter.getStatus()).toMatchObject({
      enabled: true,
      phase: "running",
      detail: {
        accounts: [
          expect.objectContaining({ ilinkBotId: "multi-a@im.wechat", phase: "running" }),
          expect.objectContaining({ ilinkBotId: "multi-b@im.wechat", phase: "running" }),
        ],
      },
    });

    await (adapter as any).logout("multi-a@im.wechat");
    expect(clearCredentials).toHaveBeenCalledWith("multi-a@im.wechat");
    expect(mocks.settings.wechat.enabled).toBe(true);
    expect(adapter.getStatus()).toMatchObject({
      enabled: true,
      phase: "running",
      detail: {
        accounts: [
          expect.objectContaining({ ilinkBotId: "multi-a@im.wechat", phase: "config_missing" }),
          expect.objectContaining({ ilinkBotId: "multi-b@im.wechat", phase: "running" }),
        ],
      },
    });
    await adapter.stop();
  });
});
