import type { DesktopDeviceAuthorizationClient } from "./desktop-device-authorization-client";

type AvailabilityClient = Pick<
  DesktopDeviceAuthorizationClient,
  "getLocalStatus" | "reportDesktopAvailability"
>;

export type DesktopAvailabilityFailure =
  | "LOCAL_AUTHORIZATION_UNAVAILABLE"
  | "AVAILABILITY_REPORT_FAILED";

export class DesktopAvailabilityCoordinator {
  readonly #client: AvailabilityClient;
  readonly #renewalIntervalMs: number;
  readonly #onFailure: (failure: DesktopAvailabilityFailure) => void;
  #interval: ReturnType<typeof setInterval> | undefined;
  #running = false;
  #suspended = false;
  #pending: Promise<void> = Promise.resolve();

  constructor(options: {
    client: AvailabilityClient;
    renewalIntervalMs?: number;
    onFailure?: (failure: DesktopAvailabilityFailure) => void;
  }) {
    this.#client = options.client;
    this.#renewalIntervalMs = options.renewalIntervalMs ?? 30_000;
    this.#onFailure = options.onFailure ?? (() => undefined);
    if (
      !Number.isFinite(this.#renewalIntervalMs)
      || this.#renewalIntervalMs < 1_000
    ) {
      throw new Error("DESKTOP_AVAILABILITY_INTERVAL_INVALID");
    }
  }

  async start(): Promise<void> {
    if (this.#running) return this.#pending;
    this.#running = true;
    this.#suspended = false;
    this.#armRenewal();
    return this.#enqueue(true);
  }

  async suspend(): Promise<void> {
    if (!this.#running || this.#suspended) return this.#pending;
    this.#suspended = true;
    this.#clearRenewal();
    return this.#enqueue(false);
  }

  async resume(): Promise<void> {
    if (!this.#running || !this.#suspended) return this.#pending;
    this.#suspended = false;
    this.#armRenewal();
    return this.#enqueue(true);
  }

  async stop(): Promise<void> {
    if (!this.#running) return this.#pending;
    this.#running = false;
    this.#suspended = true;
    this.#clearRenewal();
    return this.#enqueue(false);
  }

  #armRenewal(): void {
    this.#clearRenewal();
    this.#interval = setInterval(() => {
      void this.#enqueue(true);
    }, this.#renewalIntervalMs);
  }

  #clearRenewal(): void {
    if (this.#interval === undefined) return;
    clearInterval(this.#interval);
    this.#interval = undefined;
  }

  #enqueue(available: boolean): Promise<void> {
    this.#pending = this.#pending.then(async () => {
      if (available && (!this.#running || this.#suspended)) return;
      let localStatus: Awaited<ReturnType<AvailabilityClient["getLocalStatus"]>>;
      try {
        localStatus = await this.#client.getLocalStatus();
      } catch {
        this.#onFailure("LOCAL_AUTHORIZATION_UNAVAILABLE");
        return;
      }
      if (localStatus.status !== "paired") return;
      try {
        await this.#client.reportDesktopAvailability(available);
      } catch {
        this.#onFailure("AVAILABILITY_REPORT_FAILED");
      }
    });
    return this.#pending;
  }
}
