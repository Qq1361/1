import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toMarketErrorResponse } from "@/server/market/market-api";
import { marketItemService } from "@/server/market/market-item-service";
import { marketItemDetailResponse } from "@/server/market/market-route-helpers";

type Context = { params: Promise<{ marketItemId: string }> };

export async function POST(_: Request, context: Context) {
  try {
    const id = (await context.params).marketItemId;
    await marketItemService.setMarketItemActive(DEFAULT_OWNER_ID, id, false);
    return await marketItemDetailResponse(DEFAULT_OWNER_ID, id);
  } catch (error) {
    return toMarketErrorResponse(error);
  }
}
