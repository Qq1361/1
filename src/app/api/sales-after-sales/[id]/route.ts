import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseSalesAfterSaleJson, toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSalesQuery } from "@/server/sales-after-sales/sales-after-sales-query";
import { salesAfterSaleDetailResponse } from "@/server/sales-after-sales/sales-after-sales-route-helpers";
import { salesAfterSalesService } from "@/server/sales-after-sales/sales-after-sales-service";
import { updateSaleAfterSaleSchema } from "@/server/sales-after-sales/sales-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function GET(_request: Request, context: Context) {
  try { return Response.json(await salesAfterSalesQuery.getDetail(DEFAULT_OWNER_ID, (await context.params).id)); }
  catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
export async function PATCH(request: Request, context: Context) {
  try {
    const input = updateSaleAfterSaleSchema.parse(await parseSalesAfterSaleJson(request));
    const id = (await context.params).id;
    const current = await salesAfterSalesQuery.getDetail(DEFAULT_OWNER_ID, id);
    const afterSaleCase = await salesAfterSalesService.updateDraft(DEFAULT_OWNER_ID, id, {
      type: input.type ?? current.type,
      reason: input.reason ?? undefined,
      note: input.note ?? undefined,
      lines: input.lines?.map((line) => ({ ...line, note: line.note ?? undefined })),
    });
    return salesAfterSaleDetailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
