import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ToolDefinition } from "./tool-registry";
import type { ToolCallResult } from "./types";
import type {
  ChatMessage,
  ChatRequest,
  ChatResponse,
  ChatVendorAdapter,
  HttpRequest,
  ProviderCapability,
  ToolCall,
  ToolExecutionResult,
} from "./vendors/types";
import { runTwoPhaseFcLoop } from "./two-phase-fc-loop";

const TEST_CAPABILITY: ProviderCapability = {
  id: "test",
  displayName: "test",
  transport: "openai",
  baseUrl: "https://test/",
  authStyle: "bearer",
  defaultModel: "m",
  supportsTools: true,
  supportsThinking: false,
  thinkingField: null,
  cacheStrategy: "none",
  testStrategy: "text",
  supportsVision: false,
};

/**
 * 极简 fake adapter —— 不发真 HTTP 请求，按 sequence 里的脚本返回响应。
 */
class FakeAdapter implements ChatVendorAdapter {
  readonly id = "fake";
  readonly transport = "openai" as const;
  capability: ProviderCapability = TEST_CAPABILITY;

  /** 控制台返回的脚本：每次 fetch 调用消耗一个 script 元素。 */
  private scripts: Array<
    | { kind: "text"; text: string; usage?: { input: number; output: number } }
    | { kind: "tool"; toolCalls: ToolCall[] }
    | { kind: "error"; message: string }
  > = [];
  private callIndex = 0;
  /** 记录所有发出的请求体，便于断言。 */
  readonly requests: ChatRequest[] = [];

  constructor(private readonly url = "https://fake/") {}

  enqueueText(text: string, usage?: { input: number; output: number }) {
    this.scripts.push({ kind: "text", text, usage });
  }
  enqueueToolCalls(toolCalls: ToolCall[]) {
    this.scripts.push({ kind: "tool", toolCalls });
  }
  enqueueError(message: string) {
    this.scripts.push({ kind: "error", message });
  }

  buildRequest(req: ChatRequest): HttpRequest {
    this.requests.push(req);
    return {
      url: this.url,
      method: "POST",
      headers: {},
      body: JSON.stringify({}),
    };
  }
  parseResponse(raw: unknown): ChatResponse {
    const script = this.scripts[this.callIndex++];
    if (!script) throw new Error("FakeAdapter: no script enqueued for call " + this.callIndex);
    if (script.kind === "error") throw new Error(script.message);

    const text = script.kind === "text" ? script.text : "";
    const toolCalls = script.kind === "tool" ? script.toolCalls : [];

    return {
      assistantMessage: {
        role: "assistant",
        ...(text ? { content: text } : {}),
        ...(toolCalls.length > 0 ? { toolCalls } : {}),
      },
      text,
      toolCalls,
      finishReason: toolCalls.length > 0 ? "tool_calls" : "stop",
      raw: {},
      ...(script.kind === "text" && script.usage ? { usage: script.usage } : {}),
    };
  }
  appendToolResults(messages: ChatMessage[], results: ToolExecutionResult[]): ChatMessage[] {
    const next = messages.slice();
    for (const r of results) {
      next.push({
        role: "tool",
        toolCallId: r.toolCall.id,
        name: r.toolCall.name,
        content: r.output,
      });
    }
    return next;
  }
  buildStreamRequest(req: ChatRequest): HttpRequest {
    return this.buildRequest({ ...req, stream: true });
  }
  parseStreamEvent(): null {
    return null;
  }
  async testConnection() {
    return { ok: true, latency: 0 };
  }
}

function makeTool(id: string, enabled = true): ToolDefinition {
  return {
    id,
    name: id,
    description: id,
    enabled,
    inputSchema: { type: "object", properties: {} },
    execute: async () => "ok",
  };
}

const baseMessages: ChatMessage[] = [
  { role: "user", content: "你好" },
];

const baseOptions = {
  messages: baseMessages,
  tools: [makeTool("weather")],
  toolSystemContent: "TOOL_SYSTEM",
  soulSystemBaseContent: "SOUL_SYSTEM_BASE",
  timeoutMs: 30_000,
};

