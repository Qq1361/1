import { DEFAULT_OWNER_ID } from "@/server/constants";
import { salesReportService } from "@/server/reports/sales-report-service";

const PLATFORMS = ["DEWU", "NINETY_FIVE", "XIANYU", "OTHER"] as const;
const STATUSES = ["CONFIRMED", "SETTLED"] as const;
const SORT_BY = ["soldItemCount", "profitTotal", "afterSaleNetProfit", "refundedAmountTotal", "restockedItemCount", "averageProfitPerItem", "inventoryCostTotal", "lastSoldAt"] as const;
const SORT_ORDER = ["asc", "desc"] as const;

function badRequest(message: string) {
  return Response.json({ message }, { status: 400 });
}

function parseDate(value: string | null, field: string) {
  if (!value) return undefined;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) throw new Error(`${field} 必须是有效的 ISO 日期。`);
  return parsed;
}

function parseEnum<T extends readonly string[]>(value: string | null, allowed: T, field: string) {
  if (!value) return undefined;
  if (!allowed.includes(value)) throw new Error(`${field} 参数无效。`);
  return value as T[number];
}

function parsePositiveInteger(value: string | null, field: string, fallback: number) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`${field} 必须是正整数。`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) throw new Error(`${field} 必须是正整数。`);
  return parsed;
}

export async function GET(request: Request) {
  let filters: Parameters<typeof salesReportService.getSalesReportProducts>[0];
  try {
    const { searchParams } = new URL(request.url);
    const dateFrom = parseDate(searchParams.get("dateFrom"), "dateFrom");
    const dateTo = parseDate(searchParams.get("dateTo"), "dateTo");
    if (dateFrom && dateTo && dateFrom > dateTo) return badRequest("dateFrom 不能晚于 dateTo。");

    const page = parsePositiveInteger(searchParams.get("page"), "page", 1);
    const pageSize = parsePositiveInteger(searchParams.get("pageSize"), "pageSize", 20);
    if (pageSize > 100) return badRequest("pageSize 不能大于 100。");

    filters = {
      ownerId: DEFAULT_OWNER_ID,
      dateFrom,
      dateTo,
      platform: parseEnum(searchParams.get("platform"), PLATFORMS, "platform"),
      status: parseEnum(searchParams.get("status"), STATUSES, "status"),
      keyword: searchParams.get("keyword")?.trim() || undefined,
      page,
      pageSize,
      sortBy: parseEnum(searchParams.get("sortBy"), SORT_BY, "sortBy"),
      sortOrder: parseEnum(searchParams.get("sortOrder"), SORT_ORDER, "sortOrder"),
    };
  } catch (error) {
    if (error instanceof Error) return badRequest(error.message);
    return badRequest("参数无效。");
  }

  try {
    return Response.json(await salesReportService.getSalesReportProducts(filters));
  } catch {
    return Response.json({ message: "加载商品利润分析失败。" }, { status: 500 });
  }
}
