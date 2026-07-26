import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDefaultCharacterRuntime } from "./character-runtime";

const LUMEN_ID = "fixture.lumen";
const fixtureRoot = path.join(process.cwd(), "test-fixtures", "characters", "lumen");

function copyFixtureWithVersion(
  destinationRoot: string,
  version: string,
  identitySuffix = "",
): string {
  fs.cpSync(fixtureRoot, destinationRoot, { recursive: true });
  const manifestPath = path.join(destinationRoot, "character.json");
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  manifest.version = version;
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
  if (identitySuffix) {
    fs.appendFileSync(path.join(destinationRoot, "content", "identity.md"), `\n${identitySuffix}\n`);
  }
  return destinationRoot;
}

describe("Character Package lifecycle", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("uninstalls package resources, archives private state, and restores it on reinstall", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-uninstall-restore-"));
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    const imported = await runtime.importPackage(fixtureRoot);
    expect(imported.ok).toBe(true);

    const stateRoot = path.join(userDataRoot, "characters", LUMEN_ID);
    fs.mkdirSync(path.join(stateRoot, "memory"), { recursive: true });
    fs.writeFileSync(path.join(stateRoot, "memory", "memory.json"), '{"relationship":"kept"}\n');

    await expect(runtime.uninstallPackage(LUMEN_ID)).resolves.toMatchObject({
      ok: true,
      characterId: LUMEN_ID,
      state: "archived",
    });

    expect(fs.existsSync(path.join(userDataRoot, "character-packages", "installed", LUMEN_ID))).toBe(false);
    expect(fs.existsSync(stateRoot)).toBe(false);
    expect(fs.readFileSync(
      path.join(userDataRoot, "archived-character-states", LUMEN_ID, "state", "memory", "memory.json"),
      "utf8",
    )).toContain('"relationship":"kept"');
    expect(runtime.getSnapshot().packages.some(({ id }) => id === LUMEN_ID)).toBe(false);

    const reinstalled = await runtime.importPackage(fixtureRoot);
    expect(reinstalled.ok).toBe(true);
    expect(fs.readFileSync(path.join(stateRoot, "memory", "memory.json"), "utf8")).toContain('"relationship":"kept"');
    expect(fs.existsSync(path.join(userDataRoot, "archived-character-states", LUMEN_ID))).toBe(false);
  });

  it("refuses to uninstall the built-in or current Active Character", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-uninstall-protected-"));
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    await runtime.importPackage(fixtureRoot);

    await expect(runtime.uninstallPackage("cyrene")).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.uninstall.builtin_forbidden" }],
    });

    const switchingRuntime = createDefaultCharacterRuntime({
      appRoot: process.cwd(),
      userDataRoot,
      switchAdapters: {
        getBlockingActivities: () => [],
        persistActiveState: () => undefined,
        shutdownActiveResources: () => undefined,
        requestRelaunch: () => undefined,
      },
    });
    await switchingRuntime.initialize();
    await switchingRuntime.requestSwitch(LUMEN_ID);
    const restarted = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await restarted.initialize();

    await expect(restarted.uninstallPackage(LUMEN_ID)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.uninstall.active_forbidden" }],
    });
    expect(fs.existsSync(path.join(userDataRoot, "character-packages", "installed", LUMEN_ID))).toBe(true);
  });

  it("requires confirmation, backs up the old package, and preserves private state for an upgrade", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-upgrade-"));
    const upgradeRoot = copyFixtureWithVersion(
      path.join(userDataRoot, "incoming-lumen-1.1.0"),
      "1.1.0",
      "升级后的角色内容",
    );
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    await runtime.importPackage(fixtureRoot);
    const stateFile = path.join(userDataRoot, "characters", LUMEN_ID, "memory", "memory.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, '{"relationship":"preserved"}\n');

    const plan = await runtime.importPackage(upgradeRoot);
    expect(plan).toMatchObject({
      ok: false,
      status: "confirmation-required",
      replacement: {
        kind: "upgrade",
        characterId: LUMEN_ID,
        currentVersion: "1.0.0",
        targetVersion: "1.1.0",
      },
    });
    expect(runtime.getSnapshot().packages.find(({ id }) => id === LUMEN_ID)?.version).toBe("1.0.0");

    const upgraded = await runtime.importPackage(upgradeRoot, { confirmReplacement: true });
    expect(upgraded).toMatchObject({
      ok: true,
      package: { id: LUMEN_ID, version: "1.1.0" },
    });
    expect(fs.readFileSync(stateFile, "utf8")).toContain('"relationship":"preserved"');
    const backupsRoot = path.join(userDataRoot, "character-packages", "backups", LUMEN_ID);
    const backupDirectories = fs.readdirSync(backupsRoot);
    expect(backupDirectories).toHaveLength(1);
    expect(JSON.parse(fs.readFileSync(
      path.join(backupsRoot, backupDirectories[0], "character.json"),
      "utf8",
    )).version).toBe("1.0.0");
  });

  it("requires explicit confirmation for same-version digest changes and rejects downgrades", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-version-policy-"));
    const modifiedRoot = copyFixtureWithVersion(
      path.join(userDataRoot, "incoming-lumen-modified"),
      "1.0.0",
      "相同版本但内容变化",
    );
    const downgradeRoot = copyFixtureWithVersion(
      path.join(userDataRoot, "incoming-lumen-downgrade"),
      "0.9.0",
    );
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    await runtime.importPackage(fixtureRoot);

    await expect(runtime.importPackage(modifiedRoot)).resolves.toMatchObject({
      ok: false,
      status: "confirmation-required",
      replacement: {
        kind: "modified",
        currentVersion: "1.0.0",
        targetVersion: "1.0.0",
      },
    });
    await expect(runtime.importPackage(downgradeRoot, { confirmReplacement: true })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.import.downgrade_forbidden" }],
    });
    expect(runtime.getSnapshot().packages.find(({ id }) => id === LUMEN_ID)?.version).toBe("1.0.0");
  });

  it("leaves the installed package and private state untouched when an upgrade fails validation", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-upgrade-failure-"));
    const invalidUpgradeRoot = copyFixtureWithVersion(
      path.join(userDataRoot, "incoming-lumen-invalid"),
      "1.1.0",
    );
    fs.rmSync(path.join(invalidUpgradeRoot, "content", "soul.md"));
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    const installed = await runtime.importPackage(fixtureRoot);
    if (!installed.ok) throw new Error("fixture import failed");
    const originalDigest = installed.package.digest;
    const stateFile = path.join(userDataRoot, "characters", LUMEN_ID, "memory", "memory.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, '{"relationship":"untouched"}\n');

    await expect(runtime.importPackage(invalidUpgradeRoot, { confirmReplacement: true })).resolves.toMatchObject({
      ok: false,
      diagnostics: [expect.objectContaining({ code: "character.core_resource.missing" })],
    });
    expect(runtime.getSnapshot().packages.find(({ id }) => id === LUMEN_ID)).toMatchObject({
      version: "1.0.0",
      digest: originalDigest,
    });
    expect(fs.readFileSync(stateFile, "utf8")).toContain('"relationship":"untouched"');
  });

  it("requires switching away before replacing the Active Character package", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-active-upgrade-"));
    const upgradeRoot = copyFixtureWithVersion(
      path.join(userDataRoot, "incoming-active-lumen"),
      "1.1.0",
    );
    const adapters = {
      getBlockingActivities: () => [],
      persistActiveState: () => undefined,
      shutdownActiveResources: () => undefined,
      requestRelaunch: () => undefined,
    };
    const runtime = createDefaultCharacterRuntime({
      appRoot: process.cwd(),
      userDataRoot,
      switchAdapters: adapters,
    });
    await runtime.initialize();
    await runtime.importPackage(fixtureRoot);
    await runtime.requestSwitch(LUMEN_ID);
    const restarted = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await restarted.initialize();

    await expect(restarted.importPackage(upgradeRoot, { confirmReplacement: true })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.import.active_replacement_forbidden" }],
    });
    expect(restarted.getSnapshot().activeCharacter?.version).toBe("1.0.0");
  });

  it("enumerates archived data and requires the exact Character ID for permanent deletion", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-permanent-delete-"));
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    await runtime.importPackage(fixtureRoot);
    const stateFile = path.join(userDataRoot, "characters", LUMEN_ID, "memory", "memory.json");
    fs.mkdirSync(path.dirname(stateFile), { recursive: true });
    fs.writeFileSync(stateFile, '{"secret":"must-confirm"}\n');
    await runtime.uninstallPackage(LUMEN_ID);

    expect(await runtime.listArchivedCharacterStates()).toEqual([
      expect.objectContaining({
        characterId: LUMEN_ID,
        displayName: "流明",
        packageVersion: "1.0.0",
        fileCount: 1,
        totalBytes: Buffer.byteLength('{"secret":"must-confirm"}\n'),
      }),
    ]);
    await expect(runtime.permanentlyDeleteArchivedState(LUMEN_ID, "流明")).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.archive.confirmation_mismatch" }],
    });
    expect(fs.existsSync(path.join(userDataRoot, "archived-character-states", LUMEN_ID))).toBe(true);

    await expect(runtime.permanentlyDeleteArchivedState(LUMEN_ID, LUMEN_ID)).resolves.toEqual({
      ok: true,
      characterId: LUMEN_ID,
      deletedFiles: 1,
      deletedBytes: Buffer.byteLength('{"secret":"must-confirm"}\n'),
    });
    expect(fs.existsSync(path.join(userDataRoot, "archived-character-states", LUMEN_ID))).toBe(false);
  });

  it("rejects invalid Character IDs before resolving lifecycle storage paths", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-invalid-id-"));
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();

    await expect(runtime.uninstallPackage("../escape")).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.id.invalid" }],
    });
    await expect(runtime.uninstallPackage("fixture..escape")).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.id.invalid" }],
    });
    await expect(runtime.permanentlyDeleteArchivedState("../escape", "../escape")).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.id.invalid" }],
    });
    expect(fs.existsSync(path.join(userDataRoot, "escape"))).toBe(false);
  });

  it("restores the package registry and runtime snapshot when uninstall cleanup fails", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-uninstall-rollback-"));
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    const imported = await runtime.importPackage(fixtureRoot);
    if (!imported.ok) throw new Error("fixture import failed");
    const originalDigest = imported.package.digest;
    const originalRm = fs.promises.rm.bind(fs.promises);
    let injectedFailure = false;
    vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => {
      if (!injectedFailure && String(target).includes(".removing-")) {
        injectedFailure = true;
        throw new Error("injected removal failure");
      }
      return originalRm(target, options);
    });

    await expect(runtime.uninstallPackage(LUMEN_ID)).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.uninstall.failed" }],
    });

    const restarted = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await restarted.initialize();
    expect(restarted.getSnapshot().packages.find(({ id }) => id === LUMEN_ID)).toMatchObject({
      version: "1.0.0",
      digest: originalDigest,
    });
  });

  it("restores the old package and registry when upgrade cleanup fails after activation", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-upgrade-rollback-"));
    const upgradeRoot = copyFixtureWithVersion(
      path.join(userDataRoot, "incoming-lumen-1.1.0"),
      "1.1.0",
      "会触发清理失败的升级内容",
    );
    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await runtime.initialize();
    const imported = await runtime.importPackage(fixtureRoot);
    if (!imported.ok) throw new Error("fixture import failed");
    const originalDigest = imported.package.digest;
    const originalRm = fs.promises.rm.bind(fs.promises);
    let injectedFailure = false;
    vi.spyOn(fs.promises, "rm").mockImplementation(async (target, options) => {
      if (!injectedFailure && String(target).includes(".rollback-")) {
        injectedFailure = true;
        throw new Error("injected rollback cleanup failure");
      }
      return originalRm(target, options);
    });

    await expect(runtime.importPackage(upgradeRoot, { confirmReplacement: true })).resolves.toMatchObject({
      ok: false,
      diagnostics: [{ code: "character.import.failed" }],
    });

    const restarted = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    await restarted.initialize();
    expect(restarted.getSnapshot().packages.find(({ id }) => id === LUMEN_ID)).toMatchObject({
      version: "1.0.0",
      digest: originalDigest,
    });
  });
});
