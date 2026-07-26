export type CharacterBoundActivityKind = "tts" | "state-write";

const activeCounts: Record<CharacterBoundActivityKind, number> = {
  tts: 0,
  "state-write": 0,
};

export function getCharacterBoundActivitySnapshot(): Readonly<{
  tts: boolean;
  stateWrite: boolean;
}> {
  return {
    tts: activeCounts.tts > 0,
    stateWrite: activeCounts["state-write"] > 0,
  };
}

export async function trackCharacterBoundActivity<T>(
  kind: CharacterBoundActivityKind,
  operation: () => T | Promise<T>,
): Promise<T> {
  activeCounts[kind] += 1;
  try {
    return await operation();
  } finally {
    activeCounts[kind] = Math.max(0, activeCounts[kind] - 1);
  }
}
