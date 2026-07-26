import {
  SessionExpiredError,
  type Credentials,
  type WeixinMessage,
} from "./ilink-protocol-client";
import type { WechatAccountRecord } from "./wechat-account-store";

export interface WechatPollingClient {
  getUpdates(
    buf: string,
    signal: AbortSignal,
  ): Promise<{ messages: WeixinMessage[]; buf: string }>;
}

export interface WechatAccountSource {
  listAccounts(): Promise<WechatAccountRecord[]>;
  loadCredentials(ilinkBotId: string): Promise<Credentials | null>;
  removeAccount?(ilinkBotId: string): Promise<void>;
}

export type WechatAccountConnectionPhase =
  | "starting"
  | "running"
  | "offline"
  | "config_missing"
  | "login_required"
  | "error";

export interface WechatAccountConnectionStatus {
  ilinkBotId: string;
  label: string;
  enabled: boolean;
  phase: WechatAccountConnectionPhase;
  lastConnectedAt?: number;
  lastError?: string;
}

export interface WechatAccountConnectionPoolOptions {
  accountSource: WechatAccountSource;
  createClient(credentials: Credentials): WechatPollingClient;
  onAuthorizedMessage(
    account: WechatAccountRecord,
    credentials: Credentials,
    message: WeixinMessage,
  ): Promise<void>;
  now?: () => number;
  sleep?: (delayMs: number, signal: AbortSignal) => Promise<void>;
  random?: () => number;
  retryBaseDelayMs?: number;
  retryMaxDelayMs?: number;
  reconnectMinIntervalMs?: number;
  log?: (level: "info" | "warn", message: string) => void;
}

export class WechatAccountConnection {
  readonly #account: WechatAccountRecord;
  readonly #credentials: Credentials;
  readonly #client: WechatPollingClient;
  readonly #onAuthorizedMessage: WechatAccountConnectionPoolOptions["onAuthorizedMessage"];
  readonly #now: () => number;
  readonly #sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  readonly #random: () => number;
  readonly #retryBaseDelayMs: number;
  readonly #retryMaxDelayMs: number;
  readonly #log: (level: "info" | "warn", message: string) => void;
  readonly #waitForReconnectTurn: (signal: AbortSignal) => Promise<void>;
  #abort: AbortController | null = null;
  #pollPromise: Promise<void> | null = null;
  #status: WechatAccountConnectionStatus;

  constructor(input: {
    account: WechatAccountRecord;
    credentials: Credentials;
    client: WechatPollingClient;
    onAuthorizedMessage: WechatAccountConnectionPoolOptions["onAuthorizedMessage"];
    now: () => number;
    sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
    random: () => number;
    retryBaseDelayMs: number;
    retryMaxDelayMs: number;
    log: (level: "info" | "warn", message: string) => void;
    waitForReconnectTurn: (signal: AbortSignal) => Promise<void>;
  }) {
    this.#account = input.account;
    this.#credentials = input.credentials;
    this.#client = input.client;
    this.#onAuthorizedMessage = input.onAuthorizedMessage;
    this.#now = input.now;
    this.#sleep = input.sleep;
    this.#random = input.random;
    this.#retryBaseDelayMs = input.retryBaseDelayMs;
    this.#retryMaxDelayMs = input.retryMaxDelayMs;
    this.#log = input.log;
    this.#waitForReconnectTurn = input.waitForReconnectTurn;
    this.#status = statusFromAccount(input.account, "offline");
  }

