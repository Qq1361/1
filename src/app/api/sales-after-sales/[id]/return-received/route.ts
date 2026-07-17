import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseOptionalSalesAfterSaleJson, toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSaleDetailResponse } from "@/server/sales-after-sales/sales-after-sales-route-helpers";
import { salesAfterSalesService } from "@/server/sales-after-sales/sales-after-sales-service";
import { returnReceivedSaleAfterSaleSchema } from "@/server/sales-after-sales/sales-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = returnReceivedSaleAfterSaleSchema.parse(await parseOptionalSalesAfterSaleJson(request));
    const afterSaleCase = await salesAfterSalesService.markReturnReceived(DEFAULT_OWNER_ID, (await context.params).id, { ...input, note: input.note ?? undefined });
    return salesAfterSaleDetailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
