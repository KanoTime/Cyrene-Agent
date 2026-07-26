import { describe, expect, it } from "vitest";
import { planChannelExecution } from "./channel-execution-plan";

describe("planChannelExecution", () => {
  it.each([
    "昔涟，你可以抱抱我吗",
    "晚安，今天也辛苦啦",
    "谢谢你一直陪着我",
    "你觉得我今天表现怎么样？",
  ])("高置信度纯聊天直接进入 soul-only：%s", (text) => {
    expect(planChannelExecution({ text, characterNames: ["昔涟"] }).mode).toBe("soul-only");
  });

  it("uses the active character name instead of a built-in name for pure-chat routing", () => {
    expect(planChannelExecution({ text: "流明，你好呀", characterNames: ["流明"] }).mode).toBe("soul-only");
    expect(planChannelExecution({ text: "昔涟，你好呀", characterNames: ["流明"] }).mode).toBe("full-tool-loop");
  });

  it.each([
    "北京今天天气怎么样？",
    "帮我搜索最新的 Qwen 新闻",
    "读取 /Users/kano/Desktop/报告.pdf",
    "帮我记一笔 20 元午饭",
    "把这句话翻译成日语",
    "给 test@example.com 发一封邮件",
    "昔涟，眨眨眼",
    "你还记得我上次说的旅行计划吗？",
  ])("存在明确工具意图时保留工具阶段：%s", (text) => {
    expect(planChannelExecution({ text }).mode).toBe("tool-loop");
  });

  it("有媒体附件时不走纯聊天快速路径", () => {
    expect(planChannelExecution({
      text: "帮我看看这个",
      attachments: [{ kind: "image" }],
    }).mode).toBe("full-tool-loop");
  });

  it("空文本保守回退工具阶段", () => {
    expect(planChannelExecution({ text: "   " }).mode).toBe("full-tool-loop");
  });

  it.each([
    ["北京天气怎么样？", ["weather", "web_search"]],
    ["搜索最新的 Qwen 新闻", ["web_search"]],
    ["读取 /Users/kano/Desktop/报告.pdf", ["read_file", "list_dir"]],
    ["帮我记一笔 20 元午饭", ["record_expense"]],
    ["把这句话翻译成日语", ["translate"]],
    ["给 test@example.com 发一封邮件", ["send_email"]],
    ["昔涟，眨眨眼", ["play_live2d_action"]],
    ["你还记得我上次说的旅行计划吗？", ["user_memory", "recall_history"]],
  ])("只选择与明确意图匹配且已启用的候选工具：%s", (text, expected) => {
    const plan = planChannelExecution({
      text,
      enabledToolIds: [
        "weather", "web_search", "fetch_url", "read_file", "list_dir",
        "record_expense", "translate", "send_email", "play_live2d_action",
        "user_memory", "recall_history", "write_pdf",
      ],
    });

    expect(plan.mode).toBe("tool-loop");
    expect(plan.candidateToolIds).toEqual(expected);
  });

  it("匹配到的工具未启用时回退完整工具循环", () => {
    const plan = planChannelExecution({
      text: "给 test@example.com 发一封邮件",
      enabledToolIds: ["web_search", "read_file"],
    });

    expect(plan.mode).toBe("full-tool-loop");
    expect(plan.candidateToolIds).toBeUndefined();
  });

  it("未命中明确闲聊或工具意图的短任务保守回退完整工具循环", () => {
    const plan = planChannelExecution({ text: "帮我分析这个项目并制定执行计划" });
    expect(plan).toMatchObject({ mode: "full-tool-loop", reason: "uncertain" });
  });

  it("天气属于单次终结查询，只允许一轮工具决策", () => {
    const plan = planChannelExecution({
      text: "上海明天天气怎么样？",
      enabledToolIds: ["weather", "web_search"],
    });

    expect(plan.mode).toBe("tool-loop");
    expect(plan.finishAfterFirstToolBatch).toBe(true);
  });

  it("开放式联网搜索仍允许多轮工具编排", () => {
    const plan = planChannelExecution({
      text: "搜索最新的 Qwen 新闻并整理来源",
      enabledToolIds: ["web_search"],
    });

    expect(plan.finishAfterFirstToolBatch).toBeUndefined();
  });
});
