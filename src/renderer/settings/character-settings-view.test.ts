import { describe, expect, it } from "vitest";
import {
  buildCharacterReplacementConfirmation,
  buildCharacterSwitchConfirmation,
  renderArchivedCharacterStates,
  renderCharacterPackages,
} from "./character-settings-view";

describe("character settings view", () => {
  it("renders active, health, distribution and capability state without trusting package HTML", () => {
    const html = renderCharacterPackages({
      status: "ready",
      activeCharacter: { id: "fixture.lumen", displayName: "流明" },
      packages: [{
        id: "fixture.lumen",
        displayName: '<img src=x onerror="alert(1)">',
        version: "1.0.0",
        source: "local",
        readOnly: false,
        distributionStatus: "local-only",
        capabilities: {
          worldbook: "available",
          live2d: "unavailable",
          semanticActions: "unavailable",
          voice: "available",
          stickers: "unavailable",
          openers: "unavailable",
        },
        health: { status: "healthy", diagnostics: [] },
      }],
    });

    expect(html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(html).not.toContain("<img");
    expect(html).toContain("当前使用");
    expect(html).toContain("仅限本机");
    expect(html).toContain("世界书");
    expect(html).toContain("音色");
    expect(html).not.toContain("Live2D</span>");
    expect(html).not.toContain('data-character-switch="fixture.lumen"');
  });

  it("shows structured diagnostics for an unhealthy package", () => {
    const html = renderCharacterPackages({
      status: "ready",
      activeCharacter: { id: "cyrene", displayName: "昔涟" },
      packages: [{
        id: "broken",
        displayName: "损坏角色",
        version: "1.0.0",
        source: "local",
        readOnly: false,
        distributionStatus: "redistributable",
        capabilities: {
          worldbook: "unavailable",
          live2d: "unavailable",
          semanticActions: "unavailable",
          voice: "unavailable",
          stickers: "unavailable",
          openers: "unavailable",
        },
        health: {
          status: "unhealthy",
          diagnostics: [{ code: "missing", message: "缺少 soul.md" }],
        },
      }],
    });

    expect(html).toContain("需要修复");
    expect(html).toContain("缺少 soul.md");
    expect(html).not.toContain('data-character-switch="broken"');
  });

  it("renders a switch action and explains globally blocking activity", () => {
    const html = renderCharacterPackages({
      status: "ready",
      activeCharacter: { id: "cyrene", displayName: "昔涟" },
      switching: {
        blockingActivities: [{ kind: "voice-call", reason: "语音通话正在进行" }],
      },
      packages: [{
        id: "fixture.lumen",
        displayName: "流明",
        version: "1.0.0",
        source: "local",
        readOnly: false,
        distributionStatus: "redistributable",
        capabilities: {
          worldbook: "available",
          live2d: "unavailable",
          semanticActions: "unavailable",
          voice: "available",
          stickers: "unavailable",
          openers: "unavailable",
        },
        health: { status: "healthy", diagnostics: [] },
      }],
    });

    expect(html).toContain('data-character-switch="fixture.lumen"');
    expect(html).toContain("切换到流明");
    expect(html).toContain("disabled");
    expect(html).toContain("语音通话正在进行");
  });

  it("builds a confirmation that names the target, restart, and unavailable capabilities", () => {
    expect(buildCharacterSwitchConfirmation({
      id: "fixture.lumen",
      displayName: "流明",
      capabilities: {
        worldbook: "available",
        live2d: "unavailable",
        semanticActions: "unavailable",
        voice: "available",
        stickers: "unavailable",
        openers: "unavailable",
      },
    })).toEqual({
      title: "切换到「流明」？",
      message: "应用将保存当前状态并自动重启。该角色暂不提供：Live2D、语义动作、表情包、主动开口。",
      confirmLabel: "切换并重启",
    });
  });

  it("offers uninstall only for an inactive local package", () => {
    const html = renderCharacterPackages({
      status: "ready",
      activeCharacter: { id: "cyrene", displayName: "昔涟" },
      packages: [{
        id: "fixture.lumen",
        displayName: "流明",
        version: "1.0.0",
        source: "local",
        readOnly: false,
        distributionStatus: "redistributable",
        capabilities: {
          worldbook: "available",
          live2d: "unavailable",
          semanticActions: "unavailable",
          voice: "available",
          stickers: "unavailable",
          openers: "unavailable",
        },
        health: { status: "healthy", diagnostics: [] },
      }],
    });

    expect(html).toContain('data-character-uninstall="fixture.lumen"');
    expect(html).toContain("卸载角色包");
  });

  it("renders archived state impact and a separate permanent-delete action", () => {
    const html = renderArchivedCharacterStates([{
      characterId: "fixture.lumen",
      displayName: "流明",
      packageVersion: "1.0.0",
      archivedAt: "2026-07-16T00:00:00.000Z",
      fileCount: 12,
      totalBytes: 2_048,
    }]);

    expect(html).toContain("流明");
    expect(html).toContain("12 个文件");
    expect(html).toContain("2 KB");
    expect(html).toContain('data-character-archive-delete="fixture.lumen"');
    expect(html).toContain("永久删除状态");
  });

  it("explains version, digest and capability changes before replacement", () => {
    expect(buildCharacterReplacementConfirmation({
      kind: "upgrade",
      characterId: "fixture.lumen",
      displayName: "流明",
      currentVersion: "1.0.0",
      targetVersion: "1.1.0",
      currentDigest: "a".repeat(64),
      targetDigest: "b".repeat(64),
      changedCapabilities: ["live2d", "voice"],
    })).toEqual({
      title: "升级「流明」？",
      message: "版本：1.0.0 → 1.1.0。内容摘要：aaaaaaaaaaaa → bbbbbbbbbbbb。能力变化：Live2D、音色。旧角色包会先备份，聊天、记忆和关系状态不会被替换。",
      confirmLabel: "确认升级",
    });
  });
});
