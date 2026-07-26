import { resolveChatContextTimezone } from "./chat-time-context";

let userTimezoneGetter: (() => string | undefined) | null = null;

/**
 * 注入用户时区读取器。主进程启动时绑定 profile，其余模块不直接依赖主进程入口。
 */
export function setUserTimezoneConfig(timezoneGetter: () => string | undefined): void {
  userTimezoneGetter = timezoneGetter;
}

/** 当前用户的有效时区（缺失或非法时回退 Asia/Shanghai）。 */
export function currentUserTimezone(): string {
  return resolveChatContextTimezone(userTimezoneGetter?.());
}
