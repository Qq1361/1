import { DEFAULT_OWNER_ID } from "@/server/constants";
import { db } from "@/server/db";
import { parseSalesAfterSaleJson, toSalesAfterSaleErrorResponse } from "@/server/sales-after-sales/sales-after-sales-api";
import { salesAfterSalesQuery } from "@/server/sales-after-sales/sales-after-sales-query";
import { salesAfterSalesService } from "@/server/sales-after-sales/sales-after-sales-service";
import { refundSaleAfterSaleSchema } from "@/server/sales-after-sales/sales-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = refundSaleAfterSaleSchema.parse(await parseSalesAfterSaleJson(request));
    const id = (await context.params).id;
    const existing = await db.saleRefundRecord.findFirst({ where: { ownerId: DEFAULT_OWNER_ID, afterSaleCaseId: id, idempotencyKey: input.idempotencyKey }, select: { id: true } });
    const refundRecord = await salesAfterSalesService.recordRefund(DEFAULT_OWNER_ID, id, {
      ...input,
      refundMethod: input.refundMethod ?? undefined,
      externalRefundNo: input.externalRefundNo ?? undefined,
      note: input.note ?? undefined,
    });
    const updatedCase = await salesAfterSalesQuery.getDetail(DEFAULT_OWNER_ID, id);
    const dtoRefundRecord = updatedCase.refundRecords.find((record) => record.id === refundRecord.id);
    return Response.json({ refundRecord: dtoRefundRecord, updatedCase, totals: updatedCase.totals }, { status: existing ? 200 : 201 });
  } catch (error) { return toSalesAfterSaleErrorResponse(error); }
}
