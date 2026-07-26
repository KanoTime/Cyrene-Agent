#!/usr/bin/env node

import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawn, spawnSync } from "node:child_process";

import { ensureGradle9FoojayCompatibility } from "./ensure-gradle9-foojay-compatible.mjs";

const isCheckOnly = process.argv.includes("--check");
const forwardedArgs = process.argv.slice(2).filter((argument) => argument !== "--check");

function asExistingDirectory(candidate) {
  if (!candidate?.trim()) return null;
  const normalized = resolve(candidate.trim());
  return existsSync(normalized) ? normalized : null;
}

function firstExisting(values) {
  for (const value of values) {
    const found = asExistingDirectory(value);
    if (found) return found;
  }
  return null;
}

function commandExists(command) {
  const result = spawnSync(command, ["-version"], { stdio: "ignore" });
  return !result.error && result.status === 0;
}

function fail(message) {
  console.error(`\n[Cyrene Android] ${message}\n`);
  process.exitCode = 1;
}

const defaultSdkPath = join(homedir(), "Library", "Android", "sdk");
const sdkRoot = firstExisting([
  process.env.ANDROID_HOME,
  process.env.ANDROID_SDK_ROOT,
  defaultSdkPath,
]);

if (!sdkRoot) {
  fail([
    "未找到 Android SDK，因此 Expo 无法启动 adb。",
    "请安装 Android Studio，并在首次启动的 Setup Wizard 中安装 Android SDK、Android SDK Platform-Tools 和 Android SDK Build-Tools。",
    `完成后，SDK 默认应位于：${defaultSdkPath}`,
    "安装完成后重新运行：npm run android",
  ].join("\n"));
} else {
  const adbPath = join(sdkRoot, "platform-tools", "adb");
  if (!existsSync(adbPath)) {
    fail([
      `已找到 Android SDK：${sdkRoot}`,
      "但缺少 platform-tools/adb。请在 Android Studio → Settings → Languages & Frameworks → Android SDK → SDK Tools 勾选 Android SDK Platform-Tools，然后重新运行 npm run android。",
    ].join("\n"));
  } else {
    const studioJbr = "/Applications/Android Studio.app/Contents/jbr/Contents/Home";
    const javaHome = firstExisting([process.env.JAVA_HOME, studioJbr]);
    const javaExecutable = javaHome ? join(javaHome, "bin", "java") : null;
    const hasJava = javaExecutable ? existsSync(javaExecutable) : commandExists("java");

    if (!hasJava) {
      fail([
        "未找到可用的 Java。Android Studio 完整安装会自带 JBR；也可以安装 JDK 17。",
        "安装 Android Studio 后重新运行 npm run android；脚本会自动使用它内置的 JBR。",
      ].join("\n"));
    } else if (isCheckOnly) {
      console.log("[Cyrene Android] 环境就绪");
      console.log(`SDK: ${sdkRoot}`);
      console.log(`ADB: ${adbPath}`);
      console.log(`Java: ${javaExecutable ?? "system java"}`);
    } else {
      try {
        const patchResult = await ensureGradle9FoojayCompatibility();
        if (patchResult.changed) {
          console.log("[Cyrene Android] 已应用 Gradle 9 / Foojay 兼容补丁");
        }
      } catch (error) {
        fail(error instanceof Error ? error.message : String(error));
        process.exit(1);
      }

      const pathEntries = [
        javaHome ? join(javaHome, "bin") : null,
        join(sdkRoot, "platform-tools"),
        join(sdkRoot, "emulator"),
        process.env.PATH,
      ].filter(Boolean).join(delimiter);
      const environment = {
        ...process.env,
        ANDROID_HOME: sdkRoot,
        // Expo and some third-party Gradle tooling still read this legacy name.
        ANDROID_SDK_ROOT: sdkRoot,
        // USB-connected Android devices reach Metro through adb reverse. Pinning
        // localhost prevents Expo from advertising a VPN/TUN interface address.
        REACT_NATIVE_PACKAGER_HOSTNAME:
          process.env.REACT_NATIVE_PACKAGER_HOSTNAME ?? "127.0.0.1",
        ...(javaHome ? { JAVA_HOME: javaHome } : {}),
        PATH: pathEntries,
      };
      const npx = process.platform === "win32" ? "npx.cmd" : "npx";
      const child = spawn(npx, ["--no-install", "expo", "run:android", ...forwardedArgs], {
        cwd: process.cwd(),
        env: environment,
        stdio: "inherit",
      });
      child.on("error", (error) => {
        console.error("[Cyrene Android] 无法启动 Expo：", error.message);
        process.exitCode = 1;
      });
      child.on("exit", (code, signal) => {
        process.exitCode = code ?? (signal ? 1 : 0);
      });
    }
  }
}
