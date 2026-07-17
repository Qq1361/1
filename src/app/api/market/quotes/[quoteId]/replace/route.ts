import { DEFAULT_OWNER_ID } from "@/server/constants";
import { marketQuoteReplaceSchema, parseMarketJson, toMarketErrorResponse } from "@/server/market/market-api";
import { marketQuoteService } from "@/server/market/market-quote-service";
import { marketQuoteResponse } from "@/server/market/market-route-helpers";

type Context = { params: Promise<{ quoteId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const input = marketQuoteReplaceSchema.parse(await parseMarketJson(request));
    const result = await marketQuoteService.correctMarketQuote(DEFAULT_OWNER_ID, (await context.params).quoteId, input);
    return await marketQuoteResponse(DEFAULT_OWNER_ID, result.replacementQuote.quote.id, 201);
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
