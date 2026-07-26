import { execFile } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface PreparedWechatAudioFile {
  filePath: string;
  fileName: string;
  mime: string;
  converted: boolean;
}

interface PrepareWechatAudioOptions {
  platform?: NodeJS.Platform;
  runAfconvert?: (inputPath: string, outputPath: string) => Promise<void>;
}

async function defaultRunAfconvert(inputPath: string, outputPath: string): Promise<void> {
  await execFileAsync("/usr/bin/afconvert", [
    "-f", "m4af",
    "-d", "aac",
    "-b", "96000",
    inputPath,
    outputPath,
  ]);
}

export async function prepareWechatAudioFile(
  inputPath: string,
  options: PrepareWechatAudioOptions = {},
): Promise<PreparedWechatAudioFile> {
  const platform = options.platform ?? process.platform;
  const fallback: PreparedWechatAudioFile = {
    filePath: inputPath,
    fileName: "语音回复.wav",
    mime: "audio/wav",
    converted: false,
  };
  if (platform !== "darwin" || path.extname(inputPath).toLowerCase() !== ".wav") return fallback;

  const outputPath = path.join(
    path.dirname(inputPath),
    `${path.basename(inputPath, path.extname(inputPath))}.m4a`,
  );
  try {
    await (options.runAfconvert ?? defaultRunAfconvert)(inputPath, outputPath);
    const stat = await fs.stat(outputPath);
    if (!stat.isFile() || stat.size === 0) throw new Error("M4A output is empty");
    return {
      filePath: outputPath,
      fileName: "语音回复.m4a",
      mime: "audio/mp4",
      converted: true,
    };
  } catch {
    await fs.unlink(outputPath).catch(() => undefined);
    return fallback;
  }
}
