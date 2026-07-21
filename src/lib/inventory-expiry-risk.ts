import {
  isLegacyInventoryItemStatus,
  isSupportedInventoryItemStatus,
} from "@/lib/inventory-item-status-contract";

export const INVENTORY_EXPIRY_RISKS = [
  "EXPIRED",
  "WITHIN_30_DAYS",
  "WITHIN_90_DAYS",
  "WITHIN_180_DAYS",
] as const;

export type InventoryExpiryRisk = (typeof INVENTORY_EXPIRY_RISKS)[number];

export const inventoryExpiryRiskLabels: Record<InventoryExpiryRisk, string> = {
  EXPIRED: "已过期",
  WITHIN_30_DAYS: "30天内到期",
  WITHIN_90_DAYS: "90天内到期",
  WITHIN_180_DAYS: "180天内到期",
};

export type ExpiryRiskInventoryItem = {
  expiryDate: Date | null;
  itemStatus: string;
  ownershipStatus?: string | null;
};

const DAY_MS = 86_400_000;

function dateOnlyUtc(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

export function getShanghaiBusinessDate(value = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(value);
  const fields = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return new Date(Date.UTC(Number(fields.year), Number(fields.month) - 1, Number(fields.day)));
}

export function addBusinessDays(date: Date, days: number) {
  const normalized = dateOnlyUtc(date);
  return new Date(normalized.getTime() + days * DAY_MS);
}

export function classifyInventoryExpiryRisk(expiryDate: Date | null | undefined, asOf = new Date()): InventoryExpiryRisk | null {
  if (!expiryDate) return null;
  const expiry = dateOnlyUtc(expiryDate);
  const today = getShanghaiBusinessDate(asOf);
  if (expiry < today) return "EXPIRED";
  if (expiry <= addBusinessDays(today, 30)) return "WITHIN_30_DAYS";
  if (expiry <= addBusinessDays(today, 90)) return "WITHIN_90_DAYS";
  if (expiry <= addBusinessDays(today, 180)) return "WITHIN_180_DAYS";
  return null;
}

export function getInventoryExpiryDayOffset(expiryDate: Date, asOf = new Date()) {
  return Math.round((dateOnlyUtc(expiryDate).getTime() - getShanghaiBusinessDate(asOf).getTime()) / DAY_MS);
}

export function isInventoryAssetSubjectToExpiryRisk(item: ExpiryRiskInventoryItem) {
  return item.ownershipStatus === "OWNED"
    && isSupportedInventoryItemStatus(item.itemStatus)
    && !isLegacyInventoryItemStatus(item.itemStatus)
    && item.itemStatus !== "SOLD";
}

export function buildInventoryExpiryWhere(risk: InventoryExpiryRisk, asOf = new Date()) {
  const today = getShanghaiBusinessDate(asOf);
  if (risk === "EXPIRED") return { lt: today };
  if (risk === "WITHIN_30_DAYS") return { gte: today, lte: addBusinessDays(today, 30) };
  if (risk === "WITHIN_90_DAYS") return { gt: addBusinessDays(today, 30), lte: addBusinessDays(today, 90) };
  return { gt: addBusinessDays(today, 90), lte: addBusinessDays(today, 180) };
}

export function summarizeInventoryExpiryRisk<T extends ExpiryRiskInventoryItem>(items: T[], asOf = new Date()) {
  const byRisk = Object.fromEntries(INVENTORY_EXPIRY_RISKS.map((risk) => [risk, [] as T[]])) as Record<InventoryExpiryRisk, T[]>;
  for (const item of items) {
    if (!isInventoryAssetSubjectToExpiryRisk(item)) continue;
    const risk = classifyInventoryExpiryRisk(item.expiryDate, asOf);
    if (risk) byRisk[risk].push(item);
  }
  for (const risk of INVENTORY_EXPIRY_RISKS) {
    byRisk[risk].sort((left, right) => (left.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER) - (right.expiryDate?.getTime() ?? Number.MAX_SAFE_INTEGER));
  }
  return byRisk;
}
