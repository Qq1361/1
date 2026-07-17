import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { purchaseAfterSalesService } from "../src/server/purchase-after-sales/purchase-after-sales-service.ts";
import { purchaseAfterSalesQuery } from "../src/server/purchase-after-sales/purchase-after-sales-query.ts";
import { salesService } from "../src/server/sales/sales-service.ts";
import { shipmentService } from "../src/server/services/shipment-service.ts";
import { inventoryService } from "../src/server/services/inventory-service.ts";
import { purchaseOrderService } from "../src/server/services/purchase-order-service.ts";
import { getReminderType } from "../src/server/services/todo-service.ts";
import { GET as listPurchaseAfterSales, POST as createPurchaseAfterSale } from "../src/app/api/purchase-after-sales/route.ts";
import { GET as eligiblePurchaseAfterSaleItems } from "../src/app/api/purchase-after-sales/eligible-items/route.ts";
import { GET as getPurchaseAfterSale, PATCH as updatePurchaseAfterSale } from "../src/app/api/purchase-after-sales/[id]/route.ts";
import { POST as submitPurchaseAfterSale } from "../src/app/api/purchase-after-sales/[id]/submit/route.ts";
import { POST as approvePurchaseAfterSale } from "../src/app/api/purchase-after-sales/[id]/seller-approve/route.ts";
import { POST as recordPurchaseAfterSaleRefund } from "../src/app/api/purchase-after-sales/[id]/refunds/route.ts";
import { POST as markPurchaseAfterSaleRefundPending } from "../src/app/api/purchase-after-sales/[id]/refund-pending/route.ts";
import { POST as completePurchaseAfterSale } from "../src/app/api/purchase-after-sales/[id]/complete/route.ts";

const ownerId = "default-user";
const runId = `M3D-PURCHASE-${Date.now()}`;
const verificationBaseUrl = (process.env.APP_BASE_URL ?? "http://localhost").replace(/\/$/, "");
const created = {
  orderId: null,
  inventoryIds: [],
  inspectionIds: [],
  caseIds: [],
  lineIds: [],
  refundIds: [],
  allocationIds: [],
  actionLogIds: [],
};
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

async function rejects(action, description) {
  try {
    await action();
  } catch {
    checks += 1;
    return;
  }
  throw new Error(`${description} should be rejected`);
}

async function pathDoesNotExist(relativePath) {
  try {
    await fs.access(path.join(process.cwd(), relativePath));
  } catch {
    checks += 1;
    return;
  }
  throw new Error(`${relativePath} must not exist in the API-only slice`);
}

function context(id) {
  return { params: Promise.resolve({ id }) };
}

function request(url, init) {
  const path = url.startsWith("http://localhost") ? url.slice("http://localhost".length) : url;
  return new Request(`${verificationBaseUrl}${path}`, init);
}

