export const MOBILE_CALL_CONTROL_TOPIC = "cyrene.call.control";
export const MOBILE_CALL_EVENT_TOPIC = "cyrene.call.event";
const MAX_EVENT_BYTES = 15 * 1024 - 41;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export type MobileCallTurnMode = "automatic" | "manual";

export interface MobileVoiceConversationMeta {
  id: string;
  title: string;
  createdAt: number;
  updatedAt: number;
  turnCount: number;
  preview: string;
}

export type MobileCallControl =
  | { type: "conversation.list"; after?: string }
  | { type: "conversation.create"; title: string }
  | { type: "conversation.select"; conversationId: string }
  | { type: "conversation.rename"; conversationId: string; title: string }
  | { type: "turn.mode"; mode: MobileCallTurnMode }
  | { type: "turn.begin" }
  | { type: "turn.commit" };

export type MobileCallEvent =
  | { type: "state"; state: string }
  | { type: "transcript"; partial?: string; final?: string }
  | { type: "error"; message: string }
  | { type: "bridge"; state: string }
  | {
      type: "conversation.catalog";
      conversations: MobileVoiceConversationMeta[];
      selectedId?: string;
      mode: MobileCallTurnMode;
      replace: boolean;
      nextCursor?: string;
    }
  | {
      type: "conversation.selected";
      conversation: MobileVoiceConversationMeta;
      mode: MobileCallTurnMode;
    }
  | {
      type: "conversation.updated";
      conversation: MobileVoiceConversationMeta;
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

export function encodeMobileCallControl(
  control: MobileCallControl,
): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(control));
}

export function parseMobileCallEvent(payload: Uint8Array): MobileCallEvent | null {
  if (payload.byteLength === 0 || payload.byteLength > MAX_EVENT_BYTES) return null;
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as Record<string, unknown>;
    if (value.type === "state" && typeof value.state === "string") {
      return { type: "state", state: value.state };
    }
    if (value.type === "transcript") {
      if (
        value.partial !== undefined && typeof value.partial !== "string"
        || value.final !== undefined && typeof value.final !== "string"
      ) {
        return null;
      }
      return {
        type: "transcript",
        ...(typeof value.partial === "string" ? { partial: value.partial } : {}),
        ...(typeof value.final === "string" ? { final: value.final } : {}),
      };
    }
    if (value.type === "error" && typeof value.message === "string") {
      return { type: "error", message: value.message };
    }
    if (value.type === "bridge" && typeof value.state === "string") {
      return { type: "bridge", state: value.state };
    }
    if (value.type === "conversation.catalog") {
      const conversations = parseConversationList(value.conversations);
      const mode = parseMode(value.mode);
      if (!conversations || !mode) return null;
      if (
        value.selectedId !== undefined
        && (typeof value.selectedId !== "string" || !UUID_PATTERN.test(value.selectedId))
      ) {
        return null;
      }
      if (
        typeof value.replace !== "boolean"
        || value.nextCursor !== undefined
        && (typeof value.nextCursor !== "string" || !UUID_PATTERN.test(value.nextCursor))
      ) {
        return null;
      }
      return {
        type: "conversation.catalog",
        conversations,
        ...(typeof value.selectedId === "string" ? { selectedId: value.selectedId } : {}),
        mode,
        replace: value.replace,
        ...(typeof value.nextCursor === "string" ? { nextCursor: value.nextCursor } : {}),
      };
    }
    if (value.type === "conversation.selected") {
      const conversation = parseConversationMeta(value.conversation);
      const mode = parseMode(value.mode);
      return conversation && mode
        ? { type: "conversation.selected", conversation, mode }
        : null;
    }
    if (value.type === "conversation.updated") {
      const conversation = parseConversationMeta(value.conversation);
      return conversation
        ? { type: "conversation.updated", conversation }
        : null;
    }
    if (value.type === "turn.mode") {
      const mode = parseMode(value.mode);
      return mode && typeof value.manualTurnOpen === "boolean"
        ? { type: "turn.mode", mode, manualTurnOpen: value.manualTurnOpen }
        : null;
    }
    if (value.type === "control.error" && typeof value.message === "string") {
      return { type: "control.error", message: value.message };
    }
    return null;
  } catch {
    return null;
  }
}

function parseMode(value: unknown): MobileCallTurnMode | null {
  return value === "automatic" || value === "manual" ? value : null;
}

function parseConversationList(value: unknown): MobileVoiceConversationMeta[] | null {
  if (!Array.isArray(value) || value.length > 500) return null;
  const parsed = value.map(parseConversationMeta);
  return parsed.every((conversation): conversation is MobileVoiceConversationMeta => Boolean(conversation))
    ? parsed
    : null;
}

function parseConversationMeta(value: unknown): MobileVoiceConversationMeta | null {
  if (!value || typeof value !== "object") return null;
  const meta = value as Partial<MobileVoiceConversationMeta>;
  if (
    typeof meta.id !== "string"
    || !UUID_PATTERN.test(meta.id)
    || typeof meta.title !== "string"
    || !meta.title.trim()
    || Array.from(meta.title).length > 80
    || typeof meta.createdAt !== "number"
    || typeof meta.updatedAt !== "number"
    || typeof meta.turnCount !== "number"
    || !Number.isInteger(meta.turnCount)
    || meta.turnCount < 0
    || typeof meta.preview !== "string"
    || Array.from(meta.preview).length > 120
  ) {
    return null;
  }
  return {
    id: meta.id,
    title: meta.title,
    createdAt: meta.createdAt,
    updatedAt: meta.updatedAt,
    turnCount: meta.turnCount,
    preview: meta.preview,
  };
}