  start(): void {
    if (this.#pollPromise) return;
    this.#abort = new AbortController();
    this.#status = {
      ...statusFromAccount(this.#account, "running"),
      lastConnectedAt: this.#now(),
    };
    this.#pollPromise = this.#poll(this.#abort.signal).finally(() => {
      this.#pollPromise = null;
    });
  }

  async stop(): Promise<void> {
    this.#abort?.abort();
    await this.#pollPromise;
    this.#abort = null;
    this.#status = statusFromAccount(this.#account, "offline");
  }

  getStatus(): WechatAccountConnectionStatus {
    return { ...this.#status };
  }

  async #poll(signal: AbortSignal): Promise<void> {
    let buf = "";
    let consecutiveFailures = 0;
    while (!signal.aborted) {
      try {
        this.#status = {
          ...statusFromAccount(this.#account, "running"),
          lastConnectedAt: this.#status.lastConnectedAt ?? this.#now(),
        };
        const result = await this.#client.getUpdates(buf, signal);
        buf = result.buf;
        consecutiveFailures = 0;
        for (const message of result.messages) {
          if (message.fromUserId !== this.#credentials.ilinkUserId) continue;
          await this.#onAuthorizedMessage(this.#account, this.#credentials, message);
        }
      } catch (error) {
        if (signal.aborted) break;
        if (error instanceof SessionExpiredError) {
          this.#status = {
            ...statusFromAccount(this.#account, "login_required"),
            lastError: "微信登录已失效，请重新扫码",
          };
          this.#log("warn", `${accountLogIdentity(this.#account)} 登录已失效，需要重新扫码`);
          break;
        }
        this.#status = {
          ...statusFromAccount(this.#account, "error"),
          lastError: "微信连接暂时中断，正在重试",
        };
        const exponentialDelay = Math.min(
          this.#retryMaxDelayMs,
          this.#retryBaseDelayMs * 2 ** consecutiveFailures,
        );
        consecutiveFailures += 1;
        const jitteredDelay = Math.round(exponentialDelay * (0.75 + this.#random() * 0.5));
        this.#log(
          "warn",
          `${accountLogIdentity(this.#account)} 连接暂时中断，${jitteredDelay}ms 后重试`,
        );
        await this.#sleep(jitteredDelay, signal);
        if (!signal.aborted) await this.#waitForReconnectTurn(signal);
      }
    }
  }
}

export class WechatAccountConnectionPool {
  readonly #options: WechatAccountConnectionPoolOptions;
  readonly #connections = new Map<string, WechatAccountConnection>();
  readonly #statuses = new Map<string, WechatAccountConnectionStatus>();
  readonly #reconnectThrottle: ReconnectThrottle;
  #started = false;

  constructor(options: WechatAccountConnectionPoolOptions) {
    this.#options = options;
    this.#reconnectThrottle = new ReconnectThrottle({
      minIntervalMs: options.reconnectMinIntervalMs ?? 250,
      now: options.now ?? Date.now,
      sleep: options.sleep ?? abortableSleep,
    });
  }

  async start(): Promise<void> {
    if (this.#started) return;
    this.#started = true;
    const accounts = await this.#options.accountSource.listAccounts();
    await Promise.all(accounts.map((account) => this.#startAccount(account)));
  }

  async stop(): Promise<void> {
    await Promise.all([...this.#connections.values()].map((connection) => connection.stop()));
    for (const [ilinkBotId, connection] of this.#connections) {
      this.#statuses.set(ilinkBotId, connection.getStatus());
    }
    this.#connections.clear();
    this.#started = false;
  }

  async stopAccount(ilinkBotId: string): Promise<void> {
    const connection = this.#connections.get(ilinkBotId);
    if (!connection) return;
    await connection.stop();
    this.#statuses.set(ilinkBotId, connection.getStatus());
    this.#connections.delete(ilinkBotId);
  }

  markAccountLoginRequired(ilinkBotId: string): void {
    const status = this.#statuses.get(ilinkBotId);
    if (!status) return;
    this.#statuses.set(ilinkBotId, {
      ...status,
      phase: "config_missing",
      lastError: undefined,
    });
  }

  async reconnectAccount(ilinkBotId: string): Promise<void> {
    await this.stopAccount(ilinkBotId);
    const account = (await this.#options.accountSource.listAccounts()).find(
      (candidate) => candidate.ilinkBotId === ilinkBotId,
    );
    if (!account) {
      this.#statuses.delete(ilinkBotId);
      return;
    }
    await this.#startAccount(account);
  }

  async removeAccount(ilinkBotId: string): Promise<void> {
    await this.stopAccount(ilinkBotId);
    await this.#options.accountSource.removeAccount?.(ilinkBotId);
    this.#statuses.delete(ilinkBotId);
  }

  getAccountStatuses(): WechatAccountConnectionStatus[] {
    return [...this.#statuses.values()].map((status) => {
      const connection = this.#connections.get(status.ilinkBotId);
      return connection?.getStatus() ?? { ...status };
    });
  }

  async #startAccount(account: WechatAccountRecord): Promise<void> {
    if (!account.enabled) {
      this.#statuses.set(account.ilinkBotId, statusFromAccount(account, "offline"));
      return;
    }
    this.#statuses.set(account.ilinkBotId, statusFromAccount(account, "starting"));
    this.#options.log?.("info", `${accountLogIdentity(account)} 正在连接`);
    try {
      const credentials = await this.#options.accountSource.loadCredentials(account.ilinkBotId);
      if (!credentials) {
        this.#statuses.set(account.ilinkBotId, statusFromAccount(account, "config_missing"));
        return;
      }
      const connection = new WechatAccountConnection({
        account,
        credentials,
        client: this.#options.createClient(credentials),
        onAuthorizedMessage: this.#options.onAuthorizedMessage,
        now: this.#options.now ?? Date.now,
        sleep: this.#options.sleep ?? abortableSleep,
        random: this.#options.random ?? Math.random,
        retryBaseDelayMs: this.#options.retryBaseDelayMs ?? 1_000,
        retryMaxDelayMs: this.#options.retryMaxDelayMs ?? 30_000,
        log: this.#options.log ?? (() => undefined),
        waitForReconnectTurn: (signal) => this.#reconnectThrottle.waitTurn(signal),
      });
      this.#connections.set(account.ilinkBotId, connection);
      connection.start();
      this.#statuses.set(account.ilinkBotId, connection.getStatus());
      this.#options.log?.("info", `${accountLogIdentity(account)} 已连接`);
    } catch {
      this.#statuses.set(account.ilinkBotId, {
        ...statusFromAccount(account, "error"),
        lastError: "微信账号连接启动失败",
      });
      this.#options.log?.("warn", `${accountLogIdentity(account)} 连接启动失败`);
    }
  }
}

