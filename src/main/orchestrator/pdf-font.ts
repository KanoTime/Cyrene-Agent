import * as fs from "fs";

/**
 * Return platform-appropriate fonts that contain Simplified Chinese glyphs.
 * Keep a plain TTF first where possible because PDFKit can load it without
 * selecting a face from a TrueType collection.
 */
export function getCjkFontCandidates(
  platform: NodeJS.Platform = process.platform,
  override = process.env.CYRENE_PDF_CJK_FONT,
): string[] {
  const candidates: string[] = [];
  if (override?.trim()) candidates.push(override.trim());

  if (platform === "darwin") {
    candidates.push(
      "/System/Library/Fonts/Supplemental/Arial Unicode.ttf",
      "/Library/Fonts/Arial Unicode.ttf",
      "/System/Library/Fonts/Hiragino Sans GB.ttc",
      "/System/Library/Fonts/STHeiti Light.ttc",
    );
  } else if (platform === "win32") {
    candidates.push(
      "C:\\Windows\\Fonts\\msyh.ttc",
      "C:\\Windows\\Fonts\\simsun.ttc",
      "C:\\Windows\\Fonts\\simhei.ttf",
    );
  } else {
    candidates.push(
      "/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc",
      "/usr/share/fonts/opentype/noto/NotoSerifCJK-Regular.ttc",
      "/usr/share/fonts/opentype/source-han-sans/SourceHanSansSC-Regular.otf",
      "/usr/share/fonts/truetype/wqy/wqy-zenhei.ttc",
    );
  }

  return [...new Set(candidates)];
}

export function resolveCjkFontPath(
  platform: NodeJS.Platform = process.platform,
  exists: (path: string) => boolean = fs.existsSync,
  override = process.env.CYRENE_PDF_CJK_FONT,
): string | null {
  return getCjkFontCandidates(platform, override).find((fontPath) => exists(fontPath)) ?? null;
}

export function containsCjkText(value: unknown): boolean {
  return /[\u3400-\u9fff\uf900-\ufaff]/u.test(String(value ?? ""));
}
