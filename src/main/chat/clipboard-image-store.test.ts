import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  ClipboardImageStoreError,
  persistClipboardImages,
} from "./clipboard-image-store";

const temporaryDirectories: string[] = [];
const PNG_SIGNATURE = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10]);

async function makeTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(path.join(os.tmpdir(), "cyrene-clipboard-image-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((directory) => (
    rm(directory, { recursive: true, force: true })
  )));
});

describe("persistClipboardImages", () => {
  it("writes pasted image bytes to the character-owned attachment directory", async () => {
    const attachmentsRoot = await makeTemporaryDirectory();

    const [stored] = await persistClipboardImages(attachmentsRoot, [{
      name: "聊天截图.png",
      mime: "image/png",
      bytes: PNG_SIGNATURE,
    }]);

    expect(stored.name).toBe("聊天截图.png");
    expect(path.dirname(stored.filePath)).toBe(attachmentsRoot);
    expect(path.extname(stored.filePath)).toBe(".png");
    expect(await readFile(stored.filePath)).toEqual(Buffer.from(PNG_SIGNATURE));
  });

  it("rejects unsupported or non-image clipboard payloads before writing files", async () => {
    const attachmentsRoot = await makeTemporaryDirectory();

    await expect(persistClipboardImages(attachmentsRoot, [{
      name: "not-an-image.txt",
      mime: "text/plain",
      bytes: Uint8Array.from([1, 2, 3]),
    }])).rejects.toBeInstanceOf(ClipboardImageStoreError);

    await expect(persistClipboardImages(attachmentsRoot, [{
      name: "fake.png",
      mime: "image/png",
      bytes: Uint8Array.from([1, 2, 3]),
    }])).rejects.toBeInstanceOf(ClipboardImageStoreError);
  });
});
