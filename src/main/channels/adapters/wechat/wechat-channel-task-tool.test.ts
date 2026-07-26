import { beforeEach, describe, expect, it, vi } from "vitest";
import { toolRegistry } from "../../../orchestrator/tool-registry";
import {
  registerWechatChannelTaskTool,
  setWechatChannelTaskService,
} from "./wechat-channel-task-tool";

describe("channel_task tool", () => {
  const task = {
    id: "task-1",
    identity: {
      channel: "wechat" as const,
      connectionAccountId: "account-a@im.wechat",
      participantId: "owner-a@im.wechat",
    },
    title: "喝水",
    prompt: "该喝水了",
    dueAt: "2026-07-17T08:05:00.000Z",
    state: "scheduled" as const,
    createdAt: "2026-07-17T08:00:00.000Z",
    updatedAt: "2026-07-17T08:00:00.000Z",
  };
  beforeEach(() => {
    vi.useRealTimers();
    toolRegistry.unregister("channel_task");
    setWechatChannelTaskService(null);
  });

  it("从运行上下文提取显式账号与绑定者，不接受模型传入身份", async () => {
    const create = vi.fn(async () => task);
    setWechatChannelTaskService({
      create,
      list: vi.fn(async () => []),
      cancel: vi.fn(async () => ({ ...task, state: "cancelled" as const })),
    });
    registerWechatChannelTaskTool();
    const tool = toolRegistry.getById("channel_task")!;
    const result = await tool.execute({
      action: "create",
      title: "喝水",
      prompt: "该喝水了",
      dueAt: "2026-07-17T08:05:00.000Z",
      connectionAccountId: "evil-account",
    }, {
      userQuery: "五分钟后提醒我喝水",
      metadata: {
        channel: "wechat",
        connectionAccountId: "account-a@im.wechat",
        participantId: "owner-a@im.wechat",
      },
    });

    expect(create).toHaveBeenCalledWith({
      channel: "wechat",
      connectionAccountId: "account-a@im.wechat",
      participantId: "owner-a@im.wechat",
    }, {
      title: "喝水",
      prompt: "该喝水了",
      dueAt: "2026-07-17T08:05:00.000Z",
    });
    expect(result).toContain("task-1");
  });

  it("缺少结构化微信身份时拒绝执行", async () => {
    setWechatChannelTaskService({
      create: vi.fn(), list: vi.fn(), cancel: vi.fn(),
    });
    registerWechatChannelTaskTool();
    await expect(toolRegistry.getById("channel_task")!.execute(
      { action: "list" },
      { userQuery: "查看提醒", metadata: { channel: "wechat" } },
    )).resolves.toContain("缺少微信账号或绑定者身份");
  });

  it("相对提醒使用本机时钟换算，不依赖模型推算年月日", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-17T08:00:00.000Z"));
    const create = vi.fn(async () => task);
    setWechatChannelTaskService({
      create,
      list: vi.fn(async () => []),
      cancel: vi.fn(async () => ({ ...task, state: "cancelled" as const })),
    });
    registerWechatChannelTaskTool();

    await toolRegistry.getById("channel_task")!.execute({
      action: "create",
      title: "三分钟提醒",
      prompt: "离线补发测试",
      delayMinutes: 3,
      dueAt: "2025-04-05T09:30:19.000Z",
    }, {
      userQuery: "三分钟后提醒我",
      metadata: {
        channel: "wechat",
        connectionAccountId: "account-a@im.wechat",
        participantId: "owner-a@im.wechat",
      },
    });

    expect(create).toHaveBeenCalledWith(task.identity, {
      title: "三分钟提醒",
      prompt: "离线补发测试",
      dueAt: "2026-07-17T08:03:00.000Z",
    });
  });
});
