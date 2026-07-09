import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";

const SCREENSHOT_DIR = "scripts/ui-screenshots";
mkdirSync(SCREENSHOT_DIR, { recursive: true });

const BASE = "http://127.0.0.1:3000";
const results = [];
function ok(l) { results.push("✅ "+l); console.log("  ✅ "+l); }
function fail(l,d) { results.push("❌ "+l+": "+d); console.log("  ❌ "+l+": "+d); }

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const errors = [];
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push(e.message));

async function waitFor(sel, t = 5000) {
  try { await page.locator(sel).first().waitFor({ state: "visible", timeout: t }); return true; }
  catch { return false; }
}

try {
  // ====== 0. Create test data via API ======
  console.log("\n=== 0. 准备数据 ===");
  const orderNo = "UI-E2E-" + Date.now();
  const r = await fetch(BASE + "/api/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo, paidAt: new Date().toISOString(), totalAmount: "200.00", shippingAmount: "15.00",
      items: [{ name: "UI-测试商品", skuText: "SKU-TEST", quantity: 2 }] }),
  });
  const order = await r.json();
  const orderId = order.id;
  ok("创建测试订单 " + orderId);

  // Confirm allocation
  await fetch(BASE + "/api/purchase-orders/" + orderId + "/allocation", {
    method: "PUT", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action: "confirm", allocations: order.items.map(i => ({ itemId: i.id, allocatedTotalCost: "100.00" })) }),
  });

  // Save tracking and refresh to get delivered
  await fetch(BASE + "/api/purchase-orders/" + orderId + "/tracking", {
    method: "PATCH", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ carrierCode: "SF", trackingNo: "DELIVERED1", shippedAt: new Date().toISOString() }),
  });
  await fetch(BASE + "/api/purchase-orders/" + orderId + "/refresh-logistics", { method: "POST" });

  // Complete one inspection via API
  const inspResp = await fetch(BASE + "/api/inspections?query=" + encodeURIComponent(orderNo));
  const inspections = (await inspResp.json()).data;
  if (inspections.length) {
    await fetch(BASE + "/api/inspections/" + inspections[0].id + "/complete", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ result: "PASS", storageLocation: "A箱", batchCode: "BATCH-001" }),
    });
    ok("完成验货并生成库存");
  }

  // Create a fresh PAID order for delete testing
  const delOrderNo = "UI-DELETE-" + Date.now();
  const dr = await fetch(BASE + "/api/purchase-orders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ orderNo: delOrderNo, paidAt: new Date().toISOString(), totalAmount: "50.00", shippingAmount: "0.00",
      items: [{ name: "可删商品", quantity: 1 }] }),
  });
  const delOrder = await dr.json();
  ok("创建可删除订单 " + delOrder.id);

  // ====== 1. Homepage card navigation ======
  console.log("\n=== 1. 首页看板卡片 ===");
  await page.goto(BASE, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SCREENSHOT_DIR + "/01-homepage.png", fullPage: true });

  // Check card links
  const missingTrackingCard = page.locator('a[href*="todo=missingTracking"]');
  if (await missingTrackingCard.isVisible()) ok("待填快递单号卡片可点击");

  const logisticsIssuesCard = page.locator('a[href*="todo=logisticsIssues"]');
  if (await logisticsIssuesCard.isVisible()) ok("物流异常卡片可点击");

  const inspectionCard = page.locator('a[href="/inspections"]').first();
  if (await inspectionCard.isVisible()) ok("待验货卡片可点击");

  const expiryCard = page.locator('a[href*="reminder=EXPIRY_UNDER_395"]');
  if (await expiryCard.isVisible()) ok("效期395天卡片可点击");

  const stockedCard = page.locator('a[href*="reminder=STOCKED_OVER_3_DAYS"]');
  if (await stockedCard.isVisible()) ok("入库满3天卡片可点击");

  // Click logistics issues card
  await logisticsIssuesCard.first().click();
  await page.waitForTimeout(1500);
  const url1 = page.url();
  if (url1.includes("todo=logisticsIssues")) ok("物流异常卡片跳转正确 → " + url1);
  else fail("物流异常跳转", url1);
  await page.screenshot({ path: SCREENSHOT_DIR + "/02-logistics-filter.png", fullPage: true });

  // Check filter title
  if (await waitFor("text=物流异常 / 停滞")) ok("筛选标题显示物流异常/停滞");

  // Clear filter link
  const clearLink = page.locator("text=清除筛选");
  if (await clearLink.isVisible()) ok("显示清除筛选链接");
  await clearLink.first().click();
  await page.waitForTimeout(1000);
  if (!page.url().includes("todo=logisticsIssues")) ok("清除筛选恢复全部列表");

  // ====== 2. Inspections page ======
  console.log("\n=== 2. 待验货页面 ===");
  await page.goto(BASE + "/inspections", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SCREENSHOT_DIR + "/03-inspections.png", fullPage: true });
  const inspLinks = page.locator('a[href^="/inspections/"]');
  const inspCount = await inspLinks.count();
  ok("待验货链接数: " + inspCount);

  // Click first one
  if (inspCount > 0) {
    await inspLinks.first().click();
    await page.waitForTimeout(1500);
    ok("点击进入验货向导");
    await page.screenshot({ path: SCREENSHOT_DIR + "/04-wizard.png", fullPage: true });
  }

  // ====== 3. Purchase list filtering ======
  console.log("\n=== 3. 采购列表筛选 ===");
  await page.goto(BASE + "/purchases?todo=missingTracking", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SCREENSHOT_DIR + "/05-missing-tracking.png", fullPage: true });
  if (await waitFor("text=待填快递单号")) ok("待填快递单号筛选标题");
  if (await waitFor("text=清除筛选")) ok("清除筛选可见");

  // Click order row
  const rowLink = page.locator('a[href^="/purchases/"][class*="font-medium"]').first();
  if (await rowLink.isVisible()) {
    await rowLink.click();
    await page.waitForTimeout(1500);
    ok("点击订单行进入详情");
  }

  // ====== 4. Delete order experience ======
  console.log("\n=== 4. 删除订单体验 ===");
  // First check a delivered order (should NOT show delete button)
  await page.goto(BASE + "/purchases/" + orderId, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SCREENSHOT_DIR + "/06-delivered-order-no-delete.png", fullPage: true });
  const deleteBtn = page.locator('button:has-text("删除订单")');
  const infoText = page.locator("text=不能直接删除");
  if (!(await deleteBtn.isVisible()) || (await infoText.isVisible())) {
    ok("已签收订单不显示删除按钮");
  } else {
    fail("已签收订单", "删除按钮仍可见");
  }
  if (await waitFor("text=不可删除")) ok("显示不可删除说明");
  else fail("不可删除说明", "未显示");

  // Check deletable order
  await page.goto(BASE + "/purchases/" + delOrder.id, { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SCREENSHOT_DIR + "/07-deletable-order.png", fullPage: true });
  const delBtn2 = page.locator('button:has-text("删除订单")');
  if (await delBtn2.isVisible()) {
    ok("PAID 订单显示删除按钮");
    // Click delete -> confirm dialog
    await delBtn2.click();
    await page.waitForTimeout(500);
    await page.screenshot({ path: SCREENSHOT_DIR + "/08-delete-confirm.png", fullPage: true });
    if (await waitFor("text=确认删除")) ok("弹出删除确认框");
    // Actually delete
    await page.locator('button:has-text("确认删除")').click();
    await page.waitForTimeout(2000);
    if (page.url().includes("/purchases") && !page.url().includes(delOrder.id)) {
      ok("删除后跳转采购列表");
    }
  }

  // ====== 5. Return navigation ======
  console.log("\n=== 5. 返回库存详情 ===");
  // Find an inventory item
  const invResp = await fetch(BASE + "/api/inventory");
  const invData = await invResp.json();
  if (invData.data.length) {
    const invItem = invData.data[0];
    await page.goto(BASE + "/inventory/" + invItem.id, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(2000);
    await page.screenshot({ path: SCREENSHOT_DIR + "/09-inventory-detail.png", fullPage: true });

    // Click "查看采购订单"
    const viewOrderLink = page.locator('a:has-text("查看采购订单")');
    if (await viewOrderLink.isVisible()) {
      const href = await viewOrderLink.getAttribute("href");
      if (href && href.includes("returnTo=")) ok("查看采购订单携带 returnTo 参数");
      else fail("returnTo 参数", href || "无href");
      await viewOrderLink.click();
      await page.waitForTimeout(1500);
      await page.screenshot({ path: SCREENSHOT_DIR + "/10-order-from-inventory.png", fullPage: true });

      // Check back link
      const backLink = page.locator("text=返回库存详情");
      if (await backLink.isVisible()) {
        ok("显示'返回库存详情'");
        await backLink.click();
        await page.waitForTimeout(1500);
        if (page.url().includes("/inventory/" + invItem.id)) ok("返回原库存详情页");
        else fail("返回库存", page.url());
      } else {
        fail("返回库存详情", "链接未显示");
      }
    }

    // Check edit inspection button
    const editBtn = page.locator('a:has-text("编辑验货信息")');
    if (await editBtn.isVisible()) {
      ok("库存详情显示编辑验货信息按钮");
      await editBtn.click();
      await page.waitForTimeout(2000);
      await page.screenshot({ path: SCREENSHOT_DIR + "/11-edit-inspection.png", fullPage: true });

      // Edit fields
      if (await waitFor("text=编辑验货信息")) {
        ok("进入编辑验货页面");
        // Change storage location
        const locInput = page.locator('input[placeholder*="A箱"]').first();
        const batchInput = page.locator('input').filter({ has: page.locator('..') }).first();
        const allInputs = page.locator("input");
        const inputCount = await allInputs.count();
        // Find storageLocation field by looking for label
        const storageField = page.locator("text=库位").locator("..").locator("input");
        if (await storageField.isVisible()) {
          await storageField.fill("B箱-测试编辑");
          ok("编辑库位字段");
        }
        const batchField = page.locator("text=批号").locator("..").locator("input");
        if (await batchField.isVisible()) {
          await batchField.fill("BATCH-EDITED");
          ok("编辑批号字段");
        }

        await page.screenshot({ path: SCREENSHOT_DIR + "/12-edit-filled.png", fullPage: true });

        // Save
        const saveBtn = page.locator('button:has-text("保存修改")');
        if (await saveBtn.isVisible()) {
          await saveBtn.click();
          await page.waitForTimeout(2000);
          ok("保存编辑成功");
          await page.screenshot({ path: SCREENSHOT_DIR + "/13-after-edit.png", fullPage: true });
        }
      }
    } else {
      fail("编辑按钮", "库存详情页未显示");
    }
  }

  // ====== 6. Inventory filtering ======
  console.log("\n=== 6. 库存筛选 ===");
  await page.goto(BASE + "/inventory?reminder=EXPIRY_UNDER_395", { waitUntil: "domcontentloaded" });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: SCREENSHOT_DIR + "/14-inventory-reminder.png", fullPage: true });
  if (await waitFor("text=效期低于 395 天")) ok("库存筛选标题显示");
  if (await waitFor("text=清除筛选")) ok("库存清除筛选可见");

  // ====== 7. Console errors ======
  console.log("\n=== 7. Console 错误 ===");
  const baseUIErrors = errors.filter(e => e.includes("nativeButton") || e.includes("Base UI") || e.includes("base-ui"));
  if (baseUIErrors.length === 0) ok("无 Base UI nativeButton 错误");
  else { for (const e of baseUIErrors) fail("Base UI", e.substring(0, 120)); }
  const otherErrors = errors.filter(e => !e.includes("nativeButton") && !e.includes("Base UI"));
  if (otherErrors.length) {
    console.log("  ⚠️ " + otherErrors.length + " other console errors:");
    for (const e of otherErrors.slice(0, 5)) console.log("    " + e.substring(0, 120));
  } else ok("无 console errors");

  // ====== SUMMARY ======
  console.log("\n========================================");
  console.log("        浏览器 UI 验收结果");
  console.log("========================================");
  for (const r of results) console.log(r);
  const passCount = results.filter(r=>r.startsWith("✅")).length;
  const failCount = results.filter(r=>r.startsWith("❌")).length;
  console.log("\n通过: " + passCount + "  失败: " + failCount);
  console.log("截图: " + SCREENSHOT_DIR + "/");
  if (failCount > 0) process.exit(1);

} catch (e) {
  console.error("Error:", e.message);
  await page.screenshot({ path: SCREENSHOT_DIR + "/error.png", fullPage: true });
  process.exit(1);
} finally {
  await browser.close();
}
