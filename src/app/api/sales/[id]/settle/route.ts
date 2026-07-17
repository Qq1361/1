import { DEFAULT_OWNER_ID } from "@/server/constants";
import { ServiceError, toErrorResponse } from "@/server/errors";
import { salesService } from "@/server/sales/sales-service";

const amountPattern = /^-?\d{1,10}(\.\d{1,2})?$/;

type C = { params: Promise<{ id: string }> };

export async function POST(request: Request, context: C) {
  try {
    const body = await request.json();
    const actualReceivedAmount = typeof body.actualReceivedAmount === "string"
      ? body.actualReceivedAmount.trim()
      : "";
    const settledAt = typeof body.settledAt === "string" && body.settledAt.trim()
      ? body.settledAt.trim()
      : undefined;
    const note = typeof body.note === "string" ? body.note : undefined;

    if (!amountPattern.test(actualReceivedAmount)) {
      throw new ServiceError("INVALID_ACTUAL_RECEIVED_AMOUNT", "请输入有效到账金额。", 400);
    }
    if (Number(actualReceivedAmount) < 0) {
      throw new ServiceError("INVALID_ACTUAL_RECEIVED_AMOUNT", "实际到账金额不能小于 0。", 400);
    }
    if (settledAt && Number.isNaN(new Date(settledAt).getTime())) {
      throw new ServiceError("INVALID_SETTLED_AT", "到账时间格式无效。", 400);
    }

    const result = await salesService.settle(DEFAULT_OWNER_ID, (await context.params).id, {
      actualReceivedAmount,
      settledAt,
      note,
    });
    return Response.json(result);
  } catch (error) {
    return toErrorResponse(error);
  }
}
