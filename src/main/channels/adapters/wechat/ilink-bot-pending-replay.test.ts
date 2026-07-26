import { describe, expect, it, vi } from "vitest";
import type { IncomingMessage } from "../../types";
import type { WechatPendingInboundEntry } from "./wechat-pending-inbound-store";
import type { WechatAccountRecord } from "./wechat-account-store";

vi.mock("electron", () => ({ app: { getPath: () => "/tmp/cyrene-pending-replay" } }));
vi.mock("../../settings-store", () => ({
  loadChannelsSettings: () => ({ wechat: { enabled: true }, feishu: { enabled: false } }),
  saveChannelsSettings: vi.fn(),
}));

import { ILinkBotAdapter } from "./ilink-bot-adapter";

const account: WechatAccountRecord = {
  ilinkBotId: "account-a@im.wechat",
  label: "账号 A",
  enabled: true,
  credentialStatus: "available",
  createdAt: 1,
  updatedAt: 1,
};

function entry(): WechatPendingInboundEntry {
  return {
    id: "message-1",
    accountId: account.ilinkBotId,
    participantId: "owner-a@im.wechat",
    contextToken: "context-a",
    incoming: {
      channel: "wechat",
      connectionAccountId: account.ilinkBotId,
      conversationIdentity: {
        channel: "wechat",
        connectionAccountId: account.ilinkBotId,
        participantId: "owner-a@im.wechat",
      },
      senderId: "owner-a@im.wechat",
      chatId: "owner-a@im.wechat",
      text: "切换期间消息",
      at: new Date("2026-07-17T08:00:00.000Z"),
    },
  };
}

describe("ILinkBotAdapter pending inbound replay", () => {
  it("合法入站先加密持久化，调度回复完成后才删除", async () => {
    const calls: string[] = [];
    let finish!: () => void;
    const pendingInboundStore = {
      save: vi.fn(async () => { calls.push("save"); }),
      list: vi.fn(async () => []),
      complete: vi.fn(async () => { calls.push("complete"); }),
    };
    const adapter = new ILinkBotAdapter({ pendingInboundStore } as never);
    adapter.onMessage = vi.fn(async (_incoming: IncomingMessage) => {
      calls.push("dispatch");
      await new Promise<void>((resolve) => { finish = resolve; });
      return null;
    });

    await (adapter as any).dispatchInbound({
      msgId: "message-1",
      fromUserId: "owner-a@im.wechat",
      toUserId: account.ilinkBotId,
      msgType: 1,
      content: "切换期间消息",
      items: [{ type: 1, text_item: { text: "切换期间消息" } }],
      contextToken: "context-a",
      raw: {},
    }, { sendText: vi.fn() }, account);
    await vi.waitFor(() => expect(calls).toEqual(["save", "dispatch"]));
    expect(pendingInboundStore.complete).not.toHaveBeenCalled();
    finish();
    await vi.waitFor(() => expect(calls).toEqual(["save", "dispatch", "complete"]));
  });

  it("重启后恢复原账号 context token，并只重放绑定者消息", async () => {
    const saved = entry();
    const pendingInboundStore = {
      save: vi.fn(),
      list: vi.fn(async () => [saved, {
        ...saved,
        id: "unauthorized",
        participantId: "other@im.wechat",
        incoming: {
          ...saved.incoming,
          senderId: "other@im.wechat",
          chatId: "other@im.wechat",
          conversationIdentity: {
            channel: "wechat" as const,
            connectionAccountId: account.ilinkBotId,
            participantId: "other@im.wechat",
          },
        },
      }]),
      complete: vi.fn(async () => undefined),
    };
    const adapter = new ILinkBotAdapter({ pendingInboundStore } as never);
    (adapter as any).clientsByAccount.set(account.ilinkBotId, { sendText: vi.fn() });
    (adapter as any).credentialsByAccount.set(account.ilinkBotId, {
      ilinkBotId: account.ilinkBotId,
      ilinkUserId: saved.participantId,
      botToken: "token",
      baseUrl: "https://example.test",
    });
    adapter.onMessage = vi.fn(async () => null);

    await (adapter as any).replayPendingInbound();

    expect(adapter.onMessage).toHaveBeenCalledOnce();
    expect(adapter.onMessage).toHaveBeenCalledWith(saved.incoming);
    expect((adapter as any).replyContextByAccountTarget.get(
      `${account.ilinkBotId}\0${saved.participantId}`,
    )).toBe(saved.contextToken);
    expect(pendingInboundStore.complete).toHaveBeenCalledWith("message-1", account.ilinkBotId);
    expect(pendingInboundStore.complete).toHaveBeenCalledWith("unauthorized", account.ilinkBotId);
  });
});
