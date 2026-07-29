#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const incompatibleDeclaration =
  'id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0")';
const compatibleDeclaration =
  'id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0")';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultSettingsPath = resolve(
  scriptDirectory,
  "..",
  "node_modules",
  "@react-native",
  "gradle-plugin",
  "settings.gradle.kts",
);

export async function ensureGradle9FoojayCompatibility(
  settingsPath = defaultSettingsPath,
) {
  const contents = await readFile(settingsPath, "utf8");

  if (contents.includes(compatibleDeclaration)) {
    return { changed: false, settingsPath };
  }

  const incompatibleOccurrences = contents.split(incompatibleDeclaration).length - 1;
  if (incompatibleOccurrences !== 1) {
    throw new Error(
      `无法识别 React Native 的 Foojay 配置：${settingsPath}。` +
        "请检查 @react-native/gradle-plugin 是否已升级。",
    );
  }

  await writeFile(
    settingsPath,
    contents.replace(incompatibleDeclaration, compatibleDeclaration),
    "utf8",
  );
  return { changed: true, settingsPath };
}

async function main() {
  const result = await ensureGradle9FoojayCompatibility();
  const status = result.changed ? "已应用" : "已存在";
  console.log(`[Cyrene Android] Gradle 9 / Foojay 兼容补丁${status}`);
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : null;
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[Cyrene Android] ${error.message}`);
    process.exitCode = 1;
  });
}
