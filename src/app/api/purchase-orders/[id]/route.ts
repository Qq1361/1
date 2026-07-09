import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { purchaseOrderService } from "@/server/services/purchase-order-service";
import { purchaseOrderSchema } from "@/server/validation/purchase-order";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(
      await purchaseOrderService.getOrder(DEFAULT_OWNER_ID, id),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const input = purchaseOrderSchema.parse(await request.json());
    return Response.json(
      await purchaseOrderService.updateOrder(DEFAULT_OWNER_ID, id, input),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function DELETE(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    await purchaseOrderService.deleteOrder(DEFAULT_OWNER_ID, id);
    return new Response(null, { status: 204 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
