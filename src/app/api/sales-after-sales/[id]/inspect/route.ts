import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseSalesAfterSaleJson, toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSaleDetailResponse } from "@/server/sales-after-sales/sales-after-sales-route-helpers";
import { salesAfterSalesService } from "@/server/sales-after-sales/sales-after-sales-service";
import { inspectSaleAfterSaleSchema } from "@/server/sales-after-sales/sales-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = inspectSaleAfterSaleSchema.parse(await parseSalesAfterSaleJson(request));
    const afterSaleCase = await salesAfterSalesService.inspectReturn(DEFAULT_OWNER_ID, (await context.params).id, input.inspections.map((item) => ({ ...item, storageLocation: item.storageLocation ?? undefined, problemReason: item.problemReason ?? undefined, note: item.note ?? undefined })));
    return salesAfterSaleDetailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
