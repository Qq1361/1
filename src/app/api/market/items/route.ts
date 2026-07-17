import { DEFAULT_OWNER_ID } from "@/server/constants";
import { marketItemCreateSchema, marketItemsListQuerySchema, parseMarketJson, queryObject, toMarketErrorResponse } from "@/server/market/market-api";
import { marketItemService } from "@/server/market/market-item-service";
import { marketQuery } from "@/server/market/market-query";
import { marketItemDetailResponse } from "@/server/market/market-route-helpers";

export async function GET(request: Request) {
  try {
    const filters = marketItemsListQuerySchema.parse(queryObject(request));
    const result = await marketQuery.listMarketItems(DEFAULT_OWNER_ID, filters);
    return Response.json({
      items: result.items,
      pagination: {
        page: result.page,
        pageSize: result.pageSize,
        total: result.total,
        totalPages: Math.max(1, Math.ceil(result.total / result.pageSize)),
      },
      appliedFilters: {
        keyword: filters.keyword ?? null,
        platform: filters.platform ?? null,
        quoteType: filters.quoteType ?? null,
        active: filters.active ?? null,
        hasCurrentQuote: filters.hasCurrentQuote ?? null,
      },
    });
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const result = await marketItemService.createMarketItem(DEFAULT_OWNER_ID, marketItemCreateSchema.parse(await parseMarketJson(request)));
    return await marketItemDetailResponse(DEFAULT_OWNER_ID, result.marketItem.id, 201, { potentialDuplicates: result.potentialDuplicates, warnings: result.warnings });
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
