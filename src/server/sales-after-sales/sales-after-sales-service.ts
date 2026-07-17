import { Prisma } from "@/generated/prisma/client";
import { normalizeSku } from "@/lib/normalize-sku";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import {
  ACTIVE_SALES_AFTER_SALE_STATUSES,
  CANCELLABLE_SALES_AFTER_SALE_STATUSES,
  REFUNDABLE_SALES_AFTER_SALE_STATUSES,
  calculateMinimumRequiredActualReceived,
  isFinalInspectionResult,
  isReturnAfterSaleType,
  outstandingApprovedAmount,
  sameRefundRequest,
  sumDecimals,
} from "./sales-after-sales-rules";

type CaseType = "REFUND_ONLY" | "RETURN_AND_REFUND";
type InspectionResult = "RESTOCKED" | "PROBLEM" | "PENDING_DECISION";
type DraftLineInput = {
  saleLineId: string;
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

function parseDate(value: string | undefined, code: string) {
  const date = value ? new Date(value) : new Date();
  if (Number.isNaN(date.getTime())) throw new ServiceError(code, "时间格式无效。", 400);
  return date;
}

function newCaseNo() {
  const day = new Date().toISOString().slice(0, 10).replaceAll("-", "");
  return `SAS-${day}-${crypto.randomUUID().slice(0, 6).toUpperCase()}`;
}

function requireTransition(type: string, actual: string, expected: string, next: string) {
  if (actual !== expected) {
    throw new ServiceError("INVALID_AFTER_SALE_TRANSITION", `当前状态不能转为${next}。`, 409);
  }
  if (type === "REFUND_ONLY" && next === "退货待寄出") {
    throw new ServiceError("RETURN_FLOW_REQUIRED", "仅退款售后不能进入退货流程。", 409);
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

export class SalesAfterSalesService {
  private async getCase(tx: Prisma.TransactionClient, ownerId: string, id: string) {
    const afterSaleCase = await tx.saleAfterSaleCase.findFirst({
      where: { id, ownerId },
      include: {
        saleOrder: { include: { lines: true, feeLines: true } },
        lines: {
          include: {
            saleLine: true,
            inventoryItem: true,
            refundAllocations: true,
            inspection: true,
          },
        },
        refundRecords: { include: { allocations: true } },
        inspections: true,
        actionLogs: { orderBy: { createdAt: "desc" } },
      },
    });
    if (!afterSaleCase) throw new ServiceError("SALES_AFTER_SALE_NOT_FOUND", "销售售后单不存在。", 404);
    return afterSaleCase;
  }

  private async lockSaleOrder(tx: Prisma.TransactionClient, saleOrderId: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sale_orders" WHERE "id" = ${saleOrderId} FOR UPDATE`);
  }

  private async lockCase(tx: Prisma.TransactionClient, id: string) {
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "sale_after_sale_cases" WHERE "id" = ${id} FOR UPDATE`);
  }

  private async lockInventoryItems(tx: Prisma.TransactionClient, ids: string[]) {
    if (!ids.length) return;
    await tx.$queryRaw(Prisma.sql`SELECT "id" FROM "inventory_items" WHERE "id" IN (${Prisma.join(ids)}) FOR UPDATE`);
  }

  private async getSettledSale(tx: Prisma.TransactionClient, ownerId: string, saleOrderId: string) {
    const sale = await tx.saleOrder.findFirst({
      where: { id: saleOrderId, ownerId },
      include: { lines: true, feeLines: true },
    });
    if (!sale) throw new ServiceError("SALE_NOT_FOUND", "销售订单不存在。", 404);
    if (sale.status !== "SETTLED" || !sale.actualReceivedAmount || sale.actualReceivedAmount.isNegative() || sale.actualReceivedAmount.isZero()) {
      throw new ServiceError("SALE_NOT_ELIGIBLE_FOR_AFTER_SALE", "只有已到账且实际到账金额大于 0 的销售订单可以发起售后。", 409);
    }
    return sale;
  }

  private async validateDraftLines(
    tx: Prisma.TransactionClient,
    ownerId: string,
    saleOrderId: string,
    type: CaseType,
    inputs: DraftLineInput[],
  ) {
    if (!inputs.length) throw new ServiceError("AFTER_SALE_LINES_REQUIRED", "至少选择一件商品。", 422);
    const saleLineIds = new Set<string>();
    const inventoryIds = new Set<string>();
    const validated = [] as Array<{
      saleLine: (typeof inputs)[number] & { id?: string };
      source: Awaited<ReturnType<Prisma.TransactionClient["saleLine"]["findFirst"]>>;
      inventory: Awaited<ReturnType<Prisma.TransactionClient["inventoryItem"]["findFirst"]>>;
      requestedRefundAmount: Prisma.Decimal;
      note: string | null;
    }>;

    for (const input of inputs) {
      if (saleLineIds.has(input.saleLineId) || inventoryIds.has(input.inventoryItemId)) {
        throw new ServiceError("DUPLICATE_AFTER_SALE_ITEM", "同一售后单不能重复选择商品。", 422);
      }
      saleLineIds.add(input.saleLineId);
      inventoryIds.add(input.inventoryItemId);
      const [source, inventory] = await Promise.all([
        tx.saleLine.findFirst({ where: { id: input.saleLineId, ownerId, saleOrderId } }),
        tx.inventoryItem.findFirst({ where: { id: input.inventoryItemId, ownerId } }),
      ]);
      if (!source || !inventory || source.inventoryItemId !== inventory.id) {
        throw new ServiceError("INVALID_AFTER_SALE_RELATION", "销售明细与库存关联不一致。", 422);
      }
      if (inventory.itemStatus !== "SOLD" || inventory.ownershipStatus !== "OWNED") {
        throw new ServiceError("ITEM_NOT_ELIGIBLE_FOR_SALES_AFTER_SALE", "只有自有且已售出的库存可以发起销售售后。", 409);
      }
      if (type === "RETURN_AND_REFUND") {
        const completedReturn = await tx.saleAfterSaleCase.findFirst({
          where: {
            ownerId,
            type,
            status: "COMPLETED",
            lines: { some: { inventoryItemId: inventory.id } },
          },
        });
        if (completedReturn) throw new ServiceError("INVENTORY_ALREADY_RESTORED", "该库存已经完成过退货恢复，不能重复发起退货售后。", 409);
      }
      validated.push({
        saleLine: input,
        source,
        inventory,
        requestedRefundAmount: parseAmount(input.requestedRefundAmount, "申请退款金额"),
        note: input.note?.trim() || null,
      });
    }
    return validated;
  }

  async getDetail(ownerId: string, id: string) {
    return db.$transaction((tx) => this.getCase(tx, ownerId, id));
  }

  async createDraft(ownerId: string, input: { saleOrderId: string; type: CaseType; reason?: string; note?: string; lines: DraftLineInput[] }) {
    if (!(input.type === "REFUND_ONLY" || input.type === "RETURN_AND_REFUND")) throw new ServiceError("INVALID_AFTER_SALE_TYPE", "销售售后类型无效。", 400);
    return db.$transaction(async (tx) => {
      const sale = await this.getSettledSale(tx, ownerId, input.saleOrderId);
      const lines = await this.validateDraftLines(tx, ownerId, sale.id, input.type, input.lines);
      const afterSaleCase = await tx.saleAfterSaleCase.create({
        data: {
          ownerId,
          saleOrderId: sale.id,
          caseNo: newCaseNo(),
          type: input.type,
          reason: input.reason?.trim() || null,
          note: input.note?.trim() || null,
        },
      });
      await tx.saleAfterSaleLine.createMany({
        data: lines.map((line) => ({
          ownerId,
          afterSaleCaseId: afterSaleCase.id,
          saleLineId: line.source!.id,
          inventoryItemId: line.inventory!.id,
          requestedRefundAmount: line.requestedRefundAmount,
          returnRequired: input.type === "RETURN_AND_REFUND",
          productNameSnapshot: line.source!.productNameSnapshot,
          skuSnapshot: normalizeSku(line.source!.skuSnapshot),
          inventoryCodeSnapshot: line.source!.inventoryCodeSnapshot,
          saleAmountSnapshot: line.source!.saleAmount.greaterThan(0) ? line.source!.saleAmount : null,
          costAmountSnapshot: line.source!.costAmount,
          profitAmountSnapshot: line.source!.profitAmount,
          note: line.note,
        })),
      });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: afterSaleCase.id, action: "CREATED_DRAFT", toStatus: "DRAFT" } });
      return this.getCase(tx, ownerId, afterSaleCase.id);
    }, { isolationLevel: "Serializable" });
  }

  async updateDraft(ownerId: string, id: string, input: { type: CaseType; reason?: string; note?: string; lines?: DraftLineInput[] }) {
    if (!(input.type === "REFUND_ONLY" || input.type === "RETURN_AND_REFUND")) throw new ServiceError("INVALID_AFTER_SALE_TYPE", "销售售后类型无效。", 400);
    return db.$transaction(async (tx) => {
      const existing = await this.getCase(tx, ownerId, id);
      requireTransition(existing.type, existing.status, "DRAFT", "草稿");
      const sale = await this.getSettledSale(tx, ownerId, existing.saleOrderId);
      const lines = await this.validateDraftLines(tx, ownerId, sale.id, input.type, input.lines ?? existing.lines.map((line) => ({ saleLineId: line.saleLineId, inventoryItemId: line.inventoryItemId, requestedRefundAmount: line.requestedRefundAmount.toFixed(2), note: line.note ?? undefined })));
      await tx.saleAfterSaleLine.deleteMany({ where: { ownerId, afterSaleCaseId: id } });
      await tx.saleAfterSaleLine.createMany({
        data: lines.map((line) => ({
          ownerId, afterSaleCaseId: id, saleLineId: line.source!.id, inventoryItemId: line.inventory!.id,
          requestedRefundAmount: line.requestedRefundAmount, returnRequired: input.type === "RETURN_AND_REFUND",
          productNameSnapshot: line.source!.productNameSnapshot, skuSnapshot: normalizeSku(line.source!.skuSnapshot),
          inventoryCodeSnapshot: line.source!.inventoryCodeSnapshot, saleAmountSnapshot: line.source!.saleAmount.greaterThan(0) ? line.source!.saleAmount : null,
          costAmountSnapshot: line.source!.costAmount, profitAmountSnapshot: line.source!.profitAmount, note: line.note,
        })),
      });
      await tx.saleAfterSaleCase.update({ where: { id }, data: { type: input.type, reason: input.reason?.trim() || null, note: input.note?.trim() || null } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "UPDATED_DRAFT", fromStatus: "DRAFT", toStatus: "DRAFT" } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async submit(ownerId: string, id: string) {
    return withSerializableRetry(() => db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      requireTransition(afterSaleCase.type, afterSaleCase.status, "DRAFT", "待审核");
      await this.getSettledSale(tx, ownerId, afterSaleCase.saleOrderId);
      await this.lockSaleOrder(tx, afterSaleCase.saleOrderId);
      await this.lockInventoryItems(tx, afterSaleCase.lines.map((line) => line.inventoryItemId));
      for (const line of afterSaleCase.lines) {
        const occupied = await tx.saleAfterSaleLine.findFirst({
          where: { ownerId, inventoryItemId: line.inventoryItemId, afterSaleCaseId: { not: id }, afterSaleCase: { status: { in: [...ACTIVE_SALES_AFTER_SALE_STATUSES] } } },
        });
        if (occupied) throw new ServiceError("SALES_AFTER_SALE_ITEM_OCCUPIED", "该库存已被其他进行中的销售售后占用。", 409);
        const inventory = await tx.inventoryItem.findFirst({ where: { id: line.inventoryItemId, ownerId } });
        if (!inventory || inventory.itemStatus !== "SOLD" || inventory.ownershipStatus !== "OWNED") throw new ServiceError("ITEM_NOT_ELIGIBLE_FOR_SALES_AFTER_SALE", "提交时库存状态已变化。", 409);
      }
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "REQUESTED", requestedAt: new Date() } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "SUBMITTED", fromStatus: "DRAFT", toStatus: "REQUESTED" } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" }));
  }

  async approve(ownerId: string, id: string, approvals: ApprovalInput[], note?: string) {
    return withSerializableRetry(() => db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const initial = await this.getCase(tx, ownerId, id);
      requireTransition(initial.type, initial.status, "REQUESTED", "已批准");
      if (approvals.length !== initial.lines.length || new Set(approvals.map((item) => item.afterSaleLineId)).size !== approvals.length) throw new ServiceError("APPROVAL_LINES_INVALID", "必须填写每条售后明细的批准退款金额。", 422);
      const approvedByLine = new Map(approvals.map((item) => [item.afterSaleLineId, parseAmount(item.approvedRefundAmount, "批准退款金额")]));
      if (initial.lines.some((line) => !approvedByLine.has(line.id))) throw new ServiceError("APPROVAL_LINES_INVALID", "批准明细不属于当前售后单。", 422);
      await this.lockSaleOrder(tx, initial.saleOrderId);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      const sale = await this.getSettledSale(tx, ownerId, afterSaleCase.saleOrderId);
      const refunded = (await tx.saleRefundRecord.aggregate({ where: { ownerId, saleOrderId: sale.id }, _sum: { refundAmount: true } }))._sum.refundAmount ?? new Prisma.Decimal(0);
      const others = await tx.saleAfterSaleCase.findMany({ where: { ownerId, saleOrderId: sale.id, id: { not: id }, status: { in: [...ACTIVE_SALES_AFTER_SALE_STATUSES] } }, include: { lines: { include: { refundAllocations: true } } } });
      const locked = sumDecimals(others.flatMap((item) => item.lines.map((line) => outstandingApprovedAmount(line.approvedRefundAmount, line.refundAllocations.map((allocation) => allocation.amount)))));
      const totalApproval = sumDecimals([...approvedByLine.values()]);
      const minimum = calculateMinimumRequiredActualReceived(refunded, locked).plus(totalApproval);
      if (minimum.greaterThan(sale.actualReceivedAmount!)) throw new ServiceError("REFUND_LIMIT_EXCEEDED", "批准退款金额超过可退款余额。", 409);
      for (const line of afterSaleCase.lines) {
        const amount = approvedByLine.get(line.id)!;
        const historical = (await tx.saleRefundAllocation.aggregate({ where: { ownerId, afterSaleLine: { saleLineId: line.saleLineId }, }, _sum: { amount: true } }))._sum.amount ?? new Prisma.Decimal(0);
        if (line.saleAmountSnapshot?.greaterThan(0) && historical.plus(amount).greaterThan(line.saleAmountSnapshot)) throw new ServiceError("LINE_REFUND_LIMIT_EXCEEDED", "单件退款金额超过可退款上限。", 409);
        await tx.saleAfterSaleLine.update({ where: { id: line.id }, data: { approvedRefundAmount: amount } });
      }
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "APPROVED", approvedAt: new Date() } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "APPROVED", fromStatus: "REQUESTED", toStatus: "APPROVED", note: note?.trim() || null, metadata: { approvals: approvals.map((item) => ({ ...item })) } } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" }));
  }

  async reject(ownerId: string, id: string, reason: string) {
    if (!reason?.trim()) throw new ServiceError("REJECTION_REASON_REQUIRED", "请填写拒绝原因。", 422);
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      requireTransition(afterSaleCase.type, afterSaleCase.status, "REQUESTED", "已拒绝");
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "REJECTED", rejectedAt: new Date(), note: reason.trim() } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "REJECTED", fromStatus: "REQUESTED", toStatus: "REJECTED", note: reason.trim() } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async prepareReturn(ownerId: string, id: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      if (!isReturnAfterSaleType(afterSaleCase.type)) throw new ServiceError("RETURN_FLOW_REQUIRED", "仅退货退款售后可以进入退货流程。", 409);
      requireTransition(afterSaleCase.type, afterSaleCase.status, "APPROVED", "退货待寄出");
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "RETURN_PENDING" } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "PREPARED_RETURN", fromStatus: "APPROVED", toStatus: "RETURN_PENDING" } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async markReturnShipped(ownerId: string, id: string, input: { returnCarrierCode: string; returnTrackingNo: string; returnShippedAt?: string; note?: string }) {
    if (!input.returnCarrierCode?.trim() || !input.returnTrackingNo?.trim()) throw new ServiceError("RETURN_LOGISTICS_REQUIRED", "请填写退回快递公司和单号。", 422);
    const date = parseDate(input.returnShippedAt, "INVALID_RETURN_SHIPPED_AT");
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      if (!isReturnAfterSaleType(afterSaleCase.type)) throw new ServiceError("RETURN_FLOW_REQUIRED", "仅退货退款售后可以退回商品。", 409);
      requireTransition(afterSaleCase.type, afterSaleCase.status, "RETURN_PENDING", "退货运输中");
      const ids = afterSaleCase.lines.map((line) => line.inventoryItemId);
      await this.lockInventoryItems(tx, ids);
      const inventory = await tx.inventoryItem.findMany({ where: { ownerId, id: { in: ids } } });
      if (inventory.length !== ids.length || inventory.some((item) => item.itemStatus !== "SOLD" || item.ownershipStatus !== "OWNED")) throw new ServiceError("RETURN_INVENTORY_INVALID", "退货期间库存必须仍为自有且已售出。", 409);
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "RETURNING", returnCarrierCode: input.returnCarrierCode.trim(), returnTrackingNo: input.returnTrackingNo.trim(), returnShippedAt: date } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "RETURN_SHIPPED", fromStatus: "RETURN_PENDING", toStatus: "RETURNING", note: input.note?.trim() || null } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async markReturnReceived(ownerId: string, id: string, input?: { returnReceivedAt?: string; note?: string }) {
    const date = parseDate(input?.returnReceivedAt, "INVALID_RETURN_RECEIVED_AT");
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      requireTransition(afterSaleCase.type, afterSaleCase.status, "RETURNING", "已收到退货");
      const ids = afterSaleCase.lines.map((line) => line.inventoryItemId);
      await this.lockInventoryItems(tx, ids);
      const inventory = await tx.inventoryItem.findMany({ where: { ownerId, id: { in: ids } } });
      if (inventory.length !== ids.length || inventory.some((item) => item.itemStatus !== "SOLD" || item.ownershipStatus !== "OWNED")) throw new ServiceError("RETURN_INVENTORY_INVALID", "收到退货前库存必须保持已售出。", 409);
      await tx.saleAfterSaleLine.updateMany({ where: { ownerId, afterSaleCaseId: id }, data: { returnReceived: true } });
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "RETURN_RECEIVED", returnReceivedAt: date } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "RETURN_RECEIVED", fromStatus: "RETURNING", toStatus: "RETURN_RECEIVED", note: input?.note?.trim() || null } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async inspectReturn(ownerId: string, id: string, inspections: Array<{ afterSaleLineId: string; result: InspectionResult; storageLocation?: string; problemReason?: string; note?: string }>) {
    if (!inspections.length) throw new ServiceError("INSPECTION_INPUT_REQUIRED", "请填写退货验货结果。", 422);
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      requireTransition(afterSaleCase.type, afterSaleCase.status, "RETURN_RECEIVED", "验货完成");
      const lineMap = new Map(afterSaleCase.lines.map((line) => [line.id, line]));
      if (inspections.length !== afterSaleCase.lines.length || new Set(inspections.map((item) => item.afterSaleLineId)).size !== inspections.length || inspections.some((item) => !lineMap.has(item.afterSaleLineId))) throw new ServiceError("INSPECTION_LINES_INVALID", "必须为每条退货明细填写结果。", 422);
      await this.lockInventoryItems(tx, afterSaleCase.lines.map((line) => line.inventoryItemId));
      const inventory = await tx.inventoryItem.findMany({ where: { ownerId, id: { in: afterSaleCase.lines.map((line) => line.inventoryItemId) } } });
      if (inventory.some((item) => item.itemStatus !== "SOLD" || item.ownershipStatus !== "OWNED")) throw new ServiceError("RETURN_INVENTORY_INVALID", "退货验货完成前库存必须保持已售出。", 409);
      for (const input of inspections) {
        if (!(input.result === "RESTOCKED" || input.result === "PROBLEM" || input.result === "PENDING_DECISION")) throw new ServiceError("INVALID_INSPECTION_RESULT", "退货验货结果无效。", 400);
        if (input.result === "RESTOCKED" && !input.storageLocation?.trim()) throw new ServiceError("STORAGE_LOCATION_REQUIRED", "可再次销售的退货必须填写库位。", 422);
        if (input.result === "PROBLEM" && !input.problemReason?.trim() && !input.note?.trim()) throw new ServiceError("PROBLEM_REASON_REQUIRED", "问题件必须填写问题原因。", 422);
        await tx.saleAfterSaleInspection.upsert({
          where: { afterSaleLineId: input.afterSaleLineId },
          create: { ownerId, afterSaleCaseId: id, afterSaleLineId: input.afterSaleLineId, result: input.result, storageLocation: input.storageLocation?.trim() || null, problemReason: input.problemReason?.trim() || null, note: input.note?.trim() || null, inspectedAt: new Date() },
          update: { result: input.result, storageLocation: input.storageLocation?.trim() || null, problemReason: input.problemReason?.trim() || null, note: input.note?.trim() || null, inspectedAt: new Date() },
        });
      }
      const final = inspections.every((item) => isFinalInspectionResult(item.result));
      await tx.saleAfterSaleCase.update({ where: { id }, data: final ? { status: "INSPECTED", inspectedAt: new Date() } : { status: "RETURN_RECEIVED" } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: final ? "INSPECTED" : "INSPECTION_PENDING", fromStatus: "RETURN_RECEIVED", toStatus: final ? "INSPECTED" : "RETURN_RECEIVED" } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async markRefundPending(ownerId: string, id: string, note?: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      const from = afterSaleCase.type === "REFUND_ONLY" ? "APPROVED" : "INSPECTED";
      requireTransition(afterSaleCase.type, afterSaleCase.status, from, "退款待登记");
      if (afterSaleCase.type === "RETURN_AND_REFUND" && afterSaleCase.lines.some((line) => !line.inspection || !isFinalInspectionResult(line.inspection.result))) throw new ServiceError("INSPECTION_INCOMPLETE", "所有退货明细验货完成后才能进入退款。", 409);
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "REFUND_PENDING" } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "REFUND_PENDING", fromStatus: from, toStatus: "REFUND_PENDING", note: note?.trim() || null } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }

  async recordRefund(ownerId: string, id: string, input: RefundInput) {
    if (!input.idempotencyKey?.trim() || !input.allocations?.length) throw new ServiceError("REFUND_INPUT_INVALID", "退款幂等键和明细分配不能为空。", 422);
    const refundAmount = parseAmount(input.refundAmount, "实际退款金额");
    const refundedAt = parseDate(input.refundedAt, "INVALID_REFUNDED_AT");
    const requested = input.allocations.map((item) => ({ afterSaleLineId: item.afterSaleLineId, amount: parseAmount(item.amount, "退款分配金额") }));
    if (new Set(requested.map((item) => item.afterSaleLineId)).size !== requested.length || !sumDecimals(requested.map((item) => item.amount)).equals(refundAmount)) throw new ServiceError("REFUND_ALLOCATION_MISMATCH", "退款明细合计必须等于本次退款总额。", 422);
    return withSerializableRetry(() => db.$transaction(async (tx) => {
      const existing = await tx.saleRefundRecord.findUnique({ where: { idempotencyKey: input.idempotencyKey.trim() }, include: { allocations: true } });
      if (existing) {
        if (sameRefundRequest(existing, { ownerId, afterSaleCaseId: id, saleOrderId: existing.saleOrderId, refundAmount, refundMethod: input.refundMethod?.trim() || null, externalRefundNo: input.externalRefundNo?.trim() || null, note: input.note?.trim() || null, allocations: requested })) return existing;
        throw new ServiceError("REFUND_IDEMPOTENCY_CONFLICT", "退款幂等键已被不同请求使用。", 409);
      }
      await this.lockCase(tx, id);
      let afterSaleCase = await this.getCase(tx, ownerId, id);
      if (!(REFUNDABLE_SALES_AFTER_SALE_STATUSES as readonly string[]).includes(afterSaleCase.status)) throw new ServiceError("INVALID_AFTER_SALE_TRANSITION", "当前状态不能登记退款。", 409);
      await this.lockSaleOrder(tx, afterSaleCase.saleOrderId);
      afterSaleCase = await this.getCase(tx, ownerId, id);
      const lineMap = new Map(afterSaleCase.lines.map((line) => [line.id, line]));
      if (requested.some((item) => !lineMap.has(item.afterSaleLineId))) throw new ServiceError("REFUND_ALLOCATION_INVALID", "退款分配只能关联当前售后明细。", 422);
      const sale = await this.getSettledSale(tx, ownerId, afterSaleCase.saleOrderId);
      const refunded = (await tx.saleRefundRecord.aggregate({ where: { ownerId, saleOrderId: sale.id }, _sum: { refundAmount: true } }))._sum.refundAmount ?? new Prisma.Decimal(0);
      if (refunded.plus(refundAmount).greaterThan(sale.actualReceivedAmount!)) throw new ServiceError("REFUND_LIMIT_EXCEEDED", "累计退款不能超过实际到账金额。", 409);
      const approvedTotal = sumDecimals(afterSaleCase.lines.map((line) => line.approvedRefundAmount));
      const caseRefunded = sumDecimals(afterSaleCase.refundRecords.map((record) => record.refundAmount));
      if (caseRefunded.plus(refundAmount).greaterThan(approvedTotal)) throw new ServiceError("CASE_REFUND_LIMIT_EXCEEDED", "退款不能超过本售后已批准金额。", 409);
      for (const item of requested) {
        const line = lineMap.get(item.afterSaleLineId)!;
        const lineCurrent = sumDecimals(line.refundAllocations.map((allocation) => allocation.amount));
        if (lineCurrent.plus(item.amount).greaterThan(line.approvedRefundAmount ?? 0)) throw new ServiceError("LINE_REFUND_LIMIT_EXCEEDED", "退款不能超过该售后明细已批准金额。", 409);
        const historical = (await tx.saleRefundAllocation.aggregate({ where: { ownerId, afterSaleLine: { saleLineId: line.saleLineId } }, _sum: { amount: true } }))._sum.amount ?? new Prisma.Decimal(0);
        if (line.saleAmountSnapshot?.greaterThan(0) && historical.plus(item.amount).greaterThan(line.saleAmountSnapshot)) throw new ServiceError("LINE_REFUND_LIMIT_EXCEEDED", "累计退款不能超过商品成交金额。", 409);
      }
      const record = await tx.saleRefundRecord.create({ data: { ownerId, afterSaleCaseId: id, saleOrderId: sale.id, refundAmount, refundedAt, refundMethod: input.refundMethod?.trim() || null, externalRefundNo: input.externalRefundNo?.trim() || null, idempotencyKey: input.idempotencyKey.trim(), note: input.note?.trim() || null } });
      await tx.saleRefundAllocation.createMany({ data: requested.map((item) => ({ ownerId, refundRecordId: record.id, afterSaleLineId: item.afterSaleLineId, amount: item.amount })) });
      const nextStatus = caseRefunded.plus(refundAmount).equals(approvedTotal) ? "REFUNDED" : "PARTIALLY_REFUNDED";
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: nextStatus } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "REFUND_RECORDED", fromStatus: afterSaleCase.status, toStatus: nextStatus, metadata: { refundAmount: refundAmount.toFixed(2), idempotencyKey: input.idempotencyKey.trim() } } });
      return tx.saleRefundRecord.findUniqueOrThrow({ where: { id: record.id }, include: { allocations: true } });
    }, { isolationLevel: "Serializable" }));
  }

  async complete(ownerId: string, id: string, note?: string) {
    return withSerializableRetry(() => db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      requireTransition(afterSaleCase.type, afterSaleCase.status, "REFUNDED", "已完成");
      const ids = afterSaleCase.lines.map((line) => line.inventoryItemId);
      await this.lockInventoryItems(tx, ids);
      const inventory = await tx.inventoryItem.findMany({ where: { ownerId, id: { in: ids } } });
      if (inventory.length !== ids.length || inventory.some((item) => item.itemStatus !== "SOLD" || item.ownershipStatus !== "OWNED")) throw new ServiceError("COMPLETE_INVENTORY_INVALID", "完成售后时选中库存必须仍为自有且已售出。", 409);
      if (afterSaleCase.type === "RETURN_AND_REFUND") {
        for (const line of afterSaleCase.lines) {
          if (!line.inspection || !isFinalInspectionResult(line.inspection.result)) throw new ServiceError("INSPECTION_INCOMPLETE", "退货验货结果未完成。", 409);
          const current = inventory.find((item) => item.id === line.inventoryItemId)!;
          const nextStatus = line.inspection.result === "RESTOCKED" ? "STOCKED" : "PROBLEM";
          await tx.inventoryItem.update({ where: { id: current.id, ownerId }, data: { itemStatus: nextStatus, storageLocation: line.inspection.storageLocation ?? current.storageLocation, problemReason: nextStatus === "PROBLEM" ? line.inspection.problemReason : null } });
          await tx.inventoryActionLog.create({ data: { ownerId, inventoryItemId: current.id, purchaseOrderId: line.saleLine.sourcePurchaseOrderId, actionType: nextStatus === "STOCKED" ? "SALES_AFTER_SALE_RESTOCKED" : "SALES_AFTER_SALE_PROBLEM", note: line.inspection.note ?? note?.trim() ?? null, oldItemStatus: "SOLD", newItemStatus: nextStatus, oldStorageLocation: current.storageLocation, newStorageLocation: line.inspection.storageLocation ?? current.storageLocation } });
        }
      }
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "COMPLETED", completedAt: new Date() } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "COMPLETED", fromStatus: "REFUNDED", toStatus: "COMPLETED", note: note?.trim() || null } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" }));
  }

  async cancel(ownerId: string, id: string, note?: string) {
    return db.$transaction(async (tx) => {
      await this.lockCase(tx, id);
      const afterSaleCase = await this.getCase(tx, ownerId, id);
      if (!(CANCELLABLE_SALES_AFTER_SALE_STATUSES as readonly string[]).includes(afterSaleCase.status)) throw new ServiceError("CANCEL_NOT_ALLOWED", "当前销售售后状态不允许取消。", 409);
      if (afterSaleCase.refundRecords.length || afterSaleCase.returnShippedAt) throw new ServiceError("CANCEL_NOT_ALLOWED", "已发生退款或退货运输，不能取消。", 409);
      const inventory = await tx.inventoryItem.findMany({ where: { ownerId, id: { in: afterSaleCase.lines.map((line) => line.inventoryItemId) } } });
      if (inventory.some((item) => item.itemStatus !== "SOLD" || item.ownershipStatus !== "OWNED")) throw new ServiceError("CANCEL_NOT_ALLOWED", "库存状态已变化，不能取消。", 409);
      await tx.saleAfterSaleCase.update({ where: { id }, data: { status: "CANCELLED", cancelledAt: new Date(), note: note?.trim() || afterSaleCase.note } });
      await tx.saleAfterSaleActionLog.create({ data: { ownerId, afterSaleCaseId: id, action: "CANCELLED", fromStatus: afterSaleCase.status, toStatus: "CANCELLED", note: note?.trim() || null } });
      return this.getCase(tx, ownerId, id);
    }, { isolationLevel: "Serializable" });
  }
}

export const salesAfterSalesService = new SalesAfterSalesService();
