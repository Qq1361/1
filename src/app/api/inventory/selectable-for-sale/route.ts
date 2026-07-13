import { DEFAULT_OWNER_ID } from "@/server/constants";
import { db } from "@/server/db";
import { toErrorResponse } from "@/server/errors";
import { Prisma } from "@/generated/prisma/client";

const SELECTABLE_STATUSES = [
  "STOCKED",
  "PLATFORM_SHIPPED",
  "PLATFORM_RECEIVED",
  "PLATFORM_IN_WAREHOUSE",
  "PLATFORM_LISTED",
] as const;

const STATUS_LABELS: Record<string, string> = {
  STOCKED: "已入库",
  PLATFORM_SHIPPED: "已发往平台",
  PLATFORM_RECEIVED: "平台已签收",
  PLATFORM_IN_WAREHOUSE: "入仓成功 / 鉴别通过",
  PLATFORM_LISTED: "平台已上架 / 可售",
  SOLD: "已售出",
  PROBLEM: "问题件",
  REMOVED: "已移出",
  RETURNING: "退回中",
  RETURNED: "已退回，待重新入库",
  PLATFORM_REJECTED: "平台拒收",
};

const SALE_MODE_LABELS: Record<string, string> = {
  NONE: "未选择",
  DEWU_LIGHTNING: "得物闪电",
  DEWU_STANDARD: "得物普通",
  NINETY_FIVE: "95分",
  XIANYU: "闲鱼",
  OTHER: "其他",
};

function saleModeMatches(query: string) {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return [];
  return Object.entries(SALE_MODE_LABELS)
    .filter(([key, label]) =>
      key.toLowerCase().includes(normalized) ||
      label.toLowerCase().includes(normalized),
    )
    .map(([key]) => key);
}

function selectableReason(itemStatus: string) {
  if (SELECTABLE_STATUSES.includes(itemStatus as (typeof SELECTABLE_STATUSES)[number])) {
    if (itemStatus === "PLATFORM_LISTED") return "可选择：平台已上架 / 可售，但不等于已售出。";
    return "可选择";
  }
  return `不可选择：${STATUS_LABELS[itemStatus] ?? itemStatus}`;
}

export async function GET(request: Request) {
  try {
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("query")?.trim() ?? "";
    const page = Math.max(1, parseInt(searchParams.get("page") ?? "1", 10) || 1);
    const pageSize = Math.min(50, Math.max(1, parseInt(searchParams.get("pageSize") ?? "20", 10) || 20));
    const modeMatches = saleModeMatches(query);

    const where: Prisma.InventoryItemWhereInput = {
      ownerId: DEFAULT_OWNER_ID,
      ...(query
        ? {
            OR: [
              { inventoryCode: { contains: query, mode: "insensitive" } },
              { name: { contains: query, mode: "insensitive" } },
              { skuText: { contains: query, mode: "insensitive" } },
              { storageLocation: { contains: query, mode: "insensitive" } },
              { purchaseOrderItem: { purchaseOrder: { orderNo: { contains: query, mode: "insensitive" } } } },
              { purchaseOrderItem: { purchaseOrder: { sellerNickname: { contains: query, mode: "insensitive" } } } },
              { shipmentLines: { some: { batch: { batchNo: { contains: query, mode: "insensitive" } } } } },
              { shipmentLines: { some: { group: { platformOrderNo: { contains: query, mode: "insensitive" } } } } },
              { shipmentLines: { some: { group: { platformTradeNo: { contains: query, mode: "insensitive" } } } } },
              ...(modeMatches.length
                ? [{ saleMode: { in: modeMatches as Prisma.EnumSaleModeFilter["in"] } }]
                : []),
            ],
          }
        : {}),
    };

    const [items, total] = await db.$transaction([
      db.inventoryItem.findMany({
        where,
        orderBy: { createdAt: "desc" },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          purchaseOrderItem: {
            select: {
              name: true,
              skuText: true,
              purchaseOrder: {
                select: { id: true, orderNo: true, sellerNickname: true },
              },
            },
          },
          shipmentLines: {
            orderBy: { createdAt: "desc" },
            take: 1,
            include: {
              batch: { select: { id: true, batchNo: true, status: true } },
              group: { select: { platformOrderNo: true, platformTradeNo: true, groupName: true } },
            },
          },
        },
      }),
      db.inventoryItem.count({ where }),
    ]);

    return Response.json({
      data: items.map((item) => ({
        ...item,
        selectable: SELECTABLE_STATUSES.includes(item.itemStatus as (typeof SELECTABLE_STATUSES)[number]),
        selectableReason: selectableReason(item.itemStatus),
        currentShipmentLine: item.shipmentLines[0] ?? null,
      })),
      total,
      page,
      pageSize,
      totalPages: Math.max(1, Math.ceil(total / pageSize)),
    });
  } catch (error) {
    return toErrorResponse(error);
  }
}
