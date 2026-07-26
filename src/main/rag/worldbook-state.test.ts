import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { WorldbookEntry, WorldbookManager } from "./worldbook";

const tempRoots: string[] = [];

function makeTempRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "cyrene-worldbook-state-"));
  tempRoots.push(root);
  return root;
}

function makeEntry(id = "private-place"): WorldbookEntry {
  return {
    id,
    keywords: ["蓝色月桂"],
    content: "只属于当前角色的秘密地点",
    priority: 10,
    permanent: false,
    enabled: true,
    intrinsicValue: 40,
    linkTriggers: [],
  };
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

describe("WorldbookManager state persistence", () => {
  it("restores activation for the same character and isolates a different state file", () => {
    const root = makeTempRoot();
    const cyreneState = path.join(root, "cyrene", "worldbook-state.json");
    const lumenState = path.join(root, "lumen", "worldbook-state.json");
    const entry = makeEntry();

    const cyrene = new WorldbookManager("unused", { stateFile: cyreneState, debug: false });
    cyrene.loadFromEntries([entry]);
    cyrene.updateActivation("蓝色月桂", "");
    expect(cyrene.getState(entry.id)?.activation).toBeGreaterThan(0);
    expect(fs.existsSync(cyreneState)).toBe(true);

    const restored = new WorldbookManager("unused", { stateFile: cyreneState, debug: false });
    restored.loadFromEntries([entry]);
    expect(restored.getState(entry.id)).toEqual(cyrene.getState(entry.id));

    const isolated = new WorldbookManager("unused", { stateFile: lumenState, debug: false });
    isolated.loadFromEntries([entry]);
    expect(isolated.getState(entry.id)).toEqual({ activation: 0, userSilence: 0, modelSilence: 0 });
  });

  it("ignores corrupt, unknown, and invalid persisted state without poisoning runtime state", () => {
    const root = makeTempRoot();
    const stateFile = path.join(root, "worldbook-state.json");
    const entry = makeEntry();

    fs.writeFileSync(stateFile, "not-json", "utf8");
    const corrupt = new WorldbookManager("unused", { stateFile, debug: false });
    corrupt.loadFromEntries([entry]);
    expect(corrupt.getState(entry.id)).toEqual({ activation: 0, userSilence: 0, modelSilence: 0 });

    fs.writeFileSync(stateFile, JSON.stringify({
      schemaVersion: 1,
      entries: {
        [entry.id]: { activation: 999, userSilence: -3, modelSilence: 2.8 },
        unknown: { activation: 80, userSilence: 1, modelSilence: 1 },
      },
    }), "utf8");
    const sanitized = new WorldbookManager("unused", { stateFile, debug: false });
    sanitized.loadFromEntries([entry]);
    expect(sanitized.getState(entry.id)).toEqual({ activation: 100, userSilence: 0, modelSilence: 2 });
    expect(sanitized.getState("unknown")).toBeUndefined();
  });
});
