import { Prisma } from "@/generated/prisma/client";
import { normalizeSku } from "@/lib/normalize-sku";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import {
  ACTIVE_PURCHASE_AFTER_SALE_STATUSES,
  isOwnedProblemInventory,
  outstandingApprovedAmount,
  sameRefundAllocationPayload,
  sumDecimals,
} from "./purchase-after-sales-rules";

type CaseType = "REFUND_ONLY" | "RETURN_AND_REFUND";
type DraftLineInput = {
  purchaseOrderItemId: string;
  inspectionId: string;
  inventoryItemId: string;
  requestedRefundAmount: string;
  note?: string;
};
type ApprovalInput = { afterSaleLineId: string; approvedRefundAmount: string };
type RefundInput = {
  idempotencyKey: string;
  refundAmount: string;
  refundedAt?: string;
  refundMethod?: string;
  externalRefundNo?: string;
  note?: string;
  allocations: { afterSaleLineId: string; amount: string }[];
};

function parseAmount(value: string, field: string, allowZero = false) {
  let amount: Prisma.Decimal;
  try {
    amount = new Prisma.Decimal(value);
  } catch {
    throw new ServiceError("INVALID_AMOUNT", `${field} 格式无效。`, 400);
  }
  if (amount.isNegative() || (!allowZero && amount.isZero())) {
    throw new ServiceError("INVALID_AMOUNT", `${field} 必须大于 0。`, 400);
  }
  return amount.toDecimalPlaces(2);
}

