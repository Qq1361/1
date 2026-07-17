import "dotenv/config";
import { ACCESS_COOKIE_NAME, createAccessToken } from "../src/lib/access-protection.ts";

const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const orderNo = `M2A-E2E-${Date.now()}`;
let orderId;
const accessCookie = process.env.APP_PASSWORD ? `${ACCESS_COOKIE_NAME}=${await createAccessToken(process.env.APP_PASSWORD)}` : null;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, { ...options, headers: { ...(options.headers ?? {}), ...(accessCookie ? { Cookie: accessCookie } : {}) } });
  const body =
    response.status === 204 ? null : await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(
      `${options.method ?? "GET"} ${path} failed (${response.status}): ${JSON.stringify(body)}`,
    );
  }
  return body;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function saveTracking(trackingNo) {
  return request(`/api/purchase-orders/${orderId}/tracking`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      carrierCode: "MOCK",
      trackingNo,
      shippedAt: new Date().toISOString(),
    }),
  });
}

try {
  const paidAt = new Date(Date.now() - 72 * 60 * 60 * 1000);
  const created = await request("/api/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNo,
      paidAt: paidAt.toISOString(),
      totalAmount: "80.00",
      shippingAmount: "5.00",
      notes: "M2-A verification",
      items: [{ name: "物流测试商品", skuText: "", quantity: 1, notes: "" }],
    }),
  });
  orderId = created.id;

  let todos = await request("/api/todos");
  assert(
    todos.data.some(
      (todo) =>
        todo.orderId === orderId && todo.type === "MISSING_TRACKING",
    ),
    "missing tracking todo was not created",
  );

  const tracking = await saveTracking("MOCK-TRANSIT-0");
  assert(tracking.order.status === "IN_TRANSIT", "tracking did not start transit");
  todos = await request("/api/todos");
  assert(
    !todos.data.some(
      (todo) =>
        todo.orderId === orderId && todo.type === "MISSING_TRACKING",
    ),
    "missing tracking todo remained after tracking was saved",
  );

  const transit = await request(
    `/api/purchase-orders/${orderId}/refresh-logistics`,
    { method: "POST" },
  );
  assert(
    transit.order.logisticsStatus === "IN_TRANSIT",
    "transit refresh failed",
  );

  await saveTracking("MOCK-EXCEPTION-2");
  const exception = await request(
    `/api/purchase-orders/${orderId}/refresh-logistics`,
    { method: "POST" },
  );
  assert(
    exception.order.status === "IN_TRANSIT" &&
      exception.order.logisticsStatus === "EXCEPTION",
    "exception state is incorrect",
  );
  todos = await request("/api/todos");
  assert(
    todos.data.some(
      (todo) =>
        todo.orderId === orderId && todo.type === "LOGISTICS_EXCEPTION",
    ),
    "exception todo was not created",
  );

  await saveTracking("MOCK-DELIVERED-1");
  const delivered = await request(
    `/api/purchase-orders/${orderId}/refresh-logistics`,
    { method: "POST" },
  );
  assert(
    delivered.order.status === "PENDING_INSPECTION",
    "delivered order did not move to pending inspection",
  );
  assert(
    delivered.events.every(
      (event) =>
        event.carrierCode === "MOCK" &&
        event.trackingNo === "MOCK-DELIVERED-1",
    ),
    "historical tracking events leaked into current tracking display",
  );
  todos = await request("/api/todos");
  const pendingTodo = todos.data.find(
    (todo) =>
      todo.orderId === orderId && todo.type === "PENDING_INSPECTION",
  );
  assert(pendingTodo, "pending inspection todo was not created");

  const detail = await request(`/api/purchase-orders/${orderId}`);
  assert(
    detail.logisticsEvents.length === 1 &&
      detail.logisticsEvents[0].trackingNo === "MOCK-DELIVERED-1",
    "order detail mixed historical tracking events",
  );

  const replaced = await saveTracking("MOCK-NEW-0");
  assert(
    replaced.order.status === "IN_TRANSIT" &&
      replaced.order.deliveredAt === null,
    "new tracking number did not reset transit state",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        orderId,
        todoLink: `/purchases/${orderId}`,
        checks: [
          "missing tracking todo",
          "save tracking",
          "in transit refresh",
          "exception todo",
          "delivered to pending inspection",
          "current tracking event isolation",
          "new tracking resets transit",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (orderId) {
    await db.purchaseOrder.deleteMany({ where: { id: orderId } });
  }
  await db.$disconnect();
}
import "dotenv/config";
import { db } from "../src/server/db.ts";
