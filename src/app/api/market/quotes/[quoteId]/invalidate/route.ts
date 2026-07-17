import { DEFAULT_OWNER_ID } from "@/server/constants";
import { marketQuoteInvalidateSchema, parseMarketJson, toMarketErrorResponse } from "@/server/market/market-api";
import { marketQuoteService } from "@/server/market/market-quote-service";
import { marketQuoteResponse } from "@/server/market/market-route-helpers";

type Context = { params: Promise<{ quoteId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const id = (await context.params).quoteId;
    await marketQuoteService.invalidateMarketQuote(DEFAULT_OWNER_ID, id, marketQuoteInvalidateSchema.parse(await parseMarketJson(request)).reason);
    return await marketQuoteResponse(DEFAULT_OWNER_ID, id);
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
