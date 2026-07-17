import { Badge } from "@/components/ui/badge";

export const marketPlatforms = ["DEWU", "NINETY_FIVE", "XIANYU", "OTHER"] as const;
export const marketQuoteTypes = ["EXPECTED_INCOME", "LISTING_PRICE", "MANUAL_REFERENCE"] as const;

const labels: Record<string, string> = {
  DEWU: "得物", NINETY_FIVE: "95分", XIANYU: "闲鱼", OTHER: "其他",
  EXPECTED_INCOME: "预计收入", LISTING_PRICE: "平台展示价格", MANUAL_REFERENCE: "人工参考价", MANUAL: "手工录入",
  CURRENT: "当前有效", UNCONFIRMED: "待确认", EXPIRED: "已过期", INVALIDATED: "已失效", SUPERSEDED: "已有更新报价",
  ACTIVE: "启用中", INACTIVE: "已停用", NO_QUOTES: "尚无报价记录", ONLY_UNCONFIRMED: "报价尚未确认",
  ALL_INVALIDATED: "报价均已失效", ALL_EXPIRED: "报价均已过期", NO_EFFECTIVE_QUOTE: "暂无有效报价",
};

export function marketLabel(value: string | null | undefined, fallback = "未填写") { return value ? (labels[value] ?? fallback) : fallback; }
export function money(value: string | null | undefined) { return value == null ? "未填写" : `¥ ${Number(value).toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`; }
export function dateTime(value: string | null | undefined) { return value ? new Date(value).toLocaleString("zh-CN", { dateStyle: "medium", timeStyle: "short" }) : "未填写"; }
export function toDateTimeLocal(value: string | null | undefined) { if (!value) return ""; const date = new Date(value); return new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); }
export function fromDateTimeLocal(value: string) { return value ? new Date(value).toISOString() : null; }

export function MarketLifecycleBadge({ status }: { status: string }) {
  const variant = status === "CURRENT" ? "default" : status === "INVALIDATED" ? "destructive" : status === "EXPIRED" ? "secondary" : "outline";
  return <Badge variant={variant}>{marketLabel(status, "状态未知")}</Badge>;
}

export function MarketItemBadge({ active }: { active: boolean }) { return <Badge variant={active ? "default" : "secondary"}>{active ? "启用中" : "已停用"}</Badge>; }