function jsonRequest(url, body) {
  return request(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function routeJson(handler, request, routeContext) {
  const response = routeContext ? await handler(request, routeContext) : await handler(request);
  return { response, body: await response.json() };
}

async function createProblemInventory(item, sequence) {
  const inspection = await db.inspection.create({
    data: {
      ownerId,
      purchaseOrderItemId: item.id,
      sequence,
      status: "PROBLEM",
      result: "PROBLEM",
      currentStep: 6,
      completedAt: new Date(),
      notes: "M3-D1 model fixture",
    },
  });
  created.inspectionIds.push(inspection.id);

  const inventory = await db.inventoryItem.create({
    data: {
      ownerId,
      purchaseOrderItemId: item.id,
      inspectionId: inspection.id,
      inventoryCode: `${runId}-${item.id.slice(-6)}-${sequence}`,
      name: item.name,
      skuText: item.skuText,
      unitCost: decimal("100.00"),
      itemStatus: "PROBLEM",
      stockedAt: new Date(),
      problemReason: "M3-D1 model fixture",
    },
  });
  created.inventoryIds.push(inventory.id);
  return { inspection, inventory };
}

function lineInput(caseId, item, inspection, inventory, overrides = {}) {
  return {
    ownerId,
    afterSaleCaseId: caseId,
    purchaseOrderItemId: item.id,
    inspectionId: inspection.id,
    inventoryItemId: inventory.id,
    requestedRefundAmount: decimal("20.00"),
    approvedRefundAmount: null,
    returnRequired: false,
    productNameSnapshot: item.name,
    skuSnapshot: item.skuText,
    inventoryCodeSnapshot: inventory.inventoryCode,
    costAmountSnapshot: inventory.unitCost,
    ...overrides,
  };
}

async function createCase(purchaseOrderId, suffix, type = "REFUND_ONLY") {
  const afterSaleCase = await db.purchaseAfterSaleCase.create({
    data: {
      ownerId,
      caseNo: `${runId}-${suffix}`,
      purchaseOrderId,
      type,
      status: "DRAFT",
      reason: "M3-D1 model verification",
    },
  });
  created.caseIds.push(afterSaleCase.id);
  return afterSaleCase;
}

try {
  await db.user.upsert({
    where: { id: ownerId },
    update: {},
    create: { id: ownerId, name: "默认用户" },
  });

  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: runId,
      paidAt: new Date(),
      totalAmount: decimal("300.00"),
      shippingAmount: decimal("12.00"),
      status: "PARTIALLY_STOCKED",
      allocationStatus: "CONFIRMED",
      items: {
        create: [
          { name: "M3-D1 组合采购 A", skuText: "A-01", quantity: 1, allocatedTotalCost: decimal("100.00") },
          { name: "M3-D1 组合采购 B", skuText: "B-01", quantity: 1, allocatedTotalCost: decimal("100.00") },
          { name: "M3-D1 组合采购 C", skuText: "C-01", quantity: 1, allocatedTotalCost: decimal("100.00") },
        ],
      },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  created.orderId = purchaseOrder.id;
  const [itemA, itemB, itemC] = purchaseOrder.items;
  const fixtureA = await createProblemInventory(itemA, 1);
  const fixtureB = await createProblemInventory(itemB, 1);
  const fixtureC = await createProblemInventory(itemC, 1);

  assert(fixtureA.inventory.itemStatus === "PROBLEM", "fixture represents completed PROBLEM inspection inventory");
  assert(fixtureA.inventory.ownershipStatus === "OWNED", "new inventory defaults to OWNED");

  const invalidApiCreate = await routeJson(
    createPurchaseAfterSale,
    jsonRequest("http://localhost/api/purchase-after-sales", { purchaseOrderId: purchaseOrder.id, type: "INVALID", lines: [] }),
  );
  assert(invalidApiCreate.response.status === 400 && invalidApiCreate.body.code === "INVALID_REQUEST", "API rejects invalid purchase after-sales input with stable 400");
  const forbiddenApiCreate = await routeJson(
    createPurchaseAfterSale,
    jsonRequest("http://localhost/api/purchase-after-sales", {
      purchaseOrderId: purchaseOrder.id,
      type: "REFUND_ONLY",
      ownerId: "other-owner",
      lines: [{ purchaseOrderItemId: itemA.id, inspectionId: fixtureA.inspection.id, inventoryItemId: fixtureA.inventory.id, requestedRefundAmount: "10.00" }],
    }),
  );
  assert(forbiddenApiCreate.response.status === 400, "API rejects client-supplied owner and authority fields");
  const eligible = await routeJson(
    eligiblePurchaseAfterSaleItems,
    request(`http://localhost/api/purchase-after-sales/eligible-items?purchaseOrderId=${purchaseOrder.id}`),
  );
  assert(eligible.response.status === 200 && eligible.body.items.some((item) => item.inventoryItemId === fixtureA.inventory.id) && typeof eligible.body.items[0].costAmount === "string", "eligible-items returns owned problem inventory with JSON-safe Decimal values");
  const apiDraft = await routeJson(
    createPurchaseAfterSale,
    jsonRequest("http://localhost/api/purchase-after-sales", {
      purchaseOrderId: purchaseOrder.id,
      type: "REFUND_ONLY",
      reason: "API verification",
      lines: [{ purchaseOrderItemId: itemA.id, inspectionId: fixtureA.inspection.id, inventoryItemId: fixtureA.inventory.id, requestedRefundAmount: "10.00" }],
    }),
  );
  assert(apiDraft.response.status === 201 && apiDraft.body.status === "DRAFT" && apiDraft.body.lines[0].requestedRefundAmount === "10.00", "POST API creates a draft and returns a complete stable DTO");
  created.caseIds.push(apiDraft.body.id);
  const apiDraftId = apiDraft.body.id;
  const apiLineId = apiDraft.body.lines[0].id;
  const apiUpdated = await routeJson(
    updatePurchaseAfterSale,
    request(`http://localhost/api/purchase-after-sales/${apiDraftId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ type: "REFUND_ONLY", note: "draft note" }) }),
    context(apiDraftId),
  );
  assert(apiUpdated.response.status === 200 && apiUpdated.body.lines.length === 1 && apiUpdated.body.note === "draft note", "PATCH API preserves draft lines when lines are omitted");
  const apiSubmitted = await routeJson(submitPurchaseAfterSale, request(`http://localhost/api/purchase-after-sales/${apiDraftId}/submit`, { method: "POST" }), context(apiDraftId));
  assert(apiSubmitted.response.status === 200 && apiSubmitted.body.status === "REQUESTED", "submit API delegates state validation to the service");
  const apiApproved = await routeJson(
    approvePurchaseAfterSale,
    jsonRequest(`http://localhost/api/purchase-after-sales/${apiDraftId}/seller-approve`, { lines: [{ afterSaleLineId: apiLineId, approvedRefundAmount: "10.00" }], note: "approved by API" }),
    context(apiDraftId),
  );
  assert(apiApproved.response.status === 200 && apiApproved.body.actionLogs.some((log) => log.note === "approved by API"), "approval API persists explicit line approval and action-log note");
  const apiRefundPending = await routeJson(markPurchaseAfterSaleRefundPending, request(`http://localhost/api/purchase-after-sales/${apiDraftId}/refund-pending`, { method: "POST" }), context(apiDraftId));
  assert(apiRefundPending.response.status === 200 && apiRefundPending.body.status === "REFUND_PENDING", "refund-pending accepts an empty body and returns refreshed detail");
  const refundPayload = { idempotencyKey: `${runId}-api-refund`, refundAmount: "10.00", note: "refund note", allocations: [{ afterSaleLineId: apiLineId, amount: "10.00" }] };
  const apiRefund = await routeJson(recordPurchaseAfterSaleRefund, jsonRequest(`http://localhost/api/purchase-after-sales/${apiDraftId}/refunds`, refundPayload), context(apiDraftId));
  assert(apiRefund.response.status === 201 && apiRefund.body.updatedCase.totals.actualRefundTotal === "10.00", "refund API returns a created refund record and updated totals");
  created.refundIds.push(apiRefund.body.refundRecord.id);
  const idempotentApiRefund = await routeJson(recordPurchaseAfterSaleRefund, jsonRequest(`http://localhost/api/purchase-after-sales/${apiDraftId}/refunds`, refundPayload), context(apiDraftId));
  assert(idempotentApiRefund.response.status === 200 && idempotentApiRefund.body.refundRecord.id === apiRefund.body.refundRecord.id, "same idempotency key returns the original refund without duplication");
  const apiCompleted = await routeJson(completePurchaseAfterSale, jsonRequest(`http://localhost/api/purchase-after-sales/${apiDraftId}/complete`, { note: "completed" }), context(apiDraftId));
  assert(apiCompleted.response.status === 200 && apiCompleted.body.status === "COMPLETED", "complete API returns the updated after-sales DTO");
  const apiList = await routeJson(listPurchaseAfterSales, request(`http://localhost/api/purchase-after-sales?purchaseOrderId=${purchaseOrder.id}&page=1&pageSize=20`));
  assert(apiList.response.status === 200 && apiList.body.items.some((item) => item.id === apiDraftId), "list API returns owner-scoped paged cases");
  const apiDetail = await routeJson(getPurchaseAfterSale, request(`http://localhost/api/purchase-after-sales/${apiDraftId}`), context(apiDraftId));
  assert(apiDetail.response.status === 200 && apiDetail.body.lines[0].currentInventory.itemStatus === "PROBLEM" && apiDetail.body.availableActions.length === 0, "detail API keeps snapshots and current inventory state separate");
  const missingDetail = await routeJson(getPurchaseAfterSale, request("http://localhost/api/purchase-after-sales/missing"), context("missing"));
  assert(missingDetail.response.status === 404, "missing or cross-owner purchase after-sales detail is a 404");

  const beforeDraftOrder = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } });
  const beforeDraftInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixtureC.inventory.id } });
  const serviceDraft = await purchaseAfterSalesService.createDraft(ownerId, {
    type: "REFUND_ONLY",
    reason: "M3-D1-2 service verification",
    lines: [{ purchaseOrderItemId: itemC.id, inspectionId: fixtureC.inspection.id, inventoryItemId: fixtureC.inventory.id, requestedRefundAmount: "20.00" }],
  });
  created.caseIds.push(serviceDraft.id);
  assert(serviceDraft.status === "DRAFT", "service creates a REFUND_ONLY draft");
  const afterDraftOrder = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } });
  const afterDraftInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixtureC.inventory.id } });
  assert(afterDraftOrder.totalAmount.equals(beforeDraftOrder.totalAmount) && afterDraftOrder.shippingAmount.equals(beforeDraftOrder.shippingAmount), "draft does not modify purchase payment");
  assert(afterDraftInventory.itemStatus === beforeDraftInventory.itemStatus && afterDraftInventory.ownershipStatus === beforeDraftInventory.ownershipStatus, "draft does not modify inventory or ownership");

  const requestedCase = await purchaseAfterSalesService.submit(ownerId, serviceDraft.id);
  assert(requestedCase.status === "REQUESTED", "submit starts active purchase after-sales occupancy");
  const conflictingDraft = await purchaseAfterSalesService.createDraft(ownerId, {
    type: "REFUND_ONLY",
    lines: [{ purchaseOrderItemId: itemC.id, inspectionId: fixtureC.inspection.id, inventoryItemId: fixtureC.inventory.id, requestedRefundAmount: "10.00" }],
  });
  created.caseIds.push(conflictingDraft.id);
  await rejects(() => purchaseAfterSalesService.submit(ownerId, conflictingDraft.id), "same inventory in another active case");

  const approvedCase = await purchaseAfterSalesService.sellerApprove(ownerId, serviceDraft.id, [{
    afterSaleLineId: requestedCase.lines[0].id,
    approvedRefundAmount: "20.00",
  }]);
  assert(approvedCase.status === "SELLER_APPROVED" && approvedCase.lines[0].approvedRefundAmount.equals(decimal("20.00")), "seller approval persists explicit line amount");
  await rejects(() => purchaseAfterSalesService.prepareReturn(ownerId, serviceDraft.id), "REFUND_ONLY entering return flow");
  const refundPendingCase = await purchaseAfterSalesService.markRefundPending(ownerId, serviceDraft.id);
  assert(refundPendingCase.status === "REFUND_PENDING", "REFUND_ONLY enters refund pending while inventory stays owned");

  const firstRefund = await purchaseAfterSalesService.recordRefund(ownerId, serviceDraft.id, {
    idempotencyKey: `${runId}-service-refund-1`, refundAmount: "8.00", refundMethod: "MANUAL",
    allocations: [{ afterSaleLineId: requestedCase.lines[0].id, amount: "8.00" }],
  });
  created.refundIds.push(firstRefund.id);
  assert(firstRefund.refundAmount.equals(decimal("8.00")), "records a real partial refund with Decimal amount");
  const idempotentRefund = await purchaseAfterSalesService.recordRefund(ownerId, serviceDraft.id, {
    idempotencyKey: `${runId}-service-refund-1`, refundAmount: "8.00", refundMethod: "MANUAL",
    allocations: [{ afterSaleLineId: requestedCase.lines[0].id, amount: "8.00" }],
  });
  assert(idempotentRefund.id === firstRefund.id, "same idempotency request does not create another refund record");
  await rejects(() => purchaseAfterSalesService.recordRefund(ownerId, serviceDraft.id, {
    idempotencyKey: `${runId}-service-refund-1`, refundAmount: "7.00",
    allocations: [{ afterSaleLineId: requestedCase.lines[0].id, amount: "7.00" }],
  }), "same idempotency key with another payload");
  const partialCase = await db.purchaseAfterSaleCase.findUniqueOrThrow({ where: { id: serviceDraft.id } });
  assert(partialCase.status === "PARTIALLY_REFUNDED", "partial refund updates case status");
  await rejects(() => purchaseAfterSalesService.recordRefund(ownerId, serviceDraft.id, {
    idempotencyKey: `${runId}-service-refund-over-limit`, refundAmount: "13.00",
    allocations: [{ afterSaleLineId: requestedCase.lines[0].id, amount: "13.00" }],
  }), "refund exceeding the approved line amount");
  const finalRefund = await purchaseAfterSalesService.recordRefund(ownerId, serviceDraft.id, {
    idempotencyKey: `${runId}-service-refund-2`, refundAmount: "12.00",
    allocations: [{ afterSaleLineId: requestedCase.lines[0].id, amount: "12.00" }],
  });
  created.refundIds.push(finalRefund.id);
  const refundedCase = await purchaseAfterSalesService.complete(ownerId, serviceDraft.id);
  assert(refundedCase.status === "COMPLETED", "fully refunded REFUND_ONLY case can complete");
  const completedRefundOnlyInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixtureC.inventory.id } });
  assert(completedRefundOnlyInventory.itemStatus === "PROBLEM" && completedRefundOnlyInventory.ownershipStatus === "OWNED", "REFUND_ONLY completion preserves PROBLEM and OWNED inventory");

  const returnDraft = await purchaseAfterSalesService.createDraft(ownerId, {
    type: "RETURN_AND_REFUND",
    lines: [{ purchaseOrderItemId: itemB.id, inspectionId: fixtureB.inspection.id, inventoryItemId: fixtureB.inventory.id, requestedRefundAmount: "15.00" }],
  });
  created.caseIds.push(returnDraft.id);
  const returnRequested = await purchaseAfterSalesService.submit(ownerId, returnDraft.id);
  await purchaseAfterSalesService.sellerApprove(ownerId, returnDraft.id, [{ afterSaleLineId: returnRequested.lines[0].id, approvedRefundAmount: "15.00" }]);
  await rejects(() => purchaseAfterSalesService.markRefundPending(ownerId, returnDraft.id), "RETURN_AND_REFUND skipping seller receipt");
  await purchaseAfterSalesService.prepareReturn(ownerId, returnDraft.id);
  const returningCase = await purchaseAfterSalesService.markReturnShipped(ownerId, returnDraft.id, { returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-RETURN` });
  assert(returningCase.status === "RETURNING_TO_SELLER", "return case moves to returning only with logistics");
  const returningInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixtureB.inventory.id } });
  assert(returningInventory.itemStatus === "PROBLEM" && returningInventory.ownershipStatus === "RETURNING_TO_UPSTREAM_SELLER", "return shipment changes only ownership state");
  await rejects(() => salesService.createDraft(ownerId, {
    platform: "OTHER", soldAt: new Date().toISOString(), grossAmount: "100.00", items: [{ inventoryItemId: fixtureB.inventory.id }],
  }), "non-owned inventory creating a sales draft");
  await rejects(() => shipmentService.createDraft(ownerId, {
    platform: "OTHER", defaultPurpose: "OTHER", itemIds: [fixtureB.inventory.id],
  }), "non-owned inventory creating a shipment draft");
  assert(getReminderType({ saleMode: "NONE", itemStatus: "STOCKED", ownershipStatus: "RETURNING_TO_UPSTREAM_SELLER", expiryDate: new Date(Date.now() + 360 * 86_400_000), stockedAt: new Date(Date.now() - 4 * 86_400_000) }) === null, "non-owned inventory does not produce reminders");
  await rejects(() => purchaseAfterSalesService.cancel(ownerId, returnDraft.id), "cancelling after return shipped");
  const sellerReceivedCase = await purchaseAfterSalesService.markSellerReceived(ownerId, returnDraft.id);
  assert(sellerReceivedCase.status === "SELLER_RECEIVED", "seller receipt advances return case");
  const returnedInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixtureB.inventory.id } });
  assert(returnedInventory.itemStatus === "PROBLEM" && returnedInventory.ownershipStatus === "RETURNED_TO_UPSTREAM_SELLER", "seller receipt changes ownership but preserves problem status");
  const ownershipSummary = await inventoryService.skuSummary(ownerId, {});
  const returnedBucket = ownershipSummary.items.find((item) => item.productName === itemB.name && item.sku === itemB.skuText);
  assert(returnedBucket?.returnedToUpstreamSellerCount === 1 && returnedBucket.unsoldCount === 0, "SKU summary separates returned-to-upstream inventory from unsold assets");
  await purchaseAfterSalesService.markRefundPending(ownerId, returnDraft.id);
  const returnRefund = await purchaseAfterSalesService.recordRefund(ownerId, returnDraft.id, {
    idempotencyKey: `${runId}-return-refund`, refundAmount: "15.00",
    allocations: [{ afterSaleLineId: returnRequested.lines[0].id, amount: "15.00" }],
  });
  created.refundIds.push(returnRefund.id);
  const completedReturnCase = await purchaseAfterSalesService.complete(ownerId, returnDraft.id);
  assert(completedReturnCase.status === "COMPLETED", "fully refunded return case can complete");

  const beforeOrder = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } });
  const refundOnlyCase = await createCase(purchaseOrder.id, "REFUND", "REFUND_ONLY");
  const refundOnlyLine = await db.purchaseAfterSaleLine.create({
    data: lineInput(refundOnlyCase.id, itemA, fixtureA.inspection, fixtureA.inventory),
  });
  created.lineIds.push(refundOnlyLine.id);

  assert(refundOnlyCase.status === "DRAFT" && refundOnlyCase.type === "REFUND_ONLY", "can create REFUND_ONLY DRAFT case");
  assert(refundOnlyLine.purchaseOrderItemId === itemA.id, "line links the selected PurchaseOrderItem");
  assert(refundOnlyLine.inspectionId === fixtureA.inspection.id, "line links the completed Inspection");
  assert(refundOnlyLine.inventoryItemId === fixtureA.inventory.id, "line links the exact InventoryItem");
  assert(decimal(refundOnlyLine.requestedRefundAmount).equals(decimal("20.00")), "requested refund is stored as Decimal");
  assert(refundOnlyLine.approvedRefundAmount === null, "approved refund can be null");

  const afterCaseOrder = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } });
  const afterCaseInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixtureA.inventory.id } });
  assert(afterCaseOrder.status === beforeOrder.status, "model creation does not modify PurchaseOrder.status");
  assert(decimal(afterCaseOrder.totalAmount).equals(beforeOrder.totalAmount) && decimal(afterCaseOrder.shippingAmount).equals(beforeOrder.shippingAmount), "model creation does not modify paidTotal inputs");
  assert(afterCaseInventory.itemStatus === "PROBLEM" && afterCaseInventory.ownershipStatus === "OWNED", "model creation does not modify inventory status or ownership");

  const returnCase = await createCase(purchaseOrder.id, "RETURN", "RETURN_AND_REFUND");
  const returnLine = await db.purchaseAfterSaleLine.create({
    data: lineInput(returnCase.id, itemA, fixtureA.inspection, fixtureA.inventory, { returnRequired: true }),
  });
  created.lineIds.push(returnLine.id);
  assert(returnCase.type === "RETURN_AND_REFUND" && returnLine.returnRequired, "can create RETURN_AND_REFUND case");

  const constraintCase = await createCase(purchaseOrder.id, "UNIQUE");
  const constraintLine = await db.purchaseAfterSaleLine.create({
    data: lineInput(constraintCase.id, itemA, fixtureA.inspection, fixtureA.inventory),
  });
  created.lineIds.push(constraintLine.id);
  await rejects(
    () => db.purchaseAfterSaleLine.create({ data: lineInput(constraintCase.id, itemA, fixtureA.inspection, fixtureB.inventory) }),
    "duplicate inspection in the same case",
  );
  await rejects(
    () => db.purchaseAfterSaleLine.create({ data: lineInput(constraintCase.id, itemB, fixtureB.inspection, fixtureA.inventory) }),
    "duplicate inventory item in the same case",
  );

  const moneyCase = await createCase(purchaseOrder.id, "MONEY");
  await rejects(
    () => db.purchaseAfterSaleLine.create({ data: lineInput(moneyCase.id, itemC, fixtureC.inspection, fixtureC.inventory, { requestedRefundAmount: decimal("0.00") }) }),
    "non-positive requested refund amount",
  );
  await rejects(
    () => db.purchaseAfterSaleLine.create({ data: lineInput(moneyCase.id, itemC, fixtureC.inspection, fixtureC.inventory, { approvedRefundAmount: decimal("-0.01") }) }),
    "negative approved refund amount",
  );

  const allocationCase = await createCase(purchaseOrder.id, "ALLOCATIONS");
  const allocationLineA = await db.purchaseAfterSaleLine.create({
    data: lineInput(allocationCase.id, itemA, fixtureA.inspection, fixtureA.inventory),
  });
  const allocationLineB = await db.purchaseAfterSaleLine.create({
    data: lineInput(allocationCase.id, itemB, fixtureB.inspection, fixtureB.inventory),
  });
  created.lineIds.push(allocationLineA.id, allocationLineB.id);
  assert(allocationLineA.inventoryItemId !== allocationLineB.inventoryItemId, "combined purchase can select only chosen inventory items as separate lines");

  const refundRecord = await db.purchaseRefundRecord.create({
    data: {
      ownerId,
      afterSaleCaseId: allocationCase.id,
      purchaseOrderId: purchaseOrder.id,
      refundAmount: decimal("30.00"),
      refundedAt: new Date(),
      refundMethod: "MANUAL",
      idempotencyKey: `${runId}-refund-1`,
    },
  });
  created.refundIds.push(refundRecord.id);
  assert(decimal(refundRecord.refundAmount).equals(decimal("30.00")), "can create a Decimal PurchaseRefundRecord");
  await rejects(
    () => db.purchaseRefundRecord.create({ data: { ...refundRecord, id: undefined, createdAt: undefined } }),
    "duplicate refund idempotency key",
  );
  await rejects(
    () => db.purchaseRefundRecord.create({ data: { ownerId, afterSaleCaseId: allocationCase.id, purchaseOrderId: purchaseOrder.id, refundAmount: decimal("0.00"), refundedAt: new Date(), idempotencyKey: `${runId}-refund-zero` } }),
    "non-positive refund amount",
  );

  const allocationA = await db.purchaseRefundAllocation.create({
    data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: allocationLineA.id, amount: decimal("10.00") },
  });
  const allocationB = await db.purchaseRefundAllocation.create({
    data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: allocationLineB.id, amount: decimal("20.00") },
  });
  created.allocationIds.push(allocationA.id, allocationB.id);
  assert(allocationA.id !== allocationB.id, "one refund record can allocate to multiple after-sale lines");
  await rejects(
    () => db.purchaseRefundAllocation.create({ data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: allocationLineA.id, amount: decimal("1.00") } }),
    "duplicate refund record and after-sale line allocation",
  );
  await rejects(
    () => db.purchaseRefundAllocation.create({ data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: refundOnlyLine.id, amount: decimal("0.00") } }),
    "non-positive allocation amount",
  );

  const extraCompensationRecord = await db.purchaseRefundRecord.create({
    data: {
      ownerId,
      afterSaleCaseId: allocationCase.id,
      purchaseOrderId: purchaseOrder.id,
      refundAmount: decimal("120.00"),
      refundedAt: new Date(),
      refundMethod: "MANUAL",
      idempotencyKey: `${runId}-extra-compensation`,
    },
  });
  created.refundIds.push(extraCompensationRecord.id);
  const extraCompensationAllocation = await db.purchaseRefundAllocation.create({
    data: { ownerId, refundRecordId: extraCompensationRecord.id, afterSaleLineId: allocationLineA.id, amount: decimal("120.00") },
  });
  created.allocationIds.push(extraCompensationAllocation.id);

  const cancelledRefundCase = await db.purchaseAfterSaleCase.create({
    data: {
      ownerId,
      caseNo: `${runId}-CANCELLED-REFUND`,
      purchaseOrderId: purchaseOrder.id,
      type: "REFUND_ONLY",
      status: "CANCELLED",
      reason: "historical refund verification",
    },
  });
  created.caseIds.push(cancelledRefundCase.id);
  const cancelledRefundRecord = await db.purchaseRefundRecord.create({
    data: {
      ownerId,
      afterSaleCaseId: cancelledRefundCase.id,
      purchaseOrderId: purchaseOrder.id,
      refundAmount: decimal("5.00"),
      refundedAt: new Date(),
      refundMethod: "MANUAL",
      idempotencyKey: `${runId}-cancelled-refund`,
    },
  });
  created.refundIds.push(cancelledRefundRecord.id);

  const allocationDetail = await purchaseAfterSalesQuery.getDetail(ownerId, allocationCase.id);
  const allocationDetailLineA = allocationDetail.lines.find((line) => line.id === allocationLineA.id);
  const allocationDetailLineB = allocationDetail.lines.find((line) => line.id === allocationLineB.id);
  assert(decimal(allocationDetailLineA?.refundedAmount).equals(decimal("130.00")), "after-sales line reads its actual refund from Allocation only");
  assert(decimal(allocationDetailLineB?.refundedAmount).equals(decimal("20.00")), "multiple allocations stay assigned to their selected lines");
  assert(decimal(allocationDetailLineA?.costAmountSnapshot).equals(decimal("100.00")), "after-sales read model preserves original cost snapshot");

  const orderDetail = await purchaseOrderService.getOrder(ownerId, purchaseOrder.id);
  const expectedRefundTotal = await db.purchaseRefundRecord.aggregate({
    where: { ownerId, purchaseOrderId: purchaseOrder.id },
    _sum: { refundAmount: true },
  });
  assert(decimal(orderDetail.purchaseAfterSalesSummary.totalPurchaseRefundedAmount).equals(expectedRefundTotal._sum.refundAmount ?? decimal(0)), "purchase order refund summary counts each RefundRecord once, not each Allocation");
  assert(decimal(orderDetail.purchaseAfterSalesSummary.netPurchasePaidAmount).equals(decimal("312.00").minus(expectedRefundTotal._sum.refundAmount ?? decimal(0))), "net purchase paid amount is original paid total minus real refunds");
  assert(decimal(orderDetail.totalAmount).plus(decimal(orderDetail.shippingAmount)).equals(decimal("312.00")), "purchase order original payment fields remain unchanged after refunds");

  const inventoryDetailA = await inventoryService.get(ownerId, fixtureA.inventory.id);
  const inventoryDetailB = await inventoryService.get(ownerId, fixtureB.inventory.id);
  const afterSaleInventoryLineA = inventoryDetailA.purchaseAfterSales.find((line) => line.id === allocationLineA.id);
  const afterSaleInventoryLineB = inventoryDetailB.purchaseAfterSales.find((line) => line.id === allocationLineB.id);
  assert(decimal(afterSaleInventoryLineA?.allocatedRefundAmount).equals(decimal("130.00")), "inventory detail exposes only the selected line Allocation total");
  assert(decimal(afterSaleInventoryLineA?.netCashCost).equals(decimal("-30.00")), "net cash cost can remain negative for extra compensation");
  assert(decimal(afterSaleInventoryLineB?.netCashCost).equals(decimal("80.00")), "combined purchase leaves unselected line costs independent");
  assert(orderDetail.purchaseAfterSalesSummary.totalPurchaseRefundedAmount !== "30.00", "a multi-allocation refund is not duplicated as an order-level refund");

  const actionLog = await db.purchaseAfterSaleActionLog.create({
    data: { ownerId, afterSaleCaseId: allocationCase.id, action: "MODEL_CREATED", toStatus: "DRAFT", note: "M3-D1 verification" },
  });
  created.actionLogIds.push(actionLog.id);
  const actionLogs = await db.purchaseAfterSaleActionLog.findMany({
    where: { afterSaleCaseId: allocationCase.id },
    orderBy: { createdAt: "desc" },
  });
  assert(actionLogs[0]?.id === actionLog.id, "action logs can be read in time order");

  const afterRefundOrder = await db.purchaseOrder.findUniqueOrThrow({ where: { id: purchaseOrder.id } });
  const unselectedInventory = await db.inventoryItem.findUniqueOrThrow({ where: { id: fixtureC.inventory.id } });
  assert(decimal(afterRefundOrder.totalAmount).equals(beforeOrder.totalAmount) && decimal(afterRefundOrder.shippingAmount).equals(beforeOrder.shippingAmount), "refund models do not overwrite original purchase payment");
  assert(unselectedInventory.itemStatus === "PROBLEM" && unselectedInventory.ownershipStatus === "OWNED", "unselected inventory remains unchanged");

  await fs.access(path.join(process.cwd(), "src/server/purchase-after-sales/purchase-after-sales-service.ts"));
  checks += 1;
  const [afterSaleCreateRoute, afterSaleRefundRoute, afterSaleQuery] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/app/api/purchase-after-sales/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/purchase-after-sales/[id]/refunds/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/purchase-after-sales/purchase-after-sales-query.ts"), "utf8"),
  ]);
  assert(afterSaleCreateRoute.includes("purchaseAfterSalesService.createDraft") && afterSaleRefundRoute.includes("purchaseAfterSalesService.recordRefund"), "purchase after-sales write routes delegate to the service layer");
  assert(!afterSaleCreateRoute.includes("purchaseAfterSaleCase.create") && !afterSaleRefundRoute.includes("purchaseRefundRecord.create") && !afterSaleRefundRoute.includes("inventoryItem.update"), "purchase after-sales routes contain no direct authoritative Prisma writes");
  assert(afterSaleQuery.includes("getPurchaseAfterSaleAvailableActions") && !afterSaleQuery.includes("inventoryItem.update"), "query DTO uses the shared action rules and only reads data");
  const [afterSalesUi, afterSalesListPage, afterSalesNewPage, afterSalesDetailPage, appShell, purchaseDetail, inventoryDetail] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/components/purchase-after-sales/purchase-after-sales-ui.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/purchase-after-sales/page.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/purchase-after-sales/new/page.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/purchase-after-sales/[id]/page.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/layout/app-shell.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/purchases/order-detail.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/inventory/inventory-detail.tsx"), "utf8"),
  ]);
  assert(afterSalesListPage.includes("PurchaseAfterSalesList") && afterSalesNewPage.includes("PurchaseAfterSaleForm") && afterSalesDetailPage.includes("PurchaseAfterSaleDetail"), "purchase after-sales list, create, and detail routes exist");
  assert(appShell.includes('label: "采购售后"') && purchaseDetail.includes("purchase-after-sales/new") && inventoryDetail.includes("purchase-after-sales/new"), "navigation, purchase detail, and inventory detail expose purchase after-sales entries");
  assert(afterSalesUi.includes("/api/purchase-after-sales/eligible-items") && afterSalesUi.includes("/api/purchase-after-sales/${id}") && afterSalesUi.includes("availableActions"), "pages load candidates/details through existing APIs and render server-provided actions");
  assert(afterSalesUi.includes("refundIdempotencyKey.current ??= crypto.randomUUID()") && afterSalesUi.includes("allocations") && afterSalesUi.includes("approvedRefundAmount"), "UI requires explicit line approvals/refund allocations and reuses one idempotency key while a refund dialog remains open");
  assert(afterSalesUi.includes("allocatedRefundAmount") && afterSalesUi.includes("netCashCost") && purchaseDetail.includes("purchaseAfterSalesSummary") && inventoryDetail.includes("PurchaseAfterSalesCard"), "purchase after-sales UI exposes derived refund and net-cost summaries across case, order, and inventory detail pages");
  assert(!afterSalesUi.includes("@/server/db") && !afterSalesUi.includes("prisma.") && !afterSalesUi.includes("/api/inventory/") && !afterSalesUi.includes("/api/purchase-orders/"), "purchase after-sales pages contain no direct Prisma or authoritative inventory/payment writes");
  await pathDoesNotExist("src/app/purchases/after-sales");

  const [inventoryPatchRoute, singleSkuRoute, bulkSkuRoute, salesSelectorRoute, shipmentSelectorService] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/app/api/inventory/[id]/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/inventory/[id]/sku/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/inventory/bulk-sku/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/inventory/selectable-for-sale/route.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/services/shipment-service.ts"), "utf8"),
  ]);
  assert(inventoryPatchRoute.includes('key === "ownershipStatus"'), "generic inventory PATCH rejects ownershipStatus");
  assert(singleSkuRoute.includes("containsOwnershipStatus") && bulkSkuRoute.includes("containsOwnershipStatus"), "SKU-only routes reject ownershipStatus");
  assert(salesSelectorRoute.includes('ownershipStatus: "OWNED"'), "sales selector returns only owned inventory");
  assert(shipmentSelectorService.includes('ownershipStatus: "OWNED"') && shipmentSelectorService.includes("assertOwnedShipmentInventory"), "shipment selector and service guard non-owned inventory");

  const schema = await fs.readFile(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const migration = await fs.readFile(
    path.join(process.cwd(), "prisma/migrations/20260714172056_add_m3d_purchase_after_sales_models/migration.sql"),
    "utf8",
  );
  assert(!schema.includes("RETURNED_TO_SELLER"), "schema does not introduce ambiguous returned-to-seller item status");
  assert(schema.includes("PurchaseAfterSaleCase") && schema.includes("SaleAfterSaleCase"), "purchase and sales after-sale models coexist as separate domains");
  assert(!migration.includes("DROP TABLE") && !migration.includes("DROP COLUMN"), "migration is additive and does not remove data structures");
  assert(!migration.includes('UPDATE "inventory_items"') && !migration.includes('"itemStatus"'), "migration does not write inventory ownership or item status business data");
  assert(!migration.includes("SaleOrder") && !migration.includes("applyShipmentLineAction"), "migration does not couple purchase after-sales to sales or M3-0");

  console.log(`verify:m3d-purchase passed ${checks} checks`);
} finally {
  const cleanup = async () => {
    if (created.caseIds.length) await db.purchaseRefundAllocation.deleteMany({ where: { refundRecord: { afterSaleCaseId: { in: created.caseIds } } } });
    if (created.caseIds.length) await db.purchaseRefundRecord.deleteMany({ where: { afterSaleCaseId: { in: created.caseIds } } });
    if (created.allocationIds.length) await db.purchaseRefundAllocation.deleteMany({ where: { id: { in: created.allocationIds } } });
    if (created.actionLogIds.length) await db.purchaseAfterSaleActionLog.deleteMany({ where: { id: { in: created.actionLogIds } } });
    if (created.refundIds.length) await db.purchaseRefundRecord.deleteMany({ where: { id: { in: created.refundIds } } });
    if (created.lineIds.length) await db.purchaseAfterSaleLine.deleteMany({ where: { id: { in: created.lineIds } } });
    if (created.caseIds.length) await db.purchaseAfterSaleCase.deleteMany({ where: { id: { in: created.caseIds } } });
    if (created.inventoryIds.length) await db.inventoryItem.deleteMany({ where: { id: { in: created.inventoryIds } } });
    if (created.inspectionIds.length) await db.inspection.deleteMany({ where: { id: { in: created.inspectionIds } } });
    if (created.orderId) await db.purchaseOrder.delete({ where: { id: created.orderId } });
    if (created.orderId) {
      const remaining = await db.purchaseOrder.count({ where: { id: created.orderId } });
      if (remaining !== 0) throw new Error("verify:m3d-purchase cleanup left the run purchase order behind");
    }
  };

  try {
    await cleanup();
  } catch (error) {
    console.error("verify:m3d-purchase cleanup failed", error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
