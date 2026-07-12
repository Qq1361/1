import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { salesService } from "@/server/sales/sales-service";
import { z } from "zod";

const settleSchema = z.object({
  actualReceivedAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/, "请输入有效金额"),
});

type C = { params: Promise<{ id: string }> };
export async function POST(r: Request, c: C) {
  try {
    const input = settleSchema.parse(await r.json());
    return Response.json(await salesService.settle(DEFAULT_OWNER_ID, (await c.params).id, input));
  } catch (e) { return toErrorResponse(e); }
}
