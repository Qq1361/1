import { DEFAULT_OWNER_ID } from "@/server/constants";
import { purchaseAfterSalesQuery } from "@/server/purchase-after-sales/purchase-after-sales-query";
import { parseJsonBody, toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { createPurchaseAfterSaleSchema, listPurchaseAfterSalesQuerySchema } from "@/server/purchase-after-sales/purchase-after-sales-validation";
import { detailResponse } from "@/server/purchase-after-sales/purchase-after-sales-route-helpers";
import { purchaseAfterSalesService } from "@/server/purchase-after-sales/purchase-after-sales-service";

export async function GET(request: Request) {
  try {
    const query = listPurchaseAfterSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await purchaseAfterSalesQuery.list(DEFAULT_OWNER_ID, query));
  } catch (error) {
    return toPurchaseAfterSaleErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createPurchaseAfterSaleSchema.parse(await parseJsonBody(request));
    const afterSaleCase = await purchaseAfterSalesService.createDraft(DEFAULT_OWNER_ID, input);
    return detailResponse(DEFAULT_OWNER_ID, afterSaleCase.id, 201);
  } catch (error) {
    return toPurchaseAfterSaleErrorResponse(error);
  }
}
