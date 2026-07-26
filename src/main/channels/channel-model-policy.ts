interface ChannelModelPolicyInput {
  channel: string;
  baseUrl: string;
  model: string;
}

/**
 * Qwen3 的 `/no_think` 是模型原生软开关。这里只对微信的本地服务启用，
 * 避免改变飞书、云端供应商或其他模型的请求语义。
 */
export function shouldUseWechatQwenSoftNoThink(input: ChannelModelPolicyInput): boolean {
  return input.channel === "wechat" &&
    isLoopbackModelUrl(input.baseUrl) &&
    /qwen[\s._\-/]*3/i.test(input.model);
}
import { isLoopbackModelUrl } from "./channel-model-endpoint";
