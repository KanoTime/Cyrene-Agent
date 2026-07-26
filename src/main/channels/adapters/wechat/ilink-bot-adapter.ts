// ILink Bot Adapter —— 用 iLinkProtocolClient 包出 ChannelAdapter。
//
// 流程：
//   微信用户发消息
//     └─ ILinkClient.getUpdates() (long-poll 35s)
//           └─ adapter.onMessage() → dispatcher → buildAndRunAgent → OutgoingMessage
//                 └─ ILinkClient.sendText() → POST /sendmessage → 微信
//
// 凭据存盘：<userData>/weixin/accounts/credentials/<botId-hash>.bin
// 敏感字段由 Electron safeStorage 设备绑定加密。
// （首次运行需在 UI 点"扫码登录"生成；之后自动续用）
import { promises as fs } from "node:fs";
import path from "node:path";
import { app } from "electron";
import {
  ILinkClient,
  MediaType,
  pollQrStatus,
  type CDNMedia,
  type Credentials,
  type SendMessageItem,
  type WeixinMessage,
} from "./ilink-protocol-client";
import { uploadWechatMediaFile } from "./wechat-media-upload";
import { downloadWechatMedia } from "./wechat-media-download";
import { prepareWechatAudioFile } from "./wechat-audio-file";
import {
  SAVE_INTENT_TTL_MS,
  buildUnsupportedWechatFilePrompt,
  buildWechatAsrFailedPrompt,
  buildWechatAsrMissingPrompt,
  buildWechatSaveSuccessPrompt,
  buildWechatSaveIntentPrompt,
  buildWechatVideoPrompt,
  describeInboundWechatMedia,
  getWechatDisplayName,
  isWechatSaveIntent,
  type InboundMediaDescriptor,
} from "./inbound-media";
import { getAsrConfig } from "../../../asr/volcano-asr-engine";
import { transcribeWechatVoiceSource } from "./wechat-voice-asr";
import type {
  ChannelAttachment,
  ChannelCapability,
  ChannelId,
  ChannelStatus,
  IncomingMessage,
  MessageHandler,
  OutgoingMessage,
} from "../../types";
import type { ChannelAdapter } from "../base";
import { loadChannelsSettings, saveChannelsSettings } from "../../settings-store";
import { getWechatAccountRepository } from "./wechat-account-runtime";
import {
  WechatAccountConnectionPool,
  type WechatAccountSource,
} from "./wechat-account-connection-pool";
import type { WechatAccountRecord } from "./wechat-account-store";
import { createWechatConversationIdentity } from "./wechat-conversation-identity";
import type {
  WechatPendingInboundEntry,
  WechatPendingInboundStore,
} from "./wechat-pending-inbound-store";

const LOG_PREFIX = "[WechatBot]";
const USER_PROFILE_FILE = "user-profile.json";

interface PendingInboundMedia {
  media: InboundMediaDescriptor;
  messageId: string;
  expiresAt: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Capability
// ─────────────────────────────────────────────────────────────────────────────

const CAPABILITY: ChannelCapability = {
  text: true,
  image: true,
  audio: true,
  file: true,
  video: true,
  markdown: false,
  card: false,
  sticker: true,
  maxTextLength: 2048,
};

// ─────────────────────────────────────────────────────────────────────────────
// Adapter
// ─────────────────────────────────────────────────────────────────────────────

export class ILinkBotAdapter implements ChannelAdapter {
  readonly id: ChannelId = "wechat";
  readonly displayName = "微信";
  readonly capability = CAPABILITY;

  /** 由 ChannelManager.setDispatcher 注入 */
  onMessage: MessageHandler | null = null;

  private client: ILinkClient | null = null;
  private readonly clientsByAccount = new Map<string, ILinkClient>();
  private readonly credentialsByAccount = new Map<string, Credentials>();
  private connectionPool: WechatAccountConnectionPool | null = null;
  private readonly accountRepository: WechatAccountSource & {
    save?: (credentials: Credentials) => Promise<WechatAccountRecord>;
    clearCredentials?: (ilinkBotId: string) => Promise<void>;
    removeAccount?: (ilinkBotId: string) => Promise<void>;
  };
  private readonly createClient: (credentials: Credentials) => ILinkClient;
  /** 账号是否已登录（凭证存在） */
  isLoggedIn = false;
  /** 当前 credentials（动态加载） */
  currentCredentials: Credentials | null = null;
  private replyContextByTarget = new Map<string, string>();
  private replyAccountByTarget = new Map<string, string>();
  private replyContextByAccountTarget = new Map<string, string>();
  private pendingSaveIntentByTarget = new Map<string, number>();
  private pendingUnsupportedMediaByTarget = new Map<string, PendingInboundMedia>();
  private uploadMedia = uploadWechatMediaFile;
  private prepareAudioFile = prepareWechatAudioFile;
  private downloadMedia = downloadInboundWechatMedia;
  private saveInboundMedia = saveInboundWechatMedia;
  private transcribeVoice = transcribeInboundWechatVoice;
  private isAsrConfigured = isWechatAsrConfigured;
  private readonly pendingInboundStore: Pick<
    WechatPendingInboundStore,
    "save" | "list" | "complete"
  > | null;
  private readonly activePendingInbound = new Set<string>();

