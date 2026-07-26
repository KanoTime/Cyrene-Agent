import type { ChatMessage } from "../orchestrator/vendors/types";

/**
 * 渠道短期上下文预算：保留最近两个完整往返。
 * 更早的精确历史仍保存在 history-log，并可由 recall_history 按需召回。
 */
const MAX_PRIOR_MESSAGES = 4;

function textContent(message: ChatMessage): string | null {
  return typeof message.content === "string" ? message.content.trim() : null;
}

export function selectChannelHistoryContext(
  priorMessages: readonly ChatMessage[],
  currentUserText: string,
  maxPriorMessages: number = MAX_PRIOR_MESSAGES,
): ChatMessage[] {
  const history = priorMessages.map((message) => ({ ...message }));
  const last = history.at(-1);

  // dispatcher 会先落盘本轮 user 再读取窗口；构建请求时还会单独追加本轮 user。
  // 这里只移除末尾完全相同的一条，保留更早出现过的同句表达。
  if (
    last?.role === "user" &&
    textContent(last) === currentUserText.trim()
  ) {
    history.pop();
  }

  return history.slice(-Math.max(0, maxPriorMessages));
}

export { MAX_PRIOR_MESSAGES };