beforeEach(() => {
  // 默认 fetch stub：如果 fake adapter 返回了正常响应，这里不会真发请求
  // （adapter 的 buildRequest 不真发请求）。但 runTwoPhaseFcLoop 内部仍走 fetch。
  globalThis.fetch = vi.fn(async () => {
    return new Response("{}", { status: 200 });
  }) as unknown as typeof fetch;
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("runTwoPhaseFcLoop", () => {
  it("soul-only 模式跳过工具阶段，只发出一次不带 tools 的 Soul 请求", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("来啦，抱紧你～");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      executionMode: "soul-only",
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("soul-only 不应执行工具");
      },
    });

    expect(result.reply).toBe("来啦，抱紧你～");
    expect(result.soulPhaseReason).toBe("soul_only");
    expect(adapter.requests).toHaveLength(1);
    expect(adapter.requests[0].messages[0].content).toBe("SOUL_SYSTEM_BASE");
    expect(adapter.requests[0].tools).toBeUndefined();
  });

  it("Soul 请求按稳定前缀、动态后缀、会话顺序发送，且不删除原文", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("好呀");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      executionMode: "soul-only",
      soulSystemStableContent: "STABLE_SOUL",
      soulSystemDynamicContent: "DYNAMIC_CONTEXT",
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "unused",
    });

    expect(adapter.requests[0].messages.slice(0, 3)).toEqual([
      { role: "system", content: "STABLE_SOUL" },
      { role: "system", content: "DYNAMIC_CONTEXT" },
      { role: "user", content: "你好" },
    ]);
  });

  it("softNoThink 只修改请求副本的最后一条 user，不污染原始消息", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("来啦～");
    const messages: ChatMessage[] = [
      { role: "user", content: "上一问" },
      { role: "assistant", content: "上一答" },
      { role: "user", content: "抱抱我" },
    ];

    await runTwoPhaseFcLoop({
      ...baseOptions,
      messages,
      executionMode: "soul-only",
      softNoThink: true,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "unused",
    });

    expect(adapter.requests[0].messages[1].content).toBe("上一问");
    expect(adapter.requests[0].messages[3].content).toBe("抱抱我 /no_think");
    expect(messages[2].content).toBe("抱抱我");
  });

  it("softNoThink 不重复追加已经存在的 /no_think", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("好");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      messages: [{ role: "user", content: "简短回答 /no_think" }],
      executionMode: "soul-only",
      softNoThink: true,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "unused",
    });

    expect(adapter.requests[0].messages[1].content).toBe("简短回答 /no_think");
  });

  it("云端 503 时切换本地并为本地 Qwen 请求副本追加 /no_think", async () => {
    const primary = new FakeAdapter("https://cloud.test/");
    const fallback = new FakeAdapter("http://127.0.0.1:8080/");
    fallback.enqueueText("本地接住你啦");
    globalThis.fetch = vi.fn(async (url) => {
      return String(url).includes("cloud.test")
        ? new Response("service unavailable", { status: 503 })
        : new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      executionMode: "soul-only",
      settings: { provider: "cloud", baseUrl: "https://cloud.test", model: "qwen-plus", apiKey: "cloud" },
      adapter: primary,
      fallback: {
        settings: { provider: "local", baseUrl: "http://127.0.0.1:8080/v1", model: "local-qwen3", apiKey: "" },
        adapter: fallback,
        softNoThink: true,
        activateAfterMs: 15_000,
      },
      executeTool: async () => "unused",
    });

    expect(result.reply).toBe("本地接住你啦");
    expect(primary.requests).toHaveLength(1);
    expect(fallback.requests).toHaveLength(1);
    expect(fallback.requests[0].model).toBe("local-qwen3");
    expect(fallback.requests[0].messages.at(-1)?.content).toBe("你好 /no_think");
  });

  it("云端 400 请求错误不自动回退，避免掩盖协议或内容问题", async () => {
    const primary = new FakeAdapter("https://cloud.test/");
    const fallback = new FakeAdapter("http://127.0.0.1:8080/");
    globalThis.fetch = vi.fn(async () => new Response("bad request", { status: 400 })) as unknown as typeof fetch;

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      executionMode: "soul-only",
      settings: { provider: "cloud", baseUrl: "https://cloud.test", model: "qwen-plus", apiKey: "cloud" },
      adapter: primary,
      fallback: {
        settings: { provider: "local", baseUrl: "http://127.0.0.1:8080/v1", model: "local-qwen3", apiKey: "" },
        adapter: fallback,
        softNoThink: true,
      },
      executeTool: async () => "unused",
    });

    expect(result.reply).toContain("HTTP 400");
    expect(fallback.requests).toHaveLength(0);
  });

  it("外部取消会终止正在进入的 Soul 请求，且不会误触发本地回退", async () => {
    const primary = new FakeAdapter("https://cloud.test/");
    const fallback = new FakeAdapter("http://127.0.0.1:8080/");
    const controller = new AbortController();
    controller.abort();

    await expect(runTwoPhaseFcLoop({
      ...baseOptions,
      executionMode: "soul-only",
      signal: controller.signal,
      settings: { provider: "cloud", baseUrl: "https://cloud.test", model: "qwen-plus", apiKey: "cloud" },
      adapter: primary,
      fallback: {
        settings: { provider: "local", baseUrl: "http://127.0.0.1:8080/v1", model: "local-qwen3", apiKey: "" },
        adapter: fallback,
      },
      executeTool: async () => "unused",
    })).rejects.toThrow("run cancelled");

    expect(primary.requests).toHaveLength(0);
    expect(fallback.requests).toHaveLength(0);
  });

  it("工具执行后云端总结失败只切换本地总结，不重复执行工具", async () => {
    const primary = new FakeAdapter("https://cloud.test/");
    const fallback = new FakeAdapter("http://127.0.0.1:8080/");
    primary.enqueueToolCalls([{ id: "weather-1", name: "weather", arguments: "{\"city\":\"上海\"}" }]);
    fallback.enqueueText("本地总结：上海明天晴");
    let cloudCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cloud.test")) {
        cloudCalls++;
        return cloudCalls === 1
          ? new Response("{}", { status: 200 })
          : new Response("service unavailable", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const executeTool = vi.fn(async () => "上海明天晴");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      finishAfterFirstToolBatch: true,
      settings: { provider: "cloud", baseUrl: "https://cloud.test", model: "qwen-plus", apiKey: "cloud" },
      adapter: primary,
      fallback: {
        settings: { provider: "local", baseUrl: "http://127.0.0.1:8080/v1", model: "local-qwen3", apiKey: "" },
        adapter: fallback,
        softNoThink: true,
      },
      executeTool,
    });

    expect(result.reply).toBe("本地总结：上海明天晴");
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(fallback.requests[0].messages.some((message) => message.role === "tool")).toBe(true);
  });

  it("跨模型回退时按工具名和规范化参数去重副作用工具", async () => {
    const primary = new FakeAdapter("https://cloud.test/");
    const fallback = new FakeAdapter("http://127.0.0.1:8080/");
    primary.enqueueToolCalls([{
      id: "send-primary",
      name: "send_email",
      arguments: '{"to":"friend@example.com","subject":"问候"}',
    }]);
    fallback.enqueueToolCalls([{
      id: "send-fallback",
      name: "send_email",
      arguments: '{"subject":"问候","to":"friend@example.com"}',
    }]);
    fallback.enqueueText("");
    fallback.enqueueText("邮件只发送了一次。");

    let cloudCalls = 0;
    globalThis.fetch = vi.fn(async (url) => {
      if (String(url).includes("cloud.test")) {
        cloudCalls++;
        return cloudCalls === 1
          ? new Response("{}", { status: 200 })
          : new Response("service unavailable", { status: 503 });
      }
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch;
    const executeTool = vi.fn(async () => "发送成功");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("send_email")],
      settings: { provider: "cloud", baseUrl: "https://cloud.test", model: "qwen-plus", apiKey: "cloud" },
      adapter: primary,
      fallback: {
        settings: { provider: "local", baseUrl: "http://127.0.0.1:8080/v1", model: "local-qwen3", apiKey: "" },
        adapter: fallback,
      },
      executeTool,
    });

    expect(result.reply).toBe("邮件只发送了一次。");
    expect(executeTool).toHaveBeenCalledTimes(1);
    expect(result.toolResults).toHaveLength(2);
    expect(result.toolResults[1].output).toBe("发送成功");
  });

  it("通过公共事件分别暴露 Tool 与 Soul 阶段的耗时、用量和请求规模", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("", { input: 9492, output: 30 });
    adapter.enqueueText("抱抱你", { input: 5290, output: 84 });

    const metrics: Array<Extract<Parameters<NonNullable<Parameters<typeof runTwoPhaseFcLoop>[0]["onEvent"]>>[0], { type: "llm_phase_metrics" }>> = [];
    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "unused",
      recordUsage: () => {},
      onEvent: (event) => {
        if (event.type === "llm_phase_metrics") metrics.push(event);
      },
    });

    expect(metrics).toHaveLength(2);
    expect(metrics[0]).toMatchObject({
      phase: "tool",
      round: 1,
      inputTokens: 9492,
      outputTokens: 30,
      messageCount: 2,
      toolCount: 1,
    });
    expect(metrics[1]).toMatchObject({
      phase: "soul",
      inputTokens: 5290,
      outputTokens: 84,
      messageCount: 2,
      toolCount: 0,
    });
    expect(metrics.every((metric) => metric.elapsedMs >= 0)).toBe(true);
  });

  it("executes only model-authored tool calls", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "call-1", name: "music_search", arguments: JSON.stringify({ keyword: "左转灯" }) }]);
    adapter.enqueueText("工具阶段结束");
    adapter.enqueueText("已经找到真实结果");
    const executed: ToolCall[] = [];

    await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_search")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async (toolCall) => {
        executed.push(toolCall);
        return JSON.stringify({ kind: "search", set: { tracks: [{ id: "1", name: "左转灯" }] } });
      },
    });

    expect(JSON.parse(executed[0].arguments)).toEqual({ keyword: "左转灯" });
    expect(adapter.requests[0].messages.some((message) => message.role === "tool")).toBe(false);
    expect(adapter.requests[1].messages.some((message) => message.role === "tool")).toBe(true);
    expect(adapter.requests[0].toolChoiceIntent).toBeUndefined();
  });

  it("never forces a tool choice before the model decides", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("模型仍未调用工具");
    adapter.enqueueText("最终回复");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => "ok",
    });

    expect(adapter.requests[0].toolChoiceIntent).toBeUndefined();
    expect(adapter.requests[1].toolChoiceIntent).toBeUndefined();
  });

  it("模型无 tool_calls → 切 SOUL_PHASE，工具阶段自由文本不写入 conversation", async () => {
    const adapter = new FakeAdapter();
    // TOOL_PHASE: 模型生成自由文本（这个文本不应进入 soul 的 conversation）
    adapter.enqueueText("UNSEEN_TOOL_TEXT");
    // SOUL_PHASE: 模型返回最终回复
    adapter.enqueueText("最终面向用户的回复");

    const executeToolCalls: ToolCall[] = [];
    const events: string[] = [];

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async (tc) => {
        executeToolCalls.push(tc);
        return "tool output";
      },
      onEvent: (e) => events.push(e.type),
    });

    expect(result.reply).toBe("最终面向用户的回复");
    expect(result.soulPhaseReason).toBe("no_tool");
    expect(executeToolCalls).toHaveLength(0);

    // 第一个请求用 tool_system，第二个请求用 soul_systemBase
    expect(adapter.requests).toHaveLength(2);
    const toolReq = adapter.requests[0];
    const soulReq = adapter.requests[1];

    // tool 阶段 system
    expect(toolReq.messages[0].role).toBe("system");
    expect(toolReq.messages[0].content).toBe("TOOL_SYSTEM");
    expect(toolReq.tools).toBeDefined();
    expect(toolReq.tools!.length).toBeGreaterThan(0);

    // soul 阶段 system
    expect(soulReq.messages[0].role).toBe("system");
    expect(String(soulReq.messages[0].content)).toContain("SOUL_SYSTEM_BASE");
    expect(String(soulReq.messages[0].content)).toContain('"calls":[]');
    // soul 阶段不携带 tools
    expect(soulReq.tools).toBeUndefined();

    // 关键：工具阶段的 UNSEEN_TOOL_TEXT 不进入 soul 的 conversation
    // soul request 的所有 messages 拼接起来不应该出现 UNSEEN_TOOL_TEXT
    const allSoulContent = soulReq.messages
      .map((m) => (typeof m.content === "string" ? m.content : ""))
      .join("\n");
    expect(allSoulContent).not.toContain("UNSEEN_TOOL_TEXT");
  });

  it("工具阶段：模型调用工具 → 执行 → 继续 TOOL_PHASE", async () => {
    const adapter = new FakeAdapter();
    // 第 1 轮：模型调工具
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: '{"city":"北京"}' },
    ]);
    // 第 2 轮：模型不调工具（自由文本）→ 切 SOUL_PHASE
    adapter.enqueueText("");
    // SOUL_PHASE
    adapter.enqueueText("北京今天 25 度");

    const executeResults: string[] = [];

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async (tc) => {
        executeResults.push(tc.name);
        return "北京：晴 25°C";
      },
    });

    expect(executeResults).toEqual(["weather"]);
    expect(result.reply).toBe("北京今天 25 度");
    expect(result.soulPhaseReason).toBe("no_tool");

    // 3 个请求：2 个 tool 阶段 + 1 个 soul 阶段
    expect(adapter.requests.length).toBeGreaterThanOrEqual(3);
    // soul 阶段不带 tools
    const soulReq = adapter.requests[adapter.requests.length - 1];
    expect(soulReq.tools).toBeUndefined();
    // soul 阶段 system 同时包含 soul base 与本轮执行事实
    expect(String(soulReq.messages[0].content)).toContain("SOUL_SYSTEM_BASE");
    expect(String(soulReq.messages[0].content)).toContain('"toolId":"weather"');
  });

  it("纯聊天场景：tool 阶段 no_tool → soul 阶段回复", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText(""); // tool 阶段：模型没调工具（自由文本忽略）
    adapter.enqueueText("hi 朋友～");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("executeTool 不应在纯聊天时被调用");
      },
    });

    expect(result.reply).toBe("hi 朋友～");
    expect(result.soulPhaseReason).toBe("no_tool");
    expect(result.toolResults).toHaveLength(0);
  });

  it("达到 maxToolRounds → SOUL_PHASE 强制总结", async () => {
    const adapter = new FakeAdapter();
    // 永远调工具，直到达到上限
    for (let i = 0; i < 3; i++) {
      adapter.enqueueToolCalls([
        { id: `tc-${i}`, name: "weather", arguments: "{}" },
      ]);
    }
    // soul 阶段
    adapter.enqueueText("抱歉，已经循环太多次了");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      maxToolRounds: 3,
      executeTool: async () => "tool output",
    });

    expect(result.soulPhaseReason).toBe("max_rounds");
    expect(result.reply).toBe("抱歉，已经循环太多次了");
  });

  it("单次终结工具在首批结果后直接进入 Soul，不再发第二轮工具判断", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([
      { id: "tc-weather", name: "weather", arguments: "{\"city\":\"上海\"}" },
    ]);
    adapter.enqueueText("上海明天多云，记得带伞。", { input: 5500, output: 20 });

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      finishAfterFirstToolBatch: true,
      executeTool: async () => "上海明天多云，18-24℃",
      recordUsage: () => {},
    });

    expect(result.soulPhaseReason).toBe("tool_complete");
    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests[0].tools).toHaveLength(1);
    expect(adapter.requests[1].tools).toBeUndefined();
    expect(adapter.requests[1].messages.some((message) => message.role === "tool")).toBe(true);
  });

  it("工具执行异常不影响主流程，并记录结构化失败状态", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: "{}" },
    ]);
    adapter.enqueueText(""); // tool 阶段：不再调
    adapter.enqueueText("出错了但我继续");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("boom");
      },
    });

    expect(result.toolResults).toHaveLength(1);
    expect(result.toolResults[0]).toMatchObject({
      output: "boom",
      status: "failed",
      errorCode: "E_TOOL_EXECUTION_FAILED",
    });
    expect(result.reply).toBe("出错了但我继续");
  });

  it("preserves a structured runtime failure for the final Soul call", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "play-1", name: "music_play_track", arguments: "{\"candidateRef\":\"ctx_missing\"}" }]);
    adapter.enqueueText("");
    adapter.enqueueText("这次请求没有成功，我再确认一下目标。");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_play_track")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => ({
        status: "failed" as const,
        output: "E_CONTEXT_REF_NOT_FOUND",
        errorCode: "E_CONTEXT_REF_NOT_FOUND",
      }),
    });

    expect(result.toolResults[0]).toMatchObject({
      toolId: "music_play_track",
      status: "failed",
      errorCode: "E_CONTEXT_REF_NOT_FOUND",
    });
    const sysContent = String(adapter.requests.at(-1)!.messages[0].content);
    expect(sysContent).toContain('"status":"failed"');
    expect(sysContent).toContain('"errorCode":"E_CONTEXT_REF_NOT_FOUND"');
  });

  it("emits a concise structured tool execution trace", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    try {
      const adapter = new FakeAdapter();
      adapter.enqueueToolCalls([{ id: "play-1", name: "music_play_track", arguments: "{}" }]);
      adapter.enqueueText("");
      adapter.enqueueText("没有执行成功。");

      await runTwoPhaseFcLoop({
        ...baseOptions,
        tools: [makeTool("music_play_track")],
        settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
        adapter,
        executeTool: async () => ({
          status: "failed",
          output: "E_CONTEXT_REF_NOT_FOUND",
          errorCode: "E_CONTEXT_REF_NOT_FOUND",
        }),
      });

      const lines = log.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(lines).toContain("[ToolExecution/Trace] tool=music_play_track status=failed errorCode=E_CONTEXT_REF_NOT_FOUND");
    } finally {
      log.mockRestore();
    }
  });

  it("Soul 阶段同时保留 tool 消息并注入本轮权威执行上下文", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: "{}" },
    ]);
    adapter.enqueueText("");
    adapter.enqueueText("北京 25 度");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "北京：晴 25°C",
    });

    const soulReq = adapter.requests[adapter.requests.length - 1];
    const sysContent = String(soulReq.messages[0].content);
    expect(sysContent).toContain("SOUL_SYSTEM_BASE");
    expect(sysContent).toContain("[TOOL_EXECUTION_CONTEXT]");
    expect(sysContent).toContain('"toolId":"weather"');
    expect(sysContent).toContain('"status":"succeeded"');
    expect(sysContent).toContain("北京：晴 25°C");
    expect(soulReq.messages).toEqual(expect.arrayContaining([
      expect.objectContaining({ role: "tool", name: "weather", content: "北京：晴 25°C" }),
    ]));
  });

  it("buildSoulToolResultsSummary 非空时，会追加到 soul system 末尾", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([
      { id: "tc-1", name: "weather", arguments: "{}" },
    ]);
    adapter.enqueueText("");
    adapter.enqueueText("北京 25 度");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => "北京：晴 25°C",
      buildSoulToolResultsSummary: () => "工具摘要：天气查询成功",
    });

    const soulReq = adapter.requests[adapter.requests.length - 1];
    const sysContent = String(soulReq.messages[0].content);
    expect(sysContent).toContain("SOUL_SYSTEM_BASE");
    expect(sysContent).toContain("工具摘要：天气查询成功");
  });

  it("tool 阶段自由文本绝不能发给用户（不进入 reply）", async () => {
    const adapter = new FakeAdapter();
    // 工具阶段模型返回了一段看起来很完整的文本
    adapter.enqueueText("这是工具阶段的文本，绝对不能泄露给用户");
    adapter.enqueueText("这是 soul 阶段的正式回复");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("不应调用");
      },
    });

    expect(result.reply).not.toContain("工具阶段的文本");
    expect(result.reply).toBe("这是 soul 阶段的正式回复");
  });

  it("strips leaked leading chat timestamp metadata before emitting and returning reply", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("[2026-07-13 13:36, Asia/Shanghai]\n怎么啦，看起来不太高兴的样子…");

    let streamed = "";
    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: {
        provider: "test",
        baseUrl: "https://test",
        model: "m",
        apiKey: "k",
      },
      adapter,
      executeTool: async () => {
        throw new Error("不应调用");
      },
      onEvent: (event) => {
        if (event.type === "text_message_content") streamed += event.delta;
      },
    });

    expect(result.reply).toBe("怎么啦，看起来不太高兴的样子…");
    expect(streamed).toBe("怎么啦，看起来不太高兴的样子…");
  });

  it("never emits MiniMax textual tool-call protocol from the Soul phase", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("]<]minimax[>[<tool_call>\n]<]minimax[>[<invoke name=\"music_get_daily_recommendations\">]<]minimax[>[</invoke>\n]<]minimax[>[</tool_call>");

    let streamed = "";
    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => "ok",
      onEvent: (event) => {
        if (event.type === "text_message_content") streamed += event.delta;
      },
    });

    expect(result.reply).not.toContain("tool_call");
    expect(result.reply).not.toContain("minimax");
    expect(result.reply.trim().length).toBeGreaterThan(0);
    expect(streamed).toBe(result.reply);
  });

  it("replaces a leaked textual tool protocol with a generic retry message", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "daily-1", name: "music_get_daily_recommendations", arguments: "{}" }]);
    adapter.enqueueText("");
    adapter.enqueueText("[tool_call]\nmusic_get_daily_recommendations\n[/tool_call]");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_get_daily_recommendations")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => JSON.stringify({
        kind: "recommendations",
        set: { tracks: [{ id: "1", name: "真实歌曲" }] },
        presentation: { cardRef: "cyrene:music:daily-1" },
      }),
    });

    expect(result.reply).toContain("没有生成正常回复")
    expect(result.reply).not.toContain("tool_call")
  });

  it("lets Soul generate the natural card reply from structured tool facts without fixed replacement", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{ id: "daily-1", name: "music_get_daily_recommendations", arguments: "{}" }]);
    adapter.enqueueText("");
    adapter.enqueueText("今天的推荐已经整理好啦，看看卡片里有没有喜欢的♪");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_get_daily_recommendations")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => JSON.stringify({
        kind: "recommendations",
        context: {
          setRef: "ctx_set",
          source: "daily_recommendation",
          candidates: [{
            candidateRef: "ctx_song_1",
            position: 1,
            name: "最初的记忆",
            artists: ["徐佳莹"],
          }],
        },
        presentation: { presented: true },
      }),
    });

    expect(result.reply).toBe("今天的推荐已经整理好啦，看看卡片里有没有喜欢的♪");
    const soulReq = adapter.requests.at(-1)!;
    const sysContent = String(soulReq.messages[0].content);
    expect(sysContent).toContain('"kind":"recommendations"');
    expect(sysContent).toContain('"name":"最初的记忆"');
    expect(sysContent).toContain('"artists":["徐佳莹"]');
  });

  it("tells Soul explicitly when no tool ran instead of using a reply regex", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("正在为你播放♪");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => "ok",
    });

    expect(result.reply).toBe("正在为你播放♪");
    const sysContent = String(adapter.requests.at(-1)!.messages[0].content);
    expect(sysContent).toContain('"calls":[]');
  });

  it("provides dispatched playback as a runtime fact and leaves wording to Soul", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueToolCalls([{
      id: "play-1",
      name: "music_play_track",
      arguments: JSON.stringify({ provider: "netease-cloud-music", setId: "s1", trackId: "1" }),
    }]);
    adapter.enqueueText("");
    adapter.enqueueText("已经开始播放了♪");

    const result = await runTwoPhaseFcLoop({
      ...baseOptions,
      tools: [makeTool("music_play_track")],
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      executeTool: async () => JSON.stringify({
        kind: "playback",
        dispatch: { state: "dispatched", resourceType: "song", resourceId: "1" },
      }),
    });

    expect(result.reply).toBe("已经开始播放了♪");
    const sysContent = String(adapter.requests.at(-1)!.messages[0].content);
    expect(sysContent).toContain('"toolId":"music_play_track"');
    expect(sysContent).toContain('"state":"dispatched"');
    expect(sysContent).toContain("effect.state=dispatched");
  });

  it("keeps style sampling out of tool requests and applies it to Soul only", async () => {
    const adapter = new FakeAdapter();
    adapter.enqueueText("");
    adapter.enqueueText("done");

    await runTwoPhaseFcLoop({
      ...baseOptions,
      settings: { provider: "test", baseUrl: "https://test", model: "m", apiKey: "k" },
      adapter,
      soulSampling: { temperature: 0.9, frequencyPenalty: 0.2 },
      executeTool: async () => {
        throw new Error("不应调用");
      },
    });

    expect(adapter.requests).toHaveLength(2);
    expect(adapter.requests[0]).not.toHaveProperty("temperature");
    expect(adapter.requests[0]).not.toHaveProperty("frequencyPenalty");
    expect(adapter.requests[1]).toMatchObject({ temperature: 0.9, frequencyPenalty: 0.2 });
    expect(adapter.requests[1].tools).toBeUndefined();
  });
});