  status: ChannelStatus = { enabled: false, phase: "offline" };

  constructor(options: {
    accountRepository?: WechatAccountSource & {
      save?: (credentials: Credentials) => Promise<WechatAccountRecord>;
      clearCredentials?: (ilinkBotId: string) => Promise<void>;
      removeAccount?: (ilinkBotId: string) => Promise<void>;
    };
    createClient?: (credentials: Credentials) => ILinkClient;
    pendingInboundStore?: Pick<WechatPendingInboundStore, "save" | "list" | "complete">;
  } = {}) {
    this.accountRepository = options.accountRepository ?? getWechatAccountRepository();
    this.createClient = options.createClient ?? ((credentials) => new ILinkClient(credentials));
    this.pendingInboundStore = options.pendingInboundStore ?? null;
  }

  // ── ChannelAdapter ────────────────────────────────────────────────────────

  async start(): Promise<void> {
    if (!loadChannelsSettings().wechat.enabled) {
      this.status = { enabled: false, phase: "offline", message: "未启用" };
      return;
    }
    this.status = { enabled: true, phase: "starting" };
    console.log(LOG_PREFIX, "Starting...");

    this.clientsByAccount.clear();
    this.credentialsByAccount.clear();
    this.client = null;
    this.currentCredentials = null;
    this.connectionPool = new WechatAccountConnectionPool({
      accountSource: this.accountRepository,
      createClient: (credentials) => {
        const client = this.createClient(credentials);
        this.clientsByAccount.set(credentials.ilinkBotId, client);
        this.credentialsByAccount.set(credentials.ilinkBotId, credentials);
        this.client ??= client;
        this.currentCredentials ??= credentials;
        return client;
      },
      onAuthorizedMessage: async (account, credentials, message) => {
        const client = this.clientsByAccount.get(credentials.ilinkBotId);
        if (!client) return;
        await this.dispatchInbound(message, client, account);
      },
      log: (level, message) => {
        if (level === "warn") console.warn(LOG_PREFIX, message);
        else console.info(LOG_PREFIX, message);
      },
    });
    await this.connectionPool.start();
    const accountStatuses = this.connectionPool.getAccountStatuses();
    if (accountStatuses.length === 0) {
      this.status = {
        enabled: true,
        phase: "config_missing",
        message: "未登录，请先扫码",
      };
      console.log(LOG_PREFIX, "No credentials, please run /wechat login");
      return;
    }
    this.#refreshAggregateStatus();
    void this.replayPendingInbound().catch((error) =>
      console.warn(LOG_PREFIX, "微信待恢复消息重放失败:", error));
  }

  async stop(): Promise<void> {
    console.log(LOG_PREFIX, "Stopping...");
    await this.connectionPool?.stop();
    this.connectionPool = null;
    this.clientsByAccount.clear();
    this.credentialsByAccount.clear();
    this.client = null;
    this.isLoggedIn = false;
    this.status = { enabled: false, phase: "offline" };
  }