function statusFromAccount(
  account: WechatAccountRecord,
  phase: WechatAccountConnectionPhase,
): WechatAccountConnectionStatus {
  return {
    ilinkBotId: account.ilinkBotId,
    label: account.label,
    enabled: account.enabled,
    phase,
  };
}

function abortableSleep(delayMs: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, delayMs);
    signal.addEventListener(
      "abort",
      () => {
        clearTimeout(timer);
        resolve();
      },
      { once: true },
    );
  });
}

function accountLogIdentity(account: WechatAccountRecord): string {
  return `${account.label} (${redactWechatId(account.ilinkBotId)})`;
}

export function redactWechatId(ilinkBotId: string): string {
  const separator = ilinkBotId.indexOf("@");
  const local = separator >= 0 ? ilinkBotId.slice(0, separator) : ilinkBotId;
  const domain = separator >= 0 ? ilinkBotId.slice(separator) : "";
  if (local.length <= 5) return `***${domain}`;
  return `${local.slice(0, 3)}…${local.slice(-2)}${domain}`;
}

class ReconnectThrottle {
  readonly #minIntervalMs: number;
  readonly #now: () => number;
  readonly #sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  #nextAllowedAt = Number.NEGATIVE_INFINITY;
  #queue: Promise<void> = Promise.resolve();

  constructor(input: {
    minIntervalMs: number;
    now: () => number;
    sleep: (delayMs: number, signal: AbortSignal) => Promise<void>;
  }) {
    this.#minIntervalMs = Math.max(0, input.minIntervalMs);
    this.#now = input.now;
    this.#sleep = input.sleep;
  }

  waitTurn(signal: AbortSignal): Promise<void> {
    const turn = this.#queue.then(async () => {
      if (signal.aborted) return;
      const now = this.#now();
      const delay = Math.max(0, this.#nextAllowedAt - now);
      if (delay > 0) await this.#sleep(delay, signal);
      this.#nextAllowedAt = Math.max(now, this.#nextAllowedAt) + this.#minIntervalMs;
    });
    this.#queue = turn.catch(() => undefined);
    return turn;
  }
}
