import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { detailResponse } from "@/server/purchase-after-sales/purchase-after-sales-route-helpers";
import { purchaseAfterSalesService } from "@/server/purchase-after-sales/purchase-after-sales-service";

type Context = { params: Promise<{ id: string }> };
export async function POST(_request: Request, context: Context) {
  try {
    const afterSaleCase = await purchaseAfterSalesService.prepareReturn(DEFAULT_OWNER_ID, (await context.params).id);
    return detailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toPurchaseAfterSaleErrorResponse(error); }
}
