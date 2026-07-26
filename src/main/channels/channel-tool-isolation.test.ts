import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "../orchestrator/tool-registry";
import { filterToolsForChannelConversation } from "./channel-tool-isolation";
import type { IncomingMessage } from "./types";

function tool(id: string): ToolDefinition {
  return {
    id,
    name: id,
    description: id,
    enabled: true,
    inputSchema: { type: "object", properties: {} },
    execute: async () => "ok",
  };
}

describe("channel tool isolation", () => {
  it("结构化微信会话禁用全局记忆与待办，但保留 session 历史和渠道任务", () => {
    const message: IncomingMessage = {
      channel: "wechat",
      connectionAccountId: "account-a",
      conversationIdentity: {
        channel: "wechat",
        connectionAccountId: "account-a",
        participantId: "owner-a",
      },
      senderId: "owner-a",
      chatId: "owner-a",
      text: "还记得吗",
      at: new Date(),
    };

    expect(
      filterToolsForChannelConversation(
        [tool("user_memory"), tool("todo_write"), tool("recall_history"), tool("channel_task"), tool("weather")],
        message,
      ).map((candidate) => candidate.id),
    ).toEqual(["recall_history", "channel_task", "weather"]);
  });

  it("桌面或非结构化渠道保持原工具集合", () => {
    const tools = [tool("user_memory"), tool("recall_history"), tool("channel_task")];
    const message: IncomingMessage = {
      channel: "feishu",
      senderId: "user-a",
      chatId: "chat-a",
      text: "你好",
      at: new Date(),
    };
    expect(filterToolsForChannelConversation(tools, message).map((candidate) => candidate.id)).toEqual([
      "user_memory", "recall_history",
    ]);
  });
});
