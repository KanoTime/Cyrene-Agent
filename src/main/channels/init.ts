// init-channels —— channels 模块的主入口。由 index.ts 在 app.whenReady() 调一次。
//
// 当前阶段：
//   - Phase 0: 骨架 + dispatcher + inbound-server
//   - Phase 2: 接入 FeishuAdapter（自建飞书应用 + 事件订阅）
//
// 注意：initChannels 必须晚于 initRAG / initMcpManager / loadModelSettings。
import { app, BrowserWindow, ipcMain } from "electron";
import path from "node:path";
import { IPC } from "../../shared/ipc-channels";
import {
  loadChannelsSettings,
  saveChannelsSettings,
} from "./settings-store";
import { channelManager } from "./manager";
import { channelDispatcher } from "./dispatcher";
import { startInboundServer, stopInboundServer } from "./inbound-server";
import { FeishuAdapter } from "./adapters/feishu";
import { ILinkBotAdapter } from "./adapters/wechat/ilink-bot-adapter";
import { fetchQrCode } from "./adapters/wechat/ilink-protocol-client";
import { createQrDataUrl } from "./adapters/wechat/qr";
import {
  getWechatAccountRepository,
  getWechatChannelIdentityState,
  getWechatPendingInboundStore,
} from "./adapters/wechat/wechat-account-runtime";
import { WechatChannelTaskService } from "./adapters/wechat/wechat-channel-task-service";
import {
  registerWechatChannelTaskTool,
  setWechatChannelTaskService,
} from "./adapters/wechat/wechat-channel-task-tool";
import { setChannelPermissionResolver } from "../permission";
import { WechatAccountSettingsService } from "./adapters/wechat/wechat-account-settings-service";
import { createWechatAccountIpcHandlers } from "./adapters/wechat/wechat-account-ipc-handlers";
import {
  WechatLoginSessionCoordinator,
  type WechatLoginSessionSnapshot,
} from "./adapters/wechat/wechat-login-session";
import { getRecentLog, clearLog } from "./message-log";

const LOG = "[ChannelsInit]";

let initialized = false;
let conversationLifecycle: {
  onUserMessage(): void;
  onConversationStarted(): void;
  onConversationEnded(): void;
} | null = null;

export function setChannelsConversationLifecycle(lifecycle: typeof conversationLifecycle): void {
  conversationLifecycle = lifecycle;
}
/** 微信 adapter 全局引用（UI 登录按钮需要） */
let wxAdapter: ILinkBotAdapter | null = null;
let wxLoginSession: WechatLoginSessionCoordinator | null = null;
let wxTaskService: WechatChannelTaskService | null = null;
let wxTaskTimer: NodeJS.Timeout | null = null;

/** app.whenReady() 调一次。idempotent。 */
export async function initChannels(): Promise<void> {
  if (initialized) return;
  initialized = true;

  // 注入 dispatcher 到 manager
  channelManager.setDispatcher(async (msg) => {
    conversationLifecycle?.onUserMessage();
    conversationLifecycle?.onConversationStarted();
    try {
      return await channelDispatcher.handleIncoming(msg);
    } finally {
      conversationLifecycle?.onConversationEnded();
    }
  });

  // 注册全局 IPC
  registerChannelsIpc();

  // 启动 inbound-server
  try {
    const handle = await startInboundServer();
    console.log(LOG, `入站 server 监听 http://127.0.0.1:${handle.port}`);
  } catch (err) {
    console.error(LOG, "入站 server 启动失败:", err);
  }

  // 注册 adapter
  const feishuAdapter = new FeishuAdapter();
  channelManager.register(feishuAdapter);

  // 注册微信 adapter（iLink 直连微信，不依赖 OpenClaw Gateway）
  // 改为 module-level handle，UI 登录按钮也能拿到
  wxAdapter = new ILinkBotAdapter({
    pendingInboundStore: getWechatPendingInboundStore(),
  });
  wxTaskService = new WechatChannelTaskService({
    rootDir: path.join(app.getPath("userData"), "weixin", "channel-tasks"),
    isAccountOnline: (accountId) => wxAdapter?.getAccountStatuses()
      .some((status) => status.ilinkBotId === accountId && status.phase === "running") ?? false,
    send: (message) => wxAdapter?.send(message)
      ?? Promise.resolve({ ok: false, error: "微信 adapter 未初始化" }),
  });
  setWechatChannelTaskService(wxTaskService);
  registerWechatChannelTaskTool();
  setChannelPermissionResolver((accountId, risk) =>
    getWechatChannelIdentityState().isToolRiskAllowed(accountId, risk));
  wxLoginSession = createWechatLoginSession(wxAdapter);
  channelManager.register(wxAdapter);

  // 启动所有已注册 adapter
  await channelManager.startAll();
  await wxTaskService.processDue();
  wxTaskTimer = setInterval(() => {
    void wxTaskService?.processDue().catch((error) =>
      console.warn(LOG, "微信渠道任务检查失败:", error));
  }, 15_000);
  wxTaskTimer.unref?.();

  console.log(LOG, "channels 模块就绪");
  broadcastChannelsStatus();
}

