import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSalesQuery } from "@/server/sales-after-sales/sales-after-sales-query";
import { eligibleLinesQuerySchema } from "@/server/sales-after-sales/sales-after-sales-validation";

export async function GET(request: Request) {
  try {
    const query = eligibleLinesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await salesAfterSalesQuery.eligibleLines(DEFAULT_OWNER_ID, query));
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
