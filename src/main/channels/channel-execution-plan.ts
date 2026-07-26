import type { ChannelAttachment } from "./types";

export type ChannelExecutionMode = "soul-only" | "tool-loop" | "full-tool-loop";

export interface ChannelExecutionPlan {
  mode: ChannelExecutionMode;
  reason: "pure_chat" | "empty" | "attachment" | "long_text" | "tool_intent" | "tool_unavailable" | "uncertain";
  candidateToolIds?: string[];
  /** 单次终结查询在首批工具结果后直接进入 Soul，避免重复询问模型是否还要工具。 */
  finishAfterFirstToolBatch?: boolean;
}

export interface ChannelExecutionInput {
  text: string;
  attachments?: Array<Pick<ChannelAttachment, "kind">>;
  enabledToolIds?: readonly string[];
  characterNames?: readonly string[];
}

interface ToolRoute {
  pattern: RegExp;
  toolIds: string[];
  finishAfterFirstToolBatch?: boolean;
}

const TOOL_ROUTES: ToolRoute[] = [
  { pattern: /(天气|气温|预报)/i, toolIds: ["weather", "web_search"], finishAfterFirstToolBatch: true },
  { pattern: /https?:\/\//i, toolIds: ["fetch_url"] },
  { pattern: /(新闻|热搜|实时|最新|联网|网页|网址|链接|搜索|搜一下|查一下|查询)/i, toolIds: ["web_search"] },
  { pattern: /(?:^|[\s"'“”])(?:\/[\w.\-\u4e00-\u9fff]+){2,}|(文件|文档|附件|目录|文件夹|读取|打开|桌面)/u, toolIds: ["read_file", "list_dir"] },
  { pattern: /(图片|照片|看图|读图)/i, toolIds: ["read_image"] },
  { pattern: /(生成|创建|制作|写).*(Excel|表格)/i, toolIds: ["write_excel"] },
  { pattern: /(生成|创建|制作|写).*(Word|文档)/i, toolIds: ["write_word"] },
  { pattern: /(生成|创建|制作|写).*PDF/i, toolIds: ["write_pdf"] },
  { pattern: /(生成|创建|制作|写).*Markdown/i, toolIds: ["write_markdown"] },
  { pattern: /(保存|写入).*(文件|路径|桌面)/i, toolIds: ["write_file"] },
  { pattern: /(记账|记一笔|花了|支出)/i, toolIds: ["record_expense"] },
  { pattern: /(开销|账单|花了多少|支出统计)/i, toolIds: ["query_expense"] },
  { pattern: /(汇率|换算)/i, toolIds: ["exchange_rate"] },
  { pattern: /翻译/i, toolIds: ["translate"] },
  { pattern: /(待办|提醒)/i, toolIds: ["todo_write"] },
  { pattern: /(邮件|发信|发一封|@[\w.-]+\.[A-Za-z]{2,})/i, toolIds: ["send_email"] },
  { pattern: /(历史记录|上次说|之前说|还记得)/i, toolIds: ["user_memory", "recall_history"] },
  { pattern: /(运行命令|终端|shell)/i, toolIds: ["run_shell"] },
  { pattern: /(安装|下载).*MCP/i, toolIds: ["install_mcp_server"] },
  { pattern: /调用\s*skill/i, toolIds: ["invoke_skill", "read_skill_reference"] },
  // 只有明确要求真实窗口动作时才进入工具阶段；“抱抱我”仍属于角色聊天。
  { pattern: /(眨眨眼|戴墨镜|播放.*动作|做个动作|动一下|换个表情|Live2D)/i, toolIds: ["play_live2d_action"] },
];

const PURE_CHAT_PATTERNS = [
  /^(?:你好|嗨|哈喽|早安|早上好|午安|晚上好|晚安)[呀啊哦～~！!。.？?]*$/i,
  /(抱抱|抱紧|亲亲|想你|爱你|喜欢你|陪陪我|陪着我|安慰我|撒个娇|辛苦[了啦呀]|谢谢你|感谢你)/i,
  /(开心|难过|伤心|委屈|孤单|寂寞|累了|好累|困了|害怕|紧张|焦虑|生气).*(?:吗|呀|啊|了|呢|。|！|!|？|\?|$)/i,
  /^(?:你觉得|你会不会|你愿意|可以陪我|能陪我|今天过得|我今天).{0,60}[？?。！!～~]?$/i,
];

function stripActiveCharacterAddress(text: string, names: readonly string[] | undefined): string {
  for (const name of names ?? []) {
    const trimmed = name.trim();
    if (!trimmed || !text.startsWith(trimmed)) continue;
    return text.slice(trimmed.length).replace(/^[，,、\s]+/, "");
  }
  return text;
}

/**
 * 微信/飞书进入模型前的保守快速路由。
 * 仅高置信度短纯聊天跳过工具阶段；任何不确定输入都回退现有工具循环。
 */
export function planChannelExecution(input: ChannelExecutionInput): ChannelExecutionPlan {
  const text = input.text.trim();
  if (!text) return { mode: "full-tool-loop", reason: "empty" };
  if ((input.attachments?.length ?? 0) > 0) return { mode: "full-tool-loop", reason: "attachment" };
  if (Array.from(text).length > 160) return { mode: "full-tool-loop", reason: "long_text" };

  const matchedIds = Array.from(new Set(
    TOOL_ROUTES
      .filter((route) => route.pattern.test(text))
      .flatMap((route) => route.toolIds),
  ));
  if (matchedIds.length > 0) {
    const matchedRoutes = TOOL_ROUTES.filter((route) => route.pattern.test(text));
    const enabled = input.enabledToolIds ? new Set(input.enabledToolIds) : null;
    const candidateToolIds = enabled ? matchedIds.filter((id) => enabled.has(id)) : matchedIds;
    if (candidateToolIds.length === 0) {
      return { mode: "full-tool-loop", reason: "tool_unavailable" };
    }
    const finishAfterFirstToolBatch = matchedRoutes.length > 0 && matchedRoutes.every((route) => route.finishAfterFirstToolBatch)
      ? true
      : undefined;
    return {
      mode: "tool-loop",
      reason: "tool_intent",
      candidateToolIds,
      ...(finishAfterFirstToolBatch ? { finishAfterFirstToolBatch } : {}),
    };
  }
  const chatText = stripActiveCharacterAddress(text, input.characterNames);
  if (PURE_CHAT_PATTERNS.some((pattern) => pattern.test(chatText))) {
    return { mode: "soul-only", reason: "pure_chat" };
  }
  return { mode: "full-tool-loop", reason: "uncertain" };
}
