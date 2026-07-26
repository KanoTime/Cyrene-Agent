import fs from "fs";
import path from "path";
import {
  SEMANTIC_ACTIONS,
  findSemanticAction,
  isLive2DTarget,
  isSemanticActionId,
  type Live2DTarget,
  type SemanticActionId,
} from "../../shared/semantic-actions";
import type { ActiveCharacterContext } from "./character-runtime";

export type CharacterVisualPresentation =
  | Readonly<{ kind: "live2d"; characterId: string; modelUrl: string; neutralTarget?: Live2DTarget }>
  | Readonly<{ kind: "static"; characterId: string; avatarUrl: string }>;

export type SemanticActionResolution =
  | Readonly<{ kind: "play"; actionId: SemanticActionId; target: Live2DTarget }>
  | Readonly<{
      kind: "noop";
      actionId?: SemanticActionId;
      reason: "unknown_action" | "live2d_unavailable" | "action_unavailable";
      available: readonly string[];
    }>;

export type CharacterVisualContext = Readonly<{
  presentation: CharacterVisualPresentation;
  availableActions: readonly string[];
  resolveAction: (input: string) => SemanticActionResolution;
}>;

type MappingFile = Readonly<{
  schemaVersion: 1;
  actions: Readonly<Partial<Record<SemanticActionId, Live2DTarget>>>;
}>;

function encodeResourcePath(resourcePath: string): string {
  return resourcePath.split(path.sep).map(encodeURIComponent).join("/");
}

function characterResourceUrl(characterId: string, resourcePath: string): string {
  return `local-character://${characterId}/${encodeResourcePath(resourcePath)}`;
}

export function readSemanticActionMapping(filePath: string): MappingFile {
  const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, unknown>;
  if (parsed.schemaVersion !== 1 || !parsed.actions || typeof parsed.actions !== "object") {
    throw new Error("Semantic Action 映射必须使用 schemaVersion 1 和 actions 对象");
  }
  const actions: Partial<Record<SemanticActionId, Live2DTarget>> = {};
  for (const [id, target] of Object.entries(parsed.actions as Record<string, unknown>)) {
    if (!isSemanticActionId(id)) throw new Error(`未知 Semantic Action：${id}`);
    if (!isLive2DTarget(target)) throw new Error(`Semantic Action ${id} 的目标无效`);
    actions[id] = Object.freeze({ ...target }) as Live2DTarget;
  }
  return Object.freeze({ schemaVersion: 1, actions: Object.freeze(actions) });
}

export function createCharacterVisualContext(active: ActiveCharacterContext): CharacterVisualContext {
  const hasLive2d = active.capabilities.live2d.status === "available";
  const mapping = hasLive2d && active.capabilities.semanticActions.status === "available"
    ? readSemanticActionMapping(active.capabilities.semanticActions.filePath).actions
    : Object.freeze({}) as MappingFile["actions"];
  const presentation: CharacterVisualPresentation = hasLive2d
    ? Object.freeze({
        kind: "live2d",
        characterId: active.id,
        modelUrl: characterResourceUrl(
          active.id,
          path.join("live2d", path.relative(active.packageRoot, active.capabilities.live2d.modelPath)),
        ),
        ...(mapping.neutral ? { neutralTarget: mapping.neutral } : {}),
      })
    : Object.freeze({
        kind: "static",
        characterId: active.id,
        avatarUrl: characterResourceUrl(active.id, "avatar"),
      });
  const availableActions = Object.freeze(SEMANTIC_ACTIONS
    .filter((action) => mapping[action.id])
    .map((action) => action.alias));

  return Object.freeze({
    presentation,
    availableActions,
    resolveAction(input: string): SemanticActionResolution {
      const action = findSemanticAction(input);
      if (!action) {
        return Object.freeze({ kind: "noop", reason: "unknown_action", available: availableActions });
      }
      if (!hasLive2d) {
        return Object.freeze({
          kind: "noop",
          actionId: action.id,
          reason: "live2d_unavailable",
          available: availableActions,
        });
      }
      const target = mapping[action.id];
      if (!target) {
        return Object.freeze({
          kind: "noop",
          actionId: action.id,
          reason: "action_unavailable",
          available: availableActions,
        });
      }
      return Object.freeze({ kind: "play", actionId: action.id, target });
    },
  });
}
