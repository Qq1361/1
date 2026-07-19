import { DEFAULT_OWNER_ID } from "@/server/constants";
import { serializeDateOnlyFields } from "@/lib/date-only";
import { toErrorResponse } from "@/server/errors";
import { inventoryService } from "@/server/services/inventory-service";
import { ServiceError } from "@/server/errors";
import { inventoryUpdateSchema } from "@/server/validation/inventory";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    return Response.json(
      serializeDateOnlyFields(await inventoryService.get(DEFAULT_OWNER_ID, (await context.params).id)),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PATCH(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const input: unknown = await request.json();
    if (containsStatusField(input)) {
      throw new ServiceError(
        "INVENTORY_PROTECTED_FIELD_UPDATE_FORBIDDEN",
        "库存状态和资产归属不能通过通用编辑接口修改，请使用对应业务流程。",
        400,
      );
    }
    return Response.json(
      serializeDateOnlyFields(await inventoryService.update(DEFAULT_OWNER_ID, id, inventoryUpdateSchema.parse(input))),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

function containsStatusField(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.entries(value as Record<string, unknown>).some(([key, child]) =>
    key === "itemStatus" || key === "status" || key === "ownershipStatus" || containsStatusField(child),
  );
}