  async send(msg: OutgoingMessage): Promise<{ ok: boolean; error?: string }> {
    const explicitAccountId =
      msg.connectionAccountId ?? msg.conversationIdentity?.connectionAccountId;
    if (explicitAccountId) {
      const client = this.clientsByAccount.get(explicitAccountId);
      if (!client) return { ok: false, error: "指定的微信账号未连接" };
      const credentials = this.credentialsByAccount.get(explicitAccountId);
      const participantId = msg.conversationIdentity?.participantId;
      if (
        !credentials ||
        !participantId ||
        participantId !== credentials.ilinkUserId ||
        msg.targetId !== credentials.ilinkUserId
      ) {
        return { ok: false, error: "微信绑定者身份不匹配" };
      }
    }
    const accountId = explicitAccountId ?? this.replyAccountByTarget.get(msg.targetId);
    const client = explicitAccountId
      ? this.clientsByAccount.get(explicitAccountId)
      : (accountId ? this.clientsByAccount.get(accountId) : null) ?? this.client;
    if (!client) return { ok: false, error: "微信未连接" };
    const contextToken = accountId
      ? this.replyContextByAccountTarget.get(accountTargetKey(accountId, msg.targetId))
      : this.replyContextByTarget.get(msg.targetId);
    if (!contextToken) return { ok: false, error: "缺少微信 context_token，无法回复" };

    let anyOk = false;
    let lastErr: string | undefined;

    for (const part of msg.parts) {
      if (part.kind === "text") {
        const text = part.text.trim();
        if (!text) continue;
        const textResult = await client.sendText(msg.targetId, text, contextToken);
        if (textResult.ok) {
          anyOk = true;
        } else {
          lastErr = textResult.error ?? "微信文本发送失败";
          console.warn(LOG_PREFIX, "text_item 发送失败:", lastErr);
        }
      } else if (part.kind === "image") {
        if (!part.filePath) return { ok: false, error: "微信图片发送需要本地 filePath" };
        const media = await this.uploadMedia(client, msg.targetId, part.filePath, MediaType.IMAGE);
        const result = await client.sendMessage(msg.targetId, [buildImageItem(media)], contextToken);
        if (result.ok) anyOk = true;
        else {
          lastErr = result.error ?? "微信图片发送失败";
          console.warn(LOG_PREFIX, "image_item 发送失败:", lastErr);
        }
      } else if (part.kind === "sticker") {
        const media = await this.uploadMedia(client, msg.targetId, part.imagePath, MediaType.IMAGE);
        const result = await client.sendMessage(msg.targetId, [buildImageItem(media)], contextToken);
        if (result.ok) anyOk = true;
        else {
          lastErr = result.error ?? "微信表情发送失败";
          console.warn(LOG_PREFIX, "sticker image_item 发送失败:", lastErr);
        }
      } else if (part.kind === "audio") {
        // iLink 当前会对 outbound voice_item 返回 HTTP 200，但微信客户端不会展示。
        // 优先发送体积更小的 M4A 文件，转换失败时自动回退 WAV。
        const prepared = await this.prepareAudioFile(part.filePath);
        const [media, stat] = await Promise.all([
          this.uploadMedia(client, msg.targetId, prepared.filePath, MediaType.FILE),
          fs.stat(prepared.filePath),
        ]);
        const result = await client.sendMessage(
          msg.targetId,
          [buildFileItem(media, prepared.fileName, stat.size)],
          contextToken,
        );
        if (result.ok) {
          anyOk = true;
          console.info(
            LOG_PREFIX,
            `语音已作为${prepared.converted ? " M4A" : " WAV"}文件发送: size=${stat.size}`,
          );
        } else {
          lastErr = result.error ?? "微信音频文件发送失败";
          console.warn(LOG_PREFIX, "audio file_item 发送失败:", lastErr);
        }
      } else if (part.kind === "file") {
        const stat = await fs.stat(part.filePath);
        const media = await this.uploadMedia(client, msg.targetId, part.filePath, MediaType.FILE);
        const result = await client.sendMessage(
          msg.targetId,
          [buildFileItem(media, path.basename(part.name ?? part.filePath), stat.size)],
          contextToken,
        );
        if (result.ok) anyOk = true;
        else {
          lastErr = result.error ?? "微信文件发送失败";
          console.warn(LOG_PREFIX, "file_item 发送失败:", lastErr);
        }
      } else if (part.kind === "video") {
        const media = await this.uploadMedia(client, msg.targetId, part.filePath, MediaType.VIDEO);
        const result = await client.sendMessage(msg.targetId, [buildVideoItem(media)], contextToken);
        if (result.ok) anyOk = true;
        else {
          lastErr = result.error ?? "微信视频发送失败";
          console.warn(LOG_PREFIX, "video_item 发送失败:", lastErr);
        }
      }
    }
    if (!anyOk && lastErr) return { ok: false, error: lastErr };
    return { ok: true };
  }

  getStatus(): ChannelStatus {
    if (!loadChannelsSettings().wechat.enabled) {
      return { enabled: false, phase: "offline", message: "未启用" };
    }
    this.#refreshAggregateStatus();
    return this.status;
  }

  #refreshAggregateStatus(): void {
    if (!this.connectionPool) return;
    const accounts = this.connectionPool.getAccountStatuses();
    const running = accounts.filter((account) => account.phase === "running").length;
    this.isLoggedIn = running > 0;
    if (accounts.length === 0) {
      this.status = {
        enabled: true,
        phase: "config_missing",
        message: "未登录，请先扫码",
        detail: { accounts },
      };
      return;
    }
    if (running > 0) {
      this.status = {
        enabled: true,
        phase: "running",
        message: `${running}/${accounts.length} 个微信账号在线`,
        detail: { accounts },
      };
      return;
    }
    const starting = accounts.some((account) => account.phase === "starting");
    const needsLogin = accounts.some(
      (account) => account.phase === "login_required" || account.phase === "config_missing",
    );
    this.status = {
      enabled: true,
      phase: starting ? "starting" : needsLogin ? "config_missing" : "error",
      message: starting ? "微信账号连接中" : needsLogin ? "需要扫码登录" : "微信账号连接异常",
      detail: { accounts },
    };
  }

