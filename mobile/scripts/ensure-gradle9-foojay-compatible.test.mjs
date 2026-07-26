import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { ensureGradle9FoojayCompatibility } from "./ensure-gradle9-foojay-compatible.mjs";

const oldPluginDeclaration =
  'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("0.5.0") }';
const compatiblePluginDeclaration =
  'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("1.0.0") }';

async function withSettingsFile(contents, run) {
  const directory = await mkdtemp(join(tmpdir(), "cyrene-foojay-test-"));
  const settingsPath = join(directory, "settings.gradle.kts");
  await writeFile(settingsPath, contents, "utf8");

  try {
    await run(settingsPath);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

test("upgrades Foojay 0.5.0 for Gradle 9 compatibility", async () => {
  await withSettingsFile(oldPluginDeclaration, async (settingsPath) => {
    const result = await ensureGradle9FoojayCompatibility(settingsPath);

    assert.equal(result.changed, true);
    assert.equal(await readFile(settingsPath, "utf8"), compatiblePluginDeclaration);
  });
});

test("is idempotent after the compatibility patch is present", async () => {
  await withSettingsFile(compatiblePluginDeclaration, async (settingsPath) => {
    const result = await ensureGradle9FoojayCompatibility(settingsPath);

    assert.equal(result.changed, false);
    assert.equal(await readFile(settingsPath, "utf8"), compatiblePluginDeclaration);
  });
});

test("fails safely when React Native changes the declaration", async () => {
  await withSettingsFile(
    'plugins { id("org.gradle.toolchains.foojay-resolver-convention").version("2.0.0") }',
    async (settingsPath) => {
      await assert.rejects(
        ensureGradle9FoojayCompatibility(settingsPath),
        /无法识别 React Native 的 Foojay 配置/,
      );
    },
  );
});
