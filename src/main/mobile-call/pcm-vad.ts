export interface PcmVadOptions {
  threshold: number;
  silenceMs: number;
  clock?: () => number;
}

/**
 * Server-side VAD for a 16-bit PCM stream.
 * It intentionally only reports after real speech has been observed, so an
 * idle mobile microphone never creates empty agent turns.
 */
export class PcmVad {
  private hasSpoken = false;
  private silenceStartedAt: number | null = null;
  private readonly now: () => number;

  constructor(
    private readonly options: PcmVadOptions,
    private readonly onTurnEnd: () => void,
  ) {
    this.now = options.clock ?? (() => Date.now());
  }

  push(frame: Int16Array): void {
    if (frame.length === 0) return;
    const level = calculatePcm16Rms(frame);
    const now = this.now();

    if (level >= this.options.threshold) {
      this.hasSpoken = true;
      this.silenceStartedAt = null;
      return;
    }

    if (!this.hasSpoken) return;
    if (this.silenceStartedAt === null) {
      this.silenceStartedAt = now;
      return;
    }
    if (now - this.silenceStartedAt >= this.options.silenceMs) {
      this.reset();
      this.onTurnEnd();
    }
  }

  reset(): void {
    this.hasSpoken = false;
    this.silenceStartedAt = null;
  }
}

export function calculatePcm16Rms(frame: Int16Array): number {
  if (frame.length === 0) return 0;
  let sumSquares = 0;
  for (const sample of frame) {
    const normalized = sample / 32_768;
    sumSquares += normalized * normalized;
  }
  return Math.sqrt(sumSquares / frame.length);
}
