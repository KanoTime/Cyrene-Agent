import { createHash } from "node:crypto";
import path from "node:path";
import { requireActiveCharacterState } from "../character/character-state";
import {
  RelationshipLogStore,
  type RelationshipTurnInput,
} from "../relationship/relationship-log";

export class ChannelConversationRelationshipStore {
  constructor(private readonly rootDir: string) {}

  async recordTurn(sessionId: string, input: RelationshipTurnInput): Promise<void> {
    await this.#store(sessionId).recordTurn(input);
  }

  async buildContext(sessionId: string): Promise<string> {
    return this.#store(sessionId).buildContext();
  }

  #store(sessionId: string): RelationshipLogStore {
    if (!sessionId) throw new Error("渠道关系状态缺少 sessionId");
    const key = createHash("sha256").update(sessionId).digest("hex");
    return new RelationshipLogStore(path.join(this.rootDir, `${key}.json`));
  }
}

function activeStore(): ChannelConversationRelationshipStore {
  return new ChannelConversationRelationshipStore(
    path.join(requireActiveCharacterState().channelHistoryRoot, "conversation-state"),
  );
}

export async function recordChannelConversationRelationship(
  sessionId: string,
  input: RelationshipTurnInput,
): Promise<void> {
  await activeStore().recordTurn(sessionId, input);
}

export async function buildChannelConversationRelationshipContext(
  sessionId: string,
): Promise<string> {
  return activeStore().buildContext(sessionId);
}
