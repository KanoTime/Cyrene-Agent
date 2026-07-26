// dispatcher 核心单元测试：sessionId hash + 限速
import { describe, it, expect } from "vitest";
import { makeSessionId, makeSessionIdForMessage, lookupOriginalSender } from "./dispatcher";
import type { IncomingMessage } from "./types";

describe("channels/dispatcher", () => {
  it("makeSessionId: 同 channel + 同 sender → 同 sessionId", () => {
    const a = makeSessionId("feishu", "ou_abc123");
    const b = makeSessionId("feishu", "ou_abc123");
    expect(a).toBe(b);
  });

  it("makeSessionId: 跨 channel 不同 sessionId", () => {
    const f = makeSessionId("feishu", "user-x");
    const w = makeSessionId("wechat", "user-x");
    expect(f).not.toBe(w);
  });

  it("makeSessionId: 长度 16 字符 hash + 前缀", () => {
    const s = makeSessionId("feishu", "ou_abc");
    // 格式: channel:<channel>:<16 hex>
    expect(s).toMatch(/^channel:feishu:[0-9a-f]{16}$/);
  });

  it("makeSessionId: 不同 sender → 不同 sessionId", () => {
    const a = makeSessionId("feishu", "ou_aaa");
    const b = makeSessionId("feishu", "ou_bbb");
    expect(a).not.toBe(b);
  });

  it("lookupOriginalSender: 未知 sessionId 返回 null", () => {
    expect(lookupOriginalSender("channel:feishu:0000000000000000")).toBeNull();
  });

  it("makeSessionIdForMessage: 微信使用连接账号与绑定者的结构化身份", () => {
    const message = (connectionAccountId: string): IncomingMessage => ({
      channel: "wechat",
      connectionAccountId,
      conversationIdentity: {
        channel: "wechat",
        connectionAccountId,
        participantId: "same-owner@im.wechat",
      },
      senderId: "same-owner@im.wechat",
      chatId: "same-owner@im.wechat",
      text: "你好",
      at: new Date(0),
    });

    const first = makeSessionIdForMessage(message("account-a@im.wechat"));
    const second = makeSessionIdForMessage(message("account-b@im.wechat"));
    expect(first).not.toBe(second);
    expect(first).toMatch(/^channel:wechat:[0-9a-f]{16}$/);
  });
});
