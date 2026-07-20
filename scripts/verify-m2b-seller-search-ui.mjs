import "dotenv/config";
import { randomUUID } from "node:crypto";
import { chromium } from "@playwright/test";
import { db } from "../src/server/db.ts";
import { DEFAULT_OWNER_ID } from "../src/server/constants.ts";

const baseUrl = process.env.APP_BASE_URL;
if (!baseUrl) throw new Error("APP_BASE_URL is required for the seller-search UI verification.");

const runId = `M2B-SELLER-UI-${Date.now()}-${randomUUID().slice(0, 8)}`;
let orderId;

try {
  const order = await db.purchaseOrder.create({
    data: {
      ownerId: DEFAULT_OWNER_ID,
      orderNo: `${runId}-ORDER`,
      sellerNickname: `${runId}-卖家`,
      paidAt: new Date(),
      totalAmount: "10.00",
      shippingAmount: "0.00",
      status: "PENDING_INSPECTION",
      items: { create: { name: `${runId}-商品`, skuText: `${runId}-SKU`, quantity: 1 } },
    },
    include: { items: true },
  });
  orderId = order.id;
  await db.inspection.create({
    data: { ownerId: DEFAULT_OWNER_ID, purchaseOrderItemId: order.items[0].id, sequence: 1 },
  });

  const browser = await chromium.launch({ headless: true });
  try {
    for (const viewport of [
      { width: 1440, height: 900 },
      { width: 390, height: 844 },
    ]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/inspections`, { waitUntil: "networkidle" });

      if (new URL(page.url()).pathname === "/access") {
        const password = process.env.APP_PASSWORD;
        if (!password) throw new Error("APP_PASSWORD is required when access protection is enabled.");
        await page.locator('input[type="password"]').fill(password);
        await page.locator("form button").click();
        await page.waitForURL(/\/inspections/);
      }

      const search = page.getByPlaceholder("搜索采购订单号、商品、SKU 或卖家昵称");
      await search.fill(order.sellerNickname ?? "");
      await page.getByText(`卖家：${order.sellerNickname}`).waitFor();
      const card = page.getByText(`卖家：${order.sellerNickname}`).locator("..");
      if (!(await card.isVisible())) throw new Error(`seller nickname is not visible at ${viewport.width}px`);
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log(JSON.stringify({ ok: true, checks: ["1440px seller search and display", "390px seller search and display"] }, null, 2));
} finally {
  if (orderId) await db.purchaseOrder.delete({ where: { id: orderId } });
  await db.$disconnect();
}
