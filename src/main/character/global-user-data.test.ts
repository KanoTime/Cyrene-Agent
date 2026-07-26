import path from "path";
import { describe, expect, it } from "vitest";
import { resolveCharacterStateLayout } from "./character-state";
import { resolveGlobalUserDataLayout } from "./global-user-data";

describe("Global User Data", () => {
  it("keeps explicit profile, documents and tasks independent from the active Character ID", () => {
    const userDataRoot = "/tmp/cyrene-user-data";
    const global = resolveGlobalUserDataLayout(userDataRoot);
    const cyrene = resolveCharacterStateLayout(userDataRoot, "cyrene");
    const lumen = resolveCharacterStateLayout(userDataRoot, "fixture.lumen");

    expect(global).toEqual(resolveGlobalUserDataLayout(userDataRoot));
    expect(global.profileFile).toBe(path.join(userDataRoot, "user-profile.json"));
    expect(global.documentRagRoot).toBe(path.join(userDataRoot, "global", "documents", "rag"));
    expect(global.todoFile).toBe(path.join(userDataRoot, "current-todos.json"));
    expect(global.scheduledTasksFile).toBe(path.join(userDataRoot, "scheduled-tasks.json"));
    for (const ownedPath of Object.values(global).filter((value) => value !== userDataRoot)) {
      expect(ownedPath.startsWith(cyrene.root)).toBe(false);
      expect(ownedPath.startsWith(lumen.root)).toBe(false);
    }
  });
});
