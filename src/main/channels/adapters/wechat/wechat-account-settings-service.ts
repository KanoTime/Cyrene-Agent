import {
  redactWechatId,
  type WechatAccountConnectionStatus,
} from "./wechat-account-connection-pool";
import type {
  UpdateWechatAccountInput,
  WechatAccountRecord,
} from "./wechat-account-store";

export interface WechatAccountQueueStats {
  processing: number;
  queued: number;
}

export interface WechatAccountSettingsItem extends WechatAccountRecord {
  maskedBotId: string;
  phase: WechatAccountConnectionStatus["phase"];
  lastConnectedAt?: number;
  errorSummary?: string;
  processing: number;
  queued: number;
}

interface AccountSettingsRepository {
  listAccounts(): Promise<WechatAccountRecord[]>;
  updateAccount?(
    ilinkBotId: string,
    patch: UpdateWechatAccountInput,
  ): Promise<WechatAccountRecord | null>;
}

interface AccountSettingsRuntime {
  getAccountStatuses(): WechatAccountConnectionStatus[];
  reconnectAccount?(ilinkBotId: string): Promise<void>;
  stopAccount?(ilinkBotId: string): Promise<void>;
}

export interface WechatAccountSettingsServiceOptions {
  repository: AccountSettingsRepository;
  runtime: AccountSettingsRuntime;
  getQueueStats?: (ilinkBotId: string) => WechatAccountQueueStats;
  logoutAccount?: (ilinkBotId: string) => Promise<void>;
  removeAccount?: (ilinkBotId: string) => Promise<void>;
  archiveAccountTasks?: (ilinkBotId: string) => Promise<void>;
}

export class WechatAccountSettingsService {
  readonly #options: WechatAccountSettingsServiceOptions;

  constructor(options: WechatAccountSettingsServiceOptions) {
    this.#options = options;
  }

  async listAccounts(): Promise<WechatAccountSettingsItem[]> {
    const [accounts, statuses] = await Promise.all([
      this.#options.repository.listAccounts(),
      Promise.resolve(this.#options.runtime.getAccountStatuses()),
    ]);
    const statusById = new Map(statuses.map((status) => [status.ilinkBotId, status]));
    return accounts.map((account) => {
      const status = statusById.get(account.ilinkBotId);
      const queue = this.#options.getQueueStats?.(account.ilinkBotId) ?? {
        processing: 0,
        queued: 0,
      };
      return {
        ...account,
        maskedBotId: redactWechatId(account.ilinkBotId),
        phase: account.credentialStatus === "available"
          ? (status?.phase ?? "offline")
          : "config_missing",
        lastConnectedAt: status?.lastConnectedAt,
        errorSummary: status?.lastError,
        processing: Math.max(0, queue.processing),
        queued: Math.max(0, queue.queued),
      };
    });
  }

  async renameAccount(ilinkBotId: string, label: string): Promise<void> {
    const id = requireAccountId(ilinkBotId);
    const normalizedLabel = label.trim();
    if (!normalizedLabel) throw new Error("微信账号备注不能为空");
    await this.#requireUpdateAccount()(id, { label: normalizedLabel });
  }

  async setAccountEnabled(ilinkBotId: string, enabled: boolean): Promise<void> {
    const id = requireAccountId(ilinkBotId);
    await this.#requireUpdateAccount()(id, { enabled });
    if (enabled) await this.#options.runtime.reconnectAccount?.(id);
    else await this.#options.runtime.stopAccount?.(id);
  }

  async reconnectAccount(ilinkBotId: string): Promise<void> {
    const id = requireAccountId(ilinkBotId);
    if (!this.#options.runtime.reconnectAccount) throw new Error("微信连接尚未初始化");
    await this.#options.runtime.reconnectAccount(id);
  }

  async logoutAccount(ilinkBotId: string): Promise<void> {
    const id = requireAccountId(ilinkBotId);
    if (!this.#options.logoutAccount) throw new Error("微信账号退出功能尚未初始化");
    await this.#options.logoutAccount(id);
  }

  async deleteAccount(ilinkBotId: string): Promise<void> {
    const id = requireAccountId(ilinkBotId);
    if (!this.#options.removeAccount) throw new Error("微信账号删除功能尚未初始化");
    await this.#options.archiveAccountTasks?.(id);
    await this.#options.removeAccount(id);
  }

  #requireUpdateAccount(): NonNullable<AccountSettingsRepository["updateAccount"]> {
    if (!this.#options.repository.updateAccount) throw new Error("微信账号仓储不支持修改");
    return this.#options.repository.updateAccount.bind(this.#options.repository);
  }
}

function requireAccountId(value: string): string {
  const normalized = value.trim();
  if (!normalized) throw new Error("必须指定微信账号");
  return normalized;
}
