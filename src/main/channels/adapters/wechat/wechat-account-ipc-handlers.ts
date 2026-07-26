import type { WechatAccountSettingsItem } from "./wechat-account-settings-service";
import type { WechatLoginSessionSnapshot } from "./wechat-login-session";

export interface WechatAccountIpcService {
  listAccounts(): Promise<WechatAccountSettingsItem[] | unknown[]>;
  renameAccount(ilinkBotId: string, label: string): Promise<void>;
  setAccountEnabled(ilinkBotId: string, enabled: boolean): Promise<void>;
  reconnectAccount(ilinkBotId: string): Promise<void>;
  logoutAccount(ilinkBotId: string): Promise<void>;
  deleteAccount(ilinkBotId: string): Promise<void>;
}

export function createWechatAccountIpcHandlers(input: {
  service: WechatAccountIpcService;
  refreshLogin(): Promise<WechatLoginSessionSnapshot>;
  onChanged?: () => void;
}) {
  const command = async (operation: () => Promise<void>) => {
    try {
      await operation();
      input.onChanged?.();
      return { ok: true as const };
    } catch (error) {
      return { ok: false as const, error: errorMessage(error) };
    }
  };
  return {
    list: () => input.service.listAccounts(),
    rename: (value: { ilinkBotId?: string; label?: string }) =>
      command(() => input.service.renameAccount(requireAccountId(value?.ilinkBotId), value?.label ?? "")),
    setEnabled: (value: { ilinkBotId?: string; enabled?: boolean }) =>
      command(() => input.service.setAccountEnabled(requireAccountId(value?.ilinkBotId), value?.enabled === true)),
    reconnect: (ilinkBotId: string) =>
      command(() => input.service.reconnectAccount(requireAccountId(ilinkBotId))),
    rescan: async (ilinkBotId: string) => {
      try {
        requireAccountId(ilinkBotId);
        return { ok: true as const, ...(await input.refreshLogin()) };
      } catch (error) {
        return { ok: false as const, error: errorMessage(error) };
      }
    },
    logout: (ilinkBotId: string) =>
      command(() => input.service.logoutAccount(requireAccountId(ilinkBotId))),
    delete: (ilinkBotId: string) =>
      command(() => input.service.deleteAccount(requireAccountId(ilinkBotId))),
  };
}

function requireAccountId(value: string | undefined): string {
  const normalized = value?.trim() ?? "";
  if (!normalized) throw new Error("必须指定微信账号");
  return normalized;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
