import { ServiceError } from "@/server/errors";

const DATE_ONLY_PATTERN = /^(\d{4})-(\d{2})-(\d{2})$/;

export function parseDateOnly(value: string, field = "日期"): Date {
  const match = DATE_ONLY_PATTERN.exec(value);
  if (!match) {
    throw new ServiceError("SHELF_LIFE_DATE_INVALID", `${field}必须是 YYYY-MM-DD 格式。`, 400, {
      [field]: ["请输入有效的 YYYY-MM-DD 日期。"],
    });
  }

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    throw new ServiceError("SHELF_LIFE_DATE_INVALID", `${field}不是有效日期。`, 400, {
      [field]: ["请输入有效的 YYYY-MM-DD 日期。"],
    });
  }
  return date;
}

export function formatDateOnly(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}-${String(date.getUTCDate()).padStart(2, "0")}`;
}

export function serializeDateOnlyFields<T>(value: T): T {
  const serialized = JSON.parse(JSON.stringify(value));
  const visit = (current: unknown): unknown => {
    if (Array.isArray(current)) return current.map(visit);
    if (!current || typeof current !== "object") return current;
    return Object.fromEntries(
      Object.entries(current).map(([key, item]) => [
        key,
        (key === "productionDate" || key === "expiryDate") && typeof item === "string"
          ? formatDateOnly(item) ?? item
          : visit(item),
      ]),
    );
  };
  return visit(serialized) as T;
}

export function addCalendarMonthsClamped(productionDate: Date, months: number): Date {
  const targetMonth = productionDate.getUTCMonth() + months;
  const targetYear = productionDate.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  return new Date(
    Date.UTC(
      targetYear,
      normalizedMonth,
      Math.min(productionDate.getUTCDate(), lastDay),
    ),
  );
}
