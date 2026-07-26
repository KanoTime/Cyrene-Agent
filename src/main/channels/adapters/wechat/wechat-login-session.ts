import { randomUUID } from "node:crypto";
import type { Credentials } from "./ilink-protocol-client";

export type WechatLoginSessionState =
  | "idle"
  | "waiting"
  | "confirmed"
  | "cancelled"
  | "expired"
  | "error";

export interface WechatLoginSessionSnapshot {
  sessionId?: string;
  state: WechatLoginSessionState;
  qrDataUrl?: string;
  ilinkBotId?: string;
  error?: string;
}

export interface WechatLoginSessionCoordinatorOptions {
  fetchQrCode(): Promise<{ qrcode: string; imageContent: string }>;
  createQrDataUrl(imageContent: string): Promise<string>;
  waitForLogin(qrcode: string, signal: AbortSignal): Promise<Credentials>;
  saveCredentials?(credentials: Credentials): Promise<unknown>;
  onChanged?(snapshot: WechatLoginSessionSnapshot): void;
}

export class WechatLoginSessionCoordinator {
  readonly #options: WechatLoginSessionCoordinatorOptions;
  #snapshot: WechatLoginSessionSnapshot = { state: "idle" };
  #abort: AbortController | null = null;
  #startPromise: Promise<WechatLoginSessionSnapshot> | null = null;

  constructor(options: WechatLoginSessionCoordinatorOptions) {
    this.#options = options;
  }

  getSnapshot(): WechatLoginSessionSnapshot {
    return { ...this.#snapshot };
  }

  start(): Promise<WechatLoginSessionSnapshot> {
    if (this.#snapshot.state === "waiting") return Promise.resolve(this.getSnapshot());
    if (this.#startPromise) return this.#startPromise;
    const startPromise = this.#beginStart().finally(() => {
      if (this.#startPromise === startPromise) this.#startPromise = null;
    });
    this.#startPromise = startPromise;
    return startPromise;
  }

  async #beginStart(): Promise<WechatLoginSessionSnapshot> {
    const sessionId = randomUUID();
    const { qrcode, imageContent } = await this.#options.fetchQrCode();
    const qrDataUrl = await this.#options.createQrDataUrl(imageContent);
    const abort = new AbortController();
    this.#abort = abort;
    this.#setSnapshot({ sessionId, state: "waiting", qrDataUrl });
    void this.#complete(sessionId, qrcode, abort.signal);
    return this.getSnapshot();
  }

  async refresh(): Promise<WechatLoginSessionSnapshot> {
    await this.cancel();
    return this.start();
  }

  async cancel(): Promise<WechatLoginSessionSnapshot> {
    if (this.#startPromise) {
      try {
        await this.#startPromise;
      } catch {
        // The start error remains visible to its caller; cancellation still clears active polling.
      }
    }
    this.#abort?.abort();
    this.#abort = null;
    if (this.#snapshot.sessionId) {
      this.#setSnapshot({
        sessionId: this.#snapshot.sessionId,
        state: "cancelled",
      });
    }
    return this.getSnapshot();
  }

  async #complete(sessionId: string, qrcode: string, signal: AbortSignal): Promise<void> {
    try {
      const credentials = await this.#options.waitForLogin(qrcode, signal);
      if (signal.aborted || this.#snapshot.sessionId !== sessionId) return;
      await this.#options.saveCredentials?.(credentials);
      if (signal.aborted || this.#snapshot.sessionId !== sessionId) return;
      this.#abort = null;
      this.#setSnapshot({
        sessionId,
        state: "confirmed",
        ilinkBotId: credentials.ilinkBotId,
      });
    } catch (error) {
      if (signal.aborted || this.#snapshot.sessionId !== sessionId) return;
      this.#abort = null;
      const message = error instanceof Error ? error.message : String(error);
      this.#setSnapshot({
        sessionId,
        state: /过期/.test(message) ? "expired" : "error",
        error: message,
      });
    }
  }

  #setSnapshot(snapshot: WechatLoginSessionSnapshot): void {
    this.#snapshot = snapshot;
    this.#options.onChanged?.(this.getSnapshot());
  }
}
