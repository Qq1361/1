import { createHash } from "node:crypto";
import type { LogisticsTrackingStatus } from "@/generated/prisma/client";
import { logisticsValidationError } from "./logistics-errors";
import { mapLogisticsTrackingStatus, normalizeRawStatusCode } from "./logistics-status-mapper";
import type { LogisticsProviderEvent, LogisticsProviderResult, NormalizedLogisticsEvent, NormalizedLogisticsProviderResult } from "./logistics-types";

const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f]/;
const TRACKING_NUMBER_MAX_LENGTH = 100;

function requireSafeText(value: unknown, code: string, message: string, maxLength: number) {
  if (typeof value !== "string") throw logisticsValidationError(code, message);
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength || CONTROL_CHARACTERS.test(trimmed)) {
    throw logisticsValidationError(code, message);
  }
  return trimmed;
}

export function normalizeProviderCode(value: unknown) {
  const code = requireSafeText(value, "LOGISTICS_INVALID_PROVIDER", "物流 Provider 无效。", 50).toUpperCase();
  if (!/^[A-Z0-9_-]+$/.test(code)) {
    throw logisticsValidationError("LOGISTICS_INVALID_PROVIDER", "物流 Provider 无效。");
  }
  return code;
}

export function normalizeCarrierCode(value: unknown) {
  return requireSafeText(value, "LOGISTICS_INVALID_CARRIER", "快递公司代码无效。", 50).toUpperCase();
}

export function normalizeOptionalText(value: unknown, maxLength = 200) {
  if (value == null) return null;
  if (typeof value !== "string" || CONTROL_CHARACTERS.test(value)) {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "物流 Provider 返回了无效文本。");
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > maxLength) {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "物流 Provider 返回文本过长。");
  }
  return trimmed;
}

export function normalizeTrackingNumber(value: unknown) {
  const trackingNumber = requireSafeText(
    value,
    "LOGISTICS_INVALID_TRACKING_NUMBER",
    `快递单号必须为 1-${TRACKING_NUMBER_MAX_LENGTH} 个安全字符。`,
    TRACKING_NUMBER_MAX_LENGTH,
  );
  const normalizedTrackingNumber = trackingNumber
    .replace(/[ \u3000]+/g, "")
    .replace(/[a-z]/g, (letter) => letter.toUpperCase());
  if (!normalizedTrackingNumber) {
    throw logisticsValidationError("LOGISTICS_INVALID_TRACKING_NUMBER", "快递单号不能为空。");
  }
  return { trackingNumber, normalizedTrackingNumber };
}

export function normalizeBusinessId(value: unknown) {
  return requireSafeText(value, "LOGISTICS_BUSINESS_OBJECT_NOT_FOUND", "物流业务对象不存在或无权访问。", 191);
}

function requireDate(value: unknown, label: string) {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", `物流 Provider 返回的${label}无效。`);
  }
  return new Date(value.getTime());
}

function eventDedupeKey(provider: string, event: Omit<NormalizedLogisticsEvent, "dedupeKey">) {
  const identity = event.providerEventId
    ? ["provider-event", provider, event.providerEventId]
    : [
        "event-v1",
        provider,
        event.eventTime.toISOString(),
        event.status,
        event.location ?? "",
        event.description,
        event.rawStatusCode ?? "",
      ];
  return createHash("sha256").update(JSON.stringify(identity)).digest("hex");
}

export function normalizeProviderEvent(provider: string, event: LogisticsProviderEvent): NormalizedLogisticsEvent {
  const eventTime = requireDate(event.eventTime, "轨迹时间");
  const providerEventId = normalizeOptionalText(event.providerEventId, 200);
  const location = normalizeOptionalText(event.location, 200);
  const description = requireSafeText(
    event.description,
    "LOGISTICS_PROVIDER_INVALID_RESPONSE",
    "物流 Provider 返回的轨迹描述无效。",
    1000,
  );
  const rawStatusCode = normalizeRawStatusCode(event.rawStatusCode);
  const status = mapLogisticsTrackingStatus(event.status);
  const normalized = { providerEventId, eventTime, status, location, description, rawStatusCode };
  return { ...normalized, dedupeKey: eventDedupeKey(provider, normalized) };
}

export function normalizeProviderResult(
  expectedProvider: string,
  expectedCarrierCode: string,
  expectedTrackingNumber: string,
  result: LogisticsProviderResult,
): NormalizedLogisticsProviderResult {
  if (!result || typeof result !== "object") {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "物流 Provider 返回数据无效。");
  }
  const provider = normalizeProviderCode(result.provider);
  if (provider !== expectedProvider) {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "物流 Provider 标识不匹配。");
  }
  const carrierCode = normalizeCarrierCode(result.carrierCode);
  if (carrierCode !== expectedCarrierCode) {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "物流 Provider 返回的快递公司不匹配。");
  }
  const tracking = normalizeTrackingNumber(result.trackingNumber);
  const expectedTracking = normalizeTrackingNumber(expectedTrackingNumber);
  if (tracking.normalizedTrackingNumber !== expectedTracking.normalizedTrackingNumber) {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "物流 Provider 返回的快递单号不匹配。");
  }
  const queriedAt = requireDate(result.queriedAt, "查询时间");
  const suggestedNextSyncAt = result.suggestedNextSyncAt == null
    ? null
    : requireDate(result.suggestedNextSyncAt, "下次同步时间");
  if (!Array.isArray(result.events)) {
    throw logisticsValidationError("LOGISTICS_PROVIDER_INVALID_RESPONSE", "物流 Provider 返回的轨迹列表无效。");
  }
  const events = result.events.map((event) => normalizeProviderEvent(provider, event));
  events.sort((left, right) => left.eventTime.getTime() - right.eventTime.getTime() || left.dedupeKey.localeCompare(right.dedupeKey));
  return {
    provider,
    carrierCode,
    trackingNumber: tracking.trackingNumber,
    currentStatus: mapLogisticsTrackingStatus(result.currentStatus),
    rawStatusCode: normalizeRawStatusCode(result.rawStatusCode),
    events,
    queriedAt,
    providerRequestId: normalizeOptionalText(result.providerRequestId, 200),
    suggestedNextSyncAt,
  };
}

export function nextSyncAtForStatus(status: LogisticsTrackingStatus, queriedAt: Date) {
  const hours = status === "OUT_FOR_DELIVERY" || status === "ARRIVED_AT_DESTINATION"
    ? 1
    : status === "PENDING_PICKUP" || status === "PICKED_UP" || status === "IN_TRANSIT"
      ? 3
      : status === "EXCEPTION" || status === "UNKNOWN" || status === "RETURNING"
        ? 12
        : null;
  return hours == null ? null : new Date(queriedAt.getTime() + hours * 60 * 60 * 1000);
}

export function newestEventTime(events: NormalizedLogisticsEvent[]) {
  return events.reduce<Date | null>((latest, event) => !latest || event.eventTime > latest ? event.eventTime : latest, null);
}

export function firstDeliveredEventTime(events: NormalizedLogisticsEvent[]) {
  return events
    .filter((event) => event.status === "DELIVERED")
    .reduce<Date | null>((earliest, event) => !earliest || event.eventTime < earliest ? event.eventTime : earliest, null);
}
