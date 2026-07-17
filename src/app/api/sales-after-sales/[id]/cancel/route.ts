import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseSalesAfterSaleJson, toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSaleDetailResponse } from "@/server/sales-after-sales/sales-after-sales-route-helpers";
import { salesAfterSalesService } from "@/server/sales-after-sales/sales-after-sales-service";
import { reasonOrNoteSchema } from "@/server/sales-after-sales/sales-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = reasonOrNoteSchema.parse(await parseSalesAfterSaleJson(request));
    const note = [input.reason, input.note].filter(Boolean).join("\n");
    const afterSaleCase = await salesAfterSalesService.cancel(DEFAULT_OWNER_ID, (await context.params).id, note);
    return salesAfterSaleDetailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
