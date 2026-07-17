import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseSalesAfterSaleJson, toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSalesQuery } from "@/server/sales-after-sales/sales-after-sales-query";
import { salesAfterSaleDetailResponse } from "@/server/sales-after-sales/sales-after-sales-route-helpers";
import { salesAfterSalesService } from "@/server/sales-after-sales/sales-after-sales-service";
import { createSaleAfterSaleSchema, listSaleAfterSalesQuerySchema } from "@/server/sales-after-sales/sales-after-sales-validation";

export async function GET(request: Request) {
  try {
    const query = listSaleAfterSalesQuerySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    return Response.json(await salesAfterSalesQuery.list(DEFAULT_OWNER_ID, query));
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const input = createSaleAfterSaleSchema.parse(await parseSalesAfterSaleJson(request));
    const afterSaleCase = await salesAfterSalesService.createDraft(DEFAULT_OWNER_ID, {
      ...input,
      reason: input.reason ?? undefined,
      note: input.note ?? undefined,
      lines: input.lines.map((line) => ({ ...line, note: line.note ?? undefined })),
    });
    return salesAfterSaleDetailResponse(DEFAULT_OWNER_ID, afterSaleCase.id, 201);
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
