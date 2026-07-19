import { randomUUID } from "node:crypto";
import * as fs from "node:fs/promises";
import path from "node:path";
import {
  CLIPBOARD_IMAGE_MIME_TO_EXTENSION,
  isSupportedClipboardImageMime,
  type ClipboardImageMime,
  type ClipboardImagePayload,
} from "../../shared/clipboard-images";

const MAX_IMAGE_COUNT = 8;
const MAX_BYTES_PER_IMAGE = 20 * 1024 * 1024;
const MAX_TOTAL_BYTES = 40 * 1024 * 1024;

export class ClipboardImageStoreError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ClipboardImageStoreError";
  }
}

export type StoredClipboardImage = Readonly<{
  filePath: string;
  name: string;
  mime: ClipboardImageMime;
}>;

function asUint8Array(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  return null;
}

function hasExpectedSignature(mime: ClipboardImageMime, bytes: Uint8Array): boolean {
  switch (mime) {
    case "image/png":
      return bytes.length >= 8
        && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47
        && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
    case "image/jpeg":
      return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
    case "image/gif":
      return bytes.length >= 6
        && bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46
        && bytes[3] === 0x38 && (bytes[4] === 0x37 || bytes[4] === 0x39) && bytes[5] === 0x61;
    case "image/bmp":
      return bytes.length >= 2 && bytes[0] === 0x42 && bytes[1] === 0x4d;
    case "image/webp":
      return bytes.length >= 12
        && bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46
        && bytes[8] === 0x57 && bytes[9] === 0x45 && bytes[10] === 0x42 && bytes[11] === 0x50;
  }
}

function normaliseDisplayName(value: unknown, extension: string): string {
  if (typeof value !== "string") return `已粘贴图片${extension}`;
  const stripped = value.replace(/[\\/\0]/g, "_").trim().slice(0, 120);
  return stripped || `已粘贴图片${extension}`;
}

function normalisePayload(payload: unknown): ClipboardImagePayload[] {
  if (!Array.isArray(payload) || payload.length === 0) return [];
  if (payload.length > MAX_IMAGE_COUNT) {
    throw new ClipboardImageStoreError(`一次最多可粘贴 ${MAX_IMAGE_COUNT} 张图片`);
  }

  let totalBytes = 0;
  return payload.map((entry, index) => {
    if (!entry || typeof entry !== "object") {
      throw new ClipboardImageStoreError(`第 ${index + 1} 张粘贴内容无效`);
    }
    const record = entry as { name?: unknown; mime?: unknown; bytes?: unknown };
    const normalizedMime = typeof record.mime === "string" ? record.mime.toLowerCase() : record.mime;
    if (!isSupportedClipboardImageMime(normalizedMime)) {
      throw new ClipboardImageStoreError(`第 ${index + 1} 张图片格式不受支持`);
    }
    const bytes = asUint8Array(record.bytes);
    if (!bytes || bytes.byteLength === 0) {
      throw new ClipboardImageStoreError(`第 ${index + 1} 张图片没有可用数据`);
    }
    if (bytes.byteLength > MAX_BYTES_PER_IMAGE) {
      throw new ClipboardImageStoreError(`第 ${index + 1} 张图片超过 20 MB 限制`);
    }
    totalBytes += bytes.byteLength;
    if (totalBytes > MAX_TOTAL_BYTES) {
      throw new ClipboardImageStoreError("本次粘贴图片总大小超过 40 MB 限制");
    }
    if (!hasExpectedSignature(normalizedMime, bytes)) {
      throw new ClipboardImageStoreError(`第 ${index + 1} 张图片内容无法验证`);
    }

    return {
      name: normaliseDisplayName(record.name, CLIPBOARD_IMAGE_MIME_TO_EXTENSION[normalizedMime]),
      mime: normalizedMime,
      bytes,
    };
  });
}

/**
 * 剪贴板 File 没有稳定的本地路径。这里将其写进活动角色的聊天状态目录，
 * 使历史会话和后续视觉请求能继续复用同一份图片。
 */
export async function persistClipboardImages(
  attachmentsRoot: string,
  payload: unknown,
): Promise<StoredClipboardImage[]> {
  const images = normalisePayload(payload);
  if (images.length === 0) return [];

  const root = path.resolve(attachmentsRoot);
  await fs.mkdir(root, { recursive: true });
  const storedPaths: string[] = [];
  try {
    const stored: StoredClipboardImage[] = [];
    for (const image of images) {
      const extension = CLIPBOARD_IMAGE_MIME_TO_EXTENSION[image.mime];
      const filePath = path.join(root, `${randomUUID()}${extension}`);
      await fs.writeFile(filePath, image.bytes, { flag: "wx" });
      storedPaths.push(filePath);
      stored.push({ filePath, name: image.name, mime: image.mime });
    }
    return stored;
  } catch (error) {
    await Promise.all(storedPaths.map((filePath) => fs.rm(filePath, { force: true })));
    throw error;
  }
}
