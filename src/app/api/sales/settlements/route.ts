import { DEFAULT_OWNER_ID } from "@/server/constants";
import { ServiceError, toErrorResponse } from "@/server/errors";
import { salesService } from "@/server/sales/sales-service";

const PLATFORMS = ["DEWU", "NINETY_FIVE", "XIANYU", "OTHER"] as const;
const SETTLEMENT_STATUSES = ["ALL", "SETTLED", "UNSETTLED"] as const;

function parsePositiveInt(value: string | null, fallback: number, field: string) {
  if (value == null || value === "") return fallback;
  if (!/^\d+$/.test(value)) {
    throw new ServiceError("INVALID_QUERY_PARAM", `${field} 参数无效。`, 400);
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) {
    throw new ServiceError("INVALID_QUERY_PARAM", `${field} 参数无效。`, 400);
  }
  return parsed;
}

function enumParam<T extends readonly string[]>(value: string | null, values: T, field: string) {
  if (!value) return undefined;
  if (!values.includes(value)) {
    throw new ServiceError("INVALID_QUERY_PARAM", `${field} 参数无效。`, 400);
  }
  return value as T[number];
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parsePositiveInt(searchParams.get("page"), 1, "page");
    const rawPageSize = parsePositiveInt(searchParams.get("pageSize"), 20, "pageSize");
    if (rawPageSize > 100) {
      throw new ServiceError("INVALID_QUERY_PARAM", "pageSize 不能超过 100。", 400);
    }

    const result = await salesService.listSettlements(DEFAULT_OWNER_ID, {
      platform: enumParam(searchParams.get("platform"), PLATFORMS, "platform"),
      settlementStatus: enumParam(searchParams.get("settlementStatus"), SETTLEMENT_STATUSES, "settlementStatus"),
      keyword: searchParams.get("keyword") ?? undefined,
      page,
      pageSize: rawPageSize,
    });
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
