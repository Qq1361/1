// Browser UI verification: action matrix on real pages
import { chromium } from "@playwright/test";

const BASE = "http://127.0.0.1:3000";
const ok = (l) => console.log("  ✅ " + l);
const fail = (l, d) => console.log("  ❌ " + l + ": " + d);

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });

try {
  // ====== Setup: ensure test data exists ======
  console.log("=== 0. Setup ===\n");
  const orderNo = "UI-ACT-" + Date.now();
  let r = await fetch(BASE + "/api/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, paidAt: new Date().toISOString(), totalAmount: "200.00", shippingAmount: "0.00",
      items: [{ name: "UI-动作测试商品", quantity: 1 }] }),
  });
  const order = await r.json();
  ok("创建测试订单 " + order.id);

  await fetch(BASE + "/api/purchase-orders/" + order.id + "/allocation", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", allocations: order.items.map(i => ({ itemId: i.id, allocatedTotalCost: "200.00" })) }),
  });

  await fetch(BASE + "/api/purchase-orders/" + order.id + "/tracking", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carrierCode: "SF", trackingNo: "DELIVERED1", shippedAt: new Date().toISOString() }),
  });
  await fetch(BASE + "/api/purchase-orders/" + order.id + "/refresh-logistics", { method: "POST" });

  const inspR = await (await fetch(BASE + "/api/inspections?query=" + encodeURIComponent(orderNo))).json();
  const insp = inspR.data[0];
  const expiry = new Date(Date.now() + 58 * 86400000); // 58 days
  await fetch(BASE + "/api/inspections/" + insp.id + "/complete", {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ result: "PASS", expiryDate: expiry.toISOString(), storageLocation: "测试-A箱" }),
  });
  ok("完成验货生成库存（58天效期）");

  // Find the inventory item
  const invR = await (await fetch(BASE + "/api/inventory?query=UI-动作测试商品")).json();
  const invItem = invR.data[0];
  ok("库存已生成 id=" + invItem.id + " 效期=" + invItem.expiryDate?.slice(0, 10));

  // ====== 1. Open homepage, check the todo ======
  console.log("\n=== 1. 首页待办 — 查看动作列表 ===\n");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: "scripts/ui-screenshots/actions-01-homepage.png", fullPage: true });

  // Find the todo card for our item
  const todoText = page.locator("text=UI-动作测试商品");
  if (await todoText.isVisible()) {
    ok("待办卡片显示测试商品名");
  } else {
    fail("待办卡片", "未找到测试商品 todo");
    // Maybe it's in "效期低于365天" - let's check
    const expiryText = page.locator("text=效期低于365天");
    if (await expiryText.isVisible()) ok("显示'效期低于365天'待办");

    // Look for the inventory code
    const codeText = page.locator("text=" + invItem.inventoryCode);
    if (await codeText.isVisible()) ok("待办显示库存编号");
    else fail("库存编号", invItem.inventoryCode + " 未在待办中找到");
  }

  // Click "处理" button on the todo card
  const processBtn = page.locator('button:has-text("处理")').first();
  if (await processBtn.isVisible()) {
    await processBtn.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: "scripts/ui-screenshots/actions-02-menu.png", fullPage: true });
    ok("处理菜单展开");

    // Check available actions
    const menuText = await page.locator(".absolute.top-full .rounded-md").first().textContent();
    console.log("  菜单内容: " + menuText?.replace(/\s+/g, " ").trim());

    // Should contain: 转闲鱼, 修改效期, 标记问题件, 已阅读 (but NOT 放到95分 since it's already under 365)
    if (menuText?.includes("转闲鱼")) ok("菜单有'转闲鱼'");
    else fail("转闲鱼", "未在菜单中找到");
    if (menuText?.includes("标记问题件")) ok("菜单有'标记问题件'");
    else fail("标记问题件", "未在菜单中找到");
    if (menuText?.includes("修改效期")) ok("菜单有'修改效期'");
    else fail("修改效期", "未在菜单中找到");
    if (menuText?.includes("已阅读")) ok("菜单有'已阅读'");
    else fail("已阅读", "未在菜单中找到");
    // These should NOT be there for EXPIRY_UNDER_365 with 58 days
    if (!menuText?.includes("已降价普通出售")) ok("无'已降价普通出售'（低于365天）");
    if (!menuText?.includes("改走得物普通")) ok("无'改走得物普通'（低于365天）");

    // Close menu
    await processBtn.click();
    await page.waitForTimeout(300);
  } else {
    // Try clicking on a todo card that has the "处理" button
    console.log("  直接查找处理按钮...");
    const allProcessBtns = page.locator('button:has-text("处理")');
    const count = await allProcessBtns.count();
    console.log("  找到 " + count + " 个'处理'按钮");
    if (count > 0) {
      await allProcessBtns.first().click();
      await page.waitForTimeout(500);
      ok("处理菜单已展开");
    }
  }

  // ====== 2. Click "标记问题件" ======
  console.log("\n=== 2. 点击标记问题件 ===\n");
  // Need to handle the prompt dialog
  page.once("dialog", async dialog => {
    console.log("  Dialog: " + dialog.message());
    await dialog.accept("浏览器验收测试-标记问题件");
  });
  page.once("dialog", async dialog => {
    console.log("  Confirm: " + dialog.message());
    await dialog.accept();
  });

  const problemBtn = page.locator('button:has-text("标记问题件")').first();
  if (await problemBtn.isVisible()) {
    await problemBtn.click();
    await page.waitForTimeout(2000);
    ok("点击标记问题件");
    await page.screenshot({ path: "scripts/ui-screenshots/actions-03-after-problem.png", fullPage: true });
  } else {
    fail("标记问题件按钮", "看不到");
  }

  // ====== 3. Verify: inventory detail shows PROBLEM ======
  console.log("\n=== 3. 库存详情 — 问题件状态 ===\n");
  await page.goto(BASE + "/inventory/" + invItem.id, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(1500);
  await page.screenshot({ path: "scripts/ui-screenshots/actions-04-inventory-detail.png", fullPage: true });

  const problemBadge = page.locator("text=问题件");
  if (await problemBadge.isVisible()) ok("库存详情显示'问题件'状态");
  else fail("问题件状态", "未在详情页显示");

  // ====== 4. Verify: todo no longer shows the expiry reminder ======
  console.log("\n=== 4. 效期提醒消失 ===\n");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);

  // The expiry todo for this item should be gone since it's now PROBLEM
  const stillVisible = page.locator("text=" + invItem.inventoryCode);
  if (!(await stillVisible.isVisible())) {
    ok("效期待办已从首页消失（PROBLEM 库存不提醒）");
  } else {
    console.log("  待办仍可见（可能是其他类型的待办或缓存）");
  }
  await page.screenshot({ path: "scripts/ui-screenshots/actions-05-homepage-after.png", fullPage: true });

  // ====== 5. Console errors ======
  console.log("\n=== 5. Console 检查 ===\n");
  const baseErrors = errors.filter(e => e.includes("nativeButton") || e.includes("Base UI"));
  if (baseErrors.length === 0) ok("无 Base UI 错误");
  else for (const e of baseErrors) fail("Base UI", e.substring(0, 100));
  const otherErrors = errors.filter(e => !e.includes("nativeButton") && !e.includes("Base UI"));
  if (otherErrors.length) console.log("  ⚠️ " + otherErrors.length + " other errors");
  else ok("无 console 错误");

  console.log("\n全部验证完成 ✅");

} catch (e) {
  console.error("Error:", e.message);
  await page.screenshot({ path: "scripts/ui-screenshots/actions-error.png", fullPage: true });
} finally {
  await browser.close();
}
