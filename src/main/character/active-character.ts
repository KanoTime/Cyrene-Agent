import type { ActiveCharacterContext } from "./character-runtime";
import {
  loadActiveCharacterTextContext,
  type ActiveCharacterTextContext,
} from "./character-text-context";
import {
  createCharacterVisualContext,
  type CharacterVisualContext,
  type CharacterVisualPresentation,
} from "./character-visual";

export type ActiveCharacterPublicIdentity = Readonly<{
  id: string;
  displayName: string;
  avatarUrl: string;
  visual: CharacterVisualPresentation;
}>;

let activeContext: ActiveCharacterContext | null = null;
let activeTextContext: ActiveCharacterTextContext | null = null;
let activeVisualContext: CharacterVisualContext | null = null;

export function configureActiveCharacter(context: ActiveCharacterContext): void {
  activeContext = context;
  activeTextContext = loadActiveCharacterTextContext(context);
  activeVisualContext = createCharacterVisualContext(context);
}

export function getActiveCharacter(): ActiveCharacterContext {
  if (!activeContext) throw new Error("活动角色尚未就绪");
  return activeContext;
}

export function getActiveCharacterText(): ActiveCharacterTextContext {
  if (!activeTextContext) throw new Error("活动角色文本上下文尚未就绪");
  return activeTextContext;
}

export function getActiveCharacterVisual(): CharacterVisualContext {
  if (!activeVisualContext) throw new Error("活动角色视觉上下文尚未就绪");
  return activeVisualContext;
}

export function getActiveCharacterPublicIdentity(): ActiveCharacterPublicIdentity {
  const active = getActiveCharacter();
  return Object.freeze({
    id: active.id,
    displayName: active.displayName,
    avatarUrl: `local-character://${active.id}/avatar`,
    visual: getActiveCharacterVisual().presentation,
  });
}
