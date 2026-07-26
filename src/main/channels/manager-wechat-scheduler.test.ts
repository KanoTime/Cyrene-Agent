import { describe, expect, it, vi } from "vitest";
import type { ChannelAdapter } from "./adapters/base";
import { ChannelManager } from "./manager";
import type { IncomingMessage, OutgoingMessage } from "./types";

function inbound(sequence: number): IncomingMessage {
  return {
    channel: "wechat",
    connectionAccountId: "account-a@im.wechat",
    conversationIdentity: {
      channel: "wechat",
      connectionAccountId: "account-a@im.wechat",
      participantId: "owner-a@im.wechat",
    },
    senderId: "owner-a@im.wechat",
    chatId: "owner-a@im.wechat",
    text: `message-${sequence}`,
    at: new Date(sequence),
  };
}

describe("ChannelManager 微信消息调度接入", () => {
  it("同一对话必须等待上一条回复发送完成后再开始下一条", async () => {
    const manager = new ChannelManager();
    let releaseFirstSend: (() => void) | undefined;
    const firstSendGate = new Promise<void>((resolve) => {
      releaseFirstSend = resolve;
    });
    const dispatched: string[] = [];
    const sent: string[] = [];
    const adapter: ChannelAdapter = {
      id: "wechat",
      displayName: "微信",
      capability: {
        text: true,
        image: true,
        audio: true,
        file: true,
        video: true,
        markdown: false,
        card: false,
        sticker: true,
        maxTextLength: 2048,
      },
      onMessage: null,
      start: vi.fn(async () => undefined),
      stop: vi.fn(async () => undefined),
      getStatus: () => ({ enabled: true, phase: "running" }),
      send: async (message) => {
        const text = message.parts[0]?.kind === "text" ? message.parts[0].text : "";
        sent.push(text);
        if (text === "reply-message-1") await firstSendGate;
        return { ok: true };
      },
    };
    manager.register(adapter);
    manager.setDispatcher(async (message) => {
      dispatched.push(message.text);
      const outgoing: OutgoingMessage = {
        channel: "wechat",
        connectionAccountId: message.connectionAccountId,
        conversationIdentity: message.conversationIdentity,
        targetId: message.chatId,
        parts: [{ kind: "text", text: `reply-${message.text}` }],
      };
      return outgoing;
    });

    const first = adapter.onMessage!(inbound(1));
    const second = adapter.onMessage!(inbound(2));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(dispatched).toEqual(["message-1"]);
    expect(sent).toEqual(["reply-message-1"]);
    releaseFirstSend?.();
    await first;
    await second;
    expect(dispatched).toEqual(["message-1", "message-2"]);
    expect(sent).toEqual(["reply-message-1", "reply-message-2"]);
  });

  it("经由 manager 的角色切换 seam 暂停未开始的微信消息", async () => {
    const manager = new ChannelManager();
    const operation = vi.fn(async () => ({ ok: false, status: "failed" as const }));
    await expect(manager.coordinateWechatCharacterSwitch(operation)).resolves.toEqual({
      ok: false,
      status: "failed",
    });
    expect(operation).toHaveBeenCalledOnce();
  });
});
