import type {
  VoiceConversation,
  VoiceConversationMeta,
  VoiceConversationTurn,
} from "../../shared/voice-conversation";
import { VoiceConversationStore } from "./voice-conversation-store";

export interface VoiceConversationRuntimeOptions {
  onSelected?(turns: VoiceConversationTurn[]): void;
}

/** Per-call selection state over a Character-private durable conversation store. */
export class VoiceConversationRuntime {
  private selectedId: string | null = null;

  constructor(
    private readonly store: VoiceConversationStore,
    private readonly options: VoiceConversationRuntimeOptions = {},
  ) {}

  list(): VoiceConversationMeta[] {
    return this.store.list();
  }

  current(): VoiceConversation | null {
    return this.selectedId ? this.store.get(this.selectedId) : null;
  }

  create(title: string): VoiceConversation {
    const conversation = this.store.create(title);
    this.activate(conversation);
    return conversation;
  }

  select(id: string): VoiceConversation | null {
    const conversation = this.store.get(id);
    if (!conversation) return null;
    this.activate(conversation);
    return conversation;
  }

  rename(id: string, title: string): VoiceConversation | null {
    return this.store.rename(id, title);
  }

  appendTurn(userText: string, assistantText: string): VoiceConversation | null {
    if (!this.selectedId) return null;
    return this.store.appendTurn(this.selectedId, { userText, assistantText });
  }

  private activate(conversation: VoiceConversation): void {
    this.selectedId = conversation.id;
    this.options.onSelected?.(
      conversation.turns.slice(-24).map((turn) => ({ ...turn })),
    );
  }
}
