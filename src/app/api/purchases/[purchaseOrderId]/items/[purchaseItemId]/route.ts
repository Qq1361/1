import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { purchaseOrderService } from "@/server/services/purchase-order-service";
import { purchaseItemMutationSchema } from "@/server/validation/purchase-order";

type Context = { params: Promise<{ purchaseOrderId: string; purchaseItemId: string }> };

export async function PATCH(request: Request, context: Context) {
  try {
    const { purchaseOrderId, purchaseItemId } = await context.params;
    const parsed = purchaseItemMutationSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        { code: "VALIDATION_ERROR", message: "商品明细参数无效。", fieldErrors: parsed.error.flatten().fieldErrors },
        { status: 400 },
      );
    }
    return Response.json(
      await purchaseOrderService.updatePurchaseItem(DEFAULT_OWNER_ID, purchaseOrderId, purchaseItemId, parsed.data),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { purchaseOrderId, purchaseItemId } = await context.params;
    return Response.json(
      await purchaseOrderService.deletePurchaseItem(DEFAULT_OWNER_ID, purchaseOrderId, purchaseItemId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
