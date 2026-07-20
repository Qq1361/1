import "dotenv/config";
import { launchAcceptanceBrowser } from "./lib/browser-acceptance.mjs";
import { db } from "../src/server/db.ts";
import { DEFAULT_OWNER_ID } from "../src/server/constants.ts";

const baseUrl = process.env.APP_BASE_URL;
if (!baseUrl) throw new Error("APP_BASE_URL is required for the warehouse UI verification.");

const runId = `M8-UI-${Date.now()}`;
let warehouseId;
let warehouseName;

try {
  const warehouse = await db.warehouse.create({
    data: {
      ownerId: DEFAULT_OWNER_ID,
      name: `${runId} 仓库`,
      locations: { create: { ownerId: DEFAULT_OWNER_ID, name: `${runId} 库位` } },
    },
  });
  warehouseId = warehouse.id;
  warehouseName = warehouse.name;

  const browser = await launchAcceptanceBrowser();
  try {
    for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
      const context = await browser.newContext({ viewport });
      const page = await context.newPage();
      await page.goto(`${baseUrl}/inventory/warehouses`, { waitUntil: "networkidle" });
      if (new URL(page.url()).pathname === "/access") {
        if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required when access protection is enabled.");
        await page.locator('input[type="password"]').fill(process.env.APP_PASSWORD);
        await page.locator("form button").click();
        await page.waitForURL(/\/inventory\/warehouses/);
      }
      await page.getByRole("heading", { name: "仓库与库位" }).waitFor();
      const backButton = page.getByRole("button", { name: "返回库存" });
      await backButton.waitFor();
      if (viewport.width === 390) {
        const backBox = await backButton.boundingBox();
        if (!backBox || backBox.height < 44) throw new Error("Mobile warehouse back button must be at least 44px high.");
        if (!(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth))) throw new Error("Mobile warehouse page has horizontal overflow.");
      }
      await backButton.click();
      await page.waitForURL(/\/inventory(?:\?.*)?$/);
      await page.getByRole("link", { name: "仓库与库位" }).click();
      await page.waitForURL(/\/inventory\/warehouses$/);
      await page.getByRole("button", { name: "返回库存" }).click();
      await page.waitForURL(/\/inventory(?:\?.*)?$/);

      await page.goto(`${baseUrl}/purchases`, { waitUntil: "networkidle" });
      await page.goto(`${baseUrl}/inventory/warehouses`, { waitUntil: "networkidle", referer: `${baseUrl}/purchases` });
      await page.getByRole("button", { name: "返回库存" }).click();
      await page.waitForURL(/\/purchases(?:\?.*)?$/);

      await page.goto(`${baseUrl}/inventory/warehouses`, { waitUntil: "networkidle" });
      const card = page.getByText(warehouseName).locator("xpath=ancestor::*[contains(@class, 'overflow-hidden')]");
      await card.waitFor();
      if (viewport.width === 1440) {
        await card.getByRole("button", { name: "编辑" }).first().click();
        warehouseName = `${runId} 已编辑仓库`;
        await page.getByRole("dialog").getByLabel("编辑名称").fill(warehouseName);
        await page.getByRole("dialog").getByRole("button", { name: "保存" }).click();
        await page.getByText(warehouseName).waitFor();
      }
      await context.close();
    }
  } finally {
    await browser.close();
  }

  console.log("verify:m8-warehouse-foundation-ui passed: 1440px and 390px");
} finally {
  if (warehouseId) {
    await db.warehouseLocation.deleteMany({ where: { warehouseId } });
    await db.warehouse.delete({ where: { id: warehouseId } });
  }
  await db.$disconnect();
}
