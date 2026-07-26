import { normalizeMobileMessageSegmentationMode, type MobileMessageSegmentationMode } from "../../shared/preferences";
import { splitTextBySentenceBreaks } from "../../shared/message-segmentation";
import type { ChannelManager } from "./manager";
import { appendHistory as appendChannelHistory } from "./history-log";
import { appendLog as appendChannelLog, type LogEntry } from "./message-log";
import type {
  ChannelConversationIdentity,
  ChannelId,
  IncomingMessage,
  OutgoingMessage,
} from "./types";

export type ProactiveMobileChannel = Extract<ChannelId, "wechat" | "feishu">;

export interface RecentProactiveChannelRecipient {
  targetId: string;
  threadId?: string;
  sessionId: string;
  updatedAt: number;
  conversationIdentity?: ChannelConversationIdentity;
}

export interface ProactiveChannelRecipientRegistry {
  remember(message: IncomingMessage, sessionId: string): void;
  get(
    channel: ProactiveMobileChannel,
    conversationIdentity?: ChannelConversationIdentity,
  ): RecentProactiveChannelRecipient | null;
}

export function createProactiveChannelRecipientRegistry(): ProactiveChannelRecipientRegistry {
  const recipients = new Map<ProactiveMobileChannel, RecentProactiveChannelRecipient>();
  const wechatRecipients = new Map<string, RecentProactiveChannelRecipient>();
  return {
    remember(message, sessionId): void {
      const targetId = message.chatId.trim();
      if (!targetId || !sessionId) return;
      const recipient: RecentProactiveChannelRecipient = {
        targetId: message.channel === "wechat" && message.conversationIdentity
          ? message.conversationIdentity.participantId
          : targetId,
        ...(message.threadId ? { threadId: message.threadId } : {}),
        sessionId,
        updatedAt: message.at.getTime(),
        ...(message.conversationIdentity
          ? { conversationIdentity: { ...message.conversationIdentity } }
          : {}),
      };
      recipients.set(message.channel, recipient);
      if (message.channel === "wechat" && isExplicitWechatIdentity(message.conversationIdentity)) {
        wechatRecipients.set(identityKey(message.conversationIdentity), recipient);
      }
    },
    get(channel, conversationIdentity): RecentProactiveChannelRecipient | null {
      if (channel === "wechat" && isExplicitWechatIdentity(conversationIdentity)) {
        return wechatRecipients.get(identityKey(conversationIdentity)) ?? null;
      }
      return recipients.get(channel) ?? null;
    },
  };
}

const defaultRecipientRegistry = createProactiveChannelRecipientRegistry();

export function rememberProactiveChannelRecipient(message: IncomingMessage, sessionId: string): void {
  defaultRecipientRegistry.remember(message, sessionId);
}

export function canStartProactiveChannelDelivery(
  channel: ProactiveMobileChannel,
  manager: Pick<ChannelManager, "getAdapter">,
  recipientRegistry: ProactiveChannelRecipientRegistry = defaultRecipientRegistry,
  conversationIdentity?: ChannelConversationIdentity,
): boolean {
  const adapter = manager.getAdapter(channel);
  if (channel === "wechat" && !isExplicitWechatIdentity(conversationIdentity)) return false;
  const recipient = recipientRegistry.get(channel, conversationIdentity);
  return adapter?.getStatus().phase === "running"
    && recipient !== null
    && (channel !== "wechat" || sameIdentity(recipient.conversationIdentity, conversationIdentity));
}

export type ProactiveChannelDeliveryResult =
  | { kind: "committed"; deliveredParts: number; totalParts: number }
  | { kind: "cancelled"; reason: string };

interface ProactiveChannelDeliveryInput {
  channel: ProactiveMobileChannel;
  text: string;
  mobileMessageSegmentation: MobileMessageSegmentationMode;
  manager: Pick<ChannelManager, "getAdapter">;
  recipientRegistry?: ProactiveChannelRecipientRegistry;
  appendHistory?: typeof appendChannelHistory;
  appendLog?: (entry: Omit<LogEntry, "at">) => void;
  canContinue?: () => boolean;
  conversationIdentity?: ChannelConversationIdentity;
}

export async function sendProactiveChannelMessage(
  input: ProactiveChannelDeliveryInput,
): Promise<ProactiveChannelDeliveryResult> {
  const adapter = input.manager.getAdapter(input.channel);
  if (!adapter || adapter.getStatus().phase !== "running") {
    return { kind: "cancelled", reason: "channel_offline" };
  }

  if (input.channel === "wechat" && !isExplicitWechatIdentity(input.conversationIdentity)) {
    return { kind: "cancelled", reason: "identity_required" };
  }
  const recipient = (input.recipientRegistry ?? defaultRecipientRegistry).get(
    input.channel,
    input.conversationIdentity,
  );
  if (!recipient) return { kind: "cancelled", reason: "recipient_unavailable" };
  if (input.channel === "wechat") {
    if (!sameIdentity(recipient.conversationIdentity, input.conversationIdentity)) {
      return { kind: "cancelled", reason: "recipient_unavailable" };
    }
  }

  const mode = normalizeMobileMessageSegmentationMode(input.mobileMessageSegmentation);
  const texts = mode === "on" ? splitTextBySentenceBreaks(input.text) : [input.text.trim()].filter(Boolean);
  if (texts.length === 0) return { kind: "cancelled", reason: "empty_text" };

  const deliveredTexts: string[] = [];
  for (const text of texts) {
    if (input.canContinue && !input.canContinue()) break;
    if (adapter.getStatus().phase !== "running") break;
    const message: OutgoingMessage = {
      channel: input.channel,
      targetId: recipient.targetId,
      ...(input.channel === "wechat" && input.conversationIdentity ? {
        connectionAccountId: input.conversationIdentity.connectionAccountId,
        conversationIdentity: input.conversationIdentity,
      } : {}),
      ...(recipient.threadId ? { threadId: recipient.threadId } : {}),
      parts: [{ kind: "text", text }],
    };
    try {
      const result = await adapter.send(message);
      if (!result.ok) break;
      deliveredTexts.push(text);
    } catch {
      break;
    }
  }

  if (deliveredTexts.length === 0) return { kind: "cancelled", reason: "send_failed" };

  const deliveredText = deliveredTexts.join("");
  (input.appendHistory ?? appendChannelHistory)(recipient.sessionId, "assistant", deliveredText);
  (input.appendLog ?? appendChannelLog)({
    dir: "outgoing",
    channel: input.channel,
    senderId: recipient.targetId,
    chatId: recipient.targetId,
    text: deliveredText,
    hasAttachments: false,
  });

  return {
    kind: "committed",
    deliveredParts: deliveredTexts.length,
    totalParts: texts.length,
  };
}

function isExplicitWechatIdentity(
  identity: ChannelConversationIdentity | undefined,
): identity is ChannelConversationIdentity & { connectionAccountId: string } {
  return identity?.channel === "wechat"
    && typeof identity.connectionAccountId === "string"
    && identity.connectionAccountId.length > 0
    && identity.participantId.length > 0;
}

function sameIdentity(
  left: ChannelConversationIdentity | undefined,
  right: ChannelConversationIdentity | undefined,
): boolean {
  return Boolean(left && right
    && left.channel === right.channel
    && left.connectionAccountId === right.connectionAccountId
    && left.participantId === right.participantId);
}

function identityKey(identity: ChannelConversationIdentity & { connectionAccountId: string }): string {
  return `${identity.connectionAccountId}\0${identity.participantId}`;
}
