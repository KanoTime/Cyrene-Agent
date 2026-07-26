import type { CharacterRuntimeSnapshot } from "./character-runtime";

export type CharacterSafeModeDialog = Readonly<{
  type: "error";
  title: string;
  message: string;
  detail: string;
  buttons: string[];
  defaultId: 0;
  cancelId: 1;
  noLink: true;
}>;

export function buildCharacterSafeModeDialog(
  snapshot: CharacterRuntimeSnapshot,
): CharacterSafeModeDialog {
  const lines = snapshot.diagnostics.map((diagnostic, index) => [
    `${index + 1}. [${diagnostic.code}] ${diagnostic.message}`,
    ...(diagnostic.resourcePath ? [`   ${diagnostic.resourcePath}`] : []),
  ]).flat();
  return {
    type: "error",
    title: "Cyrene Agent 诊断安全模式",
    message: "内置角色资源不可用，应用未加载桌宠、聊天、语音或外部渠道。",
    detail: [
      ...lines,
      "",
      "请恢复或重新安装 Cyrene Agent 的内置角色资源，然后选择“重新检查”。角色私有状态不会被删除。",
    ].join("\n"),
    buttons: ["重新检查", "退出应用"],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
  };
}
