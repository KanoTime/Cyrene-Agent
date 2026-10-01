import { describe, expect, it } from "vitest";
import type { ToolDefinition } from "./tool-registry";
import { buildToolCatalog, scopeToolSystemRules } from "./tool-catalog";

function makeTool(overrides: Partial<ToolDefinition> & { id: string }): ToolDefinition {
  return {
    name: overrides.id,
    description: overrides.id,
    enabled: true,
    inputSchema: { type: "object", properties: {} },
    execute: async () => "",
    ...overrides,
  };
}

describe("buildToolCatalog", () => {
  it("空工具列表输出占位", () => {
    expect(buildToolCatalog([])).toBe("（当前没有可用工具）");
  });

  it("基础输出：id + 用途 + 风险", () => {
    const tools = [
      makeTool({ id: "weather", description: "查询天气", risk: "network" }),
      makeTool({ id: "fetch_url", description: "读取网页", risk: "network" }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("- weather");
    expect(out).toContain("用途：查询天气");
    expect(out).toContain("风险：network");
    expect(out).toContain("- fetch_url");
    expect(out).toContain("用途：读取网页");
  });

  it("默认 risk 为 safe", () => {
    const tools = [makeTool({ id: "x", description: "X" })];
    const out = buildToolCatalog(tools);
    expect(out).toContain("风险：safe");
  });

  it("catalogHint 优先于 description", () => {
    const tools = [
      makeTool({
        id: "weather",
        description: "查询指定城市的实时天气，返回温度、湿度、风速等信息。",
        catalogHint: "查询天气",
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("用途：查询天气");
    expect(out).not.toContain("温度、湿度");
  });

  it("未填 catalogHint 时回落 description 首行", () => {
    const tools = [
      makeTool({
        id: "fetch_url",
        description:
          "下载指定 URL 的网页内容并返回正文。\n何时用：\n- 用户给了明确的网址",
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("用途：下载指定 URL 的网页内容并返回正文。");
    expect(out).not.toContain("何时用");
  });

  it("description 缺失时回落 catalogHint（兜底）", () => {
    const tools = [
      makeTool({
        id: "x",
        description: "",
        catalogHint: "兜底用途",
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).toContain("用途：兜底用途");
  });

  it("目录不输出参数（避免与 Schema 重复）", () => {
    const tools = [
      makeTool({
        id: "weather",
        description: "查询天气",
        inputSchema: {
          type: "object",
          properties: { city: { type: "string", description: "城市名" } },
          required: ["city"],
        },
      }),
    ];
    const out = buildToolCatalog(tools);
    expect(out).not.toContain("city");
    expect(out).not.toContain("properties");
    expect(out).not.toContain("required");
  });

  it("多工具按顺序拼接", () => {
    const tools = [
      makeTool({ id: "a", description: "A 工具" }),
      makeTool({ id: "b", description: "B 工具" }),
      makeTool({ id: "c", description: "C 工具" }),
    ];
    const out = buildToolCatalog(tools);
    const idxA = out.indexOf("- a");
    const idxB = out.indexOf("- b");
    const idxC = out.indexOf("- c");
    expect(idxA).toBeGreaterThanOrEqual(0);
    expect(idxB).toBeGreaterThan(idxA);
    expect(idxC).toBeGreaterThan(idxB);
  });
});

describe("scopeToolSystemRules", () => {
  const base = "# 通用规则\n\n---\n\n## Live2D 动作\n\n只在明确要求动作时调用。";

  it("候选集合没有 play_live2d_action 时移除动作专属规则", () => {
    expect(scopeToolSystemRules(base, [makeTool({ id: "weather" })])).toBe("# 通用规则");
  });

  it("候选集合包含 play_live2d_action 时保留动作专属规则", () => {
    expect(scopeToolSystemRules(base, [makeTool({ id: "play_live2d_action" })])).toBe(base);
  });
});