  async saveCredentials(credentials: Credentials): Promise<void> {
    if (!this.accountRepository.save) throw new Error("微信账号仓储不支持保存凭据");
    await this.accountRepository.save(credentials);
  }

  getAccountStatuses() {
    return this.connectionPool?.getAccountStatuses() ?? [];
  }

  async reconnectAccount(ilinkBotId: string): Promise<void> {
    if (!this.connectionPool) throw new Error("微信连接池尚未启动");
    await this.connectionPool.reconnectAccount(ilinkBotId);
    this.#refreshAggregateStatus();
    void this.replayPendingInbound().catch((error) =>
      console.warn(LOG_PREFIX, "微信待恢复消息重放失败:", error));
  }

  async stopAccount(ilinkBotId: string): Promise<void> {
    await this.connectionPool?.stopAccount(ilinkBotId);
    this.clientsByAccount.delete(ilinkBotId);
    this.credentialsByAccount.delete(ilinkBotId);
    this.#refreshAggregateStatus();
  }

  async removeAccount(ilinkBotId: string): Promise<void> {
    if (this.connectionPool) await this.connectionPool.removeAccount(ilinkBotId);
    else await this.accountRepository.removeAccount?.(ilinkBotId);
    this.clientsByAccount.delete(ilinkBotId);
    this.credentialsByAccount.delete(ilinkBotId);
    this.#refreshAggregateStatus();
  }

  // ── Login UI flow ────────────────────────────────────────────────────────

  /**
   * 扫码登录入口（由 init.ts 调用）。
   * init.ts 已经调用过 fetchQrCode() + createQrDataUrl() 把 PNG 推到 renderer，
   * 这里只负责等扫码结果。
   *
   * @param qrcode  原始 qrcode 字符串（由 init.ts 传入）
   */
  async waitForLogin(qrcode: string, signal?: AbortSignal): Promise<Credentials> {
    console.log(LOG_PREFIX, "Waiting for QR scan...");

    while (true) {
      let status: Awaited<ReturnType<typeof pollQrStatus>>;
      try {
        status = await pollQrStatus(qrcode, signal);
      } catch (err) {
        // timeout 是正常的 long-poll，继续
        if ((err as Error).name === "AbortError") throw new Error("login aborted");
        continue;
      }
      console.log(LOG_PREFIX, "QR status:", status.status);
      if (status.status === "confirmed") {
        if (!status.bot_token || !status.ilink_bot_id) {
          throw new Error("confirmed but missing bot_token or ilink_bot_id");
        }
        const creds: Credentials = {
          botToken: status.bot_token,
          ilinkBotId: status.ilink_bot_id,
          baseUrl: status.baseurl ?? "https://ilinkai.weixin.qq.com",
          ilinkUserId: status.ilink_user_id ?? "",
        };
        return creds;
      }
      if (status.status === "expired") {
        throw new Error("二维码已过期，请重新扫码");
      }
      // pending/scanning — 继续轮询
    }
  }

  async login(qrcode: string, signal?: AbortSignal): Promise<Credentials> {
    const credentials = await this.waitForLogin(qrcode, signal);
    await this.saveCredentials(credentials);
    saveChannelsSettings({ wechat: { enabled: true } });
    return credentials;
  }

  /** 注销（删除凭证文件） */
  async logout(ilinkBotId = this.currentCredentials?.ilinkBotId): Promise<void> {
    if (!ilinkBotId) return;
    await this.connectionPool?.stopAccount(ilinkBotId);
    await this.accountRepository.clearCredentials?.(ilinkBotId);
    this.connectionPool?.markAccountLoginRequired(ilinkBotId);
    this.clientsByAccount.delete(ilinkBotId);
    this.credentialsByAccount.delete(ilinkBotId);
    if (this.currentCredentials?.ilinkBotId === ilinkBotId) {
      this.currentCredentials = this.credentialsByAccount.values().next().value ?? null;
      this.client = this.clientsByAccount.values().next().value ?? null;
    }
    for (const [targetId, accountId] of this.replyAccountByTarget) {
      if (accountId === ilinkBotId) this.replyAccountByTarget.delete(targetId);
    }
    for (const key of this.replyContextByAccountTarget.keys()) {
      if (key.startsWith(`${ilinkBotId}\u0000`)) this.replyContextByAccountTarget.delete(key);
    }
    this.#refreshAggregateStatus();
  }

