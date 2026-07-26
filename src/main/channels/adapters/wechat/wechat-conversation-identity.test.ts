import { describe, expect, it } from "vitest";
import {
  createWechatConversationIdentity,
  makeWechatConversationSessionId,
} from "./wechat-conversation-identity";

describe("微信结构化对话身份", () => {
  it("相同联系人出现在不同连接账号时生成不同且稳定的 session key", () => {
    const first = createWechatConversationIdentity(
      "account-a@im.wechat",
      "same-owner@im.wechat",
    );
    const second = createWechatConversationIdentity(
      "account-b@im.wechat",
      "same-owner@im.wechat",
    );

    expect(makeWechatConversationSessionId(first)).toBe(
      makeWechatConversationSessionId(
        createWechatConversationIdentity("account-a@im.wechat", "same-owner@im.wechat"),
      ),
    );
    expect(makeWechatConversationSessionId(first)).not.toBe(
      makeWechatConversationSessionId(second),
    );
    expect(makeWechatConversationSessionId(first)).toMatch(/^channel:wechat:[0-9a-f]{16}$/);
    expect(makeWechatConversationSessionId(first)).not.toContain("account-a@im.wechat");
    expect(makeWechatConversationSessionId(first)).not.toContain("same-owner@im.wechat");
  });
});
