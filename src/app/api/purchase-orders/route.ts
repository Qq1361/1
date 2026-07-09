import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { purchaseOrderService } from "@/server/services/purchase-order-service";
import {
  orderListQuerySchema,
  purchaseOrderSchema,
} from "@/server/validation/purchase-order";

export async function GET(request: Request) {
  try {
    const params = Object.fromEntries(new URL(request.url).searchParams);
    const query = orderListQuerySchema.parse(params);
    return Response.json(
      await purchaseOrderService.listOrders(DEFAULT_OWNER_ID, query),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = purchaseOrderSchema.parse(await request.json());
    return Response.json(
      await purchaseOrderService.createOrder(DEFAULT_OWNER_ID, input),
      { status: 201 },
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
