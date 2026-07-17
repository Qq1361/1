import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import {
  canReviseInspection,
  getInventoryTargetStatus,
  isFinalInspectionResult,
  isIdempotentInspectionRetry,
  normalizePlatformReturnInspectionInput,
  type PlatformReturnInspectionInput,
  validatePlatformReturnInspectionInput,
} from "./platform-return-inspection-rules";

type InspectReturnInput = PlatformReturnInspectionInput & {
  ownerId: string;
  shipmentLineId: string;
};

type TransactionClient = Prisma.TransactionClient;

const lineInclude = {
  batch: true,
  inventoryItem: true,
  returnInspection: {
    include: { actionLogs: { orderBy: { createdAt: "asc" as const } } },
  },
} satisfies Prisma.PlatformShipmentLineInclude;

type PlatformReturnLine = Prisma.PlatformShipmentLineGetPayload<{ include: typeof lineInclude }>;

function isKnownPrismaError(error: unknown, code: string) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === code;
}

export class PlatformReturnInspectionService {
  async inspectReturn(input: InspectReturnInput) {
    const normalized = normalizePlatformReturnInspectionInput(input);
    const fieldErrors = validatePlatformReturnInspectionInput(normalized);
    if (Object.keys(fieldErrors).length) {
      throw new ServiceError("PLATFORM_RETURN_INSPECTION_VALIDATION", "请检查平台退回验货信息。", 400, fieldErrors);
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        return await db.$transaction(
          (tx) => this.inspectInTransaction(tx, input.ownerId, input.shipmentLineId, normalized),
          { isolationLevel: "Serializable" },
        );
      } catch (error) {
        if (isKnownPrismaError(error, "P2034") && attempt === 0) continue;
        if (isKnownPrismaError(error, "P2002")) {
          const retried = await this.readIdempotentRetry(input.ownerId, input.shipmentLineId, normalized);
          if (retried) return retried;
          throw new ServiceError("PLATFORM_RETURN_INSPECTION_CONFLICT", "平台退回验货记录已被其他请求处理，请刷新后重试。", 409);
        }
        throw error;
      }
    }

