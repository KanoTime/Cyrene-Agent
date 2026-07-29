export type MobileAudioOutput =
  | "bluetooth"
  | "headset"
  | "speaker"
  | "earpiece";

const DEFAULT_OUTPUT_ORDER: MobileAudioOutput[] = [
  "bluetooth",
  "headset",
  "speaker",
  "earpiece",
];

export function inferPreferredAudioOutput(
  outputs: string[],
): MobileAudioOutput | null {
  return DEFAULT_OUTPUT_ORDER.find((output) => outputs.includes(output)) ?? null;
}

export function nextAudioOutput(
  current: MobileAudioOutput | null,
  outputs: string[],
): MobileAudioOutput | null {
  const available = DEFAULT_OUTPUT_ORDER.filter((output) => outputs.includes(output));
  if (available.length === 0) return null;
  if (current === "bluetooth" && available.includes("speaker")) return "speaker";
  if (current === "speaker" && available.includes("bluetooth")) return "bluetooth";
  const currentIndex = current ? available.indexOf(current) : -1;
  return available[(currentIndex + 1) % available.length] ?? available[0];
}
