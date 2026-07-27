import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import {
  VOICE_CONVERSATION_SCHEMA_VERSION,
  type VoiceConversation,
  type VoiceConversationMeta,
  type VoiceConversationTurn,
} from "../../shared/voice-conversation";

const INDEX_FILE = "index.json";
const SESSIONS_SUBDIR = "sessions";
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface VoiceConversationStoreOptions {
  now?: () => number;
  id?: () => string;
}

function normalizeTitle(title: string): string {
  const normalized = title.replace(/\s+/g, " ").trim();
  if (!normalized) throw new Error("VOICE_CONVERSATION_TITLE_REQUIRED");
  if (Array.from(normalized).length > 80) {
    throw new Error("VOICE_CONVERSATION_TITLE_TOO_LONG");
  }
  return normalized;
}

function previewFor(conversation: VoiceConversation): string {
  const turn = conversation.turns.at(-1);
  if (!turn) return "";
  const text = (turn.assistantText || turn.userText).replace(/\s+/g, " ").trim();
  return Array.from(text).slice(0, 120).join("");
}

function metaFor(conversation: VoiceConversation): VoiceConversationMeta {
  return {
    id: conversation.id,
    title: conversation.title,
    createdAt: conversation.createdAt,
    updatedAt: conversation.updatedAt,
    turnCount: conversation.turns.length,
    preview: previewFor(conversation),
  };
}

function isMeta(value: unknown): value is VoiceConversationMeta {
  if (!value || typeof value !== "object") return false;
  const meta = value as Partial<VoiceConversationMeta>;
  return Boolean(
    typeof meta.id === "string"
    && UUID_PATTERN.test(meta.id)
    && typeof meta.title === "string"
    && typeof meta.createdAt === "number"
    && typeof meta.updatedAt === "number"
    && typeof meta.turnCount === "number"
    && typeof meta.preview === "string",
  );
}

function cloneConversation(conversation: VoiceConversation): VoiceConversation {
  return {
    ...conversation,
    turns: conversation.turns.map((turn) => ({ ...turn })),
  };
}

export class VoiceConversationStore {
  private readonly sessionsDir: string;
  private readonly indexPath: string;
  private readonly now: () => number;
  private readonly id: () => string;
  private index: VoiceConversationMeta[];

  constructor(
    private readonly rootDir: string,
    options: VoiceConversationStoreOptions = {},
  ) {
    this.sessionsDir = path.join(rootDir, SESSIONS_SUBDIR);
    this.indexPath = path.join(rootDir, INDEX_FILE);
    this.now = options.now ?? Date.now;
    this.id = options.id ?? randomUUID;
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    this.index = this.readIndex();
  }

  list(): VoiceConversationMeta[] {
    return this.index
      .slice()
      .sort((left, right) => right.updatedAt - left.updatedAt)
      .map((meta) => ({ ...meta }));
  }

  get(id: string): VoiceConversation | null {
    if (!UUID_PATTERN.test(id)) return null;
    const filePath = this.sessionPath(id);
    if (!fs.existsSync(filePath)) return null;
    try {
      const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Partial<VoiceConversation>;
      if (
        parsed.schemaVersion !== VOICE_CONVERSATION_SCHEMA_VERSION
        || parsed.id !== id
        || typeof parsed.title !== "string"
        || typeof parsed.createdAt !== "number"
        || typeof parsed.updatedAt !== "number"
        || !Array.isArray(parsed.turns)
      ) {
        return null;
      }
      const turns = parsed.turns.filter((turn): turn is VoiceConversationTurn => Boolean(
        turn
        && typeof turn.id === "string"
        && typeof turn.userText === "string"
        && typeof turn.assistantText === "string"
        && typeof turn.at === "number",
      ));
      if (turns.length !== parsed.turns.length) return null;
      return cloneConversation({ ...parsed, turns } as VoiceConversation);
    } catch {
      return null;
    }
  }

  create(title: string): VoiceConversation {
    const now = this.now();
    const conversation: VoiceConversation = {
      id: this.id(),
      title: normalizeTitle(title),
      createdAt: now,
      updatedAt: now,
      turns: [],
      schemaVersion: VOICE_CONVERSATION_SCHEMA_VERSION,
    };
    if (!UUID_PATTERN.test(conversation.id)) throw new Error("VOICE_CONVERSATION_ID_INVALID");
    this.writeConversation(conversation);
    return cloneConversation(conversation);
  }

  rename(id: string, title: string): VoiceConversation | null {
    const conversation = this.get(id);
    if (!conversation) return null;
    conversation.title = normalizeTitle(title);
    conversation.updatedAt = this.now();
    this.writeConversation(conversation);
    return cloneConversation(conversation);
  }

  appendTurn(
    id: string,
    input: Pick<VoiceConversationTurn, "userText" | "assistantText">,
  ): VoiceConversation | null {
    const conversation = this.get(id);
    if (!conversation) return null;
    const userText = input.userText.trim();
    const assistantText = input.assistantText.trim();
    if (!userText || !assistantText) throw new Error("VOICE_CONVERSATION_TURN_INVALID");
    const at = this.now();
    conversation.turns.push({
      id: this.id(),
      userText,
      assistantText,
      at,
    });
    conversation.updatedAt = at;
    this.writeConversation(conversation);
    return cloneConversation(conversation);
  }

  getRecentTurns(id: string, limit: number): VoiceConversationTurn[] {
    const conversation = this.get(id);
    if (!conversation) return [];
    const safeLimit = Math.max(0, Math.min(Math.floor(limit), 100));
    return conversation.turns.slice(-safeLimit).map((turn) => ({ ...turn }));
  }

  private readIndex(): VoiceConversationMeta[] {
    if (!fs.existsSync(this.indexPath)) return [];
    try {
      const parsed = JSON.parse(fs.readFileSync(this.indexPath, "utf8")) as unknown;
      return Array.isArray(parsed) ? parsed.filter(isMeta) : [];
    } catch {
      return [];
    }
  }

  private sessionPath(id: string): string {
    return path.join(this.sessionsDir, `${id}.json`);
  }

  private writeConversation(conversation: VoiceConversation): void {
    this.atomicWrite(this.sessionPath(conversation.id), conversation);
    const nextMeta = metaFor(conversation);
    const index = this.index.findIndex((meta) => meta.id === conversation.id);
    if (index < 0) this.index.push(nextMeta);
    else this.index[index] = nextMeta;
    this.index.sort((left, right) => right.updatedAt - left.updatedAt);
    this.atomicWrite(this.indexPath, this.index);
  }

  private atomicWrite(filePath: string, value: unknown): void {
    const temporary = `${filePath}.tmp`;
    fs.writeFileSync(temporary, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    fs.renameSync(temporary, filePath);
  }
}
