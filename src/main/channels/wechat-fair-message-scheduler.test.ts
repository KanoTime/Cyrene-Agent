import { describe, expect, it, vi } from "vitest";
import { WechatFairMessageScheduler } from "./wechat-fair-message-scheduler";

function deferred<T = void>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("WechatFairMessageScheduler", () => {
  it("按账号公开处理中与排队数量，供设置页独立展示", async () => {
    const scheduler = new WechatFairMessageScheduler({ maxConcurrency: 1 });
    let release!: () => void;
    const blocker = new Promise<void>((resolve) => { release = resolve; });
    const first = scheduler.schedule({
      accountId: "account-a",
      conversationKey: "a-1",
      run: () => blocker,
    });
    const second = scheduler.schedule({
      accountId: "account-a",
      conversationKey: "a-2",
      run: async () => undefined,
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(scheduler.getAccountStats("account-a")).toEqual({ processing: 1, queued: 1 });
    expect(scheduler.getAccountStats("account-b")).toEqual({ processing: 0, queued: 0 });
    release();
    await Promise.all([first, second]);
    expect(scheduler.getAccountStats("account-a")).toEqual({ processing: 0, queued: 0 });
  });

  it("同一对话严格按入队顺序执行", async () => {
    const scheduler = new WechatFairMessageScheduler({ maxConcurrency: 2 });
    const gates = [deferred(), deferred(), deferred()];
    const started: number[] = [];
    const jobs = gates.map((gate, index) =>
      scheduler.schedule({
        accountId: "account-a",
        conversationKey: "conversation-1",
        run: async () => {
          started.push(index + 1);
          await gate.promise;
          return index + 1;
        },
      }),
    );

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(started).toEqual([1]);
    gates[0].resolve();
    await jobs[0];
    expect(started).toEqual([1, 2]);
    gates[1].resolve();
    await jobs[1];
    expect(started).toEqual([1, 2, 3]);
    gates[2].resolve();
    await expect(Promise.all(jobs)).resolves.toEqual([1, 2, 3]);
  });

  it("全局并发不超过 2，且繁忙账号不能饿死另一个账号", async () => {
    const scheduler = new WechatFairMessageScheduler({ maxConcurrency: 2 });
    const gates = [deferred(), deferred(), deferred(), deferred()];
    const started: string[] = [];
    let active = 0;
    let maxActive = 0;
    const enqueue = (accountId: string, conversationKey: string, label: string, index: number) =>
      scheduler.schedule({
        accountId,
        conversationKey,
        run: async () => {
          started.push(label);
          active += 1;
          maxActive = Math.max(maxActive, active);
          await gates[index].promise;
          active -= 1;
          return label;
        },
      });
    const jobs = [
      enqueue("account-a", "a-1", "A1", 0),
      enqueue("account-a", "a-2", "A2", 1),
      enqueue("account-a", "a-3", "A3", 2),
      enqueue("account-b", "b-1", "B1", 3),
    ];

    await new Promise<void>((resolve) => queueMicrotask(resolve));
    expect(started).toEqual(["A1", "B1"]);
    expect(maxActive).toBe(2);
    gates[0].resolve();
    gates[3].resolve();
    await Promise.all([jobs[0], jobs[3]]);
    expect(started.slice(2)).toEqual(["A2", "A3"]);
    gates[1].resolve();
    gates[2].resolve();
    await expect(Promise.all(jobs)).resolves.toEqual(["A1", "A2", "A3", "B1"]);
    expect(maxActive).toBe(2);
  });

  it("一个任务失败只拒绝该任务，后续任务继续执行", async () => {
    const scheduler = new WechatFairMessageScheduler({ maxConcurrency: 1 });
    const afterFailure = vi.fn(async () => "recovered");
    const failed = scheduler.schedule({
      accountId: "account-a",
      conversationKey: "conversation-a",
      run: async () => {
        throw new Error("task failed");
      },
    });
    const recovered = scheduler.schedule({
      accountId: "account-b",
      conversationKey: "conversation-b",
      run: afterFailure,
    });

    await expect(failed).rejects.toThrow("task failed");
    await expect(recovered).resolves.toBe("recovered");
    expect(afterFailure).toHaveBeenCalledOnce();
  });

  it("角色切换先暂停新任务，等待在途回复完整结束", async () => {
    const scheduler = new WechatFairMessageScheduler({ maxConcurrency: 1 });
    const activeGate = deferred();
    const started: string[] = [];
    const active = scheduler.schedule({
      accountId: "account-a",
      conversationKey: "a-1",
      run: async () => {
        started.push("old-role");
        await activeGate.promise;
      },
    });
    const queued = scheduler.schedule({
      accountId: "account-b",
      conversationKey: "b-1",
      run: async () => { started.push("new-role"); },
    });
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    const switchOperation = vi.fn(async () => ({ ok: true, status: "relaunch-requested" as const }));
    const switching = scheduler.coordinateCharacterSwitch(switchOperation);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    expect(started).toEqual(["old-role"]);
    expect(switchOperation).not.toHaveBeenCalled();
    activeGate.resolve();
    await active;
    await expect(switching).resolves.toEqual({ ok: true, status: "relaunch-requested" });
    expect(switchOperation).toHaveBeenCalledOnce();
    expect(started).toEqual(["old-role"]);
    expect(scheduler.getAccountStats("account-b")).toEqual({ processing: 0, queued: 1 });
    void queued;
  });

  it("角色切换失败后恢复队列，未开始消息仍由旧角色处理", async () => {
    const scheduler = new WechatFairMessageScheduler({ maxConcurrency: 1 });
    const started: string[] = [];
    const switching = scheduler.coordinateCharacterSwitch(async () => ({
      ok: false,
      status: "failed" as const,
    }));
    const queued = scheduler.schedule({
      accountId: "account-a",
      conversationKey: "a-1",
      run: async () => { started.push("old-role-after-failure"); },
    });

    await expect(switching).resolves.toEqual({ ok: false, status: "failed" });
    await queued;
    expect(started).toEqual(["old-role-after-failure"]);
  });

  it("并发角色切换只运行一个协调事务", async () => {
    const scheduler = new WechatFairMessageScheduler();
    const switchGate = deferred<{ ok: false; status: "failed" }>();
    const firstOperation = vi.fn(() => switchGate.promise);
    const first = scheduler.coordinateCharacterSwitch(firstOperation);
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    await expect(scheduler.coordinateCharacterSwitch(async () => ({ ok: false, status: "failed" as const })))
      .rejects.toThrow("微信角色切换协调事务已在进行");
    switchGate.resolve({ ok: false, status: "failed" });
    await first;
    expect(firstOperation).toHaveBeenCalledOnce();
  });
});