    throw new ServiceError("PLATFORM_RETURN_INSPECTION_CONFLICT", "平台退回验货发生并发冲突，请重试。", 409);
  }

  private async readIdempotentRetry(
    ownerId: string,
    shipmentLineId: string,
    input: ReturnType<typeof normalizePlatformReturnInspectionInput>,
  ) {
    const line = await db.platformShipmentLine.findFirst({
      where: { id: shipmentLineId, ownerId },
      include: lineInclude,
    });
    if (!line?.inventoryItem || !line.returnInspection) return null;
    if (!isFinalInspectionResult(line.returnInspection.result)) return null;
    if (!isIdempotentInspectionRetry(line.returnInspection, input)) return null;
    if (line.inventoryItem.itemStatus !== getInventoryTargetStatus(input.result)) return null;
    return this.toResult(line);
  }

  private async inspectInTransaction(
    tx: TransactionClient,
    ownerId: string,
    shipmentLineId: string,
    input: ReturnType<typeof normalizePlatformReturnInspectionInput>,
  ) {
    const line = await tx.platformShipmentLine.findFirst({
      where: { id: shipmentLineId, ownerId },
      include: lineInclude,
    });
    if (!line) throw new ServiceError("PLATFORM_RETURN_LINE_NOT_FOUND", "平台寄送明细不存在或无权访问。", 404);
    if (!line.inventoryItemId || !line.inventoryItem || line.inventoryItem.ownerId !== ownerId) {
      throw new ServiceError("PLATFORM_RETURN_INVENTORY_NOT_FOUND", "平台寄送明细未关联当前用户库存。", 404);
    }
    if (line.lineStatus !== "RETURNED") {
      throw new ServiceError("PLATFORM_RETURN_LINE_NOT_RETURNED", "只有已退回的寄送明细可以登记退回验货。", 409);
    }
    if (line.inventoryItem.ownershipStatus !== "OWNED") {
      throw new ServiceError("PLATFORM_RETURN_INVENTORY_NOT_OWNED", "非自有库存不能登记平台退回验货。", 409);
    }

    const newerCycle = await tx.platformShipmentLine.findFirst({
      where: {
        ownerId,
        inventoryItemId: line.inventoryItemId,
        id: { not: line.id },
        createdAt: { gt: line.createdAt },
        lineStatus: { not: "CANCELLED" },
      },
      select: { id: true },
    });
    if (newerCycle) {
      throw new ServiceError("PLATFORM_RETURN_STALE_CYCLE", "该库存已进入新的平台寄送周期，不能通过旧退回明细处理。", 409);
    }

    const existing = line.returnInspection;
    if (existing && isFinalInspectionResult(existing.result)) {
      if (
        isIdempotentInspectionRetry(existing, input) &&
        line.inventoryItem.itemStatus === getInventoryTargetStatus(input.result)
      ) {
        return this.toResult(line);
      }
      throw new ServiceError("PLATFORM_RETURN_INSPECTION_FINAL", "平台退回验货已完成，不能普通修改。", 409);
    }

    if (line.inventoryItem.itemStatus !== "RETURNED") {
      throw new ServiceError("PLATFORM_RETURN_INVENTORY_NOT_RETURNED", "库存当前不是已退回状态，不能登记平台退回验货。", 409);
    }

    if (existing && isIdempotentInspectionRetry(existing, input)) {
      return this.toResult(line);
    }

    const now = new Date();
    const inspectedAt = input.inspectedAt ?? now;
    const targetStatus = getInventoryTargetStatus(input.result);
    const previousStorageLocation = line.inventoryItem.storageLocation;

    if (isFinalInspectionResult(input.result)) {
      const inventoryUpdate = await tx.inventoryItem.updateMany({
        where: {
          id: line.inventoryItem.id,
          ownerId,
          itemStatus: "RETURNED",
          ownershipStatus: "OWNED",
        },
        data: {
          itemStatus: targetStatus,
          ...(input.result === "RESTOCKED" ? { storageLocation: input.storageLocation } : {}),
        },
      });
      if (inventoryUpdate.count !== 1) {
        throw new ServiceError("PLATFORM_RETURN_INSPECTION_CONFLICT", "库存状态已被其他操作改变，请刷新后重试。", 409);
      }
    }

    const inspectionData = {
      result: input.result,
      storageLocation: input.storageLocation,
      problemReason: input.problemReason,
      note: input.note,
      inspectedAt,
    };
    const inspection = existing
      ? await tx.platformReturnInspection.update({ where: { id: existing.id }, data: inspectionData })
      : await tx.platformReturnInspection.create({
          data: {
            ownerId,
            shipmentLineId: line.id,
            inventoryItemId: line.inventoryItem.id,
            ...inspectionData,
          },
        });

    await tx.platformReturnActionLog.create({
      data: {
        ownerId,
        inspectionId: inspection.id,
        action: existing ? "INSPECTION_REVISED" : "INSPECTION_RECORDED",
        fromResult: existing?.result ?? null,
        toResult: input.result,
        note: input.note,
        metadata: {
          shipmentLineId: line.id,
          inventoryItemId: line.inventoryItem.id,
          previousStorageLocation,
          newStorageLocation: input.result === "RESTOCKED" ? input.storageLocation : previousStorageLocation,
        },
      },
    });

    const updatedLine = await tx.platformShipmentLine.findUniqueOrThrow({
      where: { id: line.id },
      include: lineInclude,
    });
    return this.toResult(updatedLine);
  }

  private toResult(line: PlatformReturnLine) {
    if (!line.inventoryItem || !line.returnInspection) {
      throw new ServiceError("PLATFORM_RETURN_INSPECTION_INCOMPLETE", "平台退回验货记录不完整。", 409);
    }
    const inspection = line.returnInspection;
    return {
      inspection,
      shipmentLine: {
        id: line.id,
        batchId: line.batchId,
        inventoryItemId: line.inventoryItemId,
        lineStatus: line.lineStatus,
      },
      inventoryItem: {
        id: line.inventoryItem.id,
        itemStatus: line.inventoryItem.itemStatus,
        ownershipStatus: line.inventoryItem.ownershipStatus,
        storageLocation: line.inventoryItem.storageLocation,
      },
      actionLogs: inspection.actionLogs,
      canRevise: canReviseInspection(inspection),
      availableActions: canReviseInspection(inspection) ? ["PENDING_DECISION", "RESTOCKED", "PROBLEM"] : [],
      // Compatibility for the existing M3-0 confirm-restocked API response.
      line,
      batch: line.batch,
    };
  }
}

export const platformReturnInspectionService = new PlatformReturnInspectionService();
