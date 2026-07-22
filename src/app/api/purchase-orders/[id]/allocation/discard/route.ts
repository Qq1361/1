import { DEFAULT_OWNER_ID } from "@/server/constants";
import { ServiceError, toErrorResponse } from "@/server/errors";
import { costAllocationService } from "@/server/services/cost-allocation-service";
import { discardAllocationDraftSchema } from "@/server/validation/purchase-order";

type Context = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: Context) {
  try {
    const { id } = await context.params;
    const body = await request.json().catch(() => {
      throw new ServiceError("INVALID_ALLOCATION_DRAFT_DISCARD_REQUEST", "请求 JSON 无效。", 400);
    });
    const parsed = discardAllocationDraftSchema.safeParse(body);
    if (!parsed.success) {
      throw new ServiceError(
        "INVALID_ALLOCATION_DRAFT_DISCARD_REQUEST",
        "放弃成本分摊草稿的请求参数无效。",
        400,
      );
    }
    const input = parsed.data;
    return Response.json(
      await costAllocationService.discardDraft(
        DEFAULT_OWNER_ID,
        id,
        input.expectedAllocationVersion,
      ),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
