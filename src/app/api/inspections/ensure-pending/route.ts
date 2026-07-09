import { z } from "zod";
import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { inspectionService } from "@/server/services/inspection-service";

const schema = z.object({ orderId: z.string().cuid().optional() });

export async function POST(request: Request) {
  try {
    const input = schema.parse(await request.json().catch(() => ({})));
    return Response.json(
      await inspectionService.ensurePendingInspections(DEFAULT_OWNER_ID, input.orderId),
    );
  } catch (error) {
    return toErrorResponse(error);
  }
}
