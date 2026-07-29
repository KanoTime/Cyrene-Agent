import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DesktopAvailabilityCoordinator } from "./desktop-availability-coordinator";

describe("Desktop Availability Coordinator", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("renews while awake, clears on suspension, and resumes explicitly", async () => {
    const client = {
      getLocalStatus: vi.fn(async () => ({
        status: "paired" as const,
        deviceId: "desktop-1",
        controlPlaneOrigin: "https://control.example.test",
      })),
      reportDesktopAvailability: vi.fn(async (available: boolean) => {
        if (available) {
          return {
            status: "AVAILABLE" as const,
            availableUntil: "2026-07-23T08:00:45.000Z",
          };
        }
        return { status: "UNAVAILABLE" as const };
      }),
    };
    const coordinator = new DesktopAvailabilityCoordinator({
      client,
      renewalIntervalMs: 30_000,
    });

    await coordinator.start();
    expect(client.reportDesktopAvailability).toHaveBeenLastCalledWith(true);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.reportDesktopAvailability).toHaveBeenCalledTimes(2);

    await coordinator.suspend();
    expect(client.reportDesktopAvailability).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.reportDesktopAvailability).toHaveBeenCalledTimes(3);

    await coordinator.resume();
    expect(client.reportDesktopAvailability).toHaveBeenLastCalledWith(true);

    await coordinator.stop();
    expect(client.reportDesktopAvailability).toHaveBeenLastCalledWith(false);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(client.reportDesktopAvailability).toHaveBeenCalledTimes(5);
  });

  it("detects a desktop paired after startup without restarting the app", async () => {
    let paired = false;
    const client = {
      getLocalStatus: vi.fn(async () => paired
        ? {
          status: "paired" as const,
          deviceId: "desktop-1",
          controlPlaneOrigin: "https://control.example.test",
        }
        : { status: "not-paired" as const }),
      reportDesktopAvailability: vi.fn(async () => ({
        status: "AVAILABLE" as const,
        availableUntil: "2026-07-23T08:00:45.000Z",
      })),
    };
    const coordinator = new DesktopAvailabilityCoordinator({
      client,
      renewalIntervalMs: 30_000,
    });

    await coordinator.start();
    expect(client.reportDesktopAvailability).not.toHaveBeenCalled();

    paired = true;
    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.reportDesktopAvailability).toHaveBeenCalledWith(true);
    await coordinator.stop();
  });

  it("keeps retrying after a transport failure without exposing raw errors", async () => {
    const failures: string[] = [];
    const client = {
      getLocalStatus: vi.fn(async () => ({
        status: "paired" as const,
        deviceId: "desktop-1",
        controlPlaneOrigin: "https://control.example.test",
      })),
      reportDesktopAvailability: vi.fn()
        .mockRejectedValueOnce(new Error("secret-bearing transport detail"))
        .mockResolvedValue({
          status: "AVAILABLE" as const,
          availableUntil: "2026-07-23T08:00:45.000Z",
        }),
    };
    const coordinator = new DesktopAvailabilityCoordinator({
      client,
      renewalIntervalMs: 30_000,
      onFailure: (failure) => failures.push(failure),
    });

    await coordinator.start();
    expect(failures).toEqual(["AVAILABILITY_REPORT_FAILED"]);

    await vi.advanceTimersByTimeAsync(30_000);
    expect(client.reportDesktopAvailability).toHaveBeenCalledTimes(2);
    expect(failures).toEqual(["AVAILABILITY_REPORT_FAILED"]);
    await coordinator.stop();
  });
});
