export type CharacterPresentationIdentity = Readonly<{
  displayName: string;
  visual:
    | Readonly<{ kind: "live2d"; modelUrl: string }>
    | Readonly<{ kind: "static"; avatarUrl: string }>;
}>;

export type CharacterPresentationSurfaces = Readonly<{
  canvas: { style: { visibility: string } };
  avatar: { src: string; alt: string; hidden: boolean };
}>;

export type AppliedCharacterPresentation =
  | Readonly<{ kind: "live2d"; modelUrl: string }>
  | Readonly<{ kind: "static" }>;

/** Atomically removes the old visual surface before exposing the active one. */
export function applyCharacterPresentation(
  identity: CharacterPresentationIdentity,
  surfaces: CharacterPresentationSurfaces,
): AppliedCharacterPresentation {
  if (identity.visual.kind === "static") {
    surfaces.avatar.src = identity.visual.avatarUrl;
    surfaces.avatar.alt = identity.displayName;
    surfaces.avatar.hidden = false;
    surfaces.canvas.style.visibility = "hidden";
    return Object.freeze({ kind: "static" });
  }

  surfaces.avatar.hidden = true;
  surfaces.avatar.src = "";
  surfaces.avatar.alt = "";
  surfaces.canvas.style.visibility = "visible";
  return Object.freeze({ kind: "live2d", modelUrl: identity.visual.modelUrl });
}
