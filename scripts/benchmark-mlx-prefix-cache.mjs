import fs from "node:fs";
import path from "node:path";
import process from "node:process";

function readArg(name, fallback) {
  const index = process.argv.indexOf(`--${name}`);
  return index >= 0 ? process.argv[index + 1] : fallback;
}

const baseUrl = readArg("base-url", "http://127.0.0.1:8080/v1").replace(/\/$/, "");
const model = readArg("model", "/Users/kano/Documents/local-llms/qwen3.5-9b/model");
const runs = Number(readArg("runs", "3"));
const maxTokens = Number(readArg("max-tokens", "96"));
const disableThinking = process.argv.includes("--disable-thinking");
const softNoThink = process.argv.includes("--soft-no-think");
const repoRoot = path.resolve(import.meta.dirname, "..");
const promptFiles = [
  "system.md",
  "identity.md",
  "soul.md",
  "canon_quotes.md",
  "styles/01_default.md",
];
const systemPrompt = promptFiles
  .map((name) => fs.readFileSync(path.join(repoRoot, "prompts", name), "utf8").trim())
  .join("\n\n---\n\n");

for (let run = 1; run <= runs; run += 1) {
  const body = {
    model,
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: `昔涟，你可以抱抱我吗？第 ${run} 次前缀缓存测试${softNoThink ? " /no_think" : ""}` },
    ],
    stream: false,
    max_tokens: maxTokens,
    ...(disableThinking ? { chat_template_kwargs: { enable_thinking: false } } : {}),
  };
  const startedAt = performance.now();
  const response = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  const usage = data.usage ?? {};
  const message = data.choices?.[0]?.message ?? {};
  console.log(JSON.stringify({
    run,
    disableThinking,
    softNoThink,
    status: response.status,
    elapsedMs: Math.round(performance.now() - startedAt),
    inputTokens: usage.prompt_tokens ?? usage.input_tokens,
    outputTokens: usage.completion_tokens ?? usage.output_tokens,
    cachedTokens: usage.prompt_tokens_details?.cached_tokens ?? usage.cached_tokens ?? 0,
    finishReason: data.choices?.[0]?.finish_reason,
    contentChars: (message.content ?? "").length,
    reasoningChars: (message.reasoning_content ?? "").length,
    error: data.error,
  }));
  if (!response.ok) process.exitCode = 1;
}
