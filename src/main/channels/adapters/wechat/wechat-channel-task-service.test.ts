import { describe, expect, it, vi } from "vitest";
import { mkdtemp } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { WechatChannelTaskService } from "./wechat-channel-task-service";
import type { OutgoingMessage } from "../../types";

const identityA = {
  channel: "wechat" as const,
  connectionAccountId: "account-a@im.wechat",
  participantId: "owner@im.wechat",
};
const identityB = { ...identityA, connectionAccountId: "account-b@im.wechat" };

async function createService(overrides: {
  isOnline?: (accountId: string) => boolean;
  send?: (message: OutgoingMessage) => Promise<{ ok: boolean; error?: string }>;
} = {}) {
  const rootDir = await mkdtemp(path.join(os.tmpdir(), "cyrene-channel-task-"));
  const send = overrides.send ?? vi.fn(async (_message: OutgoingMessage) => ({ ok: true }));
  let currentTime = new Date("2026-07-17T08:00:00.000Z");
  const service = new WechatChannelTaskService({
    rootDir,
    now: () => new Date(currentTime),
    id: () => "task-1",
    isAccountOnline: overrides.isOnline ?? (() => true),
    send,
  });
  return {
    service,
    send,
    setNow: (value: string) => { currentTime = new Date(value); },
  };
}

describe("WechatChannelTaskService", () => {
  it("任务 CRUD 严格限制为创建它的账号与绑定者", async () => {
    const { service } = await createService();
    const task = await service.create(identityA, {
      title: "喝水提醒",
      prompt: "该喝水啦",
      dueAt: "2026-07-17T08:05:00.000Z",
    });
    expect(await service.list(identityA)).toEqual([task]);
    expect(await service.list(identityB)).toEqual([]);
    await expect(service.cancel(identityB, task.id)).rejects.toThrow("任务不存在或无权访问");
    await service.cancel(identityA, task.id);
    expect((await service.list(identityA))[0]).toMatchObject({ state: "cancelled" });
  });

  it("账号离线时保持待投递，恢复后无论检查多少次都最多发送一次", async () => {
    let online = false;
    const { service, send, setNow } = await createService({ isOnline: () => online });
    await service.create(identityA, {
      title: "到期任务",
      prompt: "提醒内容",
      dueAt: "2026-07-17T08:01:00.000Z",
    });

    setNow("2026-07-17T08:02:00.000Z");
    await service.processDue();
    expect(send).not.toHaveBeenCalled();
    expect((await service.list(identityA))[0]).toMatchObject({ state: "pending_delivery" });

    online = true;
    await Promise.all([service.processDue(), service.processDue()]);
    await service.processDue();
    expect(send).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledWith(expect.objectContaining({
      connectionAccountId: identityA.connectionAccountId,
      conversationIdentity: identityA,
      targetId: identityA.participantId,
    }));
    expect((await service.list(identityA))[0]).toMatchObject({ state: "delivered" });
  });

  it("删除账号后归档未完成任务且永不迁移或投递", async () => {
    const { service, send, setNow } = await createService();
    await service.create(identityA, {
      title: "待归档",
      prompt: "不要迁移",
      dueAt: "2026-07-17T08:01:00.000Z",
    });
    await service.archiveAccount(identityA.connectionAccountId);
    setNow("2026-07-17T08:02:00.000Z");
    await service.processDue();
    expect(send).not.toHaveBeenCalled();
    expect((await service.list(identityA))[0]).toMatchObject({ state: "archived" });
    expect(await service.list(identityB)).toEqual([]);
  });

  it("拒绝已经过去的提醒时间，避免误标为立即投递", async () => {
    const { service } = await createService();
    await expect(service.create(identityA, {
      title: "错误年份",
      prompt: "不应立即发送",
      dueAt: "2025-04-05T09:30:19.000Z",
    })).rejects.toThrow("提醒时间必须晚于当前时间");
    expect(await service.list(identityA)).toEqual([]);
  });
});