/** app.on('before-quit') 调 */
export async function shutdownChannels(): Promise<void> {
  if (wxTaskTimer) clearInterval(wxTaskTimer);
  wxTaskTimer = null;
  setWechatChannelTaskService(null);
  setChannelPermissionResolver(null);
  await wxLoginSession?.cancel();
  await channelManager.stopAll();
  await stopInboundServer();
  initialized = false;
}

/** IPC 注册 */
function registerChannelsIpc(): void {
  ipcMain.handle(IPC.CHANNELS_GET_CONFIG, () => loadChannelsSettings());

  ipcMain.handle(IPC.CHANNELS_SAVE_CONFIG, (_e, patch: unknown) => {
    return saveChannelsSettings(patch as Parameters<typeof saveChannelsSettings>[0]);
  });

  ipcMain.handle(IPC.CHANNELS_LIST, () => channelManager.listChannels());

  ipcMain.handle(IPC.CHANNELS_GET_STATUS, () => channelManager.getAllStatus());

  ipcMain.handle(IPC.CHANNELS_RESTART, async () => {
    await channelManager.stopAll();
    await channelManager.startAll();
    await wxTaskService?.processDue();
    broadcastChannelsStatus();
    return { ok: true };
  });

  // ── 微信 IPC (iLink 直连版) ───────────────────────────────────────────────────────

  ipcMain.handle(IPC.CHANNELS_WECHAT_RUNTIME_DETECT, () => {
    // iLink Bot API 是腾讯的远程协议，不需本地安装
    return { installed: true, version: "ilink/1.0.0" };
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGIN_START, async () => {
    if (!wxLoginSession) return { ok: false, error: "微信登录服务未初始化" };
    try {
      return { ok: true, ...(await wxLoginSession.start()) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGIN_CANCEL, async () => {
    if (!wxLoginSession) return { ok: false, error: "微信登录服务未初始化" };
    return { ok: true, ...(await wxLoginSession.cancel()) };
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGIN_REFRESH, async () => {
    if (!wxLoginSession) return { ok: false, error: "微信登录服务未初始化" };
    try {
      return { ok: true, ...(await wxLoginSession.refresh()) };
    } catch (err) {
      return { ok: false, error: errorMessage(err) };
    }
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGIN_RESULT, async () => {
    if (!wxAdapter) return { connected: false, loginSession: { state: "idle" } };
    const status = wxAdapter.getStatus();
    return {
      running: status.phase === "starting",
      connected: status.phase === "running",
      loggedIn: wxAdapter.isLoggedIn,
      loginSession: wxLoginSession?.getSnapshot() ?? { state: "idle" },
    };
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_PAIRING_LIST, () => {
    // iLink 模式没有 pairing 概念
    return [];
  });

  ipcMain.handle(IPC.CHANNELS_WECHAT_PAIRING_APPROVE, () => ({ ok: false, error: "iLink 模式不支持 pairing" }));

  ipcMain.handle(IPC.CHANNELS_WECHAT_ACCOUNTS_LIST, () => getWechatAccountIpcHandlers().list());
  ipcMain.handle(IPC.CHANNELS_WECHAT_ACCOUNT_RENAME, (_event, input: { ilinkBotId?: string; label?: string }) =>
    getWechatAccountIpcHandlers().rename(input));
  ipcMain.handle(IPC.CHANNELS_WECHAT_ACCOUNT_SET_ENABLED, (_event, input: { ilinkBotId?: string; enabled?: boolean }) =>
    getWechatAccountIpcHandlers().setEnabled(input));
  ipcMain.handle(IPC.CHANNELS_WECHAT_ACCOUNT_RECONNECT, (_event, ilinkBotId: string) =>
    getWechatAccountIpcHandlers().reconnect(ilinkBotId));
  ipcMain.handle(IPC.CHANNELS_WECHAT_ACCOUNT_RESCAN, (_event, ilinkBotId: string) =>
    getWechatAccountIpcHandlers().rescan(ilinkBotId));
  ipcMain.handle(IPC.CHANNELS_WECHAT_LOGOUT, (_event, ilinkBotId: string) =>
    getWechatAccountIpcHandlers().logout(ilinkBotId));
  ipcMain.handle(IPC.CHANNELS_WECHAT_ACCOUNT_DELETE, (_event, ilinkBotId: string) =>
    getWechatAccountIpcHandlers().delete(ilinkBotId));

  ipcMain.handle(IPC.CHANNELS_WECHAT_RUNTIME_INSTALL, () => ({
    ok: true,
    hint: "iLink Bot API 是云端协议，无需本地安装",
  }));

  ipcMain.handle(IPC.CHANNELS_WECHAT_RUNTIME_UPDATE, () => ({ ok: true }));

  ipcMain.handle(IPC.CHANNELS_WECHAT_INSTALL, async () => {
    if (!wxAdapter) return { ok: false };
    await wxAdapter.stop();
    await wxAdapter.start();
    return { ok: true, phase: "ready" };
  });

  // Phase 2 长连接：测试连接 = 重建 LarkChannel（SDK 内部会自动跑 WSS handshake）
  ipcMain.handle(IPC.CHANNELS_FEISHU_TEST_CONNECTION, async () => {
    const adapter = channelManager.getAdapter("feishu") as FeishuAdapter | undefined;
    if (!adapter) return { ok: false, error: "飞书 adapter 未注册" };
    const status = adapter.getStatus();
    if (!status.enabled) return { ok: false, error: "飞书渠道未启用" };
    if (!loadChannelsSettings().feishu.appId || !loadChannelsSettings().feishu.appSecret) {
      return { ok: false, error: "App ID / App Secret 未配置" };
    }
    try {
      await adapter.rebuild();
      const s = adapter.getStatus();
      if (s.phase === "running") {
        return { ok: true, message: "WSS 长连接已建立" };
      }
      return { ok: false, error: s.message ?? "握手未完成" };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // 长连接模式不需要 webhook URL —— 这个 IPC 保留但返回 ok 提示用户用长连接
  ipcMain.handle(IPC.CHANNELS_FEISHU_TEST_WEBHOOK_REACHABLE, async () => {
    return {
      ok: true,
      message: "长连接模式不需要公网 URL — SDK 已自动建立 WSS 连接",
    };
  });

  // Phase 3.4：消息日志
  ipcMain.handle(IPC.CHANNELS_LOG_GET, (_e, limit: unknown) => {
    const n = typeof limit === "number" && limit > 0 ? limit : 100;
    return getRecentLog(n);
  });
  ipcMain.handle(IPC.CHANNELS_LOG_CLEAR, () => {
    clearLog();
    return { ok: true };
  });
}

function createWechatLoginSession(adapter: ILinkBotAdapter): WechatLoginSessionCoordinator {
  return new WechatLoginSessionCoordinator({
    fetchQrCode: async () => {
      const result = await fetchQrCode();
      return { qrcode: result.qrcode, imageContent: result.qrcode_img_content };
    },
    createQrDataUrl: (imageContent) => createQrDataUrl(imageContent, 256),
    waitForLogin: (qrcode, signal) => adapter.waitForLogin(qrcode, signal),
    saveCredentials: async (credentials) => {
      await adapter.saveCredentials(credentials);
      saveChannelsSettings({ wechat: { enabled: true } });
      try {
        await adapter.reconnectAccount(credentials.ilinkBotId);
      } catch {
        await adapter.stop();
        await adapter.start();
      }
      await wxTaskService?.processDue();
      broadcastChannelsStatus();
    },
    onChanged: broadcastWechatLoginSession,
  });
}

function getWechatAccountSettingsService(): WechatAccountSettingsService {
  if (!wxAdapter) throw new Error("微信 adapter 未初始化");
  const adapter = wxAdapter;
  return new WechatAccountSettingsService({
    repository: getWechatAccountRepository(),
    runtime: {
      getAccountStatuses: () => adapter.getAccountStatuses(),
      reconnectAccount: async (ilinkBotId) => {
        await adapter.reconnectAccount(ilinkBotId);
        await wxTaskService?.processDue();
      },
      stopAccount: (ilinkBotId) => adapter.stopAccount(ilinkBotId),
    },
    getQueueStats: (ilinkBotId) => channelManager.getWechatAccountQueueStats(ilinkBotId),
    logoutAccount: (ilinkBotId) => adapter.logout(ilinkBotId),
    archiveAccountTasks: (ilinkBotId) => wxTaskService?.archiveAccount(ilinkBotId) ?? Promise.resolve(),
    removeAccount: async (ilinkBotId) => {
      await getWechatPendingInboundStore().removeAccount(ilinkBotId);
      await adapter.removeAccount(ilinkBotId);
    },
  });
}

function getWechatAccountIpcHandlers() {
  if (!wxLoginSession) throw new Error("微信登录服务未初始化");
  return createWechatAccountIpcHandlers({
    service: getWechatAccountSettingsService(),
    refreshLogin: () => wxLoginSession!.refresh(),
    onChanged: broadcastChannelsStatus,
  });
}

function broadcastWechatLoginSession(snapshot: WechatLoginSessionSnapshot): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    win.webContents.send(IPC.CHANNELS_WECHAT_LOGIN_STATE, snapshot);
    if (snapshot.state === "waiting" && snapshot.qrDataUrl) {
      win.webContents.send(IPC.CHANNELS_WECHAT_QRCODE, snapshot.qrDataUrl);
    } else if (snapshot.state === "confirmed") {
      win.webContents.send(IPC.CHANNELS_WECHAT_LOGIN_DONE, {
        ok: true,
        botId: snapshot.ilinkBotId,
      });
    } else if (snapshot.state === "expired" || snapshot.state === "error") {
      win.webContents.send(IPC.CHANNELS_WECHAT_LOGIN_DONE, {
        ok: false,
        error: snapshot.error ?? "微信扫码登录失败",
      });
    }
  }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** 工具：把所有 BrowserWindow 广播 channels 状态变更（UI 轮询用）。 */
export function broadcastChannelsStatus(): void {
  const status = channelManager.getAllStatus();
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC.CHANNELS_STATUS_CHANGED, status);
    } catch (err) {
      console.warn(LOG, "广播失败:", err);
    }
  }
}

/** 工具：把所有 BrowserWindow 广播安装进度。 */
export function broadcastChannelsInstallProgress(progress: {
  channel: string;
  phase: string;
  pct: number;
}): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed()) continue;
    try {
      win.webContents.send(IPC.CHANNELS_INSTALL_PROGRESS, progress);
    } catch (err) {
      console.warn(LOG, "广播安装进度失败:", err);
    }
  }
}
