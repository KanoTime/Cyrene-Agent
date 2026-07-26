import fs from "fs";
import path from "path";
import {
  collectLive2dResourcePaths,
  LIVE2D_RESOURCE_KEYS,
  type ActiveCharacterContext,
} from "./character-runtime";

export type CharacterResourceResolution =
  | Readonly<{ ok: true; filePath: string }>
  | Readonly<{ ok: false; status: 403 | 404 }>;

function isPathInside(rootPath: string, candidatePath: string): boolean {
  const relative = path.relative(path.resolve(rootPath), path.resolve(candidatePath));
  return relative === "" || (!relative.startsWith(`..${path.sep}`) && relative !== "..");
}

function encodeResourceReference(reference: string): string {
  return reference.split("/").map(encodeURIComponent).join("/");
}

function encodeLive2dReferences(value: unknown, parentKey?: string): unknown {
  if (typeof value === "string") {
    return parentKey && LIVE2D_RESOURCE_KEYS.has(parentKey)
      ? encodeResourceReference(value)
      : value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => encodeLive2dReferences(item, parentKey));
  }
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value as Record<string, unknown>)
      .map(([key, item]) => [key, encodeLive2dReferences(item, key)]));
  }
  return value;
}

/** Returns model metadata whose relative resource URLs survive standard URL parsing. */
export function prepareLive2dModelJsonForProtocol(source: string): string {
  const model = JSON.parse(source) as Record<string, unknown>;
  return JSON.stringify({
    ...model,
    FileReferences: encodeLive2dReferences(model.FileReferences),
  });
}

export function resolveCharacterResourceRequest(
  active: ActiveCharacterContext,
  rawUrl: string,
): CharacterResourceResolution {
  let requestUrl: URL;
  try {
    requestUrl = new URL(rawUrl);
  } catch {
    return { ok: false, status: 404 };
  }
  if (requestUrl.hostname !== active.id) return { ok: false, status: 403 };
  if (requestUrl.pathname === "/avatar") {
    return { ok: true, filePath: active.content.avatarPath };
  }
  const prefix = "/live2d/";
  if (!requestUrl.pathname.startsWith(prefix) || active.capabilities.live2d.status !== "available") {
    return { ok: false, status: 404 };
  }
  let relativePath: string;
  try {
    relativePath = decodeURIComponent(requestUrl.pathname.slice(prefix.length));
  } catch {
    return { ok: false, status: 404 };
  }
  if (!relativePath || relativePath.includes("\0") || path.isAbsolute(relativePath)) {
    return { ok: false, status: 404 };
  }
  const filePath = path.resolve(active.packageRoot, relativePath);
  if (!isPathInside(active.packageRoot, filePath)) return { ok: false, status: 403 };
  const modelPath = active.capabilities.live2d.modelPath;
  if (filePath !== modelPath) {
    let declaredResources: Set<string>;
    try {
      const model = JSON.parse(fs.readFileSync(modelPath, "utf8")) as Record<string, unknown>;
      declaredResources = new Set(collectLive2dResourcePaths(model.FileReferences)
        .map((resource) => path.resolve(path.dirname(modelPath), resource)));
    } catch {
      return { ok: false, status: 404 };
    }
    if (!declaredResources.has(filePath)) return { ok: false, status: 403 };
  }
  return { ok: true, filePath };
}