  private async dispatchInbound(
    msg: WeixinMessage,
    client: ILinkClient | null = this.client,
    account?: WechatAccountRecord,
  ): Promise<void> {
    if (!this.onMessage) {
      console.warn(LOG_PREFIX, "onMessage 未注入，跳过消息");
      return;
    }
    console.log(LOG_PREFIX, `账号 ${account?.label ?? "微信"} 收到绑定者消息`);
    this.replyContextByTarget.set(msg.fromUserId, msg.contextToken);
    if (account) {
      this.replyAccountByTarget.set(msg.fromUserId, account.ilinkBotId);
      this.replyContextByAccountTarget.set(
        accountTargetKey(account.ilinkBotId, msg.fromUserId),
        msg.contextToken,
      );
    }

    const media = describeInboundWechatMedia(msg.items);
    const conversationStateKey = account
      ? accountTargetKey(account.ilinkBotId, msg.fromUserId)
      : msg.fromUserId;
    const voiceText = await this.#maybeTranscribeInboundVoice(msg, media, client);
    if (voiceText === null) return;
    const intercept = await this.#maybeInterceptInboundMedia(msg, media, conversationStateKey);
    if (intercept.handled) {
      if (intercept.text) void this.#sendInterceptText(client, msg.fromUserId, msg.contextToken, intercept.text);
      return;
    }
    const attachments = await this.#downloadInboundAttachments(msg, media, client);
    if (attachments === null) return;

    const incoming: IncomingMessage = {
      channel: "wechat",
      ...(account
        ? {
            connectionAccountId: account.ilinkBotId,
            conversationIdentity: createWechatConversationIdentity(
              account.ilinkBotId,
              msg.fromUserId,
            ),
          }
        : {}),
      senderId: msg.fromUserId,
      chatId: msg.fromUserId,
      text: voiceText || msg.content || "",
      attachments: attachments.length > 0 ? attachments : undefined,
      at: new Date(),
      _raw: msg,
    };

    if (account && this.pendingInboundStore) {
      const pendingEntry: WechatPendingInboundEntry = {
        id: msg.msgId || `${msg.createTimeMs ?? Date.now()}-${msg.fromUserId}`,
        accountId: account.ilinkBotId,
        participantId: msg.fromUserId,
        contextToken: msg.contextToken,
        incoming,
      };
      const key = pendingInboundKey(pendingEntry.accountId, pendingEntry.id);
      if (this.activePendingInbound.has(key)) return;
      this.activePendingInbound.add(key);
      let persisted = false;
      try {
        await this.pendingInboundStore.save(pendingEntry);
        persisted = true;
      } catch (error) {
        console.warn(LOG_PREFIX, "微信入站消息持久化失败，本轮继续处理:", error);
      }
      void this.#dispatchPendingInbound(pendingEntry, persisted);
      return;
    }

    void this.onMessage(incoming).catch((err) => {
      console.error(LOG_PREFIX, "dispatcher error:", err);
    });
  }

  private async replayPendingInbound(): Promise<void> {
    if (!this.pendingInboundStore || !this.onMessage) return;
    const entries = await this.pendingInboundStore.list();
    await Promise.all(entries.map(async (entry) => {
      const credentials = this.credentialsByAccount.get(entry.accountId);
      const client = this.clientsByAccount.get(entry.accountId);
      if (!credentials || !client) return;
      if (
        credentials.ilinkUserId !== entry.participantId
        || entry.incoming.connectionAccountId !== entry.accountId
        || entry.incoming.conversationIdentity?.participantId !== entry.participantId
      ) {
        await this.pendingInboundStore!.complete(entry.id, entry.accountId);
        return;
      }
      const key = pendingInboundKey(entry.accountId, entry.id);
      if (this.activePendingInbound.has(key)) return;
      this.activePendingInbound.add(key);
      this.replyContextByTarget.set(entry.participantId, entry.contextToken);
      this.replyAccountByTarget.set(entry.participantId, entry.accountId);
      this.replyContextByAccountTarget.set(
        accountTargetKey(entry.accountId, entry.participantId),
        entry.contextToken,
      );
      await this.#dispatchPendingInbound(entry, true);
    }));
  }

