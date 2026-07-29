import type {
  VoiceConversationMeta,
} from "./voice-conversation";

export const MOBILE_CALL_CONTROL_TOPIC = "cyrene.call.control";
export const MOBILE_CALL_EVENT_TOPIC = "cyrene.call.event";
export const MOBILE_CALL_CONTROL_MAX_BYTES = 4_096;
export const MOBILE_CALL_CONVERSATION_PAGE_SIZE = 12;

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MobileCallTurnMode = "automatic" | "manual";

export type MobileCallControl =
  | { type: "conversation.list"; after?: string }
  | { type: "conversation.create"; title: string }
  | { type: "conversation.select"; conversationId: string }
  | { type: "conversation.rename"; conversationId: string; title: string }
  | { type: "conversation.delete"; conversationId: string }
  | { type: "turn.mode"; mode: MobileCallTurnMode }
  | { type: "turn.begin" }
  | { type: "turn.commit" };

export type MobileCallConversationEvent =
  | {
      type: "conversation.catalog";
      conversations: VoiceConversationMeta[];
      selectedId?: string;
      mode: MobileCallTurnMode;
      replace: boolean;
      nextCursor?: string;
    }
  | {
      type: "conversation.selected";
      conversation: VoiceConversationMeta;
      mode: MobileCallTurnMode;
    }
  | {
      type: "conversation.updated";
      conversation: VoiceConversationMeta;
    }
  | {
      type: "turn.mode";
      mode: MobileCallTurnMode;
      manualTurnOpen: boolean;
    }
  | {
      type: "control.error";
      message: string;
    };

function validTitle(value: unknown): value is string {
  if (typeof value !== "string") return false;
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > 0 && Array.from(normalized).length <= 80;
}

export function parseMobileCallControl(payload: Uint8Array): MobileCallControl | null {
  if (payload.byteLength === 0 || payload.byteLength > MOBILE_CALL_CONTROL_MAX_BYTES) {
    return null;
  }
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    switch (value.type) {
      case "turn.begin":
      case "turn.commit":
        return { type: value.type };
      case "conversation.list":
        return (
          value.after === undefined
          || typeof value.after === "string" && UUID_PATTERN.test(value.after)
        )
          ? {
              type: value.type,
              ...(typeof value.after === "string" ? { after: value.after } : {}),
            }
          : null;
      case "conversation.create":
        return validTitle(value.title)
          ? { type: value.type, title: value.title.replace(/\s+/g, " ").trim() }
          : null;
      case "conversation.select":
      case "conversation.delete":
        return typeof value.conversationId === "string" && UUID_PATTERN.test(value.conversationId)
          ? { type: value.type, conversationId: value.conversationId }
          : null;
      case "conversation.rename":
        return (
          typeof value.conversationId === "string"
          && UUID_PATTERN.test(value.conversationId)
          && validTitle(value.title)
        )
          ? {
              type: value.type,
              conversationId: value.conversationId,
              title: value.title.replace(/\s+/g, " ").trim(),
            }
          : null;
      case "turn.mode":
        return value.mode === "automatic" || value.mode === "manual"
          ? { type: value.type, mode: value.mode }
          : null;
      default:
        return null;
    }
  } catch {
    return null;
  }
}
