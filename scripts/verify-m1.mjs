const baseUrl = process.env.APP_BASE_URL ?? "http://127.0.0.1:3000";
const orderNo = `M1-E2E-${Date.now()}`;
let orderId;

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, options);
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

async function upload(entityType, entityId, name) {
  const png = new File(
    [new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10])],
    name,
    { type: "image/png" },
  );
  const form = new FormData();
  form.set("entityType", entityType);
  form.set("entityId", entityId);
  form.set("file", png);
  return request("/api/attachments", { method: "POST", body: form });
}

try {
  const created = await request("/api/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNo,
      paidAt: new Date().toISOString(),
      totalAmount: "100.10",
      shippingAmount: "5.20",
      notes: "M1 integration verification",
      items: [
        { name: "测试商品 A", skuText: "A-01", quantity: 2, notes: "" },
        { name: "测试商品 B", skuText: "B-01", quantity: 1, notes: "" },
      ],
    }),
  });
  orderId = created.id;
  assert(created.items.length === 2, "one order with multiple items failed");

  const edited = await request(`/api/purchase-orders/${orderId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      orderNo,
      paidAt: created.paidAt,
      totalAmount: "100.10",
      shippingAmount: "5.20",
      notes: "edited by M1 integration verification",
      items: created.items.map((item, index) => ({
        id: item.id,
        name: index === 0 ? "测试商品 A（已编辑）" : item.name,
        skuText: item.skuText ?? "",
        quantity: item.quantity,
        notes: item.notes ?? "",
      })),
    }),
  });
  assert(edited.items[0].name.includes("已编辑"), "order edit failed");

  const orderAttachment = await upload(
    "PURCHASE_ORDER",
    orderId,
    "order-proof.png",
  );
  const itemAttachment = await upload(
    "PURCHASE_ORDER_ITEM",
    edited.items[0].id,
    "item-proof.png",
  );

  const orderAttachments = await request(
    `/api/attachments?entityType=PURCHASE_ORDER&entityId=${orderId}`,
  );
  const itemAttachments = await request(
    `/api/attachments?entityType=PURCHASE_ORDER_ITEM&entityId=${edited.items[0].id}`,
  );
  assert(orderAttachments.length === 1, "order attachment list failed");
  assert(itemAttachments.length === 1, "item attachment list failed");

  for (const attachment of [orderAttachment, itemAttachment]) {
    const content = await fetch(
      `${baseUrl}/api/attachments/${attachment.id}/content`,
    );
    assert(content.ok, "attachment content read failed");
    assert((await content.arrayBuffer()).byteLength === 8, "attachment bytes differ");
  }

  const draft = await request(
    `/api/purchase-orders/${orderId}/allocation`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "save",
        allocations: [
          { itemId: edited.items[0].id, allocatedTotalCost: "50.00" },
          { itemId: edited.items[1].id, allocatedTotalCost: "25.00" },
        ],
      }),
    },
  );
  assert(draft.allocationStatus === "DRAFT", "allocation draft failed");
  assert(draft.difference === "30.30", "draft difference is incorrect");

  const confirmed = await request(
    `/api/purchase-orders/${orderId}/allocation`,
    {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "confirm",
        allocations: [
          { itemId: edited.items[0].id, allocatedTotalCost: "60.00" },
          { itemId: edited.items[1].id, allocatedTotalCost: "45.30" },
        ],
      }),
    },
  );
  assert(confirmed.isBalanced, "balanced allocation was not confirmed");
  assert(
    confirmed.allocationStatus === "CONFIRMED",
    "confirmed allocation status is incorrect",
  );

  const list = await request(
    `/api/purchase-orders?query=${encodeURIComponent(orderNo)}`,
  );
  assert(list.total === 1, "created order missing from list");
  assert(
    list.data[0].allocationStatus === "CONFIRMED",
    "list allocation status is stale",
  );

  console.log(
    JSON.stringify(
      {
        ok: true,
        orderId,
        checks: [
          "create order",
          "multiple items",
          "edit order",
          "order attachment",
          "item attachment",
          "attachment read",
          "allocation draft",
          "balanced allocation confirmation",
          "list status",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  if (orderId) {
    await fetch(`${baseUrl}/api/purchase-orders/${orderId}`, {
      method: "DELETE",
    });
  }
}
