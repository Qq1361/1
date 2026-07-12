import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { salesService } from "@/server/sales/sales-service";
import { z } from "zod";

const createSchema = z.object({
  platform: z.string().min(1),
  platformOrderNo: z.string().optional(),
  platformTradeNo: z.string().optional(),
  buyerName: z.string().optional(),
  soldAt: z.string().min(1),
  grossAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
  expectedIncome: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
  actualReceivedAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
  shippingCost: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).default("0"),
  otherCost: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).default("0"),
  note: z.string().optional(),
  items: z.array(z.object({
    inventoryItemId: z.string().min(1),
    saleAmount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/).optional(),
  })).min(1),
  feeLines: z.array(z.object({
    feeType: z.enum(["PLATFORM_COMMISSION", "AUTHENTICATION", "SHIPPING", "PACKAGING", "OTHER"]),
    amount: z.string().regex(/^\d{1,10}(\.\d{1,2})?$/),
    note: z.string().optional(),
  })).optional(),
});

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const q = searchParams.get("q") ?? undefined;
    const status = searchParams.get("status") ?? undefined;
    const platform = searchParams.get("platform") ?? undefined;
    const page = parseInt(searchParams.get("page") ?? "1");
    const pageSize = Math.min(parseInt(searchParams.get("pageSize") ?? "20"), 100);

    const { db } = await import("@/server/db");

    const where: Record<string, unknown> = { ownerId: DEFAULT_OWNER_ID };
    if (status) where.status = status;
    if (platform) where.platform = platform;
    if (q) {
      where.OR = [
        { saleNo: { contains: q, mode: "insensitive" } },
        { platformOrderNo: { contains: q, mode: "insensitive" } },
        { platformTradeNo: { contains: q, mode: "insensitive" } },
        { lines: { some: { inventoryCodeSnapshot: { contains: q, mode: "insensitive" } } } },
        { lines: { some: { productNameSnapshot: { contains: q, mode: "insensitive" } } } },
      ];
    }

    const [data, total] = await Promise.all([
      db.saleOrder.findMany({
        where,
        include: { _count: { select: { lines: true } } },
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      db.saleOrder.count({ where }),
    ]);
    return Response.json({ data, total, page, pageSize, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  } catch (error) {
    return toErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const input = createSchema.parse(await request.json());
    const result = await salesService.createDraft(DEFAULT_OWNER_ID, input);
    return Response.json(result, { status: 201 });
  } catch (error) {
    return toErrorResponse(error);
  }
}
