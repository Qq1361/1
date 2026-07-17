import "dotenv/config";
import fs from "node:fs/promises";
import path from "node:path";
import { Prisma } from "../src/generated/prisma/client.ts";
import { db } from "../src/server/db.ts";
import { salesAfterSalesService } from "../src/server/sales-after-sales/sales-after-sales-service.ts";
import { salesService } from "../src/server/sales/sales-service.ts";
import { getSalesAfterSaleFinancials } from "../src/server/reports/sales-after-sales-financials.ts";
import { GET as listSalesAfterSales, POST as createSalesAfterSale } from "../src/app/api/sales-after-sales/route.ts";
import { GET as eligibleSalesAfterSaleLines } from "../src/app/api/sales-after-sales/eligible-lines/route.ts";
import { GET as getSalesAfterSale, PATCH as updateSalesAfterSale } from "../src/app/api/sales-after-sales/[id]/route.ts";
import { POST as submitSalesAfterSale } from "../src/app/api/sales-after-sales/[id]/submit/route.ts";
import { POST as approveSalesAfterSale } from "../src/app/api/sales-after-sales/[id]/approve/route.ts";
import { POST as rejectSalesAfterSale } from "../src/app/api/sales-after-sales/[id]/reject/route.ts";
import { POST as prepareSalesAfterSaleReturn } from "../src/app/api/sales-after-sales/[id]/prepare-return/route.ts";
import { POST as shipSalesAfterSaleReturn } from "../src/app/api/sales-after-sales/[id]/return-shipped/route.ts";
import { POST as receiveSalesAfterSaleReturn } from "../src/app/api/sales-after-sales/[id]/return-received/route.ts";
import { POST as inspectSalesAfterSaleReturn } from "../src/app/api/sales-after-sales/[id]/inspect/route.ts";
import { POST as markSalesAfterSaleRefundPending } from "../src/app/api/sales-after-sales/[id]/refund-pending/route.ts";
import { POST as recordSalesAfterSaleRefund } from "../src/app/api/sales-after-sales/[id]/refunds/route.ts";
import { POST as completeSalesAfterSale } from "../src/app/api/sales-after-sales/[id]/complete/route.ts";
import { POST as cancelSalesAfterSale } from "../src/app/api/sales-after-sales/[id]/cancel/route.ts";

const ownerId = "default-user";
const runId = `M3D-SALES-${Date.now()}`;
const created = {
  purchaseOrderId: null,
  inspectionIds: [],
  inventoryIds: [],
  saleOrderId: null,
  saleLineIds: [],
  caseIds: [],
  afterSaleLineIds: [],
  refundRecordIds: [],
  allocationIds: [],
  afterSaleInspectionIds: [],
  actionLogIds: [],
};
const apiCreated = {
  purchaseOrderId: null,
  inspectionIds: [],
  inventoryIds: [],
  saleOrderId: null,
  saleLineIds: [],
  caseIds: [],
};
let checks = 0;

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
}

function decimal(value) {
  return new Prisma.Decimal(value);
}

async function rejects(action, message) {
  try {
    await action();
  } catch {
    checks += 1;
    return;
  }
  throw new Error(`${message} should be rejected`);
}

async function pathDoesNotExist(relativePath) {
  try {
    await fs.access(path.join(process.cwd(), relativePath));
  } catch {
    checks += 1;
    return;
  }
  throw new Error(`${relativePath} must not exist in the sales-after-sales API/page slice`);
}

function context(id) {
  return { params: Promise.resolve({ id }) };
}

function request(url, init) {
  return new Request(url, init);
}

