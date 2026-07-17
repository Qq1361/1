import { ServiceError } from "@/server/errors";

export const DAILY_REPORT_TIMEZONE = "Asia/Shanghai" as const;

export type DailyReportPeriod = {
  reportDate: string;
  timezone: typeof DAILY_REPORT_TIMEZONE;
  periodStart: Date;
  periodEnd: Date;
  generatedAt: Date;
};

function datePartsInShanghai(value: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: DAILY_REPORT_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return { year: Number(values.year), month: Number(values.month), day: Number(values.day) };
}

export function validateReportTimezone(timezone: string | undefined | null) {
  if (timezone === undefined || timezone === null || timezone === "") return DAILY_REPORT_TIMEZONE;
  if (timezone !== DAILY_REPORT_TIMEZONE) {
    throw new ServiceError("INVALID_TIMEZONE", "当前日报仅支持 Asia/Shanghai 时区。", 400);
  }
  return DAILY_REPORT_TIMEZONE;
}

export function parseReportDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new ServiceError("INVALID_DATE", "date 必须是 YYYY-MM-DD 格式。", 400);
  }
  const [year, month, day] = value.split("-").map(Number);
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (probe.getUTCFullYear() !== year || probe.getUTCMonth() !== month - 1 || probe.getUTCDate() !== day) {
    throw new ServiceError("INVALID_DATE", "date 不是有效日期。", 400);
  }
  return { year, month, day, reportDate: value };
}

function reportDateForGeneratedAt(generatedAt: Date) {
  const { year, month, day } = datePartsInShanghai(generatedAt);
  const todayUtc = Date.UTC(year, month - 1, day);
  const yesterday = new Date(todayUtc - 86_400_000);
  return {
    year: yesterday.getUTCFullYear(),
    month: yesterday.getUTCMonth() + 1,
    day: yesterday.getUTCDate(),
    reportDate: `${yesterday.getUTCFullYear()}-${String(yesterday.getUTCMonth() + 1).padStart(2, "0")}-${String(yesterday.getUTCDate()).padStart(2, "0")}`,
  };
}

// Asia/Shanghai has no daylight-saving transition. A local midnight is UTC midnight minus eight hours.
function shanghaiMidnightUtc(year: number, month: number, day: number) {
  return new Date(Date.UTC(year, month - 1, day, -8));
}

export function resolveDailyReportPeriod(input: {
  date?: string | null;
  timezone?: string | null;
  generatedAt: Date;
}): DailyReportPeriod {
  if (Number.isNaN(input.generatedAt.getTime())) {
    throw new ServiceError("INVALID_DATE", "generatedAt 必须是有效时间。", 400);
  }
  const timezone = validateReportTimezone(input.timezone);
  const parsed = input.date ? parseReportDate(input.date) : reportDateForGeneratedAt(input.generatedAt);
  const periodStart = shanghaiMidnightUtc(parsed.year, parsed.month, parsed.day);
  const periodEnd = new Date(periodStart.getTime() + 86_400_000);
  return { reportDate: parsed.reportDate, timezone, periodStart, periodEnd, generatedAt: new Date(input.generatedAt) };
}
