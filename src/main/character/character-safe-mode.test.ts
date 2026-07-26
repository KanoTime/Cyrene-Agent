import { describe, expect, it } from "vitest";
import { buildCharacterSafeModeDialog } from "./character-safe-mode";

describe("Character diagnostic safe mode", () => {
  it("builds an actionable local diagnostic without loading partial character resources", () => {
    expect(buildCharacterSafeModeDialog({
      status: "safe-mode",
      activeCharacter: null,
      packages: [],
      diagnostics: [{
        code: "character.core_resource.missing",
        message: "角色包核心资源不存在：content.soul",
        characterId: "cyrene",
        resourcePath: "/Applications/Cyrene Agent.app/content/soul.md",
      }, {
        code: "character.startup.safe_mode",
        message: "内置昔涟角色包也不可用，已进入诊断安全模式；不会加载部分角色资源。",
        characterId: "cyrene",
      }],
    })).toEqual({
      type: "error",
      title: "Cyrene Agent 诊断安全模式",
      message: "内置角色资源不可用，应用未加载桌宠、聊天、语音或外部渠道。",
      detail: [
        "1. [character.core_resource.missing] 角色包核心资源不存在：content.soul",
        "   /Applications/Cyrene Agent.app/content/soul.md",
        "2. [character.startup.safe_mode] 内置昔涟角色包也不可用，已进入诊断安全模式；不会加载部分角色资源。",
        "",
        "请恢复或重新安装 Cyrene Agent 的内置角色资源，然后选择“重新检查”。角色私有状态不会被删除。",
      ].join("\n"),
      buttons: ["重新检查", "退出应用"],
      defaultId: 0,
      cancelId: 1,
      noLink: true,
    });
  });
});
