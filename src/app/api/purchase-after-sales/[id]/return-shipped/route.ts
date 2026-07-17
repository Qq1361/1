import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseJsonBody, toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { detailResponse } from "@/server/purchase-after-sales/purchase-after-sales-route-helpers";
import { purchaseAfterSalesService } from "@/server/purchase-after-sales/purchase-after-sales-service";
import { returnShippedSchema } from "@/server/purchase-after-sales/purchase-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = returnShippedSchema.parse(await parseJsonBody(request));
    const afterSaleCase = await purchaseAfterSalesService.markReturnShipped(DEFAULT_OWNER_ID, (await context.params).id, input);
    return detailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toPurchaseAfterSaleErrorResponse(error); }
}
