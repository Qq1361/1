import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { purchaseOrderService } from "@/server/services/purchase-order-service";
import { purchaseItemEntryErrorRemovalSchema } from "@/server/validation/purchase-order";

type Context = { params: Promise<{ purchaseOrderId: string; purchaseItemId: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { purchaseOrderId, purchaseItemId } = await context.params;
    const parsed = purchaseItemEntryErrorRemovalSchema.safeParse(await request.json());
    if (!parsed.success) {
      return Response.json(
        {
          code: "VALIDATION_ERROR",
          message: "移除误录商品的原因参数无效。",
          fieldErrors: parsed.error.flatten().fieldErrors,
        },
        { status: 400 },
      );
    }
    return Response.json(
      await purchaseOrderService.removePurchaseItemAsEntryError(
        DEFAULT_OWNER_ID,
        purchaseOrderId,
        purchaseItemId,
        parsed.data,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
