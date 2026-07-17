import { DEFAULT_OWNER_ID } from "@/server/constants";
import { normalizeSku } from "@/lib/normalize-sku";
import { salesReportService } from "@/server/reports/sales-report-service";

const PLATFORMS = ["DEWU", "NINETY_FIVE", "XIANYU", "OTHER"] as const;
const STATUSES = ["CONFIRMED", "SETTLED"] as const;
const SETTLEMENT_STATUSES = ["ALL", "SETTLED", "UNSETTLED"] as const;

function badRequest(message: string) {
  return Response.json({ message }, { status: 400 });
}

function internalError() {
  return Response.json({ message: "服务端处理销售明细报表时发生错误。" }, { status: 500 });
}

function parseDateParam(value: string | null, field: string) {
  if (!value) return undefined;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`${field} 必须是有效的 ISO 日期字符串。`);
  }
  return date;
}

function enumParam<T extends readonly string[]>(
  value: string | null,
  allowed: T,
  field: string,
) {
  if (!value) return undefined;
  if (!allowed.includes(value)) {
    throw new Error(`${field} 参数无效。`);
  }
  return value as T[number];
}

function parsePositiveInteger(value: string | null, field: string, fallback: number) {
  if (!value) return fallback;
  if (!/^\d+$/.test(value)) {
    throw new Error(`${field} 必须是正整数。`);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new Error(`${field} 必须是正整数。`);
  }
  return parsed;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    let dateFrom: Date | undefined;
    let dateTo: Date | undefined;
    let platform: (typeof PLATFORMS)[number] | undefined;
    let status: (typeof STATUSES)[number] | undefined;
    let settlementStatus: (typeof SETTLEMENT_STATUSES)[number] | undefined;
    let page = 1;
    let pageSize = 20;

    try {
      dateFrom = parseDateParam(searchParams.get("dateFrom"), "dateFrom");
      dateTo = parseDateParam(searchParams.get("dateTo"), "dateTo");
      platform = enumParam(searchParams.get("platform"), PLATFORMS, "platform");
      status = enumParam(searchParams.get("status"), STATUSES, "status");
      settlementStatus = enumParam(
        searchParams.get("settlementStatus"),
        SETTLEMENT_STATUSES,
        "settlementStatus",
      );
      page = parsePositiveInteger(searchParams.get("page"), "page", 1);
      pageSize = parsePositiveInteger(searchParams.get("pageSize"), "pageSize", 20);
    } catch (error) {
      return badRequest(error instanceof Error ? error.message : "参数无效。");
    }

    if (dateFrom && dateTo && dateFrom > dateTo) {
      return badRequest("dateFrom 不能晚于 dateTo。");
    }

    if (pageSize > 100) {
      return badRequest("pageSize 不能大于 100。");
    }

    const productNameExact = searchParams.get("productNameExact")?.trim() || undefined;
    const skuEmpty = searchParams.get("skuEmpty") === "true";
    const rawSkuExact = searchParams.get("skuExact");
    if (skuEmpty && rawSkuExact) return badRequest("skuEmpty 与 skuExact 不能同时使用。");
    const skuExact = rawSkuExact == null ? undefined : normalizeSku(rawSkuExact) ?? undefined;
    if (rawSkuExact != null && !skuExact) return badRequest("skuExact 不能为空。");

    const report = await salesReportService.getSalesReportOrders({
      ownerId: DEFAULT_OWNER_ID,
      dateFrom,
      dateTo,
      platform,
      status,
      settlementStatus: settlementStatus ?? "ALL",
      keyword: searchParams.get("keyword")?.trim() || undefined,
      productNameExact,
      skuExact,
      skuEmpty,
      page,
      pageSize,
    });

    return Response.json(report);
  } catch (error) {
    console.error(error);
    return internalError();
  }
}
