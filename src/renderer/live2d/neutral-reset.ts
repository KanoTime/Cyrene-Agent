export interface NeutralResetOptions {
  intervalMs?: number;
}

/** Periodically invokes the active character's resolved neutral Semantic Action. */
export class NeutralResetController {
  private readonly reset: () => Promise<void>;
  private readonly intervalMs: number;
  private timer: number | null = null;
  private disposed = false;

  constructor(reset: () => Promise<void>, options: NeutralResetOptions = {}) {
    this.reset = reset;
    this.intervalMs = options.intervalMs ?? 3 * 60 * 1000;
    this.start();
  }

  restart(): void {
    if (this.disposed) return;
    this.stop();
    this.start();
  }

  async resetNow(): Promise<boolean> {
    if (this.disposed) return false;
    try {
      await this.reset();
      return true;
    } catch (error) {
      console.warn("[CharacterVisual] neutral reset failed", error);
      return false;
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    this.stop();
  }

  private start(): void {
    if (this.timer !== null) return;
    this.timer = window.setInterval(() => { void this.resetNow(); }, this.intervalMs);
  }

  private stop(): void {
    if (this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }
}
