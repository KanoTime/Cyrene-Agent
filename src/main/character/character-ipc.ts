import type { CharacterRuntime } from "./character-runtime";

function requireCharacterId(characterId: unknown): string {
  if (
    typeof characterId !== "string"
    || characterId.length > 64
    || !/^[a-z0-9]+(?:[._-][a-z0-9]+)*$/.test(characterId)
  ) {
    throw new Error("角色 ID 格式无效");
  }
  return characterId;
}

export function getCharacterSettingsSnapshot(
  runtime: Pick<CharacterRuntime, "getSnapshot" | "getBlockingActivities">,
) {
  return {
    ...runtime.getSnapshot(),
    switching: {
      blockingActivities: runtime.getBlockingActivities(),
    },
  };
}

export function requestCharacterSwitch(
  runtime: Pick<CharacterRuntime, "requestSwitch">,
  characterId: unknown,
) {
  return runtime.requestSwitch(requireCharacterId(characterId));
}

export function requestCoordinatedCharacterSwitch(
  runtime: Pick<CharacterRuntime, "requestSwitch">,
  characterId: unknown,
  coordinate: (
    operation: () => ReturnType<CharacterRuntime["requestSwitch"]>,
  ) => ReturnType<CharacterRuntime["requestSwitch"]>,
) {
  const validCharacterId = requireCharacterId(characterId);
  return coordinate(() => runtime.requestSwitch(validCharacterId));
}

export function uninstallCharacterPackage(
  runtime: Pick<CharacterRuntime, "uninstallPackage">,
  characterId: unknown,
) {
  return runtime.uninstallPackage(requireCharacterId(characterId));
}

export function listArchivedCharacterStates(
  runtime: Pick<CharacterRuntime, "listArchivedCharacterStates">,
) {
  return runtime.listArchivedCharacterStates();
}

export function deleteArchivedCharacterState(
  runtime: Pick<CharacterRuntime, "permanentlyDeleteArchivedState">,
  characterId: unknown,
  confirmationCharacterId: unknown,
) {
  const validCharacterId = requireCharacterId(characterId);
  if (typeof confirmationCharacterId !== "string") {
    throw new Error("永久删除确认格式无效");
  }
  return runtime.permanentlyDeleteArchivedState(validCharacterId, confirmationCharacterId);
}
