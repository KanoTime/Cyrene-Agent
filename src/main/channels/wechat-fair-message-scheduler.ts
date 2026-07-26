export interface WechatScheduledTask<T> {
  accountId: string;
  conversationKey: string;
  run: () => Promise<T>;
}

export interface WechatFairMessageSchedulerOptions {
  maxConcurrency?: number;
}

interface QueuedJob {
  accountId: string;
  conversationKey: string;
  run: () => Promise<unknown>;
  resolve: (value: unknown) => void;
  reject: (error: unknown) => void;
}

export class WechatFairMessageScheduler {
  readonly #maxConcurrency: number;
  readonly #queuesByAccount = new Map<string, QueuedJob[]>();
  readonly #accountOrder: string[] = [];
  readonly #activeConversations = new Set<string>();
  readonly #activeByAccount = new Map<string, number>();
  #activeCount = 0;
  #nextAccountIndex = 0;
  #drainQueued = false;
  #pausedForCharacterSwitch = false;
  #characterSwitchRunning = false;
  readonly #activeDrainWaiters = new Set<() => void>();

  constructor(options: WechatFairMessageSchedulerOptions = {}) {
    this.#maxConcurrency = Math.max(1, Math.floor(options.maxConcurrency ?? 2));
  }

  schedule<T>(task: WechatScheduledTask<T>): Promise<T> {
    if (!task.accountId) return Promise.reject(new Error("微信调度任务缺少连接账号"));
    if (!task.conversationKey) return Promise.reject(new Error("微信调度任务缺少对话身份"));

    return new Promise<T>((resolve, reject) => {
      const queue = this.#queuesByAccount.get(task.accountId) ?? [];
      if (!this.#queuesByAccount.has(task.accountId)) {
        this.#queuesByAccount.set(task.accountId, queue);
        this.#accountOrder.push(task.accountId);
      }
      queue.push({
        accountId: task.accountId,
        conversationKey: task.conversationKey,
        run: task.run,
        resolve: (value) => resolve(value as T),
        reject,
      });
      this.#requestDrain();
    });
  }

  getAccountStats(accountId: string): { processing: number; queued: number } {
    return {
      processing: this.#activeByAccount.get(accountId) ?? 0,
      queued: this.#queuesByAccount.get(accountId)?.length ?? 0,
    };
  }

  getTotalProcessing(): number {
    return this.#activeCount;
  }

  /**
   * 角色切换的单一协调 seam：立即暂停新工作，等在途回复完整结束后
   * 执行切换事务。失败时自动恢复队列；成功请求重启后保持暂停。
   */
  async coordinateCharacterSwitch<T extends { ok: boolean; status: string }>(
    operation: () => Promise<T>,
  ): Promise<T> {
    if (this.#characterSwitchRunning) {
      throw new Error("微信角色切换协调事务已在进行");
    }
    this.#characterSwitchRunning = true;
    this.#pausedForCharacterSwitch = true;
    await this.#waitForActiveDrain();
    try {
      const result = await operation();
      if (!(result.ok && result.status === "relaunch-requested")) {
        this.#resumeAfterCharacterSwitch();
      }
      return result;
    } catch (error) {
      this.#resumeAfterCharacterSwitch();
      throw error;
    }
  }

  #requestDrain(): void {
    if (this.#drainQueued) return;
    this.#drainQueued = true;
    queueMicrotask(() => {
      this.#drainQueued = false;
      this.#drain();
    });
  }

  #drain(): void {
    if (this.#pausedForCharacterSwitch) return;
    while (this.#activeCount < this.#maxConcurrency) {
      const job = this.#takeNextEligibleJob();
      if (!job) return;
      this.#activeCount += 1;
      this.#activeByAccount.set(job.accountId, (this.#activeByAccount.get(job.accountId) ?? 0) + 1);
      this.#activeConversations.add(job.conversationKey);
      void job.run().then((value) => {
        this.#finishJob(job);
        this.#drain();
        job.resolve(value);
      }, (error) => {
        this.#finishJob(job);
        this.#drain();
        job.reject(error);
      });
    }
  }

  #finishJob(job: QueuedJob): void {
    this.#activeCount -= 1;
    const activeForAccount = (this.#activeByAccount.get(job.accountId) ?? 1) - 1;
    if (activeForAccount > 0) this.#activeByAccount.set(job.accountId, activeForAccount);
    else this.#activeByAccount.delete(job.accountId);
    this.#activeConversations.delete(job.conversationKey);
    if (this.#activeCount === 0) {
      for (const resolve of this.#activeDrainWaiters) resolve();
      this.#activeDrainWaiters.clear();
    }
  }

  #waitForActiveDrain(): Promise<void> {
    if (this.#activeCount === 0) return Promise.resolve();
    return new Promise<void>((resolve) => this.#activeDrainWaiters.add(resolve));
  }

  #resumeAfterCharacterSwitch(): void {
    this.#pausedForCharacterSwitch = false;
    this.#characterSwitchRunning = false;
    this.#requestDrain();
  }

  #takeNextEligibleJob(): QueuedJob | null {
    if (this.#accountOrder.length === 0) return null;
    const accountsToInspect = this.#accountOrder.length;

    for (let inspected = 0; inspected < accountsToInspect; inspected += 1) {
      if (this.#nextAccountIndex >= this.#accountOrder.length) this.#nextAccountIndex = 0;
      const accountIndex = this.#nextAccountIndex;
      const accountId = this.#accountOrder[accountIndex];
      const queue = this.#queuesByAccount.get(accountId) ?? [];
      const eligibleIndex = queue.findIndex(
        (job) => !this.#activeConversations.has(job.conversationKey),
      );

      if (eligibleIndex < 0) {
        this.#nextAccountIndex = (accountIndex + 1) % this.#accountOrder.length;
        continue;
      }

      const [job] = queue.splice(eligibleIndex, 1);
      if (queue.length === 0) {
        this.#queuesByAccount.delete(accountId);
        this.#accountOrder.splice(accountIndex, 1);
        this.#nextAccountIndex = this.#accountOrder.length === 0
          ? 0
          : accountIndex % this.#accountOrder.length;
      } else {
        this.#nextAccountIndex = (accountIndex + 1) % this.#accountOrder.length;
      }
      return job;
    }
    return null;
  }
}
