import { createHash } from "node:crypto";
import type { ChannelConversationIdentity } from "../../types";

export interface WechatConversationIdentity extends ChannelConversationIdentity {
  channel: "wechat";
  connectionAccountId: string;
}

export function createWechatConversationIdentity(
  connectionAccountId: string,
  binderId: string,
): WechatConversationIdentity {
  const accountId = connectionAccountId.trim();
  const participantId = binderId.trim();
  if (!accountId) throw new Error("微信连接账号 ID 不能为空");
  if (!participantId) throw new Error("微信绑定者 ID 不能为空");
  return {
    channel: "wechat",
    connectionAccountId: accountId,
    participantId,
  };
}

export function makeWechatConversationSessionId(identity: WechatConversationIdentity): string {
  const hash = createHash("sha256")
    .update(
      JSON.stringify([
        identity.channel,
        identity.connectionAccountId,
        identity.participantId,
      ]),
    )
    .digest("hex")
    .slice(0, 16);
  return `channel:wechat:${hash}`;
}
