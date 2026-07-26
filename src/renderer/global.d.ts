// Global type augmentations for renderer

interface SystemApi {
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string }>;
}

interface ActiveCharacterIdentity {
  id: string;
  displayName: string;
  avatarUrl: string;
  visual:
    | { kind: "live2d"; characterId: string; modelUrl: string; neutralTarget?: import("../shared/semantic-actions").Live2DTarget }
    | { kind: "static"; characterId: string; avatarUrl: string };
}

interface CharacterApi {
  getActive: () => Promise<ActiveCharacterIdentity>;
}

declare global {
  interface Window {
    system?: SystemApi;
    character?: CharacterApi;
  }
}

// Vite ?raw 导入：把 .md 文件内联为字符串（renderMarkdown 渲染用）
declare module "*.md?raw" {
  const content: string;
  export default content;
}

export {};
