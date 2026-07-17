import { DEFAULT_OWNER_ID } from "@/server/constants";
import { marketQuoteCreateSchema, marketQuoteHistoryQuerySchema, parseMarketJson, queryObject, toMarketErrorResponse } from "@/server/market/market-api";
import { marketQuery } from "@/server/market/market-query";
import { marketQuoteService } from "@/server/market/market-quote-service";
import { marketQuoteResponse } from "@/server/market/market-route-helpers";

type Context = { params: Promise<{ marketItemId: string }> };

export async function GET(request: Request, context: Context) {
  try {
    const id = (await context.params).marketItemId;
    const filters = marketQuoteHistoryQuerySchema.parse(queryObject(request));
    const detail = await marketQuery.getMarketItemDetail(DEFAULT_OWNER_ID, id, {
      ...filters,
      dateFrom: filters.dateFrom ? new Date(filters.dateFrom) : undefined,
      dateTo: filters.dateTo ? new Date(filters.dateTo) : undefined,
    });
    return Response.json({ marketItem: detail.marketItem, ...detail.history });
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}

export async function POST(request: Request, context: Context) {
  try {
    const result = await marketQuoteService.createMarketQuote(DEFAULT_OWNER_ID, {
      marketItemId: (await context.params).marketItemId,
      ...marketQuoteCreateSchema.parse(await parseMarketJson(request)),
    });
    return await marketQuoteResponse(DEFAULT_OWNER_ID, result.quote.id, 201);
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
