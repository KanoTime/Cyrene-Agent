interface SavedProviderProfile {
  baseUrl: string;
  model: string;
  apiKey: string;
  explicitTransport?: "openai" | "anthropic" | "auto";
}

interface ResolveFallbackInput {
  channel: string;
  primaryBaseUrl: string;
  perProvider?: Record<string, SavedProviderProfile>;
}

export interface LocalModelFallback extends SavedProviderProfile {
  provider: string;
}

/** 仅为微信云端主模型选择已保存的本地 Qwen3 配置。 */
export function resolveWechatLocalModelFallback(input: ResolveFallbackInput): LocalModelFallback | undefined {
  if (input.channel !== "wechat" || isLoopbackModelUrl(input.primaryBaseUrl)) return undefined;

  for (const [provider, profile] of Object.entries(input.perProvider ?? {})) {
    if (!isLoopbackModelUrl(profile.baseUrl) || !/qwen[\s._\-/]*3/i.test(profile.model)) continue;
    return { provider, ...profile };
  }
  return undefined;
}
import { isLoopbackModelUrl } from "./channel-model-endpoint";
