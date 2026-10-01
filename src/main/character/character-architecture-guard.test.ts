import fs from "fs";
import path from "path";
import { describe, expect, it } from "vitest";

const MAIN_ROOT = path.resolve(__dirname, "..");
const REPOSITORY_ROOT = path.resolve(MAIN_ROOT, "..", "..");

function productionTypeScriptFiles(root = MAIN_ROOT): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return productionTypeScriptFiles(absolute);
    if (!entry.isFile() || !entry.name.endsWith(".ts") || entry.name.endsWith(".test.ts")) return [];
    return [absolute];
  });
}

function relative(file: string): string {
  return path.relative(REPOSITORY_ROOT, file);
}

function filesNamed(root: string, targetName: string): string[] {
  return fs.readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    if ([".git", "node_modules", "dist", "release"].includes(entry.name)) return [];
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) return filesNamed(absolute, targetName);
    return entry.isFile() && entry.name === targetName ? [absolute] : [];
  });
}

describe("Character architecture guard", () => {
  it("does not keep backup source files in the production tree", () => {
    const backups = [...new Set(productionTypeScriptFiles()
      .map((file) => path.dirname(file)))]
      .flatMap((directory) => fs.readdirSync(directory)
        .filter((name) => name.endsWith(".bak"))
        .map((name) => path.join(directory, name)));

    expect(backups.map(relative)).toEqual([]);
  });

  it("does not fall back from active character state to legacy global paths", () => {
    const violations = productionTypeScriptFiles()
      .filter((file) => !file.endsWith(path.join("character", "character-state.ts")))
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        return source.includes("getActiveCharacterState")
          ? [relative(file)]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it("does not read built-in character text resources outside package declarations", () => {
    const violations = productionTypeScriptFiles()
      .filter((file) => ![
        path.join("character", "active-character.ts"),
        path.join("character", "character-runtime.ts"),
      ].some((allowed) => file.endsWith(allowed)))
      .flatMap((file) => {
        const source = fs.readFileSync(file, "utf8");
        return [
          "skills/cyrene-original-voice",
          '"prompts", "worldbook"',
          "peekActiveCharacterText()",
        ].some((literal) => source.includes(literal))
          ? [relative(file)]
          : [];
      });

    expect(violations).toEqual([]);
  });

  it("keeps character integration seams free of a fixed display name", () => {
    const seams = [
      "application/default-dependencies.ts", "call/mobile-call-manager.ts", "channels/bootstrap.ts",
      "orchestrator/mode-prompt-profile.ts", "orchestrator/tone-injector.ts",
    ];
    for (const file of seams) expect(fs.readFileSync(path.join(MAIN_ROOT, file), "utf8")).not.toContain("昔涟");
  });

  it("renders the pet from the active character presentation", () => {
    const source = fs.readFileSync(path.join(REPOSITORY_ROOT, "src/renderer/main.ts"), "utf8");
    expect(source).toContain("window.character?.getActive()");
    expect(source).toContain("applyCharacterPresentation(identity");
    expect(source).not.toContain("昔涟");
  });

  it("does not commit local-only character packages", () => {
    const violations = filesNamed(REPOSITORY_ROOT, "character.json")
      .filter((file) => {
        const manifest = JSON.parse(fs.readFileSync(file, "utf8")) as { distributionStatus?: unknown };
        return manifest.distributionStatus === "local-only";
      })
      .map(relative);

    expect(violations).toEqual([]);
  });
});
