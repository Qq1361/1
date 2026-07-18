import type { LogisticsTrackingStatus } from "@/generated/prisma/client";

const STATUS_MAP: Record<string, LogisticsTrackingStatus> = {
  UNKNOWN: "UNKNOWN",
  NO_INFO: "UNKNOWN",
  PENDING_PICKUP: "PENDING_PICKUP",
  PRE_TRANSIT: "PENDING_PICKUP",
  PICKED_UP: "PICKED_UP",
  ACCEPTED: "PICKED_UP",
  IN_TRANSIT: "IN_TRANSIT",
  TRANSIT: "IN_TRANSIT",
  ARRIVED_AT_DESTINATION: "ARRIVED_AT_DESTINATION",
  DESTINATION_ARRIVAL: "ARRIVED_AT_DESTINATION",
  OUT_FOR_DELIVERY: "OUT_FOR_DELIVERY",
  DELIVERING: "OUT_FOR_DELIVERY",
  DELIVERED: "DELIVERED",
  SIGNED: "DELIVERED",
  EXCEPTION: "EXCEPTION",
  PROBLEM: "EXCEPTION",
  RETURNING: "RETURNING",
  RETURNED: "RETURNING",
  CANCELLED: "CANCELLED",
  CANCELED: "CANCELLED",
};

export function normalizeRawStatusCode(value: unknown) {
  if (typeof value !== "string") return null;
  const normalized = value.trim().toUpperCase();
  return normalized ? normalized.slice(0, 100) : null;
}

export function mapLogisticsTrackingStatus(value: unknown): LogisticsTrackingStatus {
  const rawStatusCode = normalizeRawStatusCode(value);
  return rawStatusCode ? (STATUS_MAP[rawStatusCode] ?? "UNKNOWN") : "UNKNOWN";
}
