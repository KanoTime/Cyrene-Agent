import { describe, expect, it } from "vitest";
import { resolveWechatLocalModelFallback } from "./channel-model-fallback";

describe("resolveWechatLocalModelFallback", () => {
  const localProfile = {
    baseUrl: "http://127.0.0.1:8080/v1",
    model: "/Users/kano/Documents/local-llms/qwen3.5-9b/model",
    apiKey: "",
    explicitTransport: "auto" as const,
  };

  it("云端微信主模型选择已保存的本地 Qwen3 配置作为回退", () => {
    const fallback = resolveWechatLocalModelFallback({
      channel: "wechat",
      primaryBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      perProvider: {
        "Qwen（通义千问）": { baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1", model: "qwen-plus", apiKey: "cloud" },
        "ChatGPT（OpenAI）": localProfile,
      },
    });

    expect(fallback).toEqual({
      provider: "ChatGPT（OpenAI）",
      ...localProfile,
    });
  });

  it.each([
    { channel: "feishu", primaryBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1" },
    { channel: "wechat", primaryBaseUrl: "http://127.0.0.1:8080/v1" },
  ])("范围外渠道或主模型已经本地时不启用回退：$channel", ({ channel, primaryBaseUrl }) => {
    expect(resolveWechatLocalModelFallback({
      channel,
      primaryBaseUrl,
      perProvider: { "ChatGPT（OpenAI）": localProfile },
    })).toBeUndefined();
  });

  it("没有完整本地 Qwen3 配置时不启用回退", () => {
    expect(resolveWechatLocalModelFallback({
      channel: "wechat",
      primaryBaseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
      perProvider: {
        local: { baseUrl: "http://127.0.0.1:8080/v1", model: "other-model", apiKey: "" },
      },
    })).toBeUndefined();
  });
});
