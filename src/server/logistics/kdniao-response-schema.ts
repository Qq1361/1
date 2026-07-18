import { z } from "zod";
import type { LogisticsTrackingStatus } from "@/generated/prisma/client";
import { LogisticsProviderError } from "./logistics-types";

const stringish = z.union([z.string(), z.number()]).transform(String);
const booleanish = z.union([
  z.boolean(),
  z.literal("true").transform(() => true),
  z.literal("false").transform(() => false),
]);

const traceSchema = z.object({
  AcceptTime: z.string(),
  AcceptStation: z.string().optional().default(""),
  Remark: z.string().optional().default(""),
}).passthrough();

const responseSchema = z.object({
  Success: booleanish,
  Reason: z.string().optional(),
  State: stringish.optional(),
  ShipperCode: stringish.optional(),
  LogisticCode: stringish.optional(),
  Traces: z.array(traceSchema).optional().default([]),
}).passthrough();

export type KdniaoResponse = z.infer<typeof responseSchema>;

export function parseKdniaoResponse(value: unknown): KdniaoResponse {
  const result = responseSchema.safeParse(value);
  if (!result.success) {
    throw new LogisticsProviderError(
      "LOGISTICS_PROVIDER_INVALID_RESPONSE",
      "快递鸟返回的数据结构无效。",
      false,
    );
  }
  return result.data;
}

export function mapKdniaoState(value: string | undefined): LogisticsTrackingStatus {
  switch (value?.trim()) {
    case "1":
      return "PICKED_UP";
    case "2":
      return "IN_TRANSIT";
    case "3":
      return "DELIVERED";
    case "4":
      return "EXCEPTION";
    case "0":
    default:
      return "UNKNOWN";
  }
}

export function parseKdniaoShanghaiTime(value: string) {
  const match = value.trim().match(/^(\d{4})[-/](\d{2})[-/](\d{2}) (\d{2}):(\d{2}):(\d{2})$/);
  if (!match) {
    throw new LogisticsProviderError(
      "LOGISTICS_PROVIDER_INVALID_RESPONSE",
      "快递鸟轨迹时间无效。",
      false,
    );
  }
  const [, yearText, monthText, dayText, hourText, minuteText, secondText] = match;
  const parts = [yearText, monthText, dayText, hourText, minuteText, secondText].map(Number);
  const [year, month, day, hour, minute, second] = parts;
  const timestamp = Date.UTC(year, month - 1, day, hour - 8, minute, second);
  const date = new Date(timestamp);
  const shanghai = new Date(timestamp + 8 * 60 * 60 * 1000);
  if (
    shanghai.getUTCFullYear() !== year
    || shanghai.getUTCMonth() + 1 !== month
    || shanghai.getUTCDate() !== day
    || shanghai.getUTCHours() !== hour
    || shanghai.getUTCMinutes() !== minute
    || shanghai.getUTCSeconds() !== second
  ) {
    throw new LogisticsProviderError(
      "LOGISTICS_PROVIDER_INVALID_RESPONSE",
      "快递鸟轨迹时间无效。",
      false,
    );
  }
  return date;
}

export function maskLogisticsContactDetails(value: string) {
  return value
    .replace(/(?<!\d)(1[3-9]\d)\d{4}(\d{4})(?!\d)/g, "$1****$2")
    .replace(/(?<!\d)(0\d{2,3})[- ]?(\d{3,4})(\d{4})(?!\d)/g, "$1-****$3");
}
