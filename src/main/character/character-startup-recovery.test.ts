import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  createCharacterRuntime,
  createDefaultCharacterRuntime,
  type CharacterPackageManifest,
} from "./character-runtime";

const LUMEN_ID = "fixture.lumen";
const fixtureRoot = path.join(process.cwd(), "test-fixtures", "characters", "lumen");

function writeRuntimeState(
  userDataRoot: string,
  state: Record<string, unknown>,
): void {
  const statePath = path.join(userDataRoot, "character-packages", "runtime-state.json");
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, `${JSON.stringify({ schemaVersion: 1, ...state }, null, 2)}\n`);
}

async function installLumen(userDataRoot: string): Promise<void> {
  const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
  await runtime.initialize();
  const result = await runtime.importPackage(fixtureRoot);
  if (!result.ok) throw new Error("fixture import failed");
}

describe("Character startup recovery", () => {
  it("falls back to built-in Cyrene when the persisted Active Character becomes unhealthy", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-startup-unhealthy-"));
    await installLumen(userDataRoot);
    writeRuntimeState(userDataRoot, { activeCharacterId: LUMEN_ID });
    const secretPath = path.join(userDataRoot, "characters", LUMEN_ID, "memory", "secret.txt");
    fs.mkdirSync(path.dirname(secretPath), { recursive: true });
    fs.writeFileSync(secretPath, "只属于流明");
    fs.rmSync(path.join(
      userDataRoot,
      "character-packages",
      "installed",
      LUMEN_ID,
      "content",
      "soul.md",
    ));

    const snapshot = await createDefaultCharacterRuntime({
      appRoot: process.cwd(),
      userDataRoot,
    }).initialize();

    expect(snapshot).toMatchObject({
      status: "ready",
      activeCharacter: { id: "cyrene" },
    });
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "character.startup.active_unhealthy",
        characterId: LUMEN_ID,
      }),
      expect.objectContaining({
        code: "character.startup.fallback_activated",
        characterId: "cyrene",
      }),
    ]));
    expect(fs.readFileSync(secretPath, "utf8")).toBe("只属于流明");
    expect(JSON.parse(fs.readFileSync(
      path.join(userDataRoot, "character-packages", "runtime-state.json"),
      "utf8",
    ))).toEqual({ schemaVersion: 1, activeCharacterId: "cyrene" });
  });

  it("reports a missing registered package, falls back, and allows reinstalling the same Character ID", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-startup-missing-"));
    await installLumen(userDataRoot);
    writeRuntimeState(userDataRoot, { activeCharacterId: LUMEN_ID });
    fs.rmSync(path.join(userDataRoot, "character-packages", "installed", LUMEN_ID), {
      recursive: true,
      force: true,
    });

    const runtime = createDefaultCharacterRuntime({ appRoot: process.cwd(), userDataRoot });
    const snapshot = await runtime.initialize();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.activeCharacter?.id).toBe("cyrene");
    expect(snapshot.packages).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: LUMEN_ID,
        health: {
          status: "unhealthy",
          diagnostics: expect.arrayContaining([
            expect.objectContaining({ code: "character.package.missing" }),
          ]),
        },
      }),
    ]));

    const repaired = await runtime.importPackage(fixtureRoot, { confirmReplacement: true });
    expect(repaired).toMatchObject({
      ok: true,
      operation: "repaired",
      package: { id: LUMEN_ID, health: { status: "healthy" } },
    });
    expect(fs.existsSync(path.join(
      userDataRoot,
      "character-packages",
      "installed",
      LUMEN_ID,
      "content",
      "soul.md",
    ))).toBe(true);
  });

  it("falls back to Cyrene when both a pending target and its previous character are unavailable", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-startup-pending-fallback-"));
    await installLumen(userDataRoot);
    writeRuntimeState(userDataRoot, {
      activeCharacterId: "fixture.missing-previous",
      previousCharacterId: "fixture.missing-previous",
      pendingCharacterId: LUMEN_ID,
    });
    fs.rmSync(path.join(
      userDataRoot,
      "character-packages",
      "installed",
      LUMEN_ID,
      "content",
      "soul.md",
    ));

    const snapshot = await createDefaultCharacterRuntime({
      appRoot: process.cwd(),
      userDataRoot,
    }).initialize();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.activeCharacter?.id).toBe("cyrene");
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: "character.switch.target_startup_failed", characterId: LUMEN_ID }),
      expect.objectContaining({ code: "character.startup.previous_unavailable" }),
      expect.objectContaining({ code: "character.startup.fallback_activated", characterId: "cyrene" }),
    ]));
    expect(JSON.parse(fs.readFileSync(
      path.join(userDataRoot, "character-packages", "runtime-state.json"),
      "utf8",
    ))).toEqual({ schemaVersion: 1, activeCharacterId: "cyrene" });
  });

  it("enters diagnostic safe mode when the built-in recovery package is unhealthy", async () => {
    const packageRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-safe-mode-builtin-"));
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-safe-mode-data-"));
    fs.mkdirSync(path.join(packageRoot, "content"), { recursive: true });
    fs.writeFileSync(path.join(packageRoot, "content", "identity.md"), "# Identity\n");
    fs.writeFileSync(path.join(packageRoot, "avatar.svg"), "<svg xmlns=\"http://www.w3.org/2000/svg\"/>");
    const manifest: CharacterPackageManifest = {
      schemaVersion: 1,
      id: "cyrene",
      version: "1.0.0",
      displayName: "昔涟",
      distributionStatus: "redistributable",
      compatibility: { minimumAppVersion: "0.1.0" },
      assetProvenance: [{
        assetClass: "character-content",
        source: "test",
        license: "MIT",
        distributionStatus: "redistributable",
      }],
      content: {
        identity: "content/identity.md",
        soul: "content/soul.md",
        avatar: "avatar.svg",
      },
    };

    const snapshot = await createCharacterRuntime({
      userDataRoot,
      activeCharacterId: "cyrene",
      packages: [{ source: "builtin", rootPath: packageRoot, manifest }],
    }).initialize();

    expect(snapshot.status).toBe("safe-mode");
    expect(snapshot.activeCharacter).toBeNull();
    expect(snapshot.diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        code: "character.startup.safe_mode",
        characterId: "cyrene",
      }),
    ]));
  });

  it("keeps Cyrene available and reports a corrupt Character Registry as a startup diagnostic", async () => {
    const userDataRoot = fs.mkdtempSync(path.join(os.tmpdir(), "character-corrupt-registry-"));
    const registryPath = path.join(userDataRoot, "character-packages", "registry.json");
    fs.mkdirSync(path.dirname(registryPath), { recursive: true });
    fs.writeFileSync(registryPath, "{not-json");

    const snapshot = await createDefaultCharacterRuntime({
      appRoot: process.cwd(),
      userDataRoot,
    }).initialize();

    expect(snapshot.status).toBe("ready");
    expect(snapshot.activeCharacter?.id).toBe("cyrene");
    expect(snapshot.diagnostics).toContainEqual(expect.objectContaining({
      code: "character.registry.unreadable",
      resourcePath: registryPath,
    }));
  });
});