function newCaseNo() {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `PAS-${day}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function assertTransition(actual: string, expected: string, next: string) {
  if (actual !== expected) {
    throw new ServiceError("INVALID_AFTER_SALE_TRANSITION", `当前状态不能转为 ${next}。`, 409);
  }
}

async function withSerializableRetry<T>(work: () => Promise<T>) {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await work();
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2034" && attempt < 2) continue;
      throw error;
    }
  }
  throw new Error("unreachable");
}

export class PurchaseAfterSalesService {
  private async getCase(tx: Prisma.TransactionClient, ownerId: string, id: string) {
    const afterSaleCase = await tx.purchaseAfterSaleCase.findFirst({
      where: { id, ownerId },
      include: {
        purchaseOrder: true,
        lines: {
          include: {
            inventoryItem: true,
            inspection: true,
            refundAllocations: true,
          },
        },
        refundRecords: { include: { allocations: true } },
      },
    });
    if (!afterSaleCase) throw new ServiceError("PURCHASE_AFTER_SALE_NOT_FOUND", "采购售后单不存在。", 404);
    return afterSaleCase;
  }

  private async lockPurchaseOrder(tx: Prisma.TransactionClient, purchaseOrderId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "purchase_orders" WHERE "id" = ${purchaseOrderId} FOR UPDATE`);
  }

  private async lockCase(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "purchase_after_sale_cases" WHERE "id" = ${id} FOR UPDATE`);
  }

  private async validateDraftLines(
    tx: Prisma.TransactionClient,
    ownerId: string,
    purchaseOrderId: string,
    lines: DraftLineInput[],
  ) {
    if (!lines.length) throw new ServiceError("AFTER_SALE_LINES_REQUIRED", "请至少选择一件问题商品。", 422);

    const inspectionIds = new Set<string>();
    const inventoryItemIds = new Set<string>();
    const validated = [] as {
      item: { id: string; name: string; skuText: string | null };
      inspection: { id: string };
      inventory: { id: string; inventoryCode: string; skuText: string | null; unitCost: Prisma.Decimal };
      requestedRefundAmount: Prisma.Decimal;
      note: string | null;
    }[];

    for (const line of lines) {
      if (inspectionIds.has(line.inspectionId) || inventoryItemIds.has(line.inventoryItemId)) {
        throw new ServiceError("DUPLICATE_AFTER_SALE_ITEM", "同一售后草稿不能重复选择同一件商品。", 422);
      }
      inspectionIds.add(line.inspectionId);
      inventoryItemIds.add(line.inventoryItemId);

      const [item, inspection, inventory] = await Promise.all([
        tx.purchaseOrderItem.findFirst({ where: { id: line.purchaseOrderItemId, purchaseOrderId } }),
        tx.inspection.findFirst({ where: { id: line.inspectionId, ownerId } }),
        tx.inventoryItem.findFirst({ where: { id: line.inventoryItemId, ownerId } }),
      ]);
      if (
        !item || !inspection || !inventory ||
        inspection.purchaseOrderItemId !== item.id ||
        inventory.purchaseOrderItemId !== item.id ||
        inventory.inspectionId !== inspection.id
      ) {
        throw new ServiceError("INVALID_AFTER_SALE_RELATION", "采购明细、验货记录和库存关联不一致。", 422);
      }
      if (!inspection.completedAt || inspection.result !== "PROBLEM" || !isOwnedProblemInventory(inventory)) {
        throw new ServiceError("ITEM_NOT_ELIGIBLE_FOR_PURCHASE_AFTER_SALE", "仅可选择自有的已完成验货问题件。", 409);
      }
      validated.push({
        item,
        inspection,
        inventory,
        requestedRefundAmount: parseAmount(line.requestedRefundAmount, "申请退款金额"),
        note: line.note?.trim() || null,
      });
    }
    return validated;
  }

  async createDraft(ownerId: string, input: {
    purchaseOrderId?: string;
    type: CaseType;
    reason?: string;
    note?: string;
    caseNo?: string;
    lines: DraftLineInput[];
  }) {
    if (!(["REFUND_ONLY", "RETURN_AND_REFUND"] as string[]).includes(input.type)) {
      throw new ServiceError("INVALID_AFTER_SALE_TYPE", "采购售后类型无效。", 400);
    }
    return db.$transaction(async (tx) => {
      const firstLine = input.lines[0];
      if (!firstLine) throw new ServiceError("AFTER_SALE_LINES_REQUIRED", "请至少选择一件问题商品。", 422);
      const firstItem = await tx.purchaseOrderItem.findFirst({
        where: { id: firstLine.purchaseOrderItemId },
        include: { purchaseOrder: { select: { ownerId: true } } },
      });
      if (!firstItem || firstItem.purchaseOrder.ownerId !== ownerId) {
        throw new ServiceError("PURCHASE_ORDER_NOT_FOUND", "采购订单不存在或无权访问。", 404);
      }
      if (input.purchaseOrderId && input.purchaseOrderId !== firstItem.purchaseOrderId) {
        throw new ServiceError("INVALID_AFTER_SALE_RELATION", "采购订单与售后明细不一致。", 422);
      }
      const lines = await this.validateDraftLines(tx, ownerId, firstItem.purchaseOrderId, input.lines);
      const afterSaleCase = await tx.purchaseAfterSaleCase.create({
        data: {
          ownerId,
          caseNo: input.caseNo?.trim() || newCaseNo(),
          purchaseOrderId: firstItem.purchaseOrderId,
          type: input.type,
          reason: input.reason?.trim() || null,
          note: input.note?.trim() || null,
        },
      });
      await tx.purchaseAfterSaleLine.createMany({
        data: lines.map((line) => ({
          ownerId,
          afterSaleCaseId: afterSaleCase.id,
          purchaseOrderItemId: line.item.id,
          inspectionId: line.inspection.id,
          inventoryItemId: line.inventory.id,
          requestedRefundAmount: line.requestedRefundAmount,
          returnRequired: input.type === "RETURN_AND_REFUND",
          productNameSnapshot: line.item.name,
          skuSnapshot: normalizeSku(line.inventory.skuText ?? line.item.skuText),
          inventoryCodeSnapshot: line.inventory.inventoryCode,
          costAmountSnapshot: line.inventory.unitCost,
          note: line.note,
        })),
      });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: afterSaleCase.id, action: "CREATED_DRAFT", toStatus: "DRAFT" },
      });
      return this.getCase(tx, ownerId, afterSaleCase.id);
    }, { isolationLevel: "Serializable" });
  }

  async updateDraft(ownerId: string, id: string, input: {
    type: CaseType;
    reason?: string;
    note?: string;
    lines?: DraftLineInput[];
  }) {
    if (!(["REFUND_ONLY", "RETURN_AND_REFUND"] as string[]).includes(input.type)) {
      throw new ServiceError("INVALID_AFTER_SALE_TYPE", "采购售后类型无效。", 400);
    }
    return db.$transaction(async (tx) => {
      const existing = await this.getCase(tx, ownerId, id);
      assertTransition(existing.status, "DRAFT", "DRAFT");
      if (input.lines) {
        const lines = await this.validateDraftLines(tx, ownerId, existing.purchaseOrderId, input.lines);
        await tx.purchaseAfterSaleLine.deleteMany({ where: { afterSaleCaseId: id, ownerId } });
        await tx.purchaseAfterSaleLine.createMany({
          data: lines.map((line) => ({
            ownerId,
            afterSaleCaseId: id,
            purchaseOrderItemId: line.item.id,
            inspectionId: line.inspection.id,
            inventoryItemId: line.inventory.id,
            requestedRefundAmount: line.requestedRefundAmount,
            returnRequired: input.type === "RETURN_AND_REFUND",
            productNameSnapshot: line.item.name,
            skuSnapshot: normalizeSku(line.inventory.skuText ?? line.item.skuText),
            inventoryCodeSnapshot: line.inventory.inventoryCode,
            costAmountSnapshot: line.inventory.unitCost,
            note: line.note,
          })),
        });
      } else if (existing.type !== input.type) {
        await tx.purchaseAfterSaleLine.updateMany({
          where: { afterSaleCaseId: id, ownerId },
          data: { returnRequired: input.type === "RETURN_AND_REFUND" },
        });
      }
      await tx.purchaseAfterSaleCase.update({
        where: { id },
        data: { type: input.type, reason: input.reason?.trim() || null, note: input.note?.trim() || null },
      });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "UPDATED_DRAFT", fromStatus: "DRAFT", toStatus: "DRAFT" },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async submit(ownerId: string, id: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      assertTransition(afterSaleCase.status, "DRAFT", "REQUESTED");
      for (const line of afterSaleCase.lines) {
        if (!line.inspection.completedAt || line.inspection.result !== "PROBLEM" || !isOwnedProblemInventory(line.inventoryItem)) {
          throw new ServiceError("ITEM_NOT_ELIGIBLE_FOR_PURCHASE_AFTER_SALE", "问题件当前不满足提交条件。", 409);
        }
        const occupied = await tx.purchaseAfterSaleLine.findFirst({
          where: {
            inventoryItemId: line.inventoryItemId,
            afterSaleCaseId: { not: id },
            afterSaleCase: { status: { in: [...ACTIVE_PURCHASE_AFTER_SALE_STATUSES] } },
          },
        });
        if (occupied) throw new ServiceError("PURCHASE_AFTER_SALE_ITEM_OCCUPIED", "该库存已被其他进行中的采购售后占用。", 409);
      }
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: "REQUESTED", requestedAt: new Date() } });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "SUBMITTED", fromStatus: "DRAFT", toStatus: "REQUESTED" },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async sellerApprove(ownerId: string, id: string, approvals: ApprovalInput[], note?: string) {
    return withSerializableRetry(() => db.$transaction(async (tx) => {
      let afterSaleCase = await this.getCase(tx, ownerId, id);
      assertTransition(afterSaleCase.status, "REQUESTED", "SELLER_APPROVED");
      if (approvals.length !== afterSaleCase.lines.length || new Set(approvals.map((approval) => approval.afterSaleLineId)).size !== approvals.length) {
        throw new ServiceError("APPROVAL_LINES_INVALID", "必须明确填写每条售后明细的批准退款金额。", 422);
      }
      const approvedByLine = new Map(approvals.map((approval) => [
        approval.afterSaleLineId,
        parseAmount(approval.approvedRefundAmount, "批准退款金额"),
      ]));
      if (afterSaleCase.lines.some((line) => !approvedByLine.has(line.id))) {
        throw new ServiceError("APPROVAL_LINES_INVALID", "批准退款明细不属于当前售后单。", 422);
      }

      await this.lockPurchaseOrder(tx, afterSaleCase.purchaseOrderId);
      afterSaleCase = await this.getCase(tx, ownerId, id);
      assertTransition(afterSaleCase.status, "REQUESTED", "SELLER_APPROVED");

      const [actualRefunded, otherActiveCases] = await Promise.all([
        tx.purchaseRefundRecord.aggregate({ where: { purchaseOrderId: afterSaleCase.purchaseOrderId }, _sum: { refundAmount: true } }),
        tx.purchaseAfterSaleCase.findMany({
          where: {
            purchaseOrderId: afterSaleCase.purchaseOrderId,
            id: { not: id },
            status: { in: [...ACTIVE_PURCHASE_AFTER_SALE_STATUSES] },
          },
          include: { lines: { include: { refundAllocations: true } } },
        }),
      ]);
      const locked = sumDecimals(otherActiveCases.flatMap((other) =>
        other.lines.map((line) => outstandingApprovedAmount(line.approvedRefundAmount, line.refundAllocations.map((allocation) => allocation.amount))),
      ));
      const approvedTotal = sumDecimals([...approvedByLine.values()]);
      const paidTotal = afterSaleCase.purchaseOrder.totalAmount.plus(afterSaleCase.purchaseOrder.shippingAmount);
      const remaining = paidTotal.minus(actualRefunded._sum.refundAmount ?? 0).minus(locked);
      if (approvedTotal.greaterThan(remaining)) {
        throw new ServiceError("PURCHASE_REFUND_LIMIT_EXCEEDED", "批准退款金额超过采购订单剩余额度。", 409);
      }

      for (const [lineId, amount] of approvedByLine) {
        await tx.purchaseAfterSaleLine.update({ where: { id: lineId }, data: { approvedRefundAmount: amount } });
      }
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: "SELLER_APPROVED", approvedAt: new Date() } });
      await tx.purchaseAfterSaleActionLog.create({
        data: {
          ownerId,
          afterSaleCaseId: id,
          action: "SELLER_APPROVED",
          fromStatus: "REQUESTED",
          toStatus: "SELLER_APPROVED",
          metadata: { approvals: approvals.map((approval) => ({ ...approval })) },
          note: note?.trim() || null,
        },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" }));
  }

  async sellerReject(ownerId: string, id: string, reason: string) {
    if (!reason?.trim()) throw new ServiceError("REJECTION_REASON_REQUIRED", "请填写拒绝原因或备注。", 422);
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      assertTransition(afterSaleCase.status, "REQUESTED", "SELLER_REJECTED");
      await tx.purchaseAfterSaleCase.update({
        where: { id },
        data: { status: "SELLER_REJECTED", rejectedAt: new Date(), note: reason.trim() },
      });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "SELLER_REJECTED", fromStatus: "REQUESTED", toStatus: "SELLER_REJECTED", note: reason.trim() },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async prepareReturn(ownerId: string, id: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      if (afterSaleCase.type !== "RETURN_AND_REFUND") throw new ServiceError("RETURN_FLOW_REQUIRED", "仅退货退款售后可进入退货流程。", 409);
      assertTransition(afterSaleCase.status, "SELLER_APPROVED", "RETURN_PENDING");
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: "RETURN_PENDING" } });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "PREPARED_RETURN", fromStatus: "SELLER_APPROVED", toStatus: "RETURN_PENDING" },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async markReturnShipped(ownerId: string, id: string, input: {
    returnCarrierCode: string;
    returnTrackingNo: string;
    returnShippedAt?: string;
    note?: string;
  }) {
    if (!input.returnCarrierCode?.trim() || !input.returnTrackingNo?.trim()) {
      throw new ServiceError("RETURN_LOGISTICS_REQUIRED", "请填写退回快递公司和单号。", 422);
    }
    const returnShippedAt = input.returnShippedAt ? new Date(input.returnShippedAt) : new Date();
    if (Number.isNaN(returnShippedAt.getTime())) throw new ServiceError("INVALID_RETURN_SHIPPED_AT", "退回发货时间无效。", 400);

    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      assertTransition(afterSaleCase.status, "RETURN_PENDING", "RETURNING_TO_SELLER");
      if (afterSaleCase.lines.some((line) => !isOwnedProblemInventory(line.inventoryItem))) {
        throw new ServiceError("RETURN_INVENTORY_INVALID", "退回库存必须仍为自有问题件。", 409);
      }
      const itemIds = afterSaleCase.lines.map((line) => line.inventoryItemId);
      const changed = await tx.inventoryItem.updateMany({
        where: { id: { in: itemIds }, ownerId, itemStatus: "PROBLEM", ownershipStatus: "OWNED" },
        data: { ownershipStatus: "RETURNING_TO_UPSTREAM_SELLER" },
      });
      if (changed.count !== itemIds.length) throw new ServiceError("RETURN_INVENTORY_INVALID", "退回库存已发生变化，请重新确认。", 409);
      await tx.purchaseAfterSaleCase.update({
        where: { id },
        data: {
          status: "RETURNING_TO_SELLER",
          returnCarrierCode: input.returnCarrierCode.trim(),
          returnTrackingNo: input.returnTrackingNo.trim(),
          returnShippedAt,
        },
      });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "RETURN_SHIPPED", fromStatus: "RETURN_PENDING", toStatus: "RETURNING_TO_SELLER", note: input.note?.trim() || null },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async markSellerReceived(ownerId: string, id: string, input?: { sellerReceivedAt?: string; note?: string }) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      assertTransition(afterSaleCase.status, "RETURNING_TO_SELLER", "SELLER_RECEIVED");
      if (afterSaleCase.lines.some((line) => line.inventoryItem.itemStatus !== "PROBLEM" || line.inventoryItem.ownershipStatus !== "RETURNING_TO_UPSTREAM_SELLER")) {
        throw new ServiceError("RETURN_INVENTORY_INVALID", "退回库存归属状态不正确。", 409);
      }
      const itemIds = afterSaleCase.lines.map((line) => line.inventoryItemId);
      const changed = await tx.inventoryItem.updateMany({
        where: { id: { in: itemIds }, ownerId, itemStatus: "PROBLEM", ownershipStatus: "RETURNING_TO_UPSTREAM_SELLER" },
        data: { ownershipStatus: "RETURNED_TO_UPSTREAM_SELLER" },
      });
      if (changed.count !== itemIds.length) throw new ServiceError("RETURN_INVENTORY_INVALID", "退回库存已发生变化，请重新确认。", 409);
      const sellerReceivedAt = input?.sellerReceivedAt ? new Date(input.sellerReceivedAt) : new Date();
      if (Number.isNaN(sellerReceivedAt.getTime())) throw new ServiceError("INVALID_SELLER_RECEIVED_AT", "卖家收货时间无效。", 400);
      await tx.purchaseAfterSaleLine.updateMany({ where: { afterSaleCaseId: id, ownerId }, data: { returnedToSeller: true } });
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: "SELLER_RECEIVED", sellerReceivedAt } });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "SELLER_RECEIVED", fromStatus: "RETURNING_TO_SELLER", toStatus: "SELLER_RECEIVED", note: input?.note?.trim() || null },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async markRefundPending(ownerId: string, id: string, note?: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      const from = afterSaleCase.type === "REFUND_ONLY" ? "SELLER_APPROVED" : "SELLER_RECEIVED";
      assertTransition(afterSaleCase.status, from, "REFUND_PENDING");
      const expectedOwnership = afterSaleCase.type === "REFUND_ONLY" ? "OWNED" : "RETURNED_TO_UPSTREAM_SELLER";
      if (afterSaleCase.lines.some((line) => line.inventoryItem.itemStatus !== "PROBLEM" || line.inventoryItem.ownershipStatus !== expectedOwnership)) {
        throw new ServiceError("REFUND_INVENTORY_INVALID", "库存归属不满足进入退款阶段的条件。", 409);
      }
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: "REFUND_PENDING" } });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "REFUND_PENDING", fromStatus: from, toStatus: "REFUND_PENDING", note: note?.trim() || null },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async recordRefund(ownerId: string, id: string, input: RefundInput) {
    if (!input.idempotencyKey?.trim() || !input.allocations?.length) {
      throw new ServiceError("REFUND_INPUT_INVALID", "退款幂等键和退款分配不能为空。", 422);
    }
    const refundAmount = parseAmount(input.refundAmount, "实际退款金额");
    const refundedAt = input.refundedAt ? new Date(input.refundedAt) : new Date();
    if (Number.isNaN(refundedAt.getTime())) throw new ServiceError("INVALID_REFUNDED_AT", "退款时间无效。", 400);
    const requestedAllocations = input.allocations.map((allocation) => ({
      afterSaleLineId: allocation.afterSaleLineId,
      amount: parseAmount(allocation.amount, "退款分配金额"),
    }));
    if (!sumDecimals(requestedAllocations.map((allocation) => allocation.amount)).equals(refundAmount)) {
      throw new ServiceError("REFUND_ALLOCATION_MISMATCH", "退款分配合计必须等于退款总额。", 422);
    }

    return withSerializableRetry(() => db.$transaction(async (tx) => {
      let afterSaleCase = await this.getCase(tx, ownerId, id);
      const existing = await tx.purchaseRefundRecord.findUnique({
        where: { idempotencyKey: input.idempotencyKey.trim() },
        include: { allocations: true },
      });
      if (existing) {
        const same = existing.ownerId === ownerId
          && existing.afterSaleCaseId === id
          && existing.refundAmount.equals(refundAmount)
          && sameRefundAllocationPayload(existing.allocations, requestedAllocations);
        if (same) return existing;
        throw new ServiceError("REFUND_IDEMPOTENCY_CONFLICT", "退款幂等键已被不同请求使用。", 409);
      }
      if (!(["REFUND_PENDING", "PARTIALLY_REFUNDED"] as string[]).includes(afterSaleCase.status)) {
        throw new ServiceError("INVALID_AFTER_SALE_TRANSITION", "当前状态不能登记退款。", 409);
      }
      await this.lockPurchaseOrder(tx, afterSaleCase.purchaseOrderId);
      afterSaleCase = await this.getCase(tx, ownerId, id);
      if (!(["REFUND_PENDING", "PARTIALLY_REFUNDED"] as string[]).includes(afterSaleCase.status)) {
        throw new ServiceError("INVALID_AFTER_SALE_TRANSITION", "当前状态不能登记退款。", 409);
      }

      const lineMap = new Map(afterSaleCase.lines.map((line) => [line.id, line]));
      if (
        new Set(requestedAllocations.map((allocation) => allocation.afterSaleLineId)).size !== requestedAllocations.length ||
        requestedAllocations.some((allocation) => !lineMap.has(allocation.afterSaleLineId))
      ) {
        throw new ServiceError("REFUND_ALLOCATION_INVALID", "退款分配只能关联当前售后明细，且每条明细只能填写一次。", 422);
      }
      const [orderRefunded, refreshedCase] = await Promise.all([
        tx.purchaseRefundRecord.aggregate({ where: { purchaseOrderId: afterSaleCase.purchaseOrderId }, _sum: { refundAmount: true } }),
        this.getCase(tx, ownerId, id),
      ]);
      const paidTotal = afterSaleCase.purchaseOrder.totalAmount.plus(afterSaleCase.purchaseOrder.shippingAmount);
      if (orderRefunded._sum.refundAmount?.plus(refundAmount).greaterThan(paidTotal)) {
        throw new ServiceError("PURCHASE_REFUND_LIMIT_EXCEEDED", "退款超过采购订单实付总额。", 409);
      }
      const approvedTotal = sumDecimals(refreshedCase.lines.map((line) => line.approvedRefundAmount));
      const caseRefunded = sumDecimals(refreshedCase.refundRecords.map((record) => record.refundAmount));
      if (caseRefunded.plus(refundAmount).greaterThan(approvedTotal)) {
        throw new ServiceError("CASE_REFUND_LIMIT_EXCEEDED", "退款超过本售后单批准金额。", 409);
      }
      for (const allocation of requestedAllocations) {
        const line = lineMap.get(allocation.afterSaleLineId)!;
        const refundedForLine = sumDecimals(line.refundAllocations.map((item) => item.amount));
        if (refundedForLine.plus(allocation.amount).greaterThan(line.approvedRefundAmount ?? 0)) {
          throw new ServiceError("LINE_REFUND_LIMIT_EXCEEDED", "退款超过售后明细批准金额。", 409);
        }
      }

      const record = await tx.purchaseRefundRecord.create({
        data: {
          ownerId,
          afterSaleCaseId: id,
          purchaseOrderId: afterSaleCase.purchaseOrderId,
          refundAmount,
          refundedAt,
          refundMethod: input.refundMethod?.trim() || null,
          externalRefundNo: input.externalRefundNo?.trim() || null,
          idempotencyKey: input.idempotencyKey.trim(),
          note: input.note?.trim() || null,
        },
      });
      await tx.purchaseRefundAllocation.createMany({
        data: requestedAllocations.map((allocation) => ({
          ownerId,
          refundRecordId: record.id,
          afterSaleLineId: allocation.afterSaleLineId,
          amount: allocation.amount,
        })),
      });
      const nextStatus = caseRefunded.plus(refundAmount).equals(approvedTotal) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: nextStatus } });
      await tx.purchaseAfterSaleActionLog.create({
        data: {
          ownerId,
          afterSaleCaseId: id,
          action: "REFUND_RECORDED",
          fromStatus: afterSaleCase.status,
          toStatus: nextStatus,
          metadata: { refundAmount: refundAmount.toFixed(2), idempotencyKey: input.idempotencyKey.trim() },
        },
      });
      return tx.purchaseRefundRecord.findUniqueOrThrow({ where: { id: record.id }, include: { allocations: true } });
    }, { isolationLevel: "Serializable" }));
  }

  async complete(ownerId: string, id: string, note?: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      assertTransition(afterSaleCase.status, "REFUNDED", "COMPLETED");
      const expectedOwnership = afterSaleCase.type === "REFUND_ONLY" ? "OWNED" : "RETURNED_TO_UPSTREAM_SELLER";
      if (afterSaleCase.lines.some((line) => line.inventoryItem.itemStatus !== "PROBLEM" || line.inventoryItem.ownershipStatus !== expectedOwnership)) {
        throw new ServiceError("COMPLETE_INVENTORY_INVALID", "库存质量或归属不满足完成条件。", 409);
      }
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "COMPLETED", fromStatus: "REFUNDED", toStatus: "COMPLETED", note: note?.trim() || null },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async cancel(ownerId: string, id: string, note?: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      if (!(["DRAFT", "REQUESTED", "SELLER_APPROVED", "RETURN_PENDING"] as string[]).includes(afterSaleCase.status)) {
        throw new ServiceError("CANCEL_NOT_ALLOWED", "当前采购售后状态不允许取消。", 409);
      }
      if (
        ["SELLER_APPROVED", "RETURN_PENDING"].includes(afterSaleCase.status) &&
        (afterSaleCase.refundRecords.length > 0 || afterSaleCase.returnShippedAt || afterSaleCase.lines.some((line) => line.inventoryItem.ownershipStatus !== "OWNED"))
      ) {
        throw new ServiceError("CANCEL_NOT_ALLOWED", "已有退款或退货动作，不能取消。", 409);
      }
      await tx.purchaseAfterSaleCase.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date() } });
      await tx.purchaseAfterSaleActionLog.create({
        data: { ownerId, afterSaleCaseId: id, action: "CANCELLED", fromStatus: afterSaleCase.status, toStatus: "CANCELLED", note: note?.trim() || null },
      });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }
}

export const purchaseAfterSalesService = new PurchaseAfterSalesService();
