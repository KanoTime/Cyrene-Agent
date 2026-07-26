export type SemanticActionId =
  | "neutral"
  | "wink"
  | "cute"
  | "smile"
  | "cool"
  | "question"
  | "sparkle"
  | "star_eyes"
  | "dizzy"
  | "happy_eyes";

export type Live2DTarget =
  | Readonly<{ kind: "motion"; group: string; motionName: string }>
  | Readonly<{ kind: "expression"; name: string }>;

export type SemanticActionDefinition = Readonly<{
  id: SemanticActionId;
  alias: string;
  description: string;
}>;

export const SEMANTIC_ACTIONS: readonly SemanticActionDefinition[] = Object.freeze([
  { id: "neutral", alias: "回正", description: "恢复到默认姿态和表情" },
  { id: "wink", alias: "眨眨眼", description: "向用户眨一只眼睛" },
  { id: "cute", alias: "可爱一下", description: "做一个可爱的动作或表情" },
  { id: "smile", alias: "笑一笑", description: "对用户微笑" },
  { id: "cool", alias: "戴墨镜", description: "做一个帅气的表情" },
  { id: "question", alias: "问号", description: "表达疑惑" },
  { id: "sparkle", alias: "闪闪发光", description: "表现闪耀或惊喜" },
  { id: "star_eyes", alias: "星星眼", description: "表现期待或喜欢" },
  { id: "dizzy", alias: "圈圈眼", description: "表现眩晕或迷糊" },
  { id: "happy_eyes", alias: "开心眼", description: "表现开心" },
]);

const ACTION_BY_ID = new Map(SEMANTIC_ACTIONS.map((action) => [action.id, action]));

export function findSemanticAction(input: string): SemanticActionDefinition | undefined {
  const needle = input.trim().toLowerCase();
  if (!needle) return undefined;
  return SEMANTIC_ACTIONS.find((action) => (
    action.id.toLowerCase() === needle || action.alias.toLowerCase() === needle
  ));
}

export function isSemanticActionId(value: string): value is SemanticActionId {
  return ACTION_BY_ID.has(value as SemanticActionId);
}

export function isLive2DTarget(value: unknown): value is Live2DTarget {
  if (!value || typeof value !== "object") return false;
  const target = value as Record<string, unknown>;
  if (target.kind === "motion") {
    return typeof target.group === "string" && target.group.trim().length > 0
      && typeof target.motionName === "string" && target.motionName.trim().length > 0;
  }
  if (target.kind === "expression") {
    return typeof target.name === "string" && target.name.trim().length > 0;
  }
  return false;
}
