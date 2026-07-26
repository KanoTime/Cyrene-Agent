import { describe, expect, it, vi } from "vitest";
import {
  SessionExpiredError,
  type Credentials,
  type WeixinMessage,
} from "./ilink-protocol-client";
import type { WechatAccountRecord } from "./wechat-account-store";
import {
  WechatAccountConnectionPool,
  type WechatPollingClient,
} from "./wechat-account-connection-pool";

function account(ilinkBotId: string, label: string): WechatAccountRecord {
  return {
    ilinkBotId,
    label,
    enabled: true,
    credentialStatus: "available",
    createdAt: 1,
    updatedAt: 1,
  };
}

function credentials(ilinkBotId: string): Credentials {
  return {
    ilinkBotId,
    botToken: `${ilinkBotId}-token`,
    baseUrl: "https://ilink.example.test",
    ilinkUserId: `${ilinkBotId}-owner`,
  };
}

function idleClient(): WechatPollingClient {
  return {
    getUpdates: (_buf: string, signal: AbortSignal) =>
      new Promise<{ messages: WeixinMessage[]; buf: string }>((_resolve, reject) => {
        signal.addEventListener(
          "abort",
          () => reject(new DOMException("aborted", "AbortError")),
          { once: true },
        );
      }),
  };
}

function message(fromUserId: string): WeixinMessage {
  return {
    msgId: "message-001",
    fromUserId,
    toUserId: "bot@im.wechat",
    msgType: 1,
    content: "不应进入日志或任何业务副作用的正文",
    items: [{ type: 3, voice_item: { media: "sensitive-media" } }],
    contextToken: "sensitive-context-token",
    raw: { sensitive: true },
  };
}

