export interface ActiveCharacterIdentity {
  id: string;
  displayName: string;
  avatarUrl: string;
  visual:
    | { kind: "live2d"; characterId: string; modelUrl: string; neutralTarget?: import("../../shared/semantic-actions").Live2DTarget }
    | { kind: "static"; characterId: string; avatarUrl: string };
}

export type CharacterSurface = "chat" | "call" | "status";

const SURFACE_LABELS: Record<CharacterSurface, string> = {
  chat: "聊天",
  call: "语音通话",
  status: "状态",
};

export function buildActiveCharacterUiText(
  identity: ActiveCharacterIdentity,
  surface: CharacterSurface,
) {
  return Object.freeze({
    windowTitle: `${identity.displayName} · ${SURFACE_LABELS[surface]}`,
    emptyMessage: `${identity.displayName}期待与你聊天哦 ✨`,
    thinkingMessage: `${identity.displayName}思考中...`,
    speakingMessage: `${identity.displayName}说话中...`,
    productVersionLabel: (version: string) => `Cyrene Agent v${version}`,
  });
}

export async function hydrateActiveCharacterIdentity(
  surface: CharacterSurface,
): Promise<ActiveCharacterIdentity | null> {
  const identity = await window.character?.getActive();
  if (!identity) return null;
  const text = buildActiveCharacterUiText(identity, surface);
  document.title = text.windowTitle;
  document.querySelectorAll<HTMLElement>("[data-character-name]")
    .forEach((element) => { element.textContent = identity.displayName; });
  document.querySelectorAll<HTMLImageElement>("[data-character-avatar]")
    .forEach((element) => {
      element.src = identity.avatarUrl;
      element.alt = identity.displayName;
    });
  document.querySelectorAll<HTMLElement>("[data-character-empty]")
    .forEach((element) => { element.textContent = text.emptyMessage; });
  return identity;
}
