export interface SecureMediaReadinessRef {
  current: boolean;
}

export function createCallTransportStateHandlers(
  secureMediaReady: SecureMediaReadinessRef,
  setCallState: (state: string) => void,
): {
  onConnected(): void;
  onReconnecting(): void;
  onReconnected(): void;
  onDisconnected(): void;
} {
  return {
    onConnected: () => setCallState(
      secureMediaReady.current
        ? "正在聆听"
        : "等待桌面加入并确认加密…",
    ),
    onReconnecting: () => setCallState("网络波动，正在自动重连…"),
    onReconnected: () => setCallState(
      secureMediaReady.current
        ? "连接已恢复，正在聆听"
        : "连接已恢复，等待桌面确认加密…",
    ),
    onDisconnected: () => setCallState("通话已断开"),
  };
}
