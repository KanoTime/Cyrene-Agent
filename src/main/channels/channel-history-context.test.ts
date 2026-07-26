import { describe, expect, it } from "vitest";
import { selectChannelHistoryContext } from "./channel-history-context";

describe("selectChannelHistoryContext", () => {
  it("移除 dispatcher 已写入历史的本轮用户消息，避免模型收到重复输入", () => {
    const selected = selectChannelHistoryContext([
      { role: "user", content: "上一问" },
      { role: "assistant", content: "上一答" },
      { role: "user", content: "昔涟，你可以抱抱我吗" },
    ], "昔涟，你可以抱抱我吗");

    expect(selected).toEqual([
      { role: "user", content: "上一问" },
      { role: "assistant", content: "上一答" },
    ]);
  });

  it("最多保留最近两个完整往返，较旧内容交给 recall_history", () => {
    const selected = selectChannelHistoryContext([
      { role: "user", content: "问1" },
      { role: "assistant", content: "答1" },
      { role: "user", content: "问2" },
      { role: "assistant", content: "答2" },
      { role: "user", content: "问3" },
      { role: "assistant", content: "答3" },
      { role: "user", content: "当前问题" },
    ], "当前问题");

    expect(selected).toEqual([
      { role: "user", content: "问2" },
      { role: "assistant", content: "答2" },
      { role: "user", content: "问3" },
      { role: "assistant", content: "答3" },
    ]);
  });

  it("只去掉末尾同内容 user，不误删更早重复表达", () => {
    const selected = selectChannelHistoryContext([
      { role: "user", content: "晚安" },
      { role: "assistant", content: "晚安呀" },
      { role: "user", content: "晚安" },
    ], "晚安");

    expect(selected).toEqual([
      { role: "user", content: "晚安" },
      { role: "assistant", content: "晚安呀" },
    ]);
  });
});
