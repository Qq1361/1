import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { purchaseAfterSalesQuery } from "@/server/purchase-after-sales/purchase-after-sales-query";
import { eligibleItemsQuerySchema } from "@/server/purchase-after-sales/purchase-after-sales-validation";

export async function GET(request: Request) {
  try {
    const query = eligibleItemsQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await purchaseAfterSalesQuery.eligibleItems(DEFAULT_OWNER_ID, query));
  } catch (error) {
    return toPurchaseAfterSaleErrorResponse(error);
  }
}
