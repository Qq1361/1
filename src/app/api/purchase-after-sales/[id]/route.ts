import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseJsonBody, toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { purchaseAfterSalesQuery } from "@/server/purchase-after-sales/purchase-after-sales-query";
import { detailResponse } from "@/server/purchase-after-sales/purchase-after-sales-route-helpers";
import { purchaseAfterSalesService } from "@/server/purchase-after-sales/purchase-after-sales-service";
import { updatePurchaseAfterSaleSchema } from "@/server/purchase-after-sales/purchase-after-sales-validation";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    return Response.json(await purchaseAfterSalesQuery.getDetail(DEFAULT_OWNER_ID, (await context.params).id));
  } catch (error) {
    return toPurchaseAfterSaleErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const input = updatePurchaseAfterSaleSchema.parse(await parseJsonBody(request));
    const afterSaleCase = await purchaseAfterSalesService.updateDraft(DEFAULT_OWNER_ID, (await context.params).id, input);
    return detailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) {
    return toPurchaseAfterSaleErrorResponse(error);
  }
}