describe("WechatAccountConnectionPool", () => {
  it("独立启动两个账号，一个失败时另一个仍保持运行", async () => {
    const records = [
      account("healthy-bot@im.wechat", "日常号"),
      account("failed-bot@im.wechat", "工作号"),
    ];
    const created: string[] = [];
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => records,
        loadCredentials: async (ilinkBotId) => credentials(ilinkBotId),
      },
      createClient: (creds) => {
        created.push(creds.ilinkBotId);
        if (creds.ilinkBotId === "failed-bot@im.wechat") {
          throw new Error("mock startup failure");
        }
        return idleClient();
      },
      onAuthorizedMessage: vi.fn(async () => undefined),
    });

    await pool.start();

    expect(created.sort()).toEqual(["failed-bot@im.wechat", "healthy-bot@im.wechat"]);
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({
        ilinkBotId: "healthy-bot@im.wechat",
        phase: "running",
      }),
      expect.objectContaining({
        ilinkBotId: "failed-bot@im.wechat",
        phase: "error",
      }),
    ]);

    await pool.stop();
  });

  it("非扫码绑定者消息在业务回调前静默丢弃", async () => {
    const record = account("owner-only-bot@im.wechat", "私人号");
    const onAuthorizedMessage = vi.fn(async () => undefined);
    let markBatchConsumed: (() => void) | undefined;
    const batchConsumed = new Promise<void>((resolve) => {
      markBatchConsumed = resolve;
    });
    let pollCount = 0;
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [record],
        loadCredentials: async () => credentials(record.ilinkBotId),
      },
      createClient: () => ({
        async getUpdates(_buf, signal) {
          pollCount += 1;
          if (pollCount === 1) {
            return { messages: [message("stranger@im.wechat")], buf: "cursor-1" };
          }
          markBatchConsumed?.();
          return idleClient().getUpdates("cursor-1", signal);
        },
      }),
      onAuthorizedMessage,
    });

    await pool.start();
    await batchConsumed;

    expect(onAuthorizedMessage).not.toHaveBeenCalled();
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({ phase: "running" }),
    ]);
    await pool.stop();
  });

  it("扫码绑定者消息携带账号上下文进入业务回调", async () => {
    const record = account("authorized-bot@im.wechat", "授权号");
    const creds = credentials(record.ilinkBotId);
    let received: [WechatAccountRecord, Credentials, WeixinMessage] | null = null;
    let markReceived: (() => void) | undefined;
    const receivedPromise = new Promise<void>((resolve) => {
      markReceived = resolve;
    });
    let pollCount = 0;
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [record],
        loadCredentials: async () => creds,
      },
      createClient: () => ({
        async getUpdates(_buf, signal) {
          pollCount += 1;
          if (pollCount === 1) {
            return { messages: [message(creds.ilinkUserId)], buf: "cursor-1" };
          }
          return idleClient().getUpdates("cursor-1", signal);
        },
      }),
      onAuthorizedMessage: async (...args) => {
        received = args;
        markReceived?.();
      },
    });

    await pool.start();
    await receivedPromise;

    expect(received).toEqual([record, creds, expect.objectContaining({ fromUserId: creds.ilinkUserId })]);
    await pool.stop();
  });

  it("临时错误按带抖动的指数退避继续轮询", async () => {
    const record = account("retry-bot@im.wechat", "重试号");
    const sleep = vi.fn(async (_delayMs: number, _signal: AbortSignal) => undefined);
    let polls = 0;
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [record],
        loadCredentials: async () => credentials(record.ilinkBotId),
      },
      createClient: () => ({
        async getUpdates(_buf, signal) {
          polls += 1;
          if (polls <= 2) throw new Error(`temporary-${polls}`);
          return idleClient().getUpdates("", signal);
        },
      }),
      onAuthorizedMessage: vi.fn(async () => undefined),
      sleep,
      random: () => 0.5,
      retryBaseDelayMs: 1_000,
      retryMaxDelayMs: 8_000,
      reconnectMinIntervalMs: 0,
    });

    await pool.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(polls).toBe(3);
    expect(sleep.mock.calls.map(([delay]) => delay)).toEqual([1_000, 2_000]);
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({ phase: "running" }),
    ]);
    await pool.stop();
  });

  it("会话明确失效时标记需要扫码且不再重试", async () => {
    const record = account("expired-bot@im.wechat", "失效号");
    const sleep = vi.fn(async (_delayMs: number, _signal: AbortSignal) => undefined);
    const getUpdates = vi.fn(async () => {
      throw new SessionExpiredError("expired secret should not be exposed");
    });
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [record],
        loadCredentials: async () => credentials(record.ilinkBotId),
      },
      createClient: () => ({ getUpdates }),
      onAuthorizedMessage: vi.fn(async () => undefined),
      sleep,
    });

    await pool.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(getUpdates).toHaveBeenCalledTimes(1);
    expect(sleep).not.toHaveBeenCalled();
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({
        phase: "login_required",
        lastError: "微信登录已失效，请重新扫码",
      }),
    ]);
    await pool.stop();
  });

  it("重复启动连接池不会创建第二条长轮询", async () => {
    const record = account("idempotent-bot@im.wechat", "幂等号");
    const createClient = vi.fn(() => idleClient());
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [record],
        loadCredentials: async () => credentials(record.ilinkBotId),
      },
      createClient,
      onAuthorizedMessage: vi.fn(async () => undefined),
    });

    await Promise.all([pool.start(), pool.start()]);

    expect(createClient).toHaveBeenCalledTimes(1);
    await pool.stop();
  });

  it("单独停止、重连和删除一个账号不影响其他账号", async () => {
    const first = account("lifecycle-a@im.wechat", "账号甲");
    const second = account("lifecycle-b@im.wechat", "账号乙");
    const createCounts = new Map<string, number>();
    const removeAccount = vi.fn(async () => undefined);
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [first, second],
        loadCredentials: async (ilinkBotId) => credentials(ilinkBotId),
        removeAccount,
      },
      createClient: (creds) => {
        createCounts.set(creds.ilinkBotId, (createCounts.get(creds.ilinkBotId) ?? 0) + 1);
        return idleClient();
      },
      onAuthorizedMessage: vi.fn(async () => undefined),
    });

    await pool.start();
    await pool.stopAccount(first.ilinkBotId);
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({ ilinkBotId: first.ilinkBotId, phase: "offline" }),
      expect.objectContaining({ ilinkBotId: second.ilinkBotId, phase: "running" }),
    ]);

    await pool.reconnectAccount(first.ilinkBotId);
    expect(createCounts.get(first.ilinkBotId)).toBe(2);
    expect(createCounts.get(second.ilinkBotId)).toBe(1);
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({ ilinkBotId: first.ilinkBotId, phase: "running" }),
      expect.objectContaining({ ilinkBotId: second.ilinkBotId, phase: "running" }),
    ]);

    await pool.removeAccount(first.ilinkBotId);
    expect(removeAccount).toHaveBeenCalledWith(first.ilinkBotId);
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({ ilinkBotId: second.ilinkBotId, phase: "running" }),
    ]);
    await pool.stop();
  });

  it("账号运行日志只包含备注和脱敏 ID，不泄露底层错误", async () => {
    const record = account("failed-sensitive-bot@im.wechat", "工作号");
    const log = vi.fn((_level: "info" | "warn", _message: string) => undefined);
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [record],
        loadCredentials: async () => credentials(record.ilinkBotId),
      },
      createClient: () => {
        throw new Error("secret-token and private endpoint");
      },
      onAuthorizedMessage: vi.fn(async () => undefined),
      log,
    });

    await pool.start();

    const output = log.mock.calls.map(([, message]) => message).join("\n");
    expect(output).toContain("工作号");
    expect(output).toContain("fai…ot@im.wechat");
    expect(output).not.toContain("failed-sensitive-bot@im.wechat");
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("private endpoint");
    await pool.stop();
  });

  it("多个账号同时断线时通过共享节流器错开恢复尝试", async () => {
    const records = [
      account("throttle-a@im.wechat", "节流甲"),
      account("throttle-b@im.wechat", "节流乙"),
    ];
    const polls = new Map<string, number>();
    const sleep = vi.fn(async (_delayMs: number, _signal: AbortSignal) => undefined);
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => records,
        loadCredentials: async (ilinkBotId) => credentials(ilinkBotId),
      },
      createClient: (creds) => ({
        async getUpdates(_buf, signal) {
          const count = (polls.get(creds.ilinkBotId) ?? 0) + 1;
          polls.set(creds.ilinkBotId, count);
          if (count === 1) throw new Error("temporary outage");
          return idleClient().getUpdates("", signal);
        },
      }),
      onAuthorizedMessage: vi.fn(async () => undefined),
      sleep,
      now: () => 0,
      random: () => 0.5,
      retryBaseDelayMs: 0,
      retryMaxDelayMs: 0,
      reconnectMinIntervalMs: 100,
    });

    await pool.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(polls).toEqual(
      new Map([
        ["throttle-a@im.wechat", 2],
        ["throttle-b@im.wechat", 2],
      ]),
    );
    expect(sleep.mock.calls.map(([delay]) => delay)).toContain(100);
    await pool.stop();
  });

  it("客户端内部长轮询超时不会被误判为用户主动停止", async () => {
    const record = account("timeout-bot@im.wechat", "超时号");
    let polls = 0;
    const pool = new WechatAccountConnectionPool({
      accountSource: {
        listAccounts: async () => [record],
        loadCredentials: async () => credentials(record.ilinkBotId),
      },
      createClient: () => ({
        async getUpdates(_buf, signal) {
          polls += 1;
          if (polls === 1) throw new DOMException("client timeout", "AbortError");
          return idleClient().getUpdates("", signal);
        },
      }),
      onAuthorizedMessage: vi.fn(async () => undefined),
      sleep: vi.fn(async () => undefined),
      reconnectMinIntervalMs: 0,
    });

    await pool.start();
    await new Promise<void>((resolve) => setImmediate(resolve));

    expect(polls).toBe(2);
    expect(pool.getAccountStatuses()).toEqual([
      expect.objectContaining({ phase: "running" }),
    ]);
    await pool.stop();
  });
});
