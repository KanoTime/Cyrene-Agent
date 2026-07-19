export const CLIPBOARD_IMAGE_MIME_TO_EXTENSION = Object.freeze({
  "image/png": ".png",
  "image/jpeg": ".jpg",
  "image/gif": ".gif",
  "image/bmp": ".bmp",
  "image/webp": ".webp",
});

export type ClipboardImageMime = keyof typeof CLIPBOARD_IMAGE_MIME_TO_EXTENSION;

export type ClipboardImagePayload = Readonly<{
  name: string;
  mime: ClipboardImageMime;
  bytes: Uint8Array;
}>;

export function isSupportedClipboardImageMime(value: unknown): value is ClipboardImageMime {
  return typeof value === "string"
    && Object.prototype.hasOwnProperty.call(CLIPBOARD_IMAGE_MIME_TO_EXTENSION, value);
}
