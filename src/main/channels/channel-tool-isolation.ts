import type { ToolDefinition } from "../orchestrator/tool-registry";
import type { IncomingMessage } from "./types";

function isStructuredWechatConversation(message: IncomingMessage): boolean {
  const identity = message.conversationIdentity;
  return message.channel === "wechat"
    && identity?.channel === "wechat"
    && typeof identity.connectionAccountId === "string"
    && identity.connectionAccountId.length > 0
    && typeof identity.participantId === "string"
    && identity.participantId.length > 0;
}

/**
 * Account-scoped WeChat memory has not been introduced yet. Keep the global
 * mutation/search tool outside structured WeChat conversations so one account
 * cannot observe or modify another account's personal memory.
 */
export function filterToolsForChannelConversation(
  tools: ToolDefinition[],
  message: IncomingMessage,
): ToolDefinition[] {
  if (!isStructuredWechatConversation(message)) {
    return tools.filter((tool) => tool.id !== "channel_task");
  }
  return tools.filter((tool) => tool.id !== "user_memory" && tool.id !== "todo_write");
}
