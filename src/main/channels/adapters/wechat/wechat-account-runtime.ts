import { app } from "electron";
import path from "node:path";
import { WechatAccountRepository } from "./wechat-account-repository";
import { createWechatSafeStorageCipher } from "./wechat-credential-cipher";
import { WechatChannelIdentityStateStore } from "./wechat-channel-identity-state";
import { WechatPendingInboundStore } from "./wechat-pending-inbound-store";

let repository: WechatAccountRepository | null = null;
let channelIdentityState: WechatChannelIdentityStateStore | null = null;
let pendingInboundStore: WechatPendingInboundStore | null = null;

export function getWechatAccountRepository(): WechatAccountRepository {
  repository ??= new WechatAccountRepository({
    userDataDir: app.getPath("userData"),
    cipher: createWechatSafeStorageCipher(),
  });
  return repository;
}

export function getWechatChannelIdentityState(): WechatChannelIdentityStateStore {
  channelIdentityState ??= new WechatChannelIdentityStateStore({
    rootDir: path.join(app.getPath("userData"), "weixin", "channel-state"),
  });
  return channelIdentityState;
}

export function getWechatPendingInboundStore(): WechatPendingInboundStore {
  pendingInboundStore ??= new WechatPendingInboundStore({
    rootDir: path.join(app.getPath("userData"), "weixin", "pending-inbound"),
    cipher: createWechatSafeStorageCipher(),
  });
  return pendingInboundStore;
}
