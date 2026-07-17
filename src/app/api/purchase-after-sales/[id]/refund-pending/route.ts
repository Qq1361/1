import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseOptionalJsonBody, toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { detailResponse } from "@/server/purchase-after-sales/purchase-after-sales-route-helpers";
import { purchaseAfterSalesService } from "@/server/purchase-after-sales/purchase-after-sales-service";
import { optionalNoteSchema } from "@/server/purchase-after-sales/purchase-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = optionalNoteSchema.parse(await parseOptionalJsonBody(request));
    const afterSaleCase = await purchaseAfterSalesService.markRefundPending(DEFAULT_OWNER_ID, (await context.params).id, input.note);
    return detailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toPurchaseAfterSaleErrorResponse(error); }
}
