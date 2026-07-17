import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSaleDetailResponse } from "@/server/sales-after-sales/sales-after-sales-route-helpers";
import { salesAfterSalesService } from "@/server/sales-after-sales/sales-after-sales-service";

type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, context: Context) {
  try {
    const afterSaleCase = await salesAfterSalesService.prepareReturn(DEFAULT_OWNER_ID, (await context.params).id);
    return salesAfterSaleDetailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
