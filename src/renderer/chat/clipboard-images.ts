import { isSupportedClipboardImageMime } from "../../shared/clipboard-images";

type ClipboardItemLike = Pick<DataTransferItem, "kind" | "type" | "getAsFile">;

/**
 * 只挑出浏览器明确标记为受支持图片格式的 File。
 * 文本粘贴不在这里被拦截，仍交给 textarea 的默认行为。
 */
export function collectPastedImageFiles(items: Iterable<ClipboardItemLike>): File[] {
  const files: File[] = [];
  for (const item of items) {
    if (item.kind !== "file") continue;
    const file = item.getAsFile();
    const mime = (file?.type || item.type).toLowerCase();
    if (file && isSupportedClipboardImageMime(mime)) files.push(file);
  }
  return files;
}
