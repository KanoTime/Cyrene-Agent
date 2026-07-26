import { toolRegistry } from "../../../orchestrator/tool-registry";
import type { ToolContext } from "../../../orchestrator/tool-context";
import type { ChannelConversationIdentity } from "../../types";
import type { WechatChannelTask, WechatChannelTaskService } from "./wechat-channel-task-service";

type ChannelTaskService = Pick<WechatChannelTaskService, "create" | "list" | "cancel">;
let taskService: ChannelTaskService | null = null;

export function setWechatChannelTaskService(service: ChannelTaskService | null): void {
  taskService = service;
}

function identityFromContext(ctx?: ToolContext): ChannelConversationIdentity | null {
  const metadata = ctx?.metadata;
  if (
    metadata?.channel !== "wechat"
    || typeof metadata.connectionAccountId !== "string"
    || !metadata.connectionAccountId
    || typeof metadata.participantId !== "string"
    || !metadata.participantId
  ) return null;
  return {
    channel: "wechat",
    connectionAccountId: metadata.connectionAccountId,
    participantId: metadata.participantId,
  };
}

function summarize(task: Pick<WechatChannelTask, "id" | "title" | "dueAt" | "state">): string {
  return `${task.id} | ${task.title} | ${task.dueAt} | ${task.state}`;
}

export function registerWechatChannelTaskTool(): void {
  toolRegistry.register({
    id: "channel_task",
    name: "微信渠道提醒",
    description: "为当前微信账号的扫码绑定者创建、查看或取消定时提醒。相对时间必须使用 delayMinutes，由本机时钟换算；只有用户指定绝对日期时间时才使用 dueAt。任务不会跨账号共享或迁移。",
    catalogHint: "创建、查看或取消当前微信绑定者的定时提醒",
    category: "channel",
    enabled: true,
    risk: "safe",
    needsContext: true,
    inputSchema: {
      type: "object",
      properties: {
        action: { type: "string", enum: ["create", "list", "cancel"], description: "操作类型" },
        title: { type: "string", description: "创建时的简短标题" },
        prompt: { type: "string", description: "到期时发送的提醒内容" },
        delayMinutes: { type: "number", description: "用户说‘几分钟/小时后’时使用，填写从现在起的分钟数；不要自行换算当前日期" },
        dueAt: { type: "string", description: "仅用于用户明确指定的绝对日期时间，ISO 8601 格式且包含时区；必须晚于当前时间" },
        taskId: { type: "string", description: "取消时的任务 ID" },
      },
      required: ["action"],
    },
    execute: async (args, ctx) => {
      if (!taskService) return "[channel_task] 微信渠道任务服务未初始化";
      const identity = identityFromContext(ctx);
      if (!identity) return "[channel_task] 缺少微信账号或绑定者身份，已拒绝执行";
      const action = String(args.action ?? "");
      try {
        if (action === "create") {
          const dueAt = resolveDueAt(args);
          const task = await taskService.create(identity, {
            title: String(args.title ?? ""),
            prompt: String(args.prompt ?? ""),
            dueAt,
          });
          return `[channel_task] 已创建：${summarize(task)}`;
        }
        if (action === "list") {
          const tasks = await taskService.list(identity);
          return tasks.length
            ? `[channel_task] 当前账号的任务：\n${tasks.map(summarize).join("\n")}`
            : "[channel_task] 当前账号没有任务";
        }
        if (action === "cancel") {
          const task = await taskService.cancel(identity, String(args.taskId ?? ""));
          return `[channel_task] 已取消：${summarize(task)}`;
        }
        return "[channel_task] action 必须是 create、list 或 cancel";
      } catch (error) {
        return `[channel_task] 执行失败：${error instanceof Error ? error.message : String(error)}`;
      }
    },
  });
}

function resolveDueAt(args: Record<string, unknown>): string {
  if (args.delayMinutes !== undefined && args.delayMinutes !== null && args.delayMinutes !== "") {
    const delayMinutes = Number(args.delayMinutes);
    if (!Number.isFinite(delayMinutes) || delayMinutes <= 0) {
      throw new Error("延迟分钟数必须大于 0");
    }
    return new Date(Date.now() + delayMinutes * 60_000).toISOString();
  }
  return String(args.dueAt ?? "");
}
