import { promises as fs } from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { prepareWechatAudioFile } from "./wechat-audio-file";

const tempDirs: string[] = [];

async function fixture(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "cyrene-wechat-audio-"));
  tempDirs.push(dir);
  const inputPath = path.join(dir, "reply.wav");
  await fs.writeFile(inputPath, "wav");
  return inputPath;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })));
});

describe("prepareWechatAudioFile", () => {
  it("prefers an AAC-encoded M4A file on macOS", async () => {
    const inputPath = await fixture();

    const result = await prepareWechatAudioFile(inputPath, {
      platform: "darwin",
      runAfconvert: async (_input, output) => {
        await fs.writeFile(output, "m4a");
      },
    });

    expect(result).toEqual({
      filePath: inputPath.replace(/\.wav$/, ".m4a"),
      fileName: "语音回复.m4a",
      mime: "audio/mp4",
      converted: true,
    });
  });

  it("falls back to WAV when M4A conversion fails", async () => {
    const inputPath = await fixture();

    const result = await prepareWechatAudioFile(inputPath, {
      platform: "darwin",
      runAfconvert: async () => {
        throw new Error("conversion failed");
      },
    });

    expect(result).toEqual({
      filePath: inputPath,
      fileName: "语音回复.wav",
      mime: "audio/wav",
      converted: false,
    });
  });
});
