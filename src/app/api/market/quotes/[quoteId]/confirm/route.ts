import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toMarketErrorResponse } from "@/server/market/market-api";
import { marketQuoteService } from "@/server/market/market-quote-service";
import { marketQuoteResponse } from "@/server/market/market-route-helpers";

type Context = { params: Promise<{ quoteId: string }> };

export async function POST(_: Request, context: Context) {
  try {
    const id = (await context.params).quoteId;
    await marketQuoteService.confirmMarketQuote(DEFAULT_OWNER_ID, id);
    return await marketQuoteResponse(DEFAULT_OWNER_ID, id);
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
