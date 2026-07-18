import type { LogisticsTrackingStatus } from "@/generated/prisma/client";
import { normalizeCarrierCode, normalizeTrackingNumber } from "../logistics-rules";
import type { LogisticsProviderAdapter } from "../logistics-provider";
import type { LogisticsProviderEvent, LogisticsProviderResult } from "../logistics-types";

const BASE_TIME = new Date("2026-01-01T00:00:00.000Z");

const STAGES: Array<{ status: LogisticsTrackingStatus; rawStatusCode: string; description: string; location: string }> = [
  { status: "PENDING_PICKUP", rawStatusCode: "PENDING_PICKUP", description: "等待快递员揽收", location: "始发地" },
  { status: "PICKED_UP", rawStatusCode: "PICKED_UP", description: "快件已揽收", location: "始发网点" },
  { status: "IN_TRANSIT", rawStatusCode: "IN_TRANSIT", description: "快件运输中", location: "转运中心" },
  { status: "OUT_FOR_DELIVERY", rawStatusCode: "OUT_FOR_DELIVERY", description: "快件派送中", location: "目的地网点" },
  { status: "DELIVERED", rawStatusCode: "DELIVERED", description: "快件已签收", location: "目的地" },
];

function stagesForTracking(normalizedTrackingNumber: string) {
  if (normalizedTrackingNumber.endsWith("01")) return STAGES.slice(0, 1);
  if (normalizedTrackingNumber.endsWith("02")) return STAGES.slice(0, 2);
  if (normalizedTrackingNumber.endsWith("03")) return STAGES.slice(0, 3);
  if (normalizedTrackingNumber.endsWith("04")) return STAGES.slice(0, 4);
  if (normalizedTrackingNumber.endsWith("05")) return STAGES;
  if (normalizedTrackingNumber.endsWith("06")) {
    return [...STAGES.slice(0, 3), { status: "EXCEPTION" as const, rawStatusCode: "EXCEPTION", description: "运输出现异常", location: "转运中心" }];
  }
  if (normalizedTrackingNumber.endsWith("07")) {
    return [...STAGES.slice(0, 3), { status: "RETURNING" as const, rawStatusCode: "RETURNING", description: "快件退回中", location: "转运中心" }];
  }
  return [{ status: "UNKNOWN" as const, rawStatusCode: "UNKNOWN", description: "暂无可用物流轨迹", location: "" }];
}

export class MockLogisticsProvider implements LogisticsProviderAdapter {
  readonly code = "MOCK";

  isConfigured() {
    return true;
  }

  supportsCarrier() {
    return true;
  }

  async queryTracking(input: { carrierCode: string; trackingNumber: string }): Promise<LogisticsProviderResult> {
    const carrierCode = normalizeCarrierCode(input.carrierCode);
    const tracking = normalizeTrackingNumber(input.trackingNumber);
    const stages = stagesForTracking(tracking.normalizedTrackingNumber);
    const events: LogisticsProviderEvent[] = stages.map((stage, index) => ({
      providerEventId: `${tracking.normalizedTrackingNumber}:${index + 1}:${stage.status}`,
      eventTime: new Date(BASE_TIME.getTime() + (index + 1) * 60 * 60 * 1000),
      status: stage.status,
      location: stage.location || null,
      description: stage.description,
      rawStatusCode: stage.rawStatusCode,
    }));
    const current = stages.at(-1)!;
    const queriedAt = new Date(BASE_TIME.getTime() + 12 * 60 * 60 * 1000);
    const terminal = current.status === "DELIVERED" || current.status === "CANCELLED";
    return {
      provider: this.code,
      carrierCode,
      trackingNumber: tracking.trackingNumber,
      currentStatus: current.status,
      rawStatusCode: current.rawStatusCode,
      events,
      queriedAt,
      providerRequestId: `MOCK:${carrierCode}:${tracking.normalizedTrackingNumber}`,
      suggestedNextSyncAt: terminal ? null : new Date(queriedAt.getTime() + 3 * 60 * 60 * 1000),
    };
  }
}
