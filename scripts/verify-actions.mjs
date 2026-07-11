// Verify the action matrix for each todo type by creating inventory with
// specific states and checking /api/todos availableActions.

const BASE = "http://127.0.0.1:3000";
const results = [];
function ok(l) { results.push("✅ " + l); console.log("  ✅ " + l); }
function fail(l, d) { results.push("❌ " + l + ": " + d); console.log("  ❌ " + l + ": " + d); }

async function request(path, opts = {}) {
  const r = await fetch(BASE + path, { headers: { "Content-Type": "application/json" }, ...opts });
  return { status: r.status, body: await r.json().catch(() => null) };
}

// Helper: get all todos and find ones for a specific inventoryId
async function getActionsForItem(inventoryId) {
  const r = await request("/api/todos");
  const todos = r.body?.data || [];
  return todos.filter(t => t.inventoryId === inventoryId).flatMap(t => t.availableActions || []);
}

async function updateInventory(id, data) {
  await fetch(BASE + "/api/inventory/" + id, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
}

try {
  console.log("=== 创建测试数据 ===\n");

  // Create a purchase order with 4 items → 4 inventory items
  const orderNo = "ACT-TEST-" + Date.now();
  const orderR = await request("/api/purchase-orders", {
    method: "POST",
    body: JSON.stringify({
      orderNo, paidAt: new Date().toISOString(),
      totalAmount: "400.00", shippingAmount: "0.00",
      items: [
        { name: "95分-58天", quantity: 1 },
        { name: "标准-400天", quantity: 1 },
        { name: "标准-370天", quantity: 1 },
        { name: "标准-293天", quantity: 1 },
      ],
    }),
  });
  const order = orderR.body;
  const orderId = order.id;

  // Confirm allocation
  await request(`/api/purchase-orders/${orderId}/allocation`, {
    method: "PUT",
    body: JSON.stringify({
      action: "confirm",
      allocations: order.items.map(it => ({ itemId: it.id, allocatedTotalCost: "100.00" })),
    }),
  });

  // Save tracking + refresh to get inspections
  await request(`/api/purchase-orders/${orderId}/tracking`, {
    method: "PATCH",
    body: JSON.stringify({ carrierCode: "SF", trackingNo: "DELIVERED1", shippedAt: new Date().toISOString() }),
  });
  await request(`/api/purchase-orders/${orderId}/refresh-logistics`, { method: "POST" });

  // Get inspections and complete them
  const inspR = await request("/api/inspections?query=" + encodeURIComponent(orderNo));
  const inspections = inspR.body?.data || [];

  const now = new Date();
  for (const [i, insp] of inspections.entries()) {
    let expiry = null;
    if (i === 0) expiry = new Date(now.getTime() + 58 * 86400000);   // 58 days
    else if (i === 1) expiry = new Date(now.getTime() + 400 * 86400000); // 400 days
    else if (i === 2) expiry = new Date(now.getTime() + 370 * 86400000); // 370 days
    else if (i === 3) expiry = new Date(now.getTime() + 293 * 86400000); // 293 days

    await request(`/api/inspections/${insp.id}/complete`, {
      method: "POST",
      body: JSON.stringify({ result: "PASS", expiryDate: expiry?.toISOString() }),
    });
  }
  ok("创建 4 件库存：58天、400天、370天、293天");

  // Get inventory items by searching for the test product names
  const names = ["95分-58天", "标准-400天", "标准-370天", "标准-293天"];
  const items = [];
  for (const name of names) {
    const r = await request("/api/inventory?query=" + encodeURIComponent(name));
    if (r.body?.data?.length) items.push(r.body.data[0]);
  }
  const item95_58 = items.find(i => i.name === "95分-58天");
  const item400 = items.find(i => i.name === "标准-400天");
  const item370 = items.find(i => i.name === "标准-370天");
  const item293 = items.find(i => i.name === "标准-293天");

  if (!item95_58 || !item400 || !item370 || !item293) {
    fail("测试数据", "未找到全部库存项");
    process.exit(1);
  }

  // ==========================================================
  // Case 1: 95分-58天 → NINETY_FIVE_EXPIRY_UNDER_60
  // ==========================================================
  console.log("\n=== Case 1: 95分 + 58天 → NINETY_FIVE_EXPIRY_UNDER_60 ===");
  await updateInventory(item95_58.id, { saleMode: "NINETY_FIVE" });
  // Wait a moment for /api/todos to recalculate
  await new Promise(r => setTimeout(r, 300));
  const actions1 = await getActionsForItem(item95_58.id);
  const labels1 = actions1.map(a => a.label);
  console.log("  动作:", labels1.join(" / "));
  if (!labels1.includes("放到95分")) ok("无'放到95分'");
  else fail("放到95分", "不应该出现");
  if (!labels1.includes("95分降价出售")) ok("无'95分降价出售'");
  else fail("95分降价出售", "不应该出现");
  if (labels1.includes("转闲鱼")) ok("有'转闲鱼'");
  else fail("转闲鱼", "缺失");
  if (labels1.includes("标记问题件")) ok("有'标记问题件'");
  else fail("标记问题件", "缺失");
  if (labels1.includes("已阅读")) ok("有'已阅读'");
  else fail("已阅读", "缺失");

  // ==========================================================
  // Case 2: 标准-400天 → DISTANCE_TO_395_WITHIN_7_DAYS
  // ==========================================================
  console.log("\n=== Case 2: 标准 + 400天 → DISTANCE_TO_395_WITHIN_7_DAYS ===");
  await updateInventory(item400.id, { saleMode: "NONE" });
  await new Promise(r => setTimeout(r, 300));
  const actions2 = await getActionsForItem(item400.id);
  const labels2 = actions2.map(a => a.label);
  console.log("  动作:", labels2.join(" / "));
  if (labels2.includes("已安排得物闪电")) ok("有'已安排得物闪电'");
  else fail("已安排得物闪电", "缺失，labels=" + labels2.join(","));

  // ==========================================================
  // Case 3: 标准-370天 → DISTANCE_TO_365_WITHIN_10_DAYS
  // ==========================================================
  console.log("\n=== Case 3: 标准 + 370天 → DISTANCE_TO_365_WITHIN_10_DAYS ===");
  await updateInventory(item370.id, { saleMode: "NONE" });
  await new Promise(r => setTimeout(r, 300));
  const actions3 = await getActionsForItem(item370.id);
  const labels3 = actions3.map(a => a.label);
  console.log("  动作:", labels3.join(" / "));
  if (labels3.includes("已降价普通出售")) ok("有'已降价普通出售'");
  else fail("已降价普通出售", "缺失，labels=" + labels3.join(","));

  // ==========================================================
  // Case 4: 标准-293天 → EXPIRY_UNDER_365
  // ==========================================================
  console.log("\n=== Case 4: 标准 + 293天 → EXPIRY_UNDER_365 ===");
  await updateInventory(item293.id, { saleMode: "NONE" });
  await new Promise(r => setTimeout(r, 300));
  const actions4 = await getActionsForItem(item293.id);
  const labels4 = actions4.map(a => a.label);
  console.log("  动作:", labels4.join(" / "));
  if (!labels4.includes("已降价普通出售")) ok("无'已降价普通出售'");
  else fail("已降价普通出售", "不应该出现");
  if (!labels4.includes("改走得物普通")) ok("无'改走得物普通'");
  else fail("改走得物普通", "不应该出现（低于365天不能再走得物普通）");
  if (labels4.includes("转95分")) ok("有'转95分'（293>90天）");
  else fail("转95分", "缺失");
  if (labels4.includes("转闲鱼")) ok("有'转闲鱼'");
  else fail("转闲鱼", "缺失");

  // ==========================================================
  // Summary
  // ==========================================================
  console.log("\n========================================");
  for (const r of results) console.log(r);
  const pass = results.filter(r => r.startsWith("✅")).length;
  const failCount = results.filter(r => r.startsWith("❌")).length;
  console.log("\n通过: " + pass + "  失败: " + failCount);
  if (failCount > 0) process.exit(1);

  // Cleanup
  await fetch(BASE + "/api/purchase-orders/" + orderId, { method: "DELETE" }).catch(() => {});

} catch (e) {
  console.error("Error:", e.message);
  process.exit(1);
}
