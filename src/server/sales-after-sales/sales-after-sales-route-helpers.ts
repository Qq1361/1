import { salesAfterSalesQuery } from "./sales-after-sales-query";

export async function salesAfterSaleDetailResponse(ownerId: string, id: string, status = 200) {
  return Response.json(await salesAfterSalesQuery.getDetail(ownerId, id), { status });
}