function jsonRequest(url, body) {
  return request(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

async function routeJson(handler, routeRequest, routeContext) {
  const response = routeContext ? await handler(routeRequest, routeContext) : await handler(routeRequest);
  return { response, body: await response.json() };
}

async function createSaleFixture() {
  const owner = await db.user.findUnique({ where: { id: ownerId } });
  assert(owner !== null, "default owner exists for the isolated verification fixture");

  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-PO`,
      paidAt: new Date("2026-07-15T08:00:00.000Z"),
      totalAmount: decimal("300.00"),
      shippingAmount: decimal("0.00"),
      allocationStatus: "CONFIRMED",
      allocationConfirmedAt: new Date("2026-07-15T08:01:00.000Z"),
      status: "STOCKED",
      items: {
        create: [1, 2, 3].map((sequence) => ({
          name: `M3-D2 销售售后商品 ${sequence}`,
          skuText: `SKU-${sequence}`,
          quantity: 1,
          allocatedTotalCost: decimal("100.00"),
        })),
      },
    },
    include: { items: { orderBy: { createdAt: "asc" } } },
  });
  created.purchaseOrderId = purchaseOrder.id;

  const inventory = [];
  for (const [index, item] of purchaseOrder.items.entries()) {
    const inspection = await db.inspection.create({
      data: {
        ownerId,
        purchaseOrderItemId: item.id,
        sequence: 1,
        status: "PASSED",
        result: "PASS",
        currentStep: 6,
        completedAt: new Date("2026-07-15T08:02:00.000Z"),
      },
    });
    created.inspectionIds.push(inspection.id);

    const inventoryItem = await db.inventoryItem.create({
      data: {
        ownerId,
        purchaseOrderItemId: item.id,
        inspectionId: inspection.id,
        inventoryCode: `${runId}-INV-${index + 1}`,
        name: item.name,
        skuText: item.skuText,
        unitCost: decimal("100.00"),
        itemStatus: "SOLD",
        stockedAt: new Date("2026-07-15T08:03:00.000Z"),
      },
    });
    created.inventoryIds.push(inventoryItem.id);
    inventory.push(inventoryItem);
  }

  const saleOrder = await db.saleOrder.create({
    data: {
      ownerId,
      saleNo: `${runId}-SO`,
      platform: "XIANYU",
      soldAt: new Date("2026-07-15T09:00:00.000Z"),
      confirmedAt: new Date("2026-07-15T09:01:00.000Z"),
      settledAt: new Date("2026-07-15T09:02:00.000Z"),
      grossAmount: decimal("450.00"),
      expectedIncome: decimal("420.00"),
      actualReceivedAmount: decimal("420.00"),
      shippingCost: decimal("10.00"),
      otherCost: decimal("5.00"),
      status: "SETTLED",
      note: "M3-D2 model verification fixture",
    },
  });
  created.saleOrderId = saleOrder.id;

  const saleLines = [];
  for (const [index, inventoryItem] of inventory.entries()) {
    const saleLine = await db.saleLine.create({
      data: {
        ownerId,
        saleOrderId: saleOrder.id,
        inventoryItemId: inventoryItem.id,
        inventoryCodeSnapshot: inventoryItem.inventoryCode,
        productNameSnapshot: inventoryItem.name,
        skuSnapshot: inventoryItem.skuText,
        unitCostSnapshot: inventoryItem.unitCost,
        saleAmount: decimal("150.00"),
        costAmount: decimal("100.00"),
        profitAmount: decimal("40.00"),
        sourcePurchaseOrderId: purchaseOrder.id,
        sourcePurchaseOrderItemId: purchaseOrder.items[index].id,
        preSaleItemStatus: "STOCKED",
        preSaleSaleMode: "NONE",
        preSaleStorageLocation: `A-${index + 1}`,
      },
    });
    created.saleLineIds.push(saleLine.id);
    saleLines.push(saleLine);
  }

  return { purchaseOrder, inventory, saleOrder, saleLines };
}

async function createApiSaleFixture() {
  const purchaseOrder = await db.purchaseOrder.create({
    data: {
      ownerId,
      orderNo: `${runId}-API-PO`,
      paidAt: new Date(),
      totalAmount: decimal("100.00"),
      shippingAmount: decimal("0.00"),
      allocationStatus: "CONFIRMED",
      status: "STOCKED",
      items: { create: [{ name: "M3-D2 API 售后商品", skuText: "API-SKU", quantity: 1, allocatedTotalCost: decimal("100.00") }] },
    },
    include: { items: true },
  });
  apiCreated.purchaseOrderId = purchaseOrder.id;
  const item = purchaseOrder.items[0];
  const inspection = await db.inspection.create({ data: { ownerId, purchaseOrderItemId: item.id, sequence: 1, status: "PASSED", result: "PASS", currentStep: 6, completedAt: new Date() } });
  apiCreated.inspectionIds.push(inspection.id);
  const inventory = await db.inventoryItem.create({ data: { ownerId, purchaseOrderItemId: item.id, inspectionId: inspection.id, inventoryCode: `${runId}-API-INV`, name: item.name, skuText: item.skuText, unitCost: decimal("100.00"), itemStatus: "SOLD", stockedAt: new Date() } });
  apiCreated.inventoryIds.push(inventory.id);
  const saleOrder = await db.saleOrder.create({ data: { ownerId, saleNo: `${runId}-API-SO`, platform: "XIANYU", soldAt: new Date(), confirmedAt: new Date(), settledAt: new Date(), grossAmount: decimal("150.00"), actualReceivedAmount: decimal("150.00"), shippingCost: decimal("0.00"), otherCost: decimal("0.00"), status: "SETTLED" } });
  apiCreated.saleOrderId = saleOrder.id;
  const saleLine = await db.saleLine.create({ data: { ownerId, saleOrderId: saleOrder.id, inventoryItemId: inventory.id, inventoryCodeSnapshot: inventory.inventoryCode, productNameSnapshot: inventory.name, skuSnapshot: inventory.skuText, unitCostSnapshot: decimal("100.00"), saleAmount: decimal("150.00"), costAmount: decimal("100.00"), profitAmount: decimal("50.00"), sourcePurchaseOrderId: purchaseOrder.id, sourcePurchaseOrderItemId: item.id, preSaleItemStatus: "STOCKED", preSaleSaleMode: "NONE" } });
  apiCreated.saleLineIds.push(saleLine.id);
  return { purchaseOrder, inventory, saleOrder, saleLine };
}

function afterSaleLineInput(afterSaleCaseId, saleLine, overrides = {}) {
  return {
    ownerId,
    afterSaleCaseId,
    saleLineId: saleLine.id,
    inventoryItemId: saleLine.inventoryItemId,
    requestedRefundAmount: decimal("20.00"),
    approvedRefundAmount: null,
    returnRequired: false,
    productNameSnapshot: saleLine.productNameSnapshot,
    skuSnapshot: saleLine.skuSnapshot,
    inventoryCodeSnapshot: saleLine.inventoryCodeSnapshot,
    saleAmountSnapshot: saleLine.saleAmount.greaterThan(0) ? saleLine.saleAmount : null,
    costAmountSnapshot: saleLine.costAmount,
    profitAmountSnapshot: saleLine.profitAmount,
    ...overrides,
  };
}

async function createCase(saleOrderId, suffix, type) {
  const afterSaleCase = await db.saleAfterSaleCase.create({
    data: {
      ownerId,
      caseNo: `${runId}-${suffix}`,
      saleOrderId,
      type,
      status: "DRAFT",
      reason: "M3-D2 model-only verification",
    },
  });
  created.caseIds.push(afterSaleCase.id);
  return afterSaleCase;
}

async function createAfterSaleLine(data) {
  const line = await db.saleAfterSaleLine.create({ data });
  created.afterSaleLineIds.push(line.id);
  return line;
}

async function createRefundRecord({ data }) {
  const record = await db.saleRefundRecord.create({ data });
  created.refundRecordIds.push(record.id);
  return record;
}

async function createAllocation({ data }) {
  const allocation = await db.saleRefundAllocation.create({ data });
  created.allocationIds.push(allocation.id);
  return allocation;
}

try {
  const fixture = await createSaleFixture();
  const beforeOrder = await db.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
  const beforeLines = await db.saleLine.findMany({
    where: { id: { in: created.saleLineIds } },
    orderBy: { createdAt: "asc" },
  });
  const beforeInventory = await db.inventoryItem.findMany({
    where: { id: { in: created.inventoryIds } },
    orderBy: { inventoryCode: "asc" },
  });

  const invalidApiCreate = await routeJson(
    createSalesAfterSale,
    jsonRequest("http://localhost/api/sales-after-sales", { saleOrderId: fixture.saleOrder.id, type: "INVALID", lines: [] }),
  );
  assert(invalidApiCreate.response.status === 400 && invalidApiCreate.body.code === "INVALID_REQUEST", "sales after-sales API rejects invalid input with stable 400");
  const duplicateApiCreate = await routeJson(
    createSalesAfterSale,
    jsonRequest("http://localhost/api/sales-after-sales", { saleOrderId: fixture.saleOrder.id, type: "REFUND_ONLY", lines: [{ saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "10.00" }, { saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "10.00" }] }),
  );
  assert(duplicateApiCreate.response.status === 400, "create API rejects duplicate sale lines and inventory items");
  const negativeApiCreate = await routeJson(
    createSalesAfterSale,
    jsonRequest("http://localhost/api/sales-after-sales", { saleOrderId: fixture.saleOrder.id, type: "REFUND_ONLY", lines: [{ saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "-1.00" }] }),
  );
  assert(negativeApiCreate.response.status === 400, "create API rejects negative Decimal strings before service execution");
  const forbiddenApiCreate = await routeJson(
    createSalesAfterSale,
    jsonRequest("http://localhost/api/sales-after-sales", { saleOrderId: fixture.saleOrder.id, type: "REFUND_ONLY", ownerId: "other-owner", lines: [{ saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "10.00" }] }),
  );
  assert(forbiddenApiCreate.response.status === 400, "sales after-sales API rejects client-supplied owner and state fields");
  const invalidEligible = await routeJson(eligibleSalesAfterSaleLines, request("http://localhost/api/sales-after-sales/eligible-lines"));
  assert(invalidEligible.response.status === 400, "eligible sales lines requires a saleOrderId");
  const missingEligible = await routeJson(eligibleSalesAfterSaleLines, request("http://localhost/api/sales-after-sales/eligible-lines?saleOrderId=missing"));
  assert(missingEligible.response.status === 404, "eligible sales lines hides missing or cross-owner sale orders with 404");
  const invalidList = await routeJson(listSalesAfterSales, request("http://localhost/api/sales-after-sales?page=0"));
  assert(invalidList.response.status === 400, "list API rejects invalid pagination before querying");
  const eligibleApiLines = await routeJson(eligibleSalesAfterSaleLines, request(`http://localhost/api/sales-after-sales/eligible-lines?saleOrderId=${fixture.saleOrder.id}&page=1&pageSize=20`));
  assert(eligibleApiLines.response.status === 200 && eligibleApiLines.body.items.some((line) => line.saleLineId === fixture.saleLines[0].id) && typeof eligibleApiLines.body.items[0].costAmount === "string", "eligible lines returns settled SOLD owned inventory with JSON-safe amounts");

  const apiDraftForCancel = await routeJson(
    createSalesAfterSale,
    jsonRequest("http://localhost/api/sales-after-sales", { saleOrderId: fixture.saleOrder.id, type: "REFUND_ONLY", lines: [{ saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "10.00" }] }),
  );
  assert(apiDraftForCancel.response.status === 201 && apiDraftForCancel.body.status === "DRAFT", "POST creates a sales after-sales draft with a stable detail DTO");
  created.caseIds.push(apiDraftForCancel.body.id);
  const cancelledDraft = await routeJson(cancelSalesAfterSale, jsonRequest(`http://localhost/api/sales-after-sales/${apiDraftForCancel.body.id}/cancel`, { reason: "API draft cancellation" }), context(apiDraftForCancel.body.id));
  assert(cancelledDraft.response.status === 200 && cancelledDraft.body.status === "CANCELLED", "cancel API cancels only a DRAFT and leaves inventory unchanged");

  const apiDraftForReject = await routeJson(
    createSalesAfterSale,
    jsonRequest("http://localhost/api/sales-after-sales", { saleOrderId: fixture.saleOrder.id, type: "REFUND_ONLY", reason: "API rejection flow", lines: [{ saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "10.00" }] }),
  );
  created.caseIds.push(apiDraftForReject.body.id);
  const apiRejectedSubmitted = await routeJson(submitSalesAfterSale, request(`http://localhost/api/sales-after-sales/${apiDraftForReject.body.id}/submit`, { method: "POST" }), context(apiDraftForReject.body.id));
  assert(apiRejectedSubmitted.response.status === 200 && apiRejectedSubmitted.body.status === "REQUESTED", "submit API delegates state changes to the service");
  const apiRejected = await routeJson(rejectSalesAfterSale, jsonRequest(`http://localhost/api/sales-after-sales/${apiDraftForReject.body.id}/reject`, { note: "API reject note" }), context(apiDraftForReject.body.id));
  assert(apiRejected.response.status === 200 && apiRejected.body.status === "REJECTED" && apiRejected.body.actionLogs.some((log) => log.note === "API reject note"), "reject API accepts a note and writes an action log");

  const apiFixture = await createApiSaleFixture();
  const apiEligible = await routeJson(eligibleSalesAfterSaleLines, request(`http://localhost/api/sales-after-sales/eligible-lines?saleOrderId=${apiFixture.saleOrder.id}`));
  assert(apiEligible.response.status === 200 && apiEligible.body.items[0].saleAmountReliable === true && apiEligible.body.items[0].currentInventory.itemStatus === "SOLD", "eligible-lines exposes reliable line amount and current inventory facts without writes");
  const apiReturnDraft = await routeJson(
    createSalesAfterSale,
    jsonRequest("http://localhost/api/sales-after-sales", { saleOrderId: apiFixture.saleOrder.id, type: "RETURN_AND_REFUND", reason: "API return flow", lines: [{ saleLineId: apiFixture.saleLine.id, inventoryItemId: apiFixture.inventory.id, requestedRefundAmount: "20.00", note: "selected line" }] }),
  );
  assert(apiReturnDraft.response.status === 201 && apiReturnDraft.body.lines[0].saleAmountSnapshot === "150.00", "create API snapshots line sale data without accepting client snapshots");
  apiCreated.caseIds.push(apiReturnDraft.body.id);
  const apiCaseId = apiReturnDraft.body.id;
  let apiLineId = apiReturnDraft.body.lines[0].id;
  const apiUpdated = await routeJson(updateSalesAfterSale, request(`http://localhost/api/sales-after-sales/${apiCaseId}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ note: "draft update only" }) }), context(apiCaseId));
  assert(apiUpdated.response.status === 200 && apiUpdated.body.lines.length === 1 && apiUpdated.body.note === "draft update only", "PATCH preserves draft lines when lines are omitted");
  apiLineId = apiUpdated.body.lines[0].id;
  const apiSubmitted = await routeJson(submitSalesAfterSale, request(`http://localhost/api/sales-after-sales/${apiCaseId}/submit`, { method: "POST" }), context(apiCaseId));
  assert(apiSubmitted.response.status === 200 && apiSubmitted.body.status === "REQUESTED", "submit API transitions DRAFT to REQUESTED");
  const apiBadApproval = await routeJson(approveSalesAfterSale, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/approve`, { lines: [] }), context(apiCaseId));
  assert(apiBadApproval.response.status === 400, "approve API rejects missing per-line approvals with 400");
  const apiApproved = await routeJson(approveSalesAfterSale, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/approve`, { lines: [{ afterSaleLineId: apiLineId, approvedRefundAmount: "20.00" }], note: "approved by API" }), context(apiCaseId));
  assert(apiApproved.response.status === 200 && apiApproved.body.status === "APPROVED" && apiApproved.body.actionLogs.some((log) => log.note === "approved by API"), "approve API validates exact lines and returns refreshed action logs");
  const apiPrepared = await routeJson(prepareSalesAfterSaleReturn, request(`http://localhost/api/sales-after-sales/${apiCaseId}/prepare-return`, { method: "POST" }), context(apiCaseId));
  assert(apiPrepared.response.status === 200 && apiPrepared.body.status === "RETURN_PENDING", "prepare-return API uses the frozen return state machine");
  const apiBadShippedDate = await routeJson(shipSalesAfterSaleReturn, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/return-shipped`, { returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-API-RETURN`, returnShippedAt: "invalid-date" }), context(apiCaseId));
  assert(apiBadShippedDate.response.status === 400, "return-shipped API rejects invalid ISO timestamps");
  const apiShipped = await routeJson(shipSalesAfterSaleReturn, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/return-shipped`, { returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-API-RETURN`, returnShippedAt: "2026-07-15T10:00:00.000Z" }), context(apiCaseId));
  assert(apiShipped.response.status === 200 && apiShipped.body.status === "RETURNING" && apiShipped.body.lines[0].currentInventory.itemStatus === "SOLD", "return-shipped API retains SOLD until refund completion");
  const apiReceived = await routeJson(receiveSalesAfterSaleReturn, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/return-received`, { returnReceivedAt: "2026-07-15T11:00:00.000Z" }), context(apiCaseId));
  assert(apiReceived.response.status === 200 && apiReceived.body.status === "RETURN_RECEIVED", "return-received API supports ISO timestamps");
  const apiBadInspection = await routeJson(inspectSalesAfterSaleReturn, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/inspect`, { inspections: [{ afterSaleLineId: apiLineId, result: "INVALID" }] }), context(apiCaseId));
  assert(apiBadInspection.response.status === 400, "inspect API rejects invalid inspection enums");
  const apiPendingInspection = await routeJson(inspectSalesAfterSaleReturn, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/inspect`, { inspections: [{ afterSaleLineId: apiLineId, result: "PENDING_DECISION" }] }), context(apiCaseId));
  assert(apiPendingInspection.response.status === 200 && apiPendingInspection.body.status === "RETURN_RECEIVED", "pending inspection does not complete buyer return");
  const apiInspected = await routeJson(inspectSalesAfterSaleReturn, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/inspect`, { inspections: [{ afterSaleLineId: apiLineId, result: "RESTOCKED", storageLocation: "API-B-01" }] }), context(apiCaseId));
  assert(apiInspected.response.status === 200 && apiInspected.body.status === "INSPECTED", "inspect API accepts final restock decision");
  const apiRefundPending = await routeJson(markSalesAfterSaleRefundPending, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/refund-pending`, { note: "ready to refund" }), context(apiCaseId));
  assert(apiRefundPending.response.status === 200 && apiRefundPending.body.status === "REFUND_PENDING", "refund-pending API completes after final inspection");
  const refundPayload = { idempotencyKey: `${runId}-API-REFUND`, refundAmount: "20.00", refundedAt: "2026-07-15T12:00:00.000Z", note: "API refund", allocations: [{ afterSaleLineId: apiLineId, amount: "20.00" }] };
  const apiRefund = await routeJson(recordSalesAfterSaleRefund, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/refunds`, refundPayload), context(apiCaseId));
  assert(apiRefund.response.status === 201 && apiRefund.body.updatedCase.totals.actualRefundTotal === "20.00", "refund API creates one refund record and current totals");
  const apiRefundRetry = await routeJson(recordSalesAfterSaleRefund, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/refunds`, refundPayload), context(apiCaseId));
  assert(apiRefundRetry.response.status === 200 && apiRefundRetry.body.refundRecord.id === apiRefund.body.refundRecord.id, "refund API makes exact idempotency retries safe");
  const apiRefundConflict = await routeJson(recordSalesAfterSaleRefund, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/refunds`, { ...refundPayload, refundAmount: "19.00", allocations: [{ afterSaleLineId: apiLineId, amount: "19.00" }] }), context(apiCaseId));
  assert(apiRefundConflict.response.status === 409, "changed idempotency retry returns a 409 conflict");
  const apiCompleted = await routeJson(completeSalesAfterSale, jsonRequest(`http://localhost/api/sales-after-sales/${apiCaseId}/complete`, { note: "API complete" }), context(apiCaseId));
  assert(apiCompleted.response.status === 200 && apiCompleted.body.status === "COMPLETED" && apiCompleted.body.lines[0].currentInventory.itemStatus === "STOCKED", "complete API restores only the inspected return inventory through the service");
  const completedEligible = await routeJson(eligibleSalesAfterSaleLines, request(`http://localhost/api/sales-after-sales/eligible-lines?saleOrderId=${apiFixture.saleOrder.id}`));
  assert(completedEligible.response.status === 200 && !completedEligible.body.items.some((line) => line.inventoryItemId === apiFixture.inventory.id), "completed physical return cannot become eligible for a second return case");
  const apiList = await routeJson(listSalesAfterSales, request(`http://localhost/api/sales-after-sales?saleOrderId=${apiFixture.saleOrder.id}&page=1&pageSize=20`));
  assert(apiList.response.status === 200 && apiList.body.items.some((item) => item.id === apiCaseId) && apiList.body.items[0].availableActions !== undefined, "list API provides owner-scoped pagination and available actions");
  const apiDetail = await routeJson(getSalesAfterSale, request(`http://localhost/api/sales-after-sales/${apiCaseId}`), context(apiCaseId));
  assert(apiDetail.response.status === 200 && apiDetail.body.orderTotals.orderTotalRefundedAmount === "20.00" && apiDetail.body.actionLogs.length > 0, "detail API returns derived order totals and ordered action logs");
  const missingApiDetail = await routeJson(getSalesAfterSale, request("http://localhost/api/sales-after-sales/missing"), context("missing"));
  assert(missingApiDetail.response.status === 404, "missing or cross-owner sales after-sales detail returns 404");

  const refundOnlyCase = await createCase(fixture.saleOrder.id, "REFUND", "REFUND_ONLY");
  const returnCase = await createCase(fixture.saleOrder.id, "RETURN", "RETURN_AND_REFUND");
  assert(refundOnlyCase.status === "DRAFT" && refundOnlyCase.type === "REFUND_ONLY", "a SETTLED sale can create a REFUND_ONLY draft case");
  assert(returnCase.status === "DRAFT" && returnCase.type === "RETURN_AND_REFUND", "a SETTLED sale can create a RETURN_AND_REFUND draft case");

  const refundLineA = await createAfterSaleLine({
    ...afterSaleLineInput(refundOnlyCase.id, fixture.saleLines[0]),
    requestedRefundAmount: decimal("20.00"),
    approvedRefundAmount: decimal("20.00"),
  });
  const refundLineB = await createAfterSaleLine({
    ...afterSaleLineInput(refundOnlyCase.id, fixture.saleLines[1]),
    requestedRefundAmount: decimal("30.00"),
    approvedRefundAmount: decimal("30.00"),
  });
  assert(refundLineA.saleLineId === fixture.saleLines[0].id && refundLineA.inventoryItemId === fixture.inventory[0].id, "after-sale line precisely links the selected SaleLine and InventoryItem");
  assert(refundLineB.saleLineId === fixture.saleLines[1].id && refundLineB.inventoryItemId === fixture.inventory[1].id, "a combined sale can select a second exact SaleLine and InventoryItem");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: fixture.inventory[2].id } })).itemStatus === "SOLD", "unselected inventory remains SOLD");
  assert(decimal(refundLineA.requestedRefundAmount).equals(decimal("20.00")), "requested refund amount is stored as Decimal");
  assert(decimal(refundLineA.saleAmountSnapshot).equals(decimal("150.00")), "reliable line sale amount is captured as a snapshot");
  assert(decimal(refundLineA.costAmountSnapshot).equals(decimal("100.00")) && decimal(refundLineA.profitAmountSnapshot).equals(decimal("40.00")), "cost and persisted profit are captured from the SaleLine snapshot");
  assert(refundLineA.productNameSnapshot === fixture.saleLines[0].productNameSnapshot && refundLineA.skuSnapshot === fixture.saleLines[0].skuSnapshot && refundLineA.inventoryCodeSnapshot === fixture.saleLines[0].inventoryCodeSnapshot, "product, SKU, and inventory-code snapshots are preserved");

  await rejects(
    () => db.saleAfterSaleLine.create({ data: afterSaleLineInput(refundOnlyCase.id, fixture.saleLines[0], { inventoryItemId: fixture.inventory[2].id }) }),
    "duplicate SaleLine in one case",
  );
  await rejects(
    () => db.saleAfterSaleLine.create({ data: afterSaleLineInput(refundOnlyCase.id, fixture.saleLines[2], { inventoryItemId: fixture.inventory[0].id }) }),
    "duplicate InventoryItem in one case",
  );

  const returnLineA = await createAfterSaleLine({
    ...afterSaleLineInput(returnCase.id, fixture.saleLines[0]),
    returnRequired: true,
    requestedRefundAmount: decimal("50.00"),
    approvedRefundAmount: decimal("50.00"),
  });
  assert(returnLineA.saleLineId === refundLineA.saleLineId && returnLineA.inventoryItemId === refundLineA.inventoryItemId, "different historical cases may reference the same SaleLine and InventoryItem");

  const pendingCase = await createCase(fixture.saleOrder.id, "PENDING", "RETURN_AND_REFUND");
  const pendingLine = await createAfterSaleLine({
    ...afterSaleLineInput(pendingCase.id, fixture.saleLines[2]),
    returnRequired: true,
    requestedRefundAmount: decimal("10.00"),
  });

  const invalidCase = await createCase(fixture.saleOrder.id, "INVALID", "REFUND_ONLY");
  await rejects(
    () => db.saleAfterSaleLine.create({ data: afterSaleLineInput(invalidCase.id, fixture.saleLines[2], { requestedRefundAmount: decimal("0.00") }) }),
    "non-positive requested refund amount",
  );
  await rejects(
    () => db.saleAfterSaleLine.create({ data: afterSaleLineInput(invalidCase.id, fixture.saleLines[1], { approvedRefundAmount: decimal("-0.01") }) }),
    "negative approved refund amount",
  );

  const refundRecord = await createRefundRecord({
    data: {
      ownerId,
      afterSaleCaseId: refundOnlyCase.id,
      saleOrderId: fixture.saleOrder.id,
      refundAmount: decimal("50.00"),
      refundedAt: new Date("2026-07-15T10:00:00.000Z"),
      refundMethod: "MANUAL",
      externalRefundNo: `${runId}-REFUND-1`,
      idempotencyKey: `${runId}-IDEMPOTENCY-1`,
      note: "M3-D2 model-only refund record",
    },
  });
  assert(decimal(refundRecord.refundAmount).equals(decimal("50.00")), "actual sale refund record stores a Decimal amount");
  await rejects(
    () => db.saleRefundRecord.create({
      data: {
        ownerId,
        afterSaleCaseId: refundOnlyCase.id,
        saleOrderId: fixture.saleOrder.id,
        refundAmount: decimal("0.00"),
        refundedAt: new Date(),
        idempotencyKey: `${runId}-INVALID-REFUND`,
      },
    }),
    "non-positive actual refund amount",
  );
  await rejects(
    () => db.saleRefundRecord.create({
      data: {
        ownerId,
        afterSaleCaseId: refundOnlyCase.id,
        saleOrderId: fixture.saleOrder.id,
        refundAmount: decimal("1.00"),
        refundedAt: new Date(),
        idempotencyKey: refundRecord.idempotencyKey,
      },
    }),
    "duplicate refund idempotency key",
  );

  const allocationA = await createAllocation({
    data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: refundLineA.id, amount: decimal("20.00") },
  });
  const allocationB = await createAllocation({
    data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: refundLineB.id, amount: decimal("30.00") },
  });
  assert(allocationA.refundRecordId === allocationB.refundRecordId && allocationA.afterSaleLineId !== allocationB.afterSaleLineId, "one refund record can explicitly allocate to multiple after-sale lines");
  assert(decimal(allocationA.amount).plus(allocationB.amount).equals(refundRecord.refundAmount), "explicit allocations can equal the one refund record without duplicated order-level refunds");
  assert(!decimal(allocationA.amount).equals(refundRecord.refundAmount) && !decimal(allocationB.amount).equals(refundRecord.refundAmount), "refund amount is not automatically copied to each allocation");
  await rejects(
    () => db.saleRefundAllocation.create({ data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: refundLineA.id, amount: decimal("1.00") } }),
    "duplicate allocation for one refund record and after-sale line",
  );
  await rejects(
    () => db.saleRefundAllocation.create({ data: { ownerId, refundRecordId: refundRecord.id, afterSaleLineId: pendingLine.id, amount: decimal("0.00") } }),
    "non-positive allocation amount",
  );

  const secondRefundRecord = await createRefundRecord({
    data: {
      ownerId,
      afterSaleCaseId: refundOnlyCase.id,
      saleOrderId: fixture.saleOrder.id,
      refundAmount: decimal("10.00"),
      refundedAt: new Date("2026-07-15T10:05:00.000Z"),
      idempotencyKey: `${runId}-IDEMPOTENCY-2`,
    },
  });
  const secondAllocation = await createAllocation({
    data: { ownerId, refundRecordId: secondRefundRecord.id, afterSaleLineId: refundLineA.id, amount: decimal("10.00") },
  });
  assert(secondAllocation.afterSaleLineId === refundLineA.id, "one after-sale line can receive allocations from multiple refund records");

  const restockedInspection = await db.saleAfterSaleInspection.create({
    data: {
      ownerId,
      afterSaleCaseId: returnCase.id,
      afterSaleLineId: returnLineA.id,
      result: "RESTOCKED",
      storageLocation: "A-01",
      inspectedAt: new Date("2026-07-15T11:00:00.000Z"),
    },
  });
  created.afterSaleInspectionIds.push(restockedInspection.id);
  const problemCase = await createCase(fixture.saleOrder.id, "PROBLEM", "RETURN_AND_REFUND");
  const problemLine = await createAfterSaleLine({ ...afterSaleLineInput(problemCase.id, fixture.saleLines[1]), returnRequired: true });
  const problemInspection = await db.saleAfterSaleInspection.create({
    data: {
      ownerId,
      afterSaleCaseId: problemCase.id,
      afterSaleLineId: problemLine.id,
      result: "PROBLEM",
      problemReason: "M3-D2 verification",
      inspectedAt: new Date("2026-07-15T11:01:00.000Z"),
    },
  });
  created.afterSaleInspectionIds.push(problemInspection.id);
  const pendingInspection = await db.saleAfterSaleInspection.create({
    data: {
      ownerId,
      afterSaleCaseId: pendingCase.id,
      afterSaleLineId: pendingLine.id,
      result: "PENDING_DECISION",
      inspectedAt: new Date("2026-07-15T11:02:00.000Z"),
    },
  });
  created.afterSaleInspectionIds.push(pendingInspection.id);
  assert(restockedInspection.result === "RESTOCKED" && problemInspection.result === "PROBLEM" && pendingInspection.result === "PENDING_DECISION", "all buyer-return inspection decisions can be stored independently");
  await rejects(
    () => db.saleAfterSaleInspection.create({ data: { ownerId, afterSaleCaseId: returnCase.id, afterSaleLineId: returnLineA.id, result: "RESTOCKED", inspectedAt: new Date() } }),
    "duplicate inspection for one after-sale line",
  );

  const firstLog = await db.saleAfterSaleActionLog.create({
    data: { ownerId, afterSaleCaseId: refundOnlyCase.id, action: "MODEL_CREATED", toStatus: "DRAFT", note: "first" },
  });
  const secondLog = await db.saleAfterSaleActionLog.create({
    data: { ownerId, afterSaleCaseId: refundOnlyCase.id, action: "REFUND_MODELLED", fromStatus: "DRAFT", toStatus: "DRAFT", note: "second" },
  });
  created.actionLogIds.push(firstLog.id, secondLog.id);
  const logs = await db.saleAfterSaleActionLog.findMany({ where: { afterSaleCaseId: refundOnlyCase.id }, orderBy: { createdAt: "asc" } });
  assert(logs.length === 2 && logs[0]?.id === firstLog.id && logs[1]?.id === secondLog.id, "action logs can be read in chronological order");

  const afterOrder = await db.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
  const afterLines = await db.saleLine.findMany({ where: { id: { in: created.saleLineIds } }, orderBy: { createdAt: "asc" } });
  const afterInventory = await db.inventoryItem.findMany({ where: { id: { in: created.inventoryIds } }, orderBy: { inventoryCode: "asc" } });
  assert(afterOrder.status === "SETTLED" && afterOrder.actualReceivedAmount?.equals(beforeOrder.actualReceivedAmount ?? decimal(0)) && afterOrder.settledAt?.getTime() === beforeOrder.settledAt?.getTime(), "after-sale model creation preserves SaleOrder status, actual receipt, and settled time");
  assert(afterLines.every((line, index) => line.saleAmount.equals(beforeLines[index].saleAmount) && line.costAmount.equals(beforeLines[index].costAmount) && line.profitAmount.equals(beforeLines[index].profitAmount) && line.skuSnapshot === beforeLines[index].skuSnapshot), "after-sale model creation never overwrites SaleLine sales, cost, profit, or snapshots");
  assert(afterInventory.every((item, index) => item.itemStatus === beforeInventory[index].itemStatus && item.itemStatus === "SOLD"), "after-sale model creation does not change any selected or unselected InventoryItem status");

  await rejects(() => db.saleOrder.delete({ where: { id: fixture.saleOrder.id } }), "deleting a SaleOrder with sale after-sales history");
  await rejects(() => db.saleLine.delete({ where: { id: fixture.saleLines[0].id } }), "deleting a SaleLine with sale after-sales history");
  await rejects(() => db.inventoryItem.delete({ where: { id: fixture.inventory[0].id } }), "deleting an InventoryItem with sale after-sales history");

  const caseGraph = await db.saleAfterSaleCase.findUniqueOrThrow({
    where: { id: refundOnlyCase.id },
    include: { lines: { include: { refundAllocations: true } }, refundRecords: true, actionLogs: true },
  });
  assert(caseGraph.ownerId === ownerId && caseGraph.lines.every((line) => line.ownerId === ownerId) && caseGraph.refundRecords.every((record) => record.ownerId === ownerId) && caseGraph.actionLogs.every((log) => log.ownerId === ownerId), "all sales-after-sales records retain the owning tenant id");
  assert(caseGraph.saleOrderId === fixture.saleOrder.id && caseGraph.lines.every((line) => line.inventoryItemId && line.saleLineId), "new relations retain direct sale-order, sale-line, and inventory references");

  // Exercise the real service lifecycle without changing the model fixture's direct records.
  const serviceRefund = await salesAfterSalesService.createDraft(ownerId, {
    saleOrderId: fixture.saleOrder.id,
    type: "REFUND_ONLY",
    reason: "service refund-only flow",
    lines: [{ saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "15.00" }],
  });
  created.caseIds.push(serviceRefund.id);
  assert(serviceRefund.status === "DRAFT" && serviceRefund.lines.length === 1, "service creates a refund-only draft with selected lines");
  const serviceBefore = await db.$transaction(async (tx) => ({
    sale: await tx.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } }),
    inventory: await tx.inventoryItem.findMany({ where: { id: { in: created.inventoryIds } }, orderBy: { inventoryCode: "asc" } }),
  }));
  assert(serviceBefore.sale.status === "SETTLED" && serviceBefore.inventory.every((item) => item.itemStatus === "SOLD"), "creating a service draft does not change sale or inventory state");
  await salesAfterSalesService.submit(ownerId, serviceRefund.id);
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: fixture.inventory[0].id } })).itemStatus === "SOLD", "submitting a refund-only case does not change inventory status");
  await salesAfterSalesService.approve(ownerId, serviceRefund.id, [{ afterSaleLineId: serviceRefund.lines[0].id, approvedRefundAmount: "15.00" }]);
  await salesAfterSalesService.markRefundPending(ownerId, serviceRefund.id);
  const firstServiceRefund = await salesAfterSalesService.recordRefund(ownerId, serviceRefund.id, {
    idempotencyKey: `${runId}-SERVICE-REFUND-1`, refundAmount: "10.00", allocations: [{ afterSaleLineId: serviceRefund.lines[0].id, amount: "10.00" }],
  });
  created.refundRecordIds.push(firstServiceRefund.id);
  assert((await db.saleAfterSaleCase.findUniqueOrThrow({ where: { id: serviceRefund.id } })).status === "PARTIALLY_REFUNDED", "partial service refund keeps the case partially refunded");
  const retryServiceRefund = await salesAfterSalesService.recordRefund(ownerId, serviceRefund.id, {
    idempotencyKey: `${runId}-SERVICE-REFUND-1`, refundAmount: "10.00", allocations: [{ afterSaleLineId: serviceRefund.lines[0].id, amount: "10.00" }],
  });
  assert(retryServiceRefund.id === firstServiceRefund.id, "repeating the same refund idempotency key returns the original record");
  await rejects(() => salesAfterSalesService.recordRefund(ownerId, serviceRefund.id, {
    idempotencyKey: `${runId}-SERVICE-REFUND-1`, refundAmount: "9.00", allocations: [{ afterSaleLineId: serviceRefund.lines[0].id, amount: "9.00" }],
  }), "a changed refund request with the same idempotency key");
  const secondServiceRefund = await salesAfterSalesService.recordRefund(ownerId, serviceRefund.id, {
    idempotencyKey: `${runId}-SERVICE-REFUND-2`, refundAmount: "5.00", allocations: [{ afterSaleLineId: serviceRefund.lines[0].id, amount: "5.00" }],
  });
  created.refundRecordIds.push(secondServiceRefund.id);
  await salesAfterSalesService.complete(ownerId, serviceRefund.id);
  assert((await db.saleAfterSaleCase.findUniqueOrThrow({ where: { id: serviceRefund.id } })).status === "COMPLETED", "a fully refunded refund-only case can complete");
  assert((await db.inventoryItem.findUniqueOrThrow({ where: { id: fixture.inventory[0].id } })).itemStatus === "SOLD", "refund-only completion does not restore inventory");

  const serviceReturn = await salesAfterSalesService.createDraft(ownerId, {
    saleOrderId: fixture.saleOrder.id,
    type: "RETURN_AND_REFUND",
    reason: "service buyer return flow",
    lines: [
      { saleLineId: fixture.saleLines[1].id, inventoryItemId: fixture.inventory[1].id, requestedRefundAmount: "30.00" },
      { saleLineId: fixture.saleLines[2].id, inventoryItemId: fixture.inventory[2].id, requestedRefundAmount: "30.00" },
    ],
  });
  created.caseIds.push(serviceReturn.id);
  await salesAfterSalesService.submit(ownerId, serviceReturn.id);
  await salesAfterSalesService.approve(ownerId, serviceReturn.id, serviceReturn.lines.map((line) => ({ afterSaleLineId: line.id, approvedRefundAmount: "30.00" })));
  await rejects(() => salesService.settle(ownerId, fixture.saleOrder.id, { actualReceivedAmount: "134.00" }), "settlement below completed refunds plus locked approved sales after-sales");
  assert((await db.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } })).actualReceivedAmount?.equals(decimal("420.00")), "a rejected lower settlement leaves the original receipt unchanged");
  await salesAfterSalesService.prepareReturn(ownerId, serviceReturn.id);
  await salesAfterSalesService.markReturnShipped(ownerId, serviceReturn.id, { returnCarrierCode: "MOCK", returnTrackingNo: `${runId}-RETURN` });
  assert((await db.inventoryItem.findMany({ where: { id: { in: [fixture.inventory[1].id, fixture.inventory[2].id] } } })).every((item) => item.itemStatus === "SOLD"), "buyer-return shipping keeps every selected inventory item SOLD");
  await salesAfterSalesService.markReturnReceived(ownerId, serviceReturn.id);
  assert((await db.inventoryItem.findMany({ where: { id: { in: [fixture.inventory[1].id, fixture.inventory[2].id] } } })).every((item) => item.itemStatus === "SOLD"), "receiving a buyer return keeps every selected inventory item SOLD before inspection");
  await salesAfterSalesService.inspectReturn(ownerId, serviceReturn.id, serviceReturn.lines.map((line) => ({ afterSaleLineId: line.id, result: "PENDING_DECISION" })));
  assert((await db.saleAfterSaleCase.findUniqueOrThrow({ where: { id: serviceReturn.id } })).status === "RETURN_RECEIVED", "pending buyer-return inspection keeps the case waiting for a decision");
  await salesAfterSalesService.inspectReturn(ownerId, serviceReturn.id, [
    { afterSaleLineId: serviceReturn.lines[0].id, result: "RESTOCKED", storageLocation: "B-01" },
    { afterSaleLineId: serviceReturn.lines[1].id, result: "PROBLEM", problemReason: "return damage" },
  ]);
  await salesAfterSalesService.markRefundPending(ownerId, serviceReturn.id);
  const returnRefund = await salesAfterSalesService.recordRefund(ownerId, serviceReturn.id, {
    idempotencyKey: `${runId}-SERVICE-RETURN-REFUND`, refundAmount: "60.00",
    allocations: serviceReturn.lines.map((line) => ({ afterSaleLineId: line.id, amount: "30.00" })),
  });
  created.refundRecordIds.push(returnRefund.id);
  assert(returnRefund.refundAmount.equals(decimal("60.00")) && (await db.saleRefundAllocation.count({ where: { refundRecordId: returnRefund.id } })) === 2, "combined return refund keeps one order refund total with explicit per-line allocations");
  await salesAfterSalesService.complete(ownerId, serviceReturn.id);
  const restored = await db.inventoryItem.findMany({ where: { id: { in: created.inventoryIds } }, orderBy: { inventoryCode: "asc" } });
  assert(restored[0]?.itemStatus === "SOLD" && restored[1]?.itemStatus === "STOCKED" && restored[2]?.itemStatus === "PROBLEM", "return completion restores only selected inventory according to inspection result");
  assert(restored.every((item) => item.ownershipStatus === "OWNED"), "sales after-sales completion preserves inventory ownership");
  const finalSale = await db.saleOrder.findUniqueOrThrow({ where: { id: fixture.saleOrder.id } });
  assert(finalSale.status === "SETTLED" && finalSale.actualReceivedAmount?.equals(decimal("420.00")), "sales after-sales never changes the original SaleOrder status or receipt");
  const finalLines = await db.saleLine.findMany({ where: { id: { in: created.saleLineIds } }, orderBy: { createdAt: "asc" } });
  assert(finalLines.every((line, index) => line.saleAmount.equals(beforeLines[index].saleAmount) && line.profitAmount.equals(beforeLines[index].profitAmount) && line.skuSnapshot === beforeLines[index].skuSnapshot), "sales after-sales never overwrites SaleLine snapshots or persisted profit");
  assert((await db.inventoryActionLog.count({ where: { inventoryItemId: { in: [fixture.inventory[1].id, fixture.inventory[2].id] }, actionType: { in: ["SALES_AFTER_SALE_RESTOCKED", "SALES_AFTER_SALE_PROBLEM"] } } })) === 2, "return completion writes one inventory action log per restored item");

  const financials = await getSalesAfterSaleFinancials(ownerId, [fixture.saleOrder.id]);
  const orderFinancials = financials.orders.get(fixture.saleOrder.id);
  assert(orderFinancials, "shared after-sales financial aggregation returns the sale order");
  const refundRecordTotal = (await db.saleRefundRecord.findMany({ where: { saleOrderId: fixture.saleOrder.id }, select: { refundAmount: true } })).reduce((total, record) => total.plus(record.refundAmount), decimal("0"));
  assert(orderFinancials.totalSalesRefundedAmount.equals(refundRecordTotal) && orderFinancials.netReceivedAmount.equals(decimal("420.00").minus(refundRecordTotal)), "order financials count each refund record once and derive net receipt from the original receipt");
  const allocationTotal = [...financials.lines.values()].reduce((total, line) => total.plus(line.refundedAmount), decimal("0"));
  assert(allocationTotal.equals(refundRecordTotal), "line financials use explicit refund allocations without duplicating the order refund");
  const restockedFinancial = financials.lines.get(fixture.saleLines[1].id);
  const problemFinancial = financials.lines.get(fixture.saleLines[2].id);
  assert(restockedFinancial?.restockedCostReversal.equals(decimal("100.00")) && problemFinancial?.restockedCostReversal.equals(decimal("0.00")), "only completed RESTOCKED returns reverse the frozen line cost");
  const lineAfterSaleProfit = [...financials.lines.values()].reduce((total, line) => total.plus(line.afterSaleNetProfit), decimal("0"));
  assert(orderFinancials.afterSaleNetProfit.equals(lineAfterSaleProfit), "order after-sales net profit equals the deduplicated line financial total");

  for (const invalidStatus of ["DRAFT", "CANCELLED"]) {
    await db.saleOrder.update({ where: { id: fixture.saleOrder.id }, data: { status: invalidStatus } });
    await rejects(() => salesAfterSalesService.createDraft(ownerId, { saleOrderId: fixture.saleOrder.id, type: "REFUND_ONLY", lines: [{ saleLineId: fixture.saleLines[0].id, inventoryItemId: fixture.inventory[0].id, requestedRefundAmount: "1.00" }] }), `${invalidStatus} sale cannot create a sales after-sale`);
    await db.saleOrder.update({ where: { id: fixture.saleOrder.id }, data: { status: "SETTLED" } });
  }

  const schema = await fs.readFile(path.join(process.cwd(), "prisma/schema.prisma"), "utf8");
  const modelMigration = await fs.readFile(path.join(process.cwd(), "prisma/migrations/20260715084432_add_m3d_sales_after_sales_models/migration.sql"), "utf8");
  const checkMigration = await fs.readFile(path.join(process.cwd(), "prisma/migrations/20260715084500_add_m3d_sales_after_sales_checks/migration.sql"), "utf8");
  assert(schema.includes("enum SaleAfterSaleType") && schema.includes("REFUND_ONLY") && schema.includes("RETURN_AND_REFUND"), "schema exposes the frozen sale-after-sales type names without redundant prefixes");
  assert(schema.includes("enum SaleAfterSaleStatus") && schema.includes("enum SaleAfterSaleInspectionResult"), "schema defines independent sales-after-sales status and buyer-return inspection enums");
  assert(!schema.includes("SaleOrderStatus\n  REFUNDED"), "SaleOrderStatus is not extended with a refund status");
  assert(!modelMigration.includes("DROP TABLE") && !modelMigration.includes("DROP COLUMN") && !/^UPDATE\s/m.test(modelMigration) && !/^DELETE\s/m.test(modelMigration), "model migration is purely additive and writes no existing business data");
  assert(!modelMigration.includes('ALTER TABLE "inventory_items"') && !modelMigration.includes('ALTER TABLE "sale_orders"'), "model migration does not alter InventoryItem or SaleOrder fields");
  assert(checkMigration.includes('"requestedRefundAmount" > 0') && checkMigration.includes('"approvedRefundAmount" IS NULL OR "approvedRefundAmount" >= 0') && checkMigration.includes('"refundAmount" > 0') && checkMigration.includes('"amount" > 0'), "database CHECK constraints protect all new monetary fields");
  assert(await fs.access(path.join(process.cwd(), "src/server/sales-after-sales/sales-after-sales-service.ts")).then(() => true).catch(() => false), "SalesAfterSalesService is implemented");
  assert(await fs.access(path.join(process.cwd(), "src/server/sales-after-sales/sales-after-sales-rules.ts")).then(() => true).catch(() => false), "sales after-sales transition and Decimal rules are implemented");
  await pathDoesNotExist("src/app/api/sales/after-sales");
  await pathDoesNotExist("src/app/sales/after-sales");
  const salesAfterSalesUi = await fs.readFile(path.join(process.cwd(), "src/components/sales-after-sales/sales-after-sales-ui.tsx"), "utf8");
  const salesAfterSalesTrace = await fs.readFile(path.join(process.cwd(), "src/components/sales-after-sales/sales-after-sales-trace.tsx"), "utf8");
  const saleDetailPage = await fs.readFile(path.join(process.cwd(), "src/components/sales/sale-detail.tsx"), "utf8");
  const inventoryDetailPage = await fs.readFile(path.join(process.cwd(), "src/components/inventory/inventory-detail.tsx"), "utf8");
  const appShell = await fs.readFile(path.join(process.cwd(), "src/components/layout/app-shell.tsx"), "utf8");
  const financialsSource = await fs.readFile(path.join(process.cwd(), "src/server/reports/sales-after-sales-financials.ts"), "utf8");
  const reportCharts = await fs.readFile(path.join(process.cwd(), "src/components/reports/sales-after-sales-charts.tsx"), "utf8");
  assert(!financialsSource.includes(".update(") && !financialsSource.includes(".create(") && !financialsSource.includes(".delete("), "shared after-sales financial aggregation is read-only");
  assert(!financialsSource.includes('itemStatus: "SOLD"'), "shared after-sales financial aggregation has no SOLD write path");
  assert(reportCharts.includes("SalesAfterSalesCharts") && reportCharts.includes("LineChart") && reportCharts.includes("BarChart"), "sales overview includes read-only after-sales charts");
  assert(!reportCharts.includes("method: \"POST\"") && !reportCharts.includes("method: \"PATCH\"") && !reportCharts.includes("method: \"DELETE\""), "charts do not expose a write path");
  for (const route of ["src/app/sales-after-sales/page.tsx", "src/app/sales-after-sales/new/page.tsx", "src/app/sales-after-sales/[id]/page.tsx"]) {
    assert(await fs.access(path.join(process.cwd(), route)).then(() => true).catch(() => false), `sales after-sales page route exists: ${route}`);
  }
  const pageContracts = [
    [salesAfterSalesUi, "SalesAfterSalesList", "list page uses the dedicated list component"],
    [salesAfterSalesUi, "/api/sales-after-sales?", "list reads the sales after-sales list API"],
    [salesAfterSalesUi, "saleOrderId", "list preserves sale order filter in its URL"],
    [salesAfterSalesUi, "原实际到账", "list distinguishes original actual receipt"],
    [salesAfterSalesUi, "订单净到账", "list displays API net receipt"],
    [salesAfterSalesUi, "eligible-lines", "new form reads eligible sale lines"],
    [salesAfterSalesUi, "requestedRefundAmount", "new form sends explicit requested amount only"],
    [salesAfterSalesUi, "该商品缺少可靠的行级成交金额", "new form warns about unreliable sale amounts"],
    [salesAfterSalesUi, "SalesAfterSaleForm", "draft editing reuses the sales after-sales form"],
    [salesAfterSalesUi, "申请退款合计", "detail displays case totals"],
    [salesAfterSalesUi, "orderTotals", "detail displays server-derived order financial totals"],
    [salesAfterSalesUi, "原始销售事实", "detail separates original sales facts"],
    [salesAfterSalesUi, "历史快照", "detail separates historical line snapshots"],
    [salesAfterSalesUi, "当前库存", "detail displays current inventory facts"],
    [salesAfterSalesUi, "退款流水", "detail displays refund records"],
    [salesAfterSalesUi, "归属", "refund allocations remain line ownership details"],
    [salesAfterSalesUi, "退货验货", "detail displays return inspection"],
    [salesAfterSalesUi, "操作日志", "detail displays action logs"],
    [salesAfterSalesUi, "availableActions", "available actions drive UI buttons"],
    [salesAfterSalesUi, "approvedRefundAmount", "approval submits per-line amounts"],
    [salesAfterSalesUi, "按申请金额填入", "approval fill is explicit user action"],
    [salesAfterSalesUi, "returnCarrierCode", "return shipping submits logistics through API"],
    [salesAfterSalesUi, "returnReceivedAt", "return received submits server timestamp input"],
    [salesAfterSalesUi, "PENDING_DECISION", "inspection supports pending decision"],
    [salesAfterSalesUi, "idempotencyKey", "refund dialog maintains idempotency key"],
    [salesAfterSalesUi, "allocations", "refund allocations are explicit line inputs"],
    [salesAfterSalesUi, "sumMoney", "refund allocation preview uses decimal-string cent calculation"],
    [salesAfterSalesUi, "完成后商品仍保持已售出", "refund-only completion makes no-restock boundary explicit"],
    [salesAfterSalesUi, "按验货结果批量更新库存", "return completion explains server transaction boundary"],
    [salesAfterSalesTrace, "SalesAfterSaleOrderSummary", "sale detail has an after-sales summary component"],
    [salesAfterSalesTrace, "InventorySalesAfterSaleTrace", "inventory detail has an after-sales trace component"],
    [saleDetailPage, "SalesAfterSaleOrderSummary", "sale detail renders sales after-sales summary"],
    [inventoryDetailPage, "InventorySalesAfterSaleTrace", "inventory detail renders sales after-sales trace"],
    [appShell, "销售售后", "navigation exposes sales after-sales separately"],
    [salesAfterSalesUi, "/api/sales-after-sales/${id}", "page actions call only the existing after-sales API"],
    [salesAfterSalesUi, "itemStatus", "page shows current inventory facts without writes"],
    [salesAfterSalesUi, "actualReceivedAmount", "page reads original receipt in DTO only"],
  ];
  for (const [source, token, message] of pageContracts) assert(typeof source === "string" && typeof token === "string" && source.includes(token), message);
  assert(!salesAfterSalesUi.includes("@/server/db") && !salesAfterSalesUi.includes("@/generated/prisma"), "sales after-sales UI has no Prisma or direct database import");
  assert(!salesAfterSalesUi.includes("setItemStatus") && !salesAfterSalesUi.includes("setOwnershipStatus") && !salesAfterSalesUi.includes("InventoryItem.update"), "sales after-sales UI has no direct inventory status or ownership write path");
  assert(!salesAfterSalesUi.includes("actualReceivedAmount: values") && !salesAfterSalesUi.includes("profitAmountSnapshot: values"), "sales after-sales UI does not submit original receipt or line profit snapshots");
  assert(!salesAfterSalesUi.includes("SalesService.confirm") && !salesAfterSalesUi.includes("itemStatus = \"SOLD\""), "sales after-sales UI has no new SOLD write path");

  console.log(`verify:m3d-sales passed ${checks} checks`);
} finally {
  try {
    if (apiCreated.caseIds.length) await db.saleAfterSaleActionLog.deleteMany({ where: { afterSaleCaseId: { in: apiCreated.caseIds } } });
    if (apiCreated.caseIds.length) await db.saleAfterSaleInspection.deleteMany({ where: { afterSaleCaseId: { in: apiCreated.caseIds } } });
    if (apiCreated.caseIds.length) await db.saleRefundAllocation.deleteMany({ where: { refundRecord: { afterSaleCaseId: { in: apiCreated.caseIds } } } });
    if (apiCreated.caseIds.length) await db.saleRefundRecord.deleteMany({ where: { afterSaleCaseId: { in: apiCreated.caseIds } } });
    if (apiCreated.caseIds.length) await db.saleAfterSaleLine.deleteMany({ where: { afterSaleCaseId: { in: apiCreated.caseIds } } });
    if (apiCreated.caseIds.length) await db.saleAfterSaleCase.deleteMany({ where: { id: { in: apiCreated.caseIds } } });
    if (apiCreated.saleLineIds.length) await db.saleLine.deleteMany({ where: { id: { in: apiCreated.saleLineIds } } });
    if (apiCreated.saleOrderId) await db.saleOrder.delete({ where: { id: apiCreated.saleOrderId } });
    if (apiCreated.inventoryIds.length) await db.inventoryItem.deleteMany({ where: { id: { in: apiCreated.inventoryIds } } });
    if (apiCreated.inspectionIds.length) await db.inspection.deleteMany({ where: { id: { in: apiCreated.inspectionIds } } });
    if (apiCreated.purchaseOrderId) await db.purchaseOrder.delete({ where: { id: apiCreated.purchaseOrderId } });
    if (created.caseIds.length) await db.saleAfterSaleActionLog.deleteMany({ where: { afterSaleCaseId: { in: created.caseIds } } });
    if (created.caseIds.length) await db.saleAfterSaleInspection.deleteMany({ where: { afterSaleCaseId: { in: created.caseIds } } });
    if (created.caseIds.length) await db.saleRefundAllocation.deleteMany({ where: { refundRecord: { afterSaleCaseId: { in: created.caseIds } } } });
    if (created.caseIds.length) await db.saleRefundRecord.deleteMany({ where: { afterSaleCaseId: { in: created.caseIds } } });
    if (created.caseIds.length) await db.saleAfterSaleLine.deleteMany({ where: { afterSaleCaseId: { in: created.caseIds } } });
    if (created.caseIds.length) await db.saleAfterSaleCase.deleteMany({ where: { id: { in: created.caseIds } } });
    if (created.saleLineIds.length) await db.saleLine.deleteMany({ where: { id: { in: created.saleLineIds } } });
    if (created.saleOrderId) await db.saleOrder.delete({ where: { id: created.saleOrderId } });
    if (created.inventoryIds.length) await db.inventoryItem.deleteMany({ where: { id: { in: created.inventoryIds } } });
    if (created.inspectionIds.length) await db.inspection.deleteMany({ where: { id: { in: created.inspectionIds } } });
    if (created.purchaseOrderId) await db.purchaseOrder.delete({ where: { id: created.purchaseOrderId } });
    if (created.purchaseOrderId) {
      const remaining = await db.purchaseOrder.count({ where: { id: created.purchaseOrderId } });
      if (remaining !== 0) throw new Error("verify:m3d-sales cleanup left verification data behind");
    }
  } catch (error) {
    console.error("verify:m3d-sales cleanup failed", error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
