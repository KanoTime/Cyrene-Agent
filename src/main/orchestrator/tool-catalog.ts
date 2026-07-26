// tool-catalog —— 运行时从 toolRegistry 自动生成工具目录。
//
// 设计原则：
// - 只输出 id + 用途 + 风险三项，不放参数（参数走 tools Schema，避免双重定义）。
// - 目录用于 LLM 工具阶段的第一层选择："这个工具大概是做什么的"，不替代完整 description。
// - 不依赖全局 toolRegistry；接受传入的工具列表，测试时可注入。

import type { ToolDefinition } from "./tool-registry";

/**
 * 提取工具的目录用途。
 * - 优先使用 catalogHint
 * - 回落 description 的首行
 * - 最后回落 description 全文
 */
function extractHint(tool: ToolDefinition): string {
  if (tool.catalogHint && tool.catalogHint.trim()) return tool.catalogHint.trim();
  const firstLine = (tool.description ?? "").split("\n")[0]?.trim();
  if (firstLine) return firstLine;
  return (tool.description ?? "").trim();
}

/**
 * 生成工具目录文本。
 * 空工具列表返回提示占位。
 */
export function buildToolCatalog(tools: ReadonlyArray<ToolDefinition>): string {
  if (tools.length === 0) return "（当前没有可用工具）";
  return tools
    .map((tool) => {
      const hint = extractHint(tool);
      const risk = tool.risk ?? "safe";
      return `- ${tool.id}\n  用途：${hint}\n  风险：${risk}`;
    })
    .join("\n");
}

/**
 * 工具候选缩小时，同步移除仅属于缺席工具的固定规则。
 * 当前 tools_system.md 的 Live2D 专属章节位于末尾，因此可安全按章节边界裁掉。
 */
export function scopeToolSystemRules(
  base: string,
  tools: ReadonlyArray<ToolDefinition>,
): string {
  if (tools.some((tool) => tool.id === "play_live2d_action")) return base;
  const marker = "\n\n---\n\n## Live2D 动作";
  const sectionStart = base.indexOf(marker);
  return sectionStart >= 0 ? base.slice(0, sectionStart).trim() : base;
}
