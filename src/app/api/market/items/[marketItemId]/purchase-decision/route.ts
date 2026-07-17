import { DEFAULT_OWNER_ID } from "@/server/constants";
import { marketPurchaseDecisionSchema, parseMarketJson, toMarketErrorResponse } from "@/server/market/market-api";
import { marketDecisionService } from "@/server/market/market-decision-service";

type Context = { params: Promise<{ marketItemId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const body = marketPurchaseDecisionSchema.parse(await parseMarketJson(request));
    return Response.json(await marketDecisionService.calculatePurchaseDecision(DEFAULT_OWNER_ID, {
      marketItemId: (await context.params).marketItemId,
      ...body,
    }));
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
