import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { ChannelConversationIdentity, OutgoingMessage } from "../../types";

export type WechatChannelTaskState =
  | "scheduled"
  | "pending_delivery"
  | "delivering"
  | "delivered"
  | "failed"
  | "cancelled"
  | "archived";

export interface WechatChannelTask {
  id: string;
  identity: ChannelConversationIdentity;
  title: string;
  prompt: string;
  dueAt: string;
  state: WechatChannelTaskState;
  createdAt: string;
  updatedAt: string;
  error?: string;
}

interface TaskServiceOptions {
  rootDir: string;
  now?: () => Date;
  id?: () => string;
  isAccountOnline: (accountId: string) => boolean;
  send: (message: OutgoingMessage) => Promise<{ ok: boolean; error?: string }>;
}

function assertIdentity(identity: ChannelConversationIdentity): asserts identity is ChannelConversationIdentity & { connectionAccountId: string } {
  if (identity.channel !== "wechat" || !identity.connectionAccountId || !identity.participantId) {
    throw new Error("微信渠道身份不完整");
  }
}

function sameIdentity(a: ChannelConversationIdentity, b: ChannelConversationIdentity): boolean {
  return a.channel === b.channel
    && a.connectionAccountId === b.connectionAccountId
    && a.participantId === b.participantId;
}

export class WechatChannelTaskService {
  private readonly filePath: string;
  private readonly now: () => Date;
  private readonly id: () => string;
  private mutation: Promise<unknown> = Promise.resolve();

  constructor(private readonly options: TaskServiceOptions) {
    this.filePath = path.join(options.rootDir, "tasks.json");
    this.now = options.now ?? (() => new Date());
    this.id = options.id ?? randomUUID;
  }

  async create(
    identity: ChannelConversationIdentity,
    input: { title: string; prompt: string; dueAt: string },
  ): Promise<WechatChannelTask> {
    assertIdentity(identity);
    const dueTime = Date.parse(input.dueAt);
    if (!input.title.trim() || !input.prompt.trim() || !Number.isFinite(dueTime)) {
      throw new Error("任务标题、内容或到期时间无效");
    }
    if (dueTime <= this.now().getTime()) {
      throw new Error("提醒时间必须晚于当前时间");
    }
    return this.mutate(async (tasks) => {
      const timestamp = this.now().toISOString();
      const task: WechatChannelTask = {
        id: this.id(),
        identity: { ...identity },
        title: input.title.trim(),
        prompt: input.prompt.trim(),
        dueAt: new Date(input.dueAt).toISOString(),
        state: "scheduled",
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      tasks.push(task);
      return task;
    });
  }

  async list(identity: ChannelConversationIdentity): Promise<WechatChannelTask[]> {
    assertIdentity(identity);
    return (await this.read()).filter((task) => sameIdentity(task.identity, identity));
  }

  async cancel(identity: ChannelConversationIdentity, taskId: string): Promise<WechatChannelTask> {
    assertIdentity(identity);
    return this.mutate(async (tasks) => {
      const task = tasks.find((candidate) => candidate.id === taskId && sameIdentity(candidate.identity, identity));
      if (!task) throw new Error("任务不存在或无权访问");
      if (["delivered", "archived"].includes(task.state)) throw new Error("任务已结束，无法取消");
      task.state = "cancelled";
      task.updatedAt = this.now().toISOString();
      return task;
    });
  }

  async archiveAccount(accountId: string): Promise<void> {
    await this.mutate(async (tasks) => {
      const timestamp = this.now().toISOString();
      for (const task of tasks) {
        if (task.identity.connectionAccountId === accountId && !["delivered", "cancelled", "archived"].includes(task.state)) {
          task.state = "archived";
          task.updatedAt = timestamp;
        }
      }
    });
  }

  async processDue(): Promise<void> {
    const claims = await this.mutate(async (tasks) => {
      const now = this.now().getTime();
      const claimed: WechatChannelTask[] = [];
      for (const task of tasks) {
        if (!["scheduled", "pending_delivery"].includes(task.state) || Date.parse(task.dueAt) > now) continue;
        const accountId = task.identity.connectionAccountId;
        if (!accountId || !this.options.isAccountOnline(accountId)) {
          task.state = "pending_delivery";
          task.updatedAt = this.now().toISOString();
          continue;
        }
        task.state = "delivering";
        task.updatedAt = this.now().toISOString();
        claimed.push(structuredClone(task));
      }
      return claimed;
    });

    await Promise.all(claims.map(async (task) => {
      const result = await this.options.send({
        channel: "wechat",
        connectionAccountId: task.identity.connectionAccountId,
        conversationIdentity: task.identity,
        targetId: task.identity.participantId,
        parts: [{ kind: "text", text: task.prompt }],
      }).catch((error) => ({ ok: false, error: error instanceof Error ? error.message : String(error) }));
      await this.mutate(async (tasks) => {
        const stored = tasks.find((candidate) => candidate.id === task.id && candidate.state === "delivering");
        if (!stored) return;
        stored.state = result.ok ? "delivered" : "failed";
        stored.updatedAt = this.now().toISOString();
        if (!result.ok) stored.error = result.error ?? "微信任务投递失败";
      });
    }));
  }

  private async read(): Promise<WechatChannelTask[]> {
    try {
      const parsed = JSON.parse(await readFile(this.filePath, "utf8"));
      return Array.isArray(parsed) ? parsed as WechatChannelTask[] : [];
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw error;
    }
  }

  private mutate<T>(operation: (tasks: WechatChannelTask[]) => Promise<T>): Promise<T> {
    const next = this.mutation.then(async () => {
      const tasks = await this.read();
      const result = await operation(tasks);
      await mkdir(path.dirname(this.filePath), { recursive: true });
      const temporaryPath = `${this.filePath}.${process.pid}.${Date.now()}.tmp`;
      await writeFile(temporaryPath, `${JSON.stringify(tasks, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
      await rename(temporaryPath, this.filePath);
      return result;
    });
    this.mutation = next.catch(() => undefined);
    return next;
  }
}
