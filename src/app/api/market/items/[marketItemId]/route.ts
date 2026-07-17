import { DEFAULT_OWNER_ID } from "@/server/constants";
import { marketItemUpdateSchema, parseMarketJson, toMarketErrorResponse } from "@/server/market/market-api";
import { marketItemService } from "@/server/market/market-item-service";
import { marketItemDetailResponse } from "@/server/market/market-route-helpers";

type Context = { params: Promise<{ marketItemId: string }> };

export async function GET(_: Request, context: Context) {
  try {
    return await marketItemDetailResponse(DEFAULT_OWNER_ID, (await context.params).marketItemId);
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const id = (await context.params).marketItemId;
    const result = await marketItemService.updateMarketItem(DEFAULT_OWNER_ID, id, marketItemUpdateSchema.parse(await parseMarketJson(request)));
    return await marketItemDetailResponse(DEFAULT_OWNER_ID, id, 200, { potentialDuplicates: result.potentialDuplicates, warnings: result.warnings });
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
