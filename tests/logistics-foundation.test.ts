import { describe, expect, it, vi } from "vitest";
import { ServiceError } from "@/server/errors";
import { LogisticsProviderRegistry } from "@/server/logistics/logistics-provider-registry";
import {
  firstDeliveredEventTime,
  newestEventTime,
  nextSyncAtForStatus,
  normalizeProviderEvent,
  normalizeProviderResult,
  normalizeTrackingNumber,
} from "@/server/logistics/logistics-rules";
import { mapLogisticsTrackingStatus } from "@/server/logistics/logistics-status-mapper";
import { MockLogisticsProvider } from "@/server/logistics/providers/mock-logistics-provider";

describe("generic logistics foundation", () => {
  it("maps provider aliases to every canonical tracking status and unknown safely", () => {
    expect(mapLogisticsTrackingStatus("no_info")).toBe("UNKNOWN");
    expect(mapLogisticsTrackingStatus("pre_transit")).toBe("PENDING_PICKUP");
    expect(mapLogisticsTrackingStatus("accepted")).toBe("PICKED_UP");
    expect(mapLogisticsTrackingStatus("transit")).toBe("IN_TRANSIT");
    expect(mapLogisticsTrackingStatus("destination_arrival")).toBe("ARRIVED_AT_DESTINATION");
    expect(mapLogisticsTrackingStatus("delivering")).toBe("OUT_FOR_DELIVERY");
    expect(mapLogisticsTrackingStatus("signed")).toBe("DELIVERED");
    expect(mapLogisticsTrackingStatus("problem")).toBe("EXCEPTION");
    expect(mapLogisticsTrackingStatus("returned")).toBe("RETURNING");
    expect(mapLogisticsTrackingStatus("canceled")).toBe("CANCELLED");
    expect(mapLogisticsTrackingStatus("provider-specific-status")).toBe("UNKNOWN");
  });

  it("normalizes tracking numbers without changing meaningful punctuation or order", () => {
    expect(normalizeTrackingNumber("  ab 12-3/4  ")).toEqual({
      trackingNumber: "ab 12-3/4",
      normalizedTrackingNumber: "AB12-3/4",
    });
    expect(() => normalizeTrackingNumber("   ")).toThrow(ServiceError);
    expect(() => normalizeTrackingNumber("AB\u0000CD")).toThrow(ServiceError);
    expect(() => normalizeTrackingNumber("X".repeat(101))).toThrow(ServiceError);
  });

  it("creates stable event dedupe keys and separates materially different events", () => {
    const base = {
      eventTime: new Date("2026-01-01T01:00:00.000Z"),
      status: "IN_TRANSIT" as const,
      location: "Guangzhou",
      description: "In transit",
      rawStatusCode: "TRANSIT",
    };
    const first = normalizeProviderEvent("MOCK", base);
    const retry = normalizeProviderEvent("MOCK", { ...base });
    const changed = normalizeProviderEvent("MOCK", { ...base, description: "Departed" });
    expect(retry.dedupeKey).toBe(first.dedupeKey);
    expect(changed.dedupeKey).not.toBe(first.dedupeKey);
  });

  it("validates provider responses and sorts events deterministically", () => {
    const result = normalizeProviderResult("MOCK", "SF", "AB 05", {
      provider: "mock",
      carrierCode: "sf",
      trackingNumber: "AB05",
      currentStatus: "DELIVERED",
      queriedAt: new Date("2026-01-01T12:00:00.000Z"),
      events: [
        { eventTime: new Date("2026-01-01T02:00:00.000Z"), status: "IN_TRANSIT", description: "Second" },
        { eventTime: new Date("2026-01-01T01:00:00.000Z"), status: "PICKED_UP", description: "First" },
      ],
    });
    expect(result.events.map((event) => event.description)).toEqual(["First", "Second"]);
    expect(() => normalizeProviderResult("MOCK", "SF", "AB05", {
      provider: "MOCK",
      carrierCode: "SF",
      trackingNumber: "AB05",
      currentStatus: "UNKNOWN",
      queriedAt: new Date(),
      events: null as never,
    })).toThrow(ServiceError);
  });

  it("uses deterministic local mock data without network access", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const provider = new MockLogisticsProvider();
    const first = await provider.queryTracking({ carrierCode: "sf", trackingNumber: "mock 05" });
    const retry = await provider.queryTracking({ carrierCode: "sf", trackingNumber: "mock 05" });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(first).toEqual(retry);
    expect(first.currentStatus).toBe("DELIVERED");
    expect(first.events).toHaveLength(5);
    fetchSpy.mockRestore();
  });

  it("returns the frozen mock status for every documented tracking suffix", async () => {
    const provider = new MockLogisticsProvider();
    const cases = [
      ["01", "PENDING_PICKUP"],
      ["02", "PICKED_UP"],
      ["03", "IN_TRANSIT"],
      ["04", "OUT_FOR_DELIVERY"],
      ["05", "DELIVERED"],
      ["06", "EXCEPTION"],
      ["07", "RETURNING"],
      ["99", "UNKNOWN"],
    ] as const;
    for (const [suffix, status] of cases) {
      const result = await provider.queryTracking({ carrierCode: "MOCK", trackingNumber: `TRACK-${suffix}` });
      expect(result.currentStatus).toBe(status);
    }
  });

  it("exposes only registered providers and rejects unknown providers", () => {
    const registry = new LogisticsProviderRegistry([new MockLogisticsProvider()]);
    expect(registry.listCodes()).toEqual(["MOCK"]);
    expect(registry.get("mock").code).toBe("MOCK");
    expect(() => registry.get("unknown")).toThrow(ServiceError);
  });

  it("derives next-sync and event times without implicit current time", () => {
    const queriedAt = new Date("2026-01-01T12:00:00.000Z");
    expect(nextSyncAtForStatus("IN_TRANSIT", queriedAt)?.toISOString()).toBe("2026-01-01T15:00:00.000Z");
    expect(nextSyncAtForStatus("DELIVERED", queriedAt)).toBeNull();
    const events = [
      normalizeProviderEvent("MOCK", { eventTime: new Date("2026-01-01T02:00:00.000Z"), status: "DELIVERED", description: "Delivered" }),
      normalizeProviderEvent("MOCK", { eventTime: new Date("2026-01-01T01:00:00.000Z"), status: "PICKED_UP", description: "Picked up" }),
    ];
    expect(newestEventTime(events)?.toISOString()).toBe("2026-01-01T02:00:00.000Z");
    expect(firstDeliveredEventTime(events)?.toISOString()).toBe("2026-01-01T02:00:00.000Z");
  });
});