  async #dispatchPendingInbound(
    entry: WechatPendingInboundEntry,
    persisted: boolean,
  ): Promise<void> {
    const key = pendingInboundKey(entry.accountId, entry.id);
    try {
      await this.onMessage?.(entry.incoming);
      if (persisted) await this.pendingInboundStore?.complete(entry.id, entry.accountId);
    } catch (err) {
      console.error(LOG_PREFIX, "dispatcher error:", err);
    } finally {
      this.activePendingInbound.delete(key);
    }
  }

  async #maybeInterceptInboundMedia(
    msg: WeixinMessage,
    media: InboundMediaDescriptor[],
    conversationStateKey = msg.fromUserId,
  ): Promise<{ handled: boolean; text?: string }> {
    const now = Date.now();
    this.#clearExpiredInboundState(conversationStateKey, now);

    const username = loadWechatPreferredName();
    const text = msg.content ?? "";

    if (isWechatSaveIntent(text)) {
      const mediaToSave = firstSaveableMedia(media);
      if (mediaToSave) {
        const result = await this.#saveInboundMedia(mediaToSave, msg.msgId || String(now), username);
        return { handled: true, text: result };
      }
      const pending = this.pendingUnsupportedMediaByTarget.get(conversationStateKey);
      if (pending) {
        const result = await this.#saveInboundMedia(pending.media, pending.messageId, username);
        this.pendingUnsupportedMediaByTarget.delete(conversationStateKey);
        return { handled: true, text: result };
      }
      this.pendingSaveIntentByTarget.set(conversationStateKey, now + SAVE_INTENT_TTL_MS);
      return { handled: true, text: buildWechatSaveIntentPrompt(username) };
    }

    if (media.length === 0) return { handled: false };

    const saveIntentUntil = this.pendingSaveIntentByTarget.get(conversationStateKey);
    if (saveIntentUntil !== undefined) {
      const mediaToSave = firstSaveableMedia(media);
      if (mediaToSave) {
        this.pendingSaveIntentByTarget.delete(conversationStateKey);
        const result = await this.#saveInboundMedia(mediaToSave, msg.msgId || String(now), username);
        return { handled: true, text: result };
      }
    }

    const video = media.find((item) => item.kind === "video");
    if (video) {
      if (this.pendingSaveIntentByTarget.has(conversationStateKey)) {
        this.pendingSaveIntentByTarget.delete(conversationStateKey);
        const result = await this.#saveInboundMedia(video, msg.msgId || String(now), username);
        return { handled: true, text: result };
      }
      this.pendingUnsupportedMediaByTarget.set(conversationStateKey, { media: video, messageId: msg.msgId || String(now), expiresAt: now + SAVE_INTENT_TTL_MS });
      return { handled: true, text: buildWechatVideoPrompt(username) };
    }

    const voice = media.find((item) => item.kind === "voice");
    if (voice && !this.isAsrConfigured()) {
      return { handled: true, text: buildWechatAsrMissingPrompt(username) };
    }

    const unsupportedFile = media.find((item) => item.kind === "file" && !item.analyzable);
    if (unsupportedFile) {
      if (this.pendingSaveIntentByTarget.has(conversationStateKey)) {
        this.pendingSaveIntentByTarget.delete(conversationStateKey);
        const result = await this.#saveInboundMedia(unsupportedFile, msg.msgId || String(now), username);
        return { handled: true, text: result };
      }
      this.pendingUnsupportedMediaByTarget.set(conversationStateKey, { media: unsupportedFile, messageId: msg.msgId || String(now), expiresAt: now + SAVE_INTENT_TTL_MS });
      return { handled: true, text: buildUnsupportedWechatFilePrompt(username) };
    }

    return { handled: false };
  }

  async #saveInboundMedia(
    media: InboundMediaDescriptor,
    messageId: string,
    username: string,
  ): Promise<string> {
    try {
      const filePath = await this.saveInboundMedia(media, messageId);
      return buildWechatSaveSuccessPrompt(username, filePath);
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(LOG_PREFIX, "入站媒体保存失败:", reason);
      return `${username}，这个文件保存失败啦：${reason}`;
    }
  }

  async #maybeTranscribeInboundVoice(
    msg: WeixinMessage,
    media: InboundMediaDescriptor[],
    client: ILinkClient | null,
  ): Promise<string | undefined | null> {
    const voice = media.find((item) => item.kind === "voice");
    if (!voice) return undefined;

    const username = loadWechatPreferredName();
    if (!this.isAsrConfigured()) {
      await this.#sendInterceptText(client, msg.fromUserId, msg.contextToken, buildWechatAsrMissingPrompt(username));
      return null;
    }

    try {
      const transcript = (await this.transcribeVoice(voice, msg.msgId || String(Date.now()))).trim();
      if (!transcript) {
        await this.#sendInterceptText(client, msg.fromUserId, msg.contextToken, buildWechatAsrFailedPrompt(username, "没有识别到文字"));
        return null;
      }
      return transcript;
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err);
      console.warn(LOG_PREFIX, "入站语音识别失败:", reason);
      await this.#sendInterceptText(client, msg.fromUserId, msg.contextToken, buildWechatAsrFailedPrompt(username, reason));
      return null;
    }
  }

  async #downloadInboundAttachments(
    msg: WeixinMessage,
    media: InboundMediaDescriptor[],
    client: ILinkClient | null,
  ): Promise<ChannelAttachment[] | null> {
    const attachments: ChannelAttachment[] = [];
    for (const item of media) {
      if (item.kind !== "image" && !(item.kind === "file" && item.analyzable)) continue;
      if (!item.media) {
        await this.#sendInterceptText(client, msg.fromUserId, msg.contextToken, `${loadWechatPreferredName()}，这个微信附件缺少下载信息，可以再发一次试试看哦~~`);
        return null;
      }
      try {
        const downloaded = await this.downloadMedia(item, msg.msgId || String(Date.now()));
        attachments.push({
          kind: item.kind === "image" ? "image" : "file",
          filePath: downloaded.filePath,
          mime: downloaded.mime,
          caption: item.fileName,
        });
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(LOG_PREFIX, "入站媒体下载失败:", reason);
        await this.#sendInterceptText(client, msg.fromUserId, msg.contextToken, `${loadWechatPreferredName()}，这个微信附件下载失败啦：${reason}。可以再发一次试试看哦~~`);
        return null;
      }
    }
    return attachments;
  }

  #clearExpiredInboundState(targetId: string, now: number): void {
    const saveIntentUntil = this.pendingSaveIntentByTarget.get(targetId);
    if (saveIntentUntil !== undefined && saveIntentUntil <= now) {
      this.pendingSaveIntentByTarget.delete(targetId);
    }
    const pendingMedia = this.pendingUnsupportedMediaByTarget.get(targetId);
    if (pendingMedia && pendingMedia.expiresAt <= now) {
      this.pendingUnsupportedMediaByTarget.delete(targetId);
    }
  }

  async #sendInterceptText(
    client: ILinkClient | null,
    toUserId: string,
    contextToken: string,
    text: string,
  ): Promise<void> {
    if (!client) return;
    const result = await client.sendText(toUserId, text, contextToken);
    if (!result.ok) {
      console.warn(LOG_PREFIX, "入站媒体拦截回复发送失败:", result.error);
    }
  }
}

