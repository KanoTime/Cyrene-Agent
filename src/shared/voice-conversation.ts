export const VOICE_CONVERSATION_SCHEMA_VERSION = 1 as const;

export interface VoiceConversationTurn {
  id: string;
  userText: string;
  assistantText: string;
  at: number;
}

export interface VoiceConversation {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turns: VoiceConversationTurn[];
  schemaVersion: typeof VOICE_CONVERSATION_SCHEMA_VERSION;
}

export interface VoiceConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  preview: string;
}
