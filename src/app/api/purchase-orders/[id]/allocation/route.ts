import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { costAllocationService } from "@/server/services/cost-allocation-service";
import { allocationSchema } from "@/server/validation/purchase-order";

type Context = { params: Promise<{ id: string }> };

export async function GET(_request: Request, context: Context) {
  try {
    const { id } = await context.params;
    return Response.json(
      await costAllocationService.getSummary(DEFAULT_OWNER_ID, id),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function PUT(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const input = allocationSchema.parse(await request.json());
    if (input.action === "reopen") {
      return Response.json(
        await costAllocationService.reopen(DEFAULT_OWNER_ID, id),
      );
    }
    return Response.json(
      await costAllocationService.save(
        DEFAULT_OWNER_ID,
        id,
        input.allocations,
        input.action === "confirm",
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