function buildImageItem(media: CDNMedia): SendMessageItem {
  return {
    type: 2,
    image_item: { media },
  };
}

function buildFileItem(media: CDNMedia, fileName: string, fileSize: number): SendMessageItem {
  return {
    type: 4,
    file_item: {
      file_name: fileName,
      len: String(fileSize),
      media,
    },
  };
}

function buildVideoItem(media: CDNMedia): SendMessageItem {
  return {
    type: 5,
    video_item: {
      media,
    },
  };
}

function firstSaveableMedia(media: InboundMediaDescriptor[]): InboundMediaDescriptor | undefined {
  return media.find((item) =>
    (item.kind === "image" || item.kind === "file" || item.kind === "video") && Boolean(item.media),
  );
}

interface DownloadedInboundMedia {
  filePath: string;
  mime: string;
}

async function downloadInboundWechatMedia(
  item: InboundMediaDescriptor,
  messageId: string,
): Promise<DownloadedInboundMedia> {
  if (!item.media) throw new Error("缺少媒体下载参数");
  const data = await downloadWechatMedia(item.media);
  const ext = pickInboundExtension(item, data);
  const cacheDir = path.join(app.getPath("userData"), "channels", "cache");
  await fs.mkdir(cacheDir, { recursive: true });
  const filePath = path.join(cacheDir, buildStoredFileName("wechat", messageId, item.fileName || item.kind, ext));
  await fs.writeFile(filePath, data);
  return { filePath, mime: mimeFromExtension(ext) };
}

async function saveInboundWechatMedia(
  item: InboundMediaDescriptor,
  messageId: string,
): Promise<string> {
  if (!item.media) throw new Error("缺少媒体下载参数");
  const data = await downloadWechatMedia(item.media);
  const ext = pickInboundExtension(item, data);
  const inboxDir = path.join(app.getPath("desktop"), "Cyrene 收件箱");
  await fs.mkdir(inboxDir, { recursive: true });
  const filePath = path.join(inboxDir, buildStoredFileName("wechat", messageId, item.fileName || item.kind, ext));
  await fs.writeFile(filePath, data);
  return filePath;
}

