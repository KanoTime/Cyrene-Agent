import { describe, expect, it } from "vitest";
import { shouldUseWechatQwenSoftNoThink } from "./channel-model-policy";

describe("shouldUseWechatQwenSoftNoThink", () => {
  it.each([
    "http://127.0.0.1:8080/v1",
    "http://localhost:8080/v1",
    "http://[::1]:8080/v1",
  ])("微信本地 Qwen3 使用软 no-think：%s", (baseUrl) => {
    expect(shouldUseWechatQwenSoftNoThink({
      channel: "wechat",
      baseUrl,
      model: "/Users/kano/Documents/local-llms/qwen3.5-9b/model",
    })).toBe(true);
  });

  it.each([
    { channel: "feishu", baseUrl: "http://127.0.0.1:8080/v1", model: "qwen3.5-9b" },
    { channel: "wechat", baseUrl: "https://api.example.com/v1", model: "qwen3.5-9b" },
    { channel: "wechat", baseUrl: "http://127.0.0.1:8080/v1", model: "other-model" },
  ])("不影响范围外的渠道、远端或非 Qwen3 模型：$channel $baseUrl $model", (input) => {
    expect(shouldUseWechatQwenSoftNoThink(input)).toBe(false);
  });
});
