import "dotenv/config";
import { db } from "../src/server/db.ts";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const orderNo = `M2B-E2E-${Date.now()}`;
let orderId;
const accessCookie = process.env.APP_PASSWORD ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}` : null;

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function call(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...(options.headers ?? {}), ...(accessCookie ? { Cookie: accessCookie } : {}) } });
  const body = response.status === 204 ? null : await response.json().catch(() => null);
  return { response, body };
}

async function request(path, options = {}) {
  const result = await call(path, options);
  if (!result.response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${result.response.status}): ${JSON.stringify(result.body)}`,
    );
  }
  return result.body;
}

try {
  const created = await request("/api/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNo,
      paidAt: new Date().toISOString(),
      totalAmount: "100.00",
      shippingAmount: "0.00",
      notes: "M2-B verification",
      items: [
        {
          name: "M2-B 单件成本测试商品",
          skuText: "M2B-SKU",
          quantity: 3,
          notes: "",
        },
      ],
    }),
  });
  orderId = created.id;

  await request(`/api/purchase-orders/${orderId}/tracking`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      carrierCode: "MOCK",
      trackingNo: `M2B-DELIVERED-${Date.now()}1`,
      shippedAt: new Date().toISOString(),
    }),
  });
  await request(`/api/purchase-orders/${orderId}/refresh-logistics`, {
    method: "POST",
  });

  let inspections = await request(
    `/api/inspections?query=${encodeURIComponent(orderNo)}`,
  );
  assert(inspections.data.length === 3, "delivery did not create three inspections");

  await db.inspection.deleteMany({
    where: { purchaseOrderItem: { purchaseOrderId: orderId } },
  });
  inspections = await request(`/api/inspections?query=${encodeURIComponent(orderNo)}`);
  assert(
    inspections.data.length === 0 && inspections.missingCount === 3,
    "GET inspections wrote data or did not report missing history",
  );

  const ensureOptions = {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderId }),
  };
  await Promise.all([
    request("/api/inspections/ensure-pending", ensureOptions),
    request("/api/inspections/ensure-pending", ensureOptions),
  ]);
  inspections = await request(`/api/inspections?query=${encodeURIComponent(orderNo)}`);
  assert(inspections.data.length === 3, "idempotent ensure duplicated inspections");

  const blocked = await call(`/api/inspections/${inspections.data[0].id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result: "PASS" }),
  });
  assert(
    blocked.response.status === 409 &&
      blocked.body?.code === "ALLOCATION_NOT_CONFIRMED",
    "unconfirmed allocation did not block completion",
  );

  await request(`/api/purchase-orders/${orderId}/allocation`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      action: "confirm",
      allocations: [
        {
          itemId: created.items[0].id,
          allocatedTotalCost: "100.00",
        },
      ],
    }),
  });

  const sorted = [...inspections.data].sort((a, b) => a.sequence - b.sequence);
  const completed = [];
  for (const [index, inspection] of sorted.entries()) {
    completed.push(
      await request(`/api/inspections/${inspection.id}/complete`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          result: index === 1 ? "PROBLEM" : "PASS",
          expiryDate:
            index === 0
              ? new Date(Date.now() + 380 * 86_400_000).toISOString()
              : null,
          notes: index === 1 ? "M2-B verification problem" : "",
        }),
      }),
    );
  }

  assert(
    completed.map((item) => item.inventory.unitCost).join(",") ===
      "33.33,33.33,33.34",
    "unit costs were not split by sequence",
  );
  assert(
    completed[1].inventory.itemStatus === "PROBLEM",
    "problem inspection did not create problem inventory",
  );

  const duplicate = await call(`/api/inspections/${sorted[0].id}/complete`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result: "PASS" }),
  });
  assert(duplicate.response.status === 409, "duplicate completion was not rejected");

  const order = await request(`/api/purchase-orders/${orderId}`);
  assert(
    order.status === "PARTIALLY_STOCKED",
    "order with a problem item did not become partially stocked",
  );

  const inventory = await request(`/api/inventory?query=${encodeURIComponent("M2-B 单件成本")}`);
  assert(inventory.total === 3, "inventory list does not contain three single items");

  const stocked = completed.find((item) => item.inventory.itemStatus === "STOCKED");
  await db.inventoryItem.update({
    where: { id: stocked.inventory.id },
    data: { stockedAt: new Date(Date.now() - 73 * 60 * 60 * 1000) },
  });
  const todos = await request("/api/todos");
  assert(
    todos.data.some(
      (todo) => todo.inventoryId === stocked.inventory.id && todo.type === "EXPIRY_UNDER_395",
    ),
    "expiry reminder was not created",
  );
  assert(
    todos.data.some(
      (todo) => todo.inventoryId === stocked.inventory.id && todo.type === "OVERSTOCKED",
    ),
    "overstock reminder was not created",
  );
  assert(
    !todos.data.some(
      (todo) =>
        todo.inventoryId === completed[1].inventory.id &&
        ["EXPIRY_UNDER_395", "EXPIRY_UNDER_365", "OVERSTOCKED"].includes(todo.type),
    ),
    "problem inventory produced a stock reminder",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        orderId,
        checks: [
          "delivery creates inspections",
          "read-only GET and concurrent idempotent ensure",
          "allocation guard",
          "sequence cost split",
          "pass and problem inventory",
          "duplicate completion guard",
          "order final status",
          "inventory list",
          "expiry and overstock reminders",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (orderId) await db.purchaseOrder.deleteMany({ where: { id: orderId } });
  await db.$disconnect();
}
