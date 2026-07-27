export interface ConversationSelectionTransport {
  setMicrophoneEnabled(enabled: boolean): Promise<unknown>;
  requestConversationCatalog(): Promise<unknown>;
}

export function prepareConversationSelectionTransport(
  transport: ConversationSelectionTransport,
): void {
  void transport.setMicrophoneEnabled(true);
  void transport.requestConversationCatalog();
}
