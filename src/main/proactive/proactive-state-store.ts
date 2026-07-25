// ProactiveChat 状态持久化（从原 opener/desire-engine 搬出 + 剃除 opener 专属字段）
// 文件名改用 "proactive-state.json"，避免与历史 opener-state.json 残留冲突。
import * as fs from "fs";
import * as path from "path";
import type { ProactiveState } from "./proactive-types";
import { requireActiveCharacterState } from "../character/character-state";

export function defaultProactiveState(): ProactiveState {
  return {
    proactiveEpoch: 0,
    unansweredCount: 0,
    lastProactiveAt: null,
    lastProactiveScene: null,
    lastNormalConversationEndedAt: null,
    globalDesire: 0,
    affinity: {},
    lastFiredAt: {},
  };
}

function getStatePath(): string {
  return requireActiveCharacterState().proactiveStateFile;
}

export function loadProactiveState(): ProactiveState {
  try {
    const p = getStatePath();
    if (!fs.existsSync(p)) return defaultProactiveState();
    const raw = JSON.parse(fs.readFileSync(p, "utf8")) as Partial<ProactiveState>;
    const base = defaultProactiveState();
    return {
      ...base,
      ...raw,
      affinity: { ...base.affinity, ...(raw.affinity ?? {}) },
      lastFiredAt: { ...(raw.lastFiredAt ?? {}) },
    };
  } catch {
    return defaultProactiveState();
  }
}

export function saveProactiveState(state: ProactiveState): void {
  try {
    const statePath = getStatePath();
    fs.mkdirSync(path.dirname(statePath), { recursive: true });
    fs.writeFileSync(statePath, JSON.stringify(state, null, 2), "utf8");
  } catch (err) {
    console.warn("[Proactive] save state failed:", err);
  }
}
