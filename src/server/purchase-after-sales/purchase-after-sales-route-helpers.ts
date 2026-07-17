import { purchaseAfterSalesQuery } from "./purchase-after-sales-query";

export async function detailResponse(ownerId: string, id: string, status = 200) {
  return Response.json(await purchaseAfterSalesQuery.getDetail(ownerId, id), { status });
}
