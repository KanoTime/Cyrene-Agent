import fs from "fs";
import os from "os";
import path from "path";
import { describe, expect, it } from "vitest";
import type { ActiveCharacterContext } from "./character-runtime";
import {
  prepareLive2dModelJsonForProtocol,
  resolveCharacterResourceRequest,
} from "./character-resource";

const root = fs.mkdtempSync(path.join(os.tmpdir(), "character-resource-"));
fs.mkdirSync(path.join(root, "live2d", "textures"), { recursive: true });
fs.mkdirSync(path.join(root, "shared"), { recursive: true });
fs.writeFileSync(path.join(root, "live2d", "Lumen.model3.json"), JSON.stringify({
  FileReferences: {
    Moc: "model.moc3",
    Textures: ["textures/body 1.png", "../shared/accessory.png"],
  },
}));
const active = {
  id: "fixture.lumen",
  packageRoot: root,
  content: { avatarPath: path.join(root, "avatar.svg") },
  capabilities: {
    live2d: { status: "available", modelPath: path.join(root, "live2d", "Lumen.model3.json") },
  },
} as ActiveCharacterContext;

describe("local character resource resolution", () => {
  it("URL-encodes model resource references without changing model action names", () => {
    const prepared = JSON.parse(prepareLive2dModelJsonForProtocol(JSON.stringify({
      FileReferences: {
        Moc: "model #1.moc3",
        Textures: ["textures/昔涟 01.png"],
        Motions: { "动作#6": [{ Name: "Wink~", File: "motions/动作#6_1.motion3.json" }] },
      },
    }))) as Record<string, any>;

    expect(prepared.FileReferences.Moc).toBe("model%20%231.moc3");
    expect(prepared.FileReferences.Textures[0]).toBe("textures/%E6%98%94%E6%B6%9F%2001.png");
    expect(prepared.FileReferences.Motions["动作#6"][0]).toEqual({
      Name: "Wink~",
      File: "motions/%E5%8A%A8%E4%BD%9C%236_1.motion3.json",
    });
  });

  it("serves only the active character avatar and package-contained Live2D resources", () => {
    expect(resolveCharacterResourceRequest(active, "local-character://fixture.lumen/avatar")).toEqual({
      ok: true,
      filePath: path.join(root, "avatar.svg"),
    });
    expect(resolveCharacterResourceRequest(active, "local-character://fixture.lumen/live2d/live2d/Lumen.model3.json")).toEqual({
      ok: true,
      filePath: path.join(root, "live2d", "Lumen.model3.json"),
    });
    expect(resolveCharacterResourceRequest(active, "local-character://fixture.lumen/live2d/live2d/textures/body%201.png")).toEqual({
      ok: true,
      filePath: path.join(root, "live2d", "textures", "body 1.png"),
    });
    expect(resolveCharacterResourceRequest(active, "local-character://fixture.lumen/live2d/shared/accessory.png")).toEqual({
      ok: true,
      filePath: path.join(root, "shared", "accessory.png"),
    });
  });

  it("rejects another character and traversal-normalized routes", () => {
    expect(resolveCharacterResourceRequest(active, "local-character://cyrene/avatar")).toMatchObject({ ok: false, status: 403 });
    expect(resolveCharacterResourceRequest(active, "local-character://fixture.lumen/live2d/../../secret.txt")).toMatchObject({ ok: false });
    expect(resolveCharacterResourceRequest(active, "local-character://fixture.lumen/identity.md")).toMatchObject({ ok: false, status: 404 });
    expect(resolveCharacterResourceRequest(active, "local-character://fixture.lumen/live2d/content/identity.md"))
      .toMatchObject({ ok: false, status: 403 });
  });

  it("does not expose Live2D routes for a text-only character", () => {
    const textOnly = {
      ...active,
      capabilities: { ...active.capabilities, live2d: { status: "unavailable" } },
    } as ActiveCharacterContext;
    expect(resolveCharacterResourceRequest(textOnly, "local-character://fixture.lumen/live2d/avatar.svg"))
      .toMatchObject({ ok: false, status: 404 });
  });
});
