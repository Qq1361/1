import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { getPlatformReturnAvailableActions } from "./platform-return-inspection-rules";

const listInclude = {
  batch: { select: { id: true, batchNo: true, platform: true, shippedAt: true } },
  inventoryItem: {
    select: {
      id: true,
      inventoryCode: true,
      name: true,
      skuText: true,
      itemStatus: true,
      ownershipStatus: true,
      storageLocation: true,
    },
  },
  returnInspection: {
    select: {
      id: true,
      result: true,
      storageLocation: true,
      problemReason: true,
      note: true,
      inspectedAt: true,
      createdAt: true,
      updatedAt: true,
    },
  },
} satisfies Prisma.PlatformShipmentLineInclude;

const detailInclude = {
  batch: { select: { id: true, batchNo: true, platform: true, shippedAt: true, receivedAt: true } },
  inventoryItem: {
    select: {
      id: true,
      inventoryCode: true,
      name: true,
      skuText: true,
      itemStatus: true,
      ownershipStatus: true,
      storageLocation: true,
      shipmentLines: {
        orderBy: { createdAt: "desc" as const },
        take: 1,
        select: {
          id: true,
          batchId: true,
          lineStatus: true,
          createdAt: true,
          batch: { select: { batchNo: true, platform: true } },
        },
      },
    },
  },
  returnInspection: {
    include: {
      actionLogs: {
        orderBy: { createdAt: "desc" as const },
        select: {
          id: true,
          action: true,
          fromResult: true,
          toResult: true,
          note: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
  },
} satisfies Prisma.PlatformShipmentLineInclude;

type ListLine = Prisma.PlatformShipmentLineGetPayload<{ include: typeof listInclude }>;

type ListFilters = {
  platform?: string;
  shipmentBatchId?: string;
  shipmentLineId?: string;
  inventoryItemId?: string;
  inventoryStatus?: string;
  inspectionResult?: string;
  pendingOnly?: boolean;
  keyword?: string;
  page: number;
  pageSize: number;
};

type PendingFilters = {
  category?: string;
  platform?: string;
  batchId?: string;
  keyword?: string;
  page: number;
  pageSize: number;
};

const iso = (value: Date | null | undefined) => value?.toISOString() ?? null;

function safeMetadata(metadata: Prisma.JsonValue | null) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return null;
  const source = metadata as Record<string, unknown>;
  const summary: Record<string, string> = {};
  for (const key of ["previousStorageLocation", "newStorageLocation"]) {
    if (typeof source[key] === "string") summary[key] = source[key];
  }
  return Object.keys(summary).length ? summary : null;
}

function availableActions(line: {
  lineStatus: string;
  inventoryItem: { itemStatus: string; ownershipStatus: string };
  returnInspection: { result: string } | null;
}) {
  const result = getPlatformReturnAvailableActions({
    shipmentLineStatus: line.lineStatus,
    inventoryItemStatus: line.inventoryItem.itemStatus,
    ownershipStatus: line.inventoryItem.ownershipStatus,
    inspectionResult: line.returnInspection?.result,
  });
  return {
    availableActions: result.actions,
    legacyDirectRestock: result.legacyDirectRestock,
    canInspect: result.actions.includes("inspectReturn"),
    canRevise: result.actions.includes("reviseInspection"),
    canFinalize: result.actions.includes("finalizeInspection"),
    isFinal: Boolean(line.returnInspection && line.returnInspection.result !== "PENDING_DECISION"),
    canUseLegacyConfirmRestocked: result.actions.includes("inspectReturn") || result.actions.includes("finalizeInspection"),
  };
}

function toListDto(line: ListLine) {
  const inspection = line.returnInspection;
  const actions = availableActions(line);
  return {
    shipmentLineId: line.id,
    shipmentBatchId: line.batchId,
    batchNumber: line.batch.batchNo,
    platform: line.batch.platform,
    shipmentLineStatus: line.lineStatus,
    inventoryItemId: line.inventoryItem.id,
    inventoryCode: line.inventoryItem.inventoryCode,
    productName: line.inventoryItem.name,
    sku: line.inventoryItem.skuText,
    currentItemStatus: line.inventoryItem.itemStatus,
    ownershipStatus: line.inventoryItem.ownershipStatus,
    rejectReason: line.rejectedReason,
    returnCarrier: line.returnCarrierCode,
    returnTrackingNo: line.returnTrackingNo,
    returnShippedAt: iso(line.returnedAt),
    returnReceivedAt: iso(line.returnedAt),
    inspectionResult: inspection?.result ?? null,
    inspectedAt: iso(inspection?.inspectedAt),
    storageLocation: inspection?.storageLocation ?? line.inventoryItem.storageLocation,
    problemReason: inspection?.problemReason ?? null,
    updatedAt: iso(inspection?.updatedAt ?? line.updatedAt),
    ...actions,
  };
}

function pendingCategory(line: ListLine) {
  if (line.inventoryItem.itemStatus === "RETURNING") return "RETURNING";
  if (line.inventoryItem.itemStatus !== "RETURNED") return null;
  if (!line.returnInspection) return "PENDING_INSPECTION";
  return line.returnInspection.result === "PENDING_DECISION" ? "PENDING_DECISION" : null;
}

function keywordWhere(keyword?: string): Prisma.PlatformShipmentLineWhereInput | undefined {
  const value = keyword?.trim();
  if (!value) return undefined;
  return {
    OR: [
      { inventoryItem: { inventoryCode: { contains: value, mode: "insensitive" } } },
      { inventoryItem: { name: { contains: value, mode: "insensitive" } } },
      { inventoryItem: { skuText: { contains: value, mode: "insensitive" } } },
      { batch: { batchNo: { contains: value, mode: "insensitive" } } },
      { returnTrackingNo: { contains: value, mode: "insensitive" } },
    ],
  };
}

export class PlatformReturnInspectionQuery {
  async list(ownerId: string, filters: ListFilters) {
    const where: Prisma.PlatformShipmentLineWhereInput = {
      ownerId,
      lineStatus: { in: ["RETURNING", "RETURNED"] },
      ...(filters.platform ? { batch: { platform: filters.platform as never } } : {}),
      ...(filters.shipmentBatchId ? { batchId: filters.shipmentBatchId } : {}),
      ...(filters.shipmentLineId ? { id: filters.shipmentLineId } : {}),
      ...(filters.inventoryItemId ? { inventoryItemId: filters.inventoryItemId } : {}),
      ...(filters.inventoryStatus ? { inventoryItem: { itemStatus: filters.inventoryStatus as never } } : {}),
      ...(filters.inspectionResult ? { returnInspection: { result: filters.inspectionResult as never } } : {}),
      ...(keywordWhere(filters.keyword) ?? {}),
    };
    if (filters.pendingOnly) {
      where.AND = [{
        OR: [
          { lineStatus: "RETURNING", inventoryItem: { itemStatus: "RETURNING", ownershipStatus: "OWNED" } },
          {
            lineStatus: "RETURNED",
            inventoryItem: { itemStatus: "RETURNED", ownershipStatus: "OWNED" },
            OR: [{ returnInspection: null }, { returnInspection: { result: "PENDING_DECISION" } }],
          },
        ],
      }];
    }
    const [total, lines] = await Promise.all([
      db.platformShipmentLine.count({ where }),
      db.platformShipmentLine.findMany({
        where,
        include: listInclude,
        orderBy: [{ returnedAt: "desc" }, { updatedAt: "desc" }],
        skip: (filters.page - 1) * filters.pageSize,
        take: filters.pageSize,
      }),
    ]);
    return { items: lines.map(toListDto), page: filters.page, pageSize: filters.pageSize, total, totalPages: Math.ceil(total / filters.pageSize) };
  }

  async listPending(ownerId: string, filters: PendingFilters) {
    const where: Prisma.PlatformShipmentLineWhereInput = {
      ownerId,
      lineStatus: { in: ["RETURNING", "RETURNED"] },
      ...(filters.platform ? { batch: { platform: filters.platform as never } } : {}),
      ...(filters.batchId ? { batchId: filters.batchId } : {}),
      ...(keywordWhere(filters.keyword) ?? {}),
    };
    const lines = await db.platformShipmentLine.findMany({
      where,
      include: listInclude,
      orderBy: [{ returnedAt: "desc" }, { updatedAt: "desc" }],
    });
    const deduplicated = new Map<string, { line: ListLine; category: string }>();
    for (const line of lines) {
      const category = pendingCategory(line);
      if (!category || (filters.category && category !== filters.category)) continue;
      if (!deduplicated.has(line.inventoryItem.id)) deduplicated.set(line.inventoryItem.id, { line, category });
    }
    const items = [...deduplicated.values()].map(({ line, category }) => ({ ...toListDto(line), category }));
    const total = items.length;
    const start = (filters.page - 1) * filters.pageSize;
    return {
      items: items.slice(start, start + filters.pageSize),
      page: filters.page,
      pageSize: filters.pageSize,
      total,
      totalPages: Math.ceil(total / filters.pageSize),
    };
  }

  async getDetail(ownerId: string, shipmentLineId: string) {
    const line = await db.platformShipmentLine.findFirst({
      where: { id: shipmentLineId, ownerId },
      include: detailInclude,
    });
    if (!line) throw new ServiceError("PLATFORM_RETURN_LINE_NOT_FOUND", "平台退回记录不存在或无权访问。", 404);

    const inspection = line.returnInspection;
    const actions = availableActions(line);
    return {
      shipmentLine: {
        shipmentLineId: line.id,
        shipmentBatchId: line.batchId,
        batchNumber: line.batch.batchNo,
        platform: line.batch.platform,
        shipmentLineStatus: line.lineStatus,
        shippedAt: iso(line.batch.shippedAt),
        receivedAt: iso(line.batch.receivedAt),
        rejectedAt: iso(line.returnedAt),
        rejectReason: line.rejectedReason,
        returnCarrier: line.returnCarrierCode,
        returnTrackingNo: line.returnTrackingNo,
        returnReceivedAt: iso(line.returnedAt),
      },
      inventoryItem: {
        inventoryItemId: line.inventoryItem.id,
        inventoryCode: line.inventoryItem.inventoryCode,
        productName: line.inventoryItem.name,
        sku: line.inventoryItem.skuText,
        currentItemStatus: line.inventoryItem.itemStatus,
        ownershipStatus: line.inventoryItem.ownershipStatus,
        storageLocation: line.inventoryItem.storageLocation,
        currentShipmentCycle: line.inventoryItem.shipmentLines[0]
          ? {
              shipmentLineId: line.inventoryItem.shipmentLines[0].id,
              shipmentBatchId: line.inventoryItem.shipmentLines[0].batchId,
              batchNumber: line.inventoryItem.shipmentLines[0].batch.batchNo,
              platform: line.inventoryItem.shipmentLines[0].batch.platform,
              shipmentLineStatus: line.inventoryItem.shipmentLines[0].lineStatus,
              createdAt: iso(line.inventoryItem.shipmentLines[0].createdAt),
            }
          : null,
      },
      inspection: inspection ? {
        inspectionId: inspection.id,
        result: inspection.result,
        storageLocation: inspection.storageLocation,
        problemReason: inspection.problemReason,
        note: inspection.note,
        inspectedAt: iso(inspection.inspectedAt),
        createdAt: iso(inspection.createdAt),
        updatedAt: iso(inspection.updatedAt),
      } : null,
      actionLogs: inspection?.actionLogs.map((log) => ({
        id: log.id,
        action: log.action,
        fromResult: log.fromResult,
        toResult: log.toResult,
        note: log.note,
        metadata: safeMetadata(log.metadata),
        createdAt: iso(log.createdAt),
      })) ?? [],
      ...actions,
    };
  }
}

export const platformReturnInspectionQuery = new PlatformReturnInspectionQuery();
