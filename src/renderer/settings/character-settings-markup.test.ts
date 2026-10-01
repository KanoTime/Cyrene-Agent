import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { CHARACTER_SETTINGS_MARKUP as html } from "../react/features/settings/fork-settings-markup";

describe("character settings markup", () => {
  it("retains character import and archive controls in the React settings surface", () => {
    expect(html).toContain('id="characters-panel"');
    expect(html).toContain('id="character-import-btn"');
    expect(html).toContain('id="character-package-list"');
    expect(html).toContain('id="character-archive-count"');
    expect(html).toContain('id="character-archive-list"');
  });

  it("explains controlled restart and busy-state protection before switching", () => {
    const panel = html.match(/<section[^>]+id="characters-panel"[\s\S]*?<\/section>/)?.[0] ?? "";
    expect(panel).toContain("切换会保存状态并自动重启");
    expect(panel).toContain("通话、识别、语音合成或回复生成期间会暂时禁止切换");
    expect(panel).toContain("对话、语音、Live2D 和角色状态会统一使用新角色");
    expect(panel).toContain("卸载角色包不会删除聊天、记忆和关系");
    expect(panel).toContain("永久删除不可撤销");
  });
});
