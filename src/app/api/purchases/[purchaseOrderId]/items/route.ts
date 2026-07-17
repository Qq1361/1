import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { purchaseOrderService } from "@/server/services/purchase-order-service";
import { purchaseItemMutationSchema } from "@/server/validation/purchase-order";

type Context = { params: Promise<{ purchaseOrderId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { purchaseOrderId } = await context.params;
    const parsed = purchaseItemMutationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { code: "VALIDATION_ERROR", message: "商品明细参数无效。", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    return Response.json(
      await purchaseOrderService.addPurchaseItem(DEFAULT_OWNER_ID, purchaseOrderId, parsed.data),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
