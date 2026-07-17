import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { parseJsonBody, toPurchaseAfterSaleErrorResponse } from "@/server/purchase-after-sales/purchase-after-sales-api";
import { detailResponse } from "@/server/purchase-after-sales/purchase-after-sales-route-helpers";
import { purchaseAfterSalesService } from "@/server/purchase-after-sales/purchase-after-sales-service";

const cancelSchema = z.object({
  reason: z.string().trim().max(1000).optional(),
  note: z.string().trim().max(2000).optional(),
}).strict().superRefine((value, ctx) => {
  if (!value.reason && !value.note) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["reason"], message: "请填写取消原因或备注。" });
});

type Context = { params: Promise<{ id: string }> };
export async function POST(request: Request, context: Context) {
  try {
    const input = cancelSchema.parse(await parseJsonBody(request));
    const note = [input.reason, input.note].filter(Boolean).join("\n");
    const afterSaleCase = await purchaseAfterSalesService.cancel(DEFAULT_OWNER_ID, (await context.params).id, note);
    return detailResponse(DEFAULT_OWNER_ID, afterSaleCase.id);
  } catch (error) { return toPurchaseAfterSaleErrorResponse(error); }
}