async function transcribeInboundWechatVoice(
  item: InboundMediaDescriptor,
  _messageId: string,
): Promise<string> {
  if (!item.media) throw new Error("缺少语音下载参数");
  const cfg = getAsrConfig();
  if (!cfg || cfg.engine === "off") {
    throw new Error("ASR 未配置");
  }

  const source = await downloadWechatMedia(item.media);
  const sampleRate = item.sampleRate ?? 16000;

  const { getActiveCharacter } = await import("../../../character/active-character");
  const { applySpeechRecognitionHints } = await import("../../../character/character-speech");
  return transcribeWechatVoiceSource(
    source,
    sampleRate,
    applySpeechRecognitionHints(cfg, getActiveCharacter().speechRecognitionHints),
  );
}

function pickInboundExtension(item: InboundMediaDescriptor, data: Buffer): string {
  if (item.extension) return item.extension;
  if (item.kind === "image") return inferImageExtension(data) ?? ".jpg";
  return ".bin";
}

function inferImageExtension(data: Buffer): string | undefined {
  if (data.length >= 8 && data.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return ".png";
  if (data.length >= 3 && data[0] === 0xff && data[1] === 0xd8 && data[2] === 0xff) return ".jpg";
  if (data.length >= 6 && (data.subarray(0, 6).toString("ascii") === "GIF87a" || data.subarray(0, 6).toString("ascii") === "GIF89a")) return ".gif";
  if (data.length >= 12 && data.subarray(8, 12).toString("ascii") === "WEBP") return ".webp";
  if (data.length >= 2 && data.subarray(0, 2).toString("ascii") === "BM") return ".bmp";
  return undefined;
}

function mimeFromExtension(ext: string): string {
  switch (ext.toLowerCase()) {
    case ".png": return "image/png";
    case ".jpg":
    case ".jpeg": return "image/jpeg";
    case ".webp": return "image/webp";
    case ".gif": return "image/gif";
    case ".bmp": return "image/bmp";
    case ".txt":
    case ".md":
    case ".markdown":
    case ".log":
    case ".csv":
    case ".tsv": return "text/plain";
    case ".json": return "application/json";
    case ".pdf": return "application/pdf";
    case ".docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case ".xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    default: return "application/octet-stream";
  }
}

function sanitizeFileName(value: string): string {
  const sanitized = value.replace(/[<>:"/\\|?*\x00-\x1f]/g, "_").trim();
  return sanitized || "attachment";
}

function buildStoredFileName(prefix: string, messageId: string, fileName: string, ext: string): string {
  const parsed = path.parse(fileName);
  const base = sanitizeFileName(parsed.name || fileName);
  return `${sanitizeFileName(prefix)}-${sanitizeFileName(messageId)}-${Date.now()}-${base}${ext}`;
}

function accountTargetKey(ilinkBotId: string, targetId: string): string {
  return `${ilinkBotId}\u0000${targetId}`;
}

function pendingInboundKey(accountId: string, messageId: string): string {
  return `${accountId}\u0000${messageId}`;
}

// ─────────────────────────────────────────────────────────────────────────────
// Credentials storage
// ─────────────────────────────────────────────────────────────────────────────

export async function loadCredentials(): Promise<Credentials | null> {
  return getWechatAccountRepository().loadPrimaryCredentials();
}

function loadWechatPreferredName(): string {
  try {
    const filePath = path.join(app.getPath("userData"), USER_PROFILE_FILE);
    const raw = require("node:fs").readFileSync(filePath, "utf8") as string;
    const profile = JSON.parse(raw) as { callPreference?: unknown };
    return getWechatDisplayName(profile.callPreference);
  } catch {
    return "伙伴";
  }
}

function isWechatAsrConfigured(): boolean {
  try {
    const filePath = path.join(app.getPath("userData"), "app-settings.json");
    const raw = require("node:fs").readFileSync(filePath, "utf8") as string;
    const settings = JSON.parse(raw) as {
      asrEngine?: unknown;
      asrAliyunAppKey?: unknown;
      asrAliyunAccessKeyId?: unknown;
      asrAliyunAccessKeySecret?: unknown;
    };
    if (settings.asrEngine === "local") return true;
    if (settings.asrEngine !== "aliyun") return false;
    return Boolean(
      typeof settings.asrAliyunAppKey === "string" && settings.asrAliyunAppKey.trim()
      && typeof settings.asrAliyunAccessKeyId === "string" && settings.asrAliyunAccessKeyId.trim()
      && typeof settings.asrAliyunAccessKeySecret === "string" && settings.asrAliyunAccessKeySecret.trim(),
    );
  } catch {
    return false;
  }
}
