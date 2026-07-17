import { DEFAULT_OWNER_ID } from "@/server/constants";
import { db } from "@/server/db";
import { parseJsonBody, toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { purchaseAfterSalesQuery } from "@/server/purchase-after-sales/purchase-after-sales-query";
import { purchaseAfterSalesService } from "@/server/purchase-after-sales/purchase-after-sales-service";
import { refundSchema } from "@/server/purchase-after-sales/purchase-after-sales-validation";

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = refundSchema.parse(await parseJsonBody(request));
    const id = (await context.params).id;
    const existing = await db.purchaseRefundRecord.findFirst({
      where: { ownerId: DEFAULT_OWNER_ID, afterSaleCaseId: id, idempotencyKey: input.idempotencyKey },
      select: { id: true },
    });
    const refundRecord = await purchaseAfterSalesService.recordRefund(DEFAULT_OWNER_ID, id, input);
    const updatedCase = await purchaseAfterSalesQuery.getDetail(DEFAULT_OWNER_ID, id);
    const dtoRefundRecord = updatedCase.refundRecords.find((record) => record.id === refundRecord.id);
    return Response.json({ refundRecord: dtoRefundRecord, updatedCase, totals: updatedCase.totals }, { status: existing ? 200 : 201 });
  } catch (error) { return toPurchaseAfterSaleErrorResponse(error); }
}
