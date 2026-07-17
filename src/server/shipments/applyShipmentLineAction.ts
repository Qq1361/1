import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import {
  getAction, canTransition, computeBatchStatus, LINE_TO_INVENTORY_STATUS,
  type ShipmentLineActionKey,
} from "@/lib/shipment-status-machine";
import { isLegacyInventoryItemStatus, LEGACY_INVENTORY_STATUS_MESSAGE } from "@/lib/inventory-item-status-contract";
import { platformReturnInspectionService } from "@/server/platform-return-inspection/platform-return-inspection-service";

export async function applyShipmentLineAction(
  ownerId: string,
  lineId: string,
  actionKey: ShipmentLineActionKey,
  input?: Record<string, string>,
) {
  // Platform-return restocking is deliberately outside the M3-0 state machine.
  // It must create a return inspection and its dedicated audit log atomically.
  if (actionKey === "confirmRestocked") {
    return platformReturnInspectionService.inspectReturn({
      ownerId,
      shipmentLineId: lineId,
      result: "RESTOCKED",
      storageLocation: input?.storageLocation,
      note: input?.note,
    });
  }

  const action = getAction(actionKey);
  if (!action) throw new ServiceError("INVALID_ACTION", `未知操作：${actionKey}。`, 400);

  const line = await db.platformShipmentLine.findFirst({
    where: { id: lineId, ownerId },
    include: { batch: true, group: true, inventoryItem: true },
  });
  if (!line) throw new ServiceError("LINE_NOT_FOUND", "寄送明细不存在。", 404);
  if (!line.inventoryItem || line.inventoryItem.ownershipStatus !== "OWNED") {
    throw new ServiceError("INVENTORY_NOT_OWNED", "非自有库存不能执行平台寄送操作。", 409);
  }

  // Validate current state
  if (!action.allowedFrom.includes(line.lineStatus)) {
    throw new ServiceError(
      "INVALID_TRANSITION",
      `当前状态 ${line.lineStatus} 不允许执行 ${actionKey}。允许的状态：${action.allowedFrom.join(", ")}。`,
      409,
    );
  }

  if (!canTransition(line.lineStatus, action.nextLineStatus)) {
    throw new ServiceError(
      "INVALID_TRANSITION",
      `不允许从 ${line.lineStatus} 转换到 ${action.nextLineStatus}。`,
      409,
    );
  }

  // Validate required input
  if (action.requiresInput && action.requiredFields) {
    for (const field of action.requiredFields) {
      if (!input?.[field]?.trim()) {
        throw new ServiceError(
          "MISSING_FIELD",
          `请填写${field === "rejectedReason" ? "拒收原因" : field === "returnedStorageLocation" ? "退回后存放库位" : field === "storageLocation" ? "库位" : field}。`,
          422,
        );
      }
    }
  }

  // Guard: never set SOLD
  if (action.nextLineStatus === "SOLD" || action.nextInventoryStatus === "SOLD") {
    throw new ServiceError("SOLD_FORBIDDEN", "M3-0 不允许将库存标记为已售出。", 403);
  }

  // Guard: inventory must not be SOLD or PROBLEM for shipment actions.
  if (line.inventoryItem && ["SOLD", "PROBLEM"].includes(line.inventoryItem.itemStatus)) {
    throw new ServiceError(
      "ITEM_STATUS_BLOCKED",
      `库存 ${line.inventoryCodeSnapshot} 状态为 ${line.inventoryItem.itemStatus}，不能执行寄送操作。`,
      409,
    );
  }
  if (line.inventoryItem && isLegacyInventoryItemStatus(line.inventoryItem.itemStatus)) {
    throw new ServiceError("LEGACY_INVENTORY_STATUS", LEGACY_INVENTORY_STATUS_MESSAGE, 409);
  }

  const purpose = line.group?.purpose ?? line.batch.defaultPurpose;
  const result = await db.$transaction(async (tx) => {
    const now = new Date();
    const lineData: Record<string, unknown> = {};

    // Normal state transition
    lineData.lineStatus = action.nextLineStatus;
    if (actionKey === "markRejected" && input?.rejectedReason) lineData.rejectedReason = input.rejectedReason.trim();
    if (actionKey === "markReturning") {
      if (input?.returnCarrierCode) lineData.returnCarrierCode = input.returnCarrierCode.trim();
      if (input?.returnTrackingNo) lineData.returnTrackingNo = input.returnTrackingNo.trim();
      if (input?.note) lineData.note = input.note.trim();
    }
    if (actionKey === "markReturned") {
      lineData.returnedAt = now;
      if (input?.returnedStorageLocation) lineData.returnedStorageLocation = input.returnedStorageLocation.trim();
      if (input?.note) lineData.note = input.note.trim();
    }

    const updatedLine = await tx.platformShipmentLine.update({ where: { id: lineId }, data: lineData });

    // Update inventory item status
    const newInvStatus = LINE_TO_INVENTORY_STATUS[action.nextLineStatus] || "PLATFORM_SHIPPED";
    if (line.inventoryItemId) {
      await tx.inventoryItem.update({
        where: { id: line.inventoryItemId },
        data: { itemStatus: newInvStatus as "STOCKED" | "PLATFORM_SHIPPED" | "PLATFORM_RECEIVED" | "PLATFORM_IN_WAREHOUSE" | "PLATFORM_LISTED" | "PLATFORM_REJECTED" | "RETURNING" | "RETURNED" },
      });
      // If returned, also update storageLocation
      if (actionKey === "markReturned" && input?.returnedStorageLocation) {
        await tx.inventoryItem.update({
          where: { id: line.inventoryItemId },
          data: { storageLocation: input.returnedStorageLocation.trim() },
        });
      }
    }

    // Recompute batch status
    const allLines = await tx.platformShipmentLine.findMany({ where: { batchId: line.batchId }, select: { lineStatus: true } });
    const batchStatus = computeBatchStatus(allLines.map(l => l.lineStatus));
    const updatedBatch = await tx.platformShipmentBatch.update({ where: { id: line.batchId }, data: { status: batchStatus as "DRAFT" | "SHIPPED" | "RECEIVED" | "PARTIALLY_RECEIVED" | "IN_WAREHOUSE" | "PARTIALLY_IN_WAREHOUSE" | "LISTED" | "PARTIALLY_LISTED" | "PARTIALLY_REJECTED" | "RETURNING" | "COMPLETED" | "CANCELLED" } });

    // Log
    await tx.platformShipmentActionLog.create({
      data: {
        ownerId, batchId: line.batchId, lineId, inventoryItemId: line.inventoryItemId ?? undefined,
        actionType: actionKey, oldStatus: line.lineStatus, newStatus: action.nextLineStatus,
        oldItemStatus: line.inventoryItem?.itemStatus ?? null, newItemStatus: newInvStatus,
        note: actionKey === "markRejected" ? `拒收原因：${input?.rejectedReason || ""}` : undefined,
      },
    });

    return { line: updatedLine, batch: updatedBatch, inventoryItem: line.inventoryItemId ? await tx.inventoryItem.findUnique({ where: { id: line.inventoryItemId } }) : null };
  });

  return result;
}
