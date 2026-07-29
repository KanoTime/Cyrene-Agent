export type ConversationEntryMode = "new" | "history";

export interface ConversationEntryTransport {
  mode: ConversationEntryMode;
  now?: Date;
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  requestConversationCatalog(): Promise<unknown>;
  createConversation(title: string): Promise<unknown>;
}

export function resolveNewConversationTitle(
  title: string,
  now = new Date(),
): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (normalized) return normalized;
  const month = now.getMonth() + 1;
  const day = now.getDate();
  const hour = String(now.getHours()).padStart(2, "0");
  const minute = String(now.getMinutes()).padStart(2, "0");
  return `${month}月${day}日 ${hour}:${minute} 的语音对话`;
}

export function prepareConversationEntryTransport(
  transport: ConversationEntryTransport,
): void {
  void transport.setMicrophoneEnabled(true);
  if (transport.mode === "new") {
    void transport.createConversation(resolveNewConversationTitle("", transport.now));
    return;
  }
  void transport.requestConversationCatalog();
}
