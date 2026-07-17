import "dotenv/config";
import { execFileSync, spawn } from "node:child_process";
import fs from "node:fs/promises";
import net from "node:net";
import path from "node:path";
import { Prisma } from "../src/generated/prisma/client.ts";
import { MarketPlatform, MarketQuoteSourceType, MarketQuoteType } from "../src/generated/prisma/enums.ts";
import { db } from "../src/server/db.ts";
import { marketItemService } from "../src/server/market/market-item-service.ts";
import { marketQuoteService } from "../src/server/market/market-quote-service.ts";
import { marketQuery } from "../src/server/market/market-query.ts";
import { selectCurrentQuote } from "../src/server/market/market-rules.ts";

const ownerId = "default-user";
const runId = `M4-MARKET-${Date.now()}`;
const created = { itemIds: [], quoteIds: [], ownerIds: [] };
let checks = 0;
let temporaryServer = null;
let temporaryPort = null;
let verificationBaseUrl = null;
let accessCookie = null;
let temporaryServerOutput = "";

function assert(condition, message) {
  if (!condition) throw new Error(message);
  checks += 1;
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

async function rejectsWithCode(action, code, message) {
  try {
    await action();
  } catch (error) {
    assert(error?.code === code, `${message} returns ${code}`);
    return;
  }
  throw new Error(`${message} should be rejected`);
}

function itemInput(suffix, overrides = {}) {
  return {
    ownerId,
    displayName: `${runId} 行情商品`,
    normalizedName: `${runId} 行情商品`,
    skuText: "2c0",
    normalizedSku: "2C0",
    versionText: "第一代",
    conditionText: "全新",
    packageVariant: "有盒",
    accessoryVariant: "含泵头",
    ...overrides,
  };
}

async function findMarketMigration(nameFragment) {
  const entries = await fs.readdir(path.join(process.cwd(), "prisma", "migrations"), { withFileTypes: true });
  const directory = entries.find((entry) => entry.isDirectory() && entry.name.includes(nameFragment));
  if (!directory) throw new Error(`Missing migration containing ${nameFragment}`);
  return fs.readFile(path.join(process.cwd(), "prisma", "migrations", directory.name, "migration.sql"), "utf8");
}

function modelBlock(schema, modelName) {
  const match = schema.match(new RegExp(`model ${modelName} \\{([\\s\\S]*?)\\n\\}`, "m"));
  if (!match) throw new Error(`Missing Prisma model ${modelName}`);
  return match[1];
}

async function pathExists(relativePath) {
  try {
    await fs.access(path.join(process.cwd(), relativePath));
    return true;
  } catch {
    return false;
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      if (!address || typeof address === "string") {
        server.close();
        reject(new Error("Could not allocate an HTTP verification port"));
        return;
      }
      const { port } = address;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

function isPortListening(port) {
  return Promise.resolve(listeningPortPids(port).length > 0);
}

function listeningPortPids(port) {
  try {
    const lines = execFileSync("netstat", ["-ano", "-p", "tcp"], { encoding: "utf8", windowsHide: true }).split(/\r?\n/);
    return [...new Set(lines.filter((line) => line.includes(`:${port}`) && /LISTENING/i.test(line)).map((line) => Number(line.trim().split(/\s+/).at(-1))).filter(Number.isInteger))];
  } catch {
    return [];
  }
}

async function waitFor(condition, message, timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await condition()) return;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error(`${message}. ${temporaryServerOutput.slice(-2_000)}`);
}

async function startTemporaryServer() {
  if (!process.env.APP_PASSWORD) throw new Error("APP_PASSWORD is required for protected HTTP verification");
  temporaryPort = await findFreePort();
  verificationBaseUrl = `http://127.0.0.1:${temporaryPort}`;
  const nextBin = path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next");
  temporaryServer = spawn(process.execPath, [nextBin, "start", "--hostname", "127.0.0.1", "--port", String(temporaryPort)], {
    cwd: process.cwd(),
    env: process.env,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  temporaryServer.stdout.on("data", (chunk) => { temporaryServerOutput += chunk.toString(); });
  temporaryServer.stderr.on("data", (chunk) => { temporaryServerOutput += chunk.toString(); });
  await waitFor(async () => {
    try {
      const response = await fetch(`${verificationBaseUrl}/access`, { redirect: "manual" });
      return response.status === 200;
    } catch {
      return false;
    }
  }, "Temporary Next server did not become ready");
  const access = await fetch(`${verificationBaseUrl}/api/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  const setCookie = access.headers.get("set-cookie");
  if (!access.ok || !setCookie) throw new Error(`Could not establish APP_PASSWORD session (${access.status})`);
  accessCookie = setCookie.split(";")[0];
  assert(Boolean(accessCookie), "temporary HTTP verification establishes the APP_PASSWORD session");
}

async function stopTemporaryServer() {
  if (!temporaryServer || !temporaryPort) return;
  const pid = temporaryServer.pid;
  if (!temporaryServer.killed) {
    temporaryServer.kill();
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 2_000);
      temporaryServer.once("exit", () => { clearTimeout(timer); resolve(undefined); });
    });
  }
  if (pid) {
    try {
      execFileSync("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // The process can already be gone; the port check below is authoritative.
    }
  }
  await new Promise((resolve) => setTimeout(resolve, 500));
  for (const listenerPid of listeningPortPids(temporaryPort)) {
    try {
      execFileSync("taskkill", ["/pid", String(listenerPid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
    } catch {
      // The listener can terminate between discovery and taskkill.
    }
  }
  // `next start` can briefly keep its socket alive while taskkill propagates through the process tree.
  await new Promise((resolve) => setTimeout(resolve, 1_000));
  await waitFor(async () => !(await isPortListening(temporaryPort)), `Temporary verification port ${temporaryPort} was not released`, 30_000);
  temporaryServer = null;
  temporaryPort = null;
  verificationBaseUrl = null;
  accessCookie = null;
}

async function api(pathname, options = {}) {
  if (!verificationBaseUrl || !accessCookie) throw new Error("Temporary HTTP session is not available");
  const response = await fetch(`${verificationBaseUrl}${pathname}`, {
    redirect: "manual",
    ...options,
    headers: { cookie: accessCookie, ...(options.headers ?? {}) },
  });
  const text = await response.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { body = { raw: text }; }
  return { status: response.status, body };
}

function apiJson(pathname, method, body) {
  return api(pathname, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
}

try {
  const [schema, marketTablesMigration, constraintsMigration] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "prisma", "schema.prisma"), "utf8"),
    findMarketMigration("add_m4_market_items_and_quotes"),
    findMarketMigration("add_m4_market_constraints"),
  ]);

  assert(await db.user.count({ where: { id: ownerId } }) === 1, "default owner exists for M4 market fixture");
  assert(Object.values(MarketPlatform).join(",") === "DEWU,NINETY_FIVE,XIANYU,OTHER", "MarketPlatform has the four frozen market platforms");
  assert(Object.values(MarketQuoteType).join(",") === "EXPECTED_INCOME,LISTING_PRICE,MANUAL_REFERENCE", "MarketQuoteType has only the frozen V1 quote meanings");
  assert(Object.values(MarketQuoteSourceType).join(",") === "MANUAL", "MarketQuoteSourceType exposes only MANUAL in M4-A1");
  assert(schema.includes("model MarketItem") && schema.includes("model MarketQuote"), "schema defines independent MarketItem and MarketQuote models");
  assert(modelBlock(schema, "User").includes("marketItems") && modelBlock(schema, "User").includes("marketQuotes"), "User has explicit market-domain reverse relations");
  assert(modelBlock(schema, "MarketQuote").includes("onDelete: Restrict"), "MarketQuote preserves MarketItem history with Restrict deletion");
  for (const legacyModel of ["PurchaseOrder", "PurchaseOrderItem", "InventoryItem", "SaleOrder", "SaleLine", "PlatformShipmentLine"]) {
    assert(!modelBlock(schema, legacyModel).includes("marketItemId"), `${legacyModel} remains untouched by M4-A1`);
  }
  assert(!marketTablesMigration.includes('ALTER TABLE "inventory_items"') && !marketTablesMigration.includes('ALTER TABLE "purchase_orders"') && !marketTablesMigration.includes('ALTER TABLE "sale_orders"'), "market table migration does not mutate M1-M3 business tables");
  for (const constraintName of [
    "market_items_display_name_not_blank_check",
    "market_items_normalized_name_not_blank_check",
    "market_items_normalized_sku_not_blank_check",
    "market_items_default_target_profit_non_negative_check",
    "market_quotes_amount_non_negative_check",
    "market_quotes_expiry_after_recorded_at_check",
    "market_quotes_invalidation_reason_pair_check",
    "market_quotes_source_reference_not_blank_check",
  ]) {
    assert(constraintsMigration.includes(constraintName), `constraint migration contains ${constraintName}`);
  }
  assert(await pathExists("src/server/market/market-item-service.ts"), "MarketItem Service exists in M4-A2");
  assert(await pathExists("src/server/market/market-quote-service.ts"), "MarketQuote Service exists in M4-A2");
  assert(await pathExists("src/server/market/market-rules.ts"), "market pure rules exist in M4-A2");
  assert(await pathExists("src/server/market/market-query.ts"), "market read-only query DTO exists in M4-A2");
  assert(await pathExists("src/server/market/market-errors.ts"), "market domain error helpers exist in M4-A2");
  assert(!await pathExists("src/app/api/market-items"), "M4-A2 does not add MarketItem HTTP APIs");
  assert(!await pathExists("src/app/api/market-quotes"), "M4-A2 does not add MarketQuote HTTP APIs");
  assert(!await pathExists("src/app/market-quotes"), "M4-A2 does not add market pages");

  const primaryItem = await db.marketItem.create({
    data: itemInput("primary", { defaultTargetProfitAmount: new Prisma.Decimal("80.00") }),
  });
  created.itemIds.push(primaryItem.id);
  const variantItem = await db.marketItem.create({
    data: itemInput("variant", { packageVariant: "无盒", defaultTargetProfitAmount: null }),
  });
  created.itemIds.push(variantItem.id);
  assert(primaryItem.defaultTargetProfitAmount?.equals("80.00"), "MarketItem persists an explicit Decimal default target profit");
  assert(variantItem.defaultTargetProfitAmount === null, "MarketItem has no hard-coded 80-yuan database default");
  assert(primaryItem.id !== variantItem.id, "similar items with different variants remain independent market objects without a fragile compound unique key");

  const recordedAt = new Date("2026-07-16T09:00:00.000Z");
  const quoteInputs = [
    { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "300.00", confirmedAt: new Date("2026-07-16T09:01:00.000Z") },
    { platform: "DEWU", quoteType: "LISTING_PRICE", amount: "360.00", confirmedAt: null },
    { platform: "NINETY_FIVE", quoteType: "MANUAL_REFERENCE", amount: "280.00", confirmedAt: new Date("2026-07-16T09:02:00.000Z") },
  ];
  for (const input of quoteInputs) {
    const quote = await db.marketQuote.create({
      data: {
        ownerId,
        marketItemId: primaryItem.id,
        platform: input.platform,
        quoteType: input.quoteType,
        amount: new Prisma.Decimal(input.amount),
        recordedAt,
        sourceType: "MANUAL",
        confirmedAt: input.confirmedAt,
        note: `${runId} historical quote`,
      },
    });
    created.quoteIds.push(quote.id);
  }
  const history = await db.marketQuote.findMany({
    where: { marketItemId: primaryItem.id, ownerId },
    include: { marketItem: true, owner: true },
    orderBy: { createdAt: "asc" },
  });
  assert(history.length === 3, "one MarketItem retains multiple platform and quote-type history records");
  assert(history.every((quote) => quote.marketItem.id === primaryItem.id && quote.owner.id === ownerId), "MarketQuote owner and MarketItem relations are generated and queryable");
  assert(history.find((quote) => quote.quoteType === "EXPECTED_INCOME")?.amount.equals("300.00"), "EXPECTED_INCOME remains a distinct stored amount");
  assert(history.find((quote) => quote.quoteType === "LISTING_PRICE")?.amount.equals("360.00"), "LISTING_PRICE remains separate from expected income");
  assert(history.every((quote) => quote.sourceType === "MANUAL"), "M4-A1 stores only manual quote sources");
  await rejects(() => db.marketItem.delete({ where: { id: primaryItem.id } }), "MarketItem with quote history");

  await rejects(() => db.marketItem.create({ data: itemInput("blank-display", { displayName: "   " }) }), "blank displayName");
  await rejects(() => db.marketItem.create({ data: itemInput("blank-normalized", { normalizedName: "   " }) }), "blank normalizedName");
  await rejects(() => db.marketItem.create({ data: itemInput("blank-sku", { normalizedSku: " " }) }), "blank normalizedSku");
  await rejects(() => db.marketItem.create({ data: itemInput("negative-target", { defaultTargetProfitAmount: new Prisma.Decimal("-0.01") }) }), "negative default target profit");

  const quoteData = {
    ownerId,
    marketItemId: variantItem.id,
    platform: "XIANYU",
    quoteType: "EXPECTED_INCOME",
    amount: new Prisma.Decimal("200.00"),
    recordedAt,
    sourceType: "MANUAL",
  };
  await rejects(() => db.marketQuote.create({ data: { ...quoteData, amount: new Prisma.Decimal("-0.01") } }), "negative market quote amount");
  await rejects(() => db.marketQuote.create({ data: { ...quoteData, expiresAt: recordedAt } }), "expiry not after recordedAt");
  await rejects(() => db.marketQuote.create({ data: { ...quoteData, invalidationReason: "录错" } }), "invalidation reason without invalidatedAt");
  await rejects(() => db.marketQuote.create({ data: { ...quoteData, invalidatedAt: new Date(), invalidationReason: "   " } }), "blank invalidation reason");
  await rejects(() => db.marketQuote.create({ data: { ...quoteData, sourceReference: "  " } }), "blank sourceReference");

  const generatedMarketItem = await fs.access(path.join(process.cwd(), "src", "generated", "prisma", "models", "MarketItem.ts")).then(() => true).catch(() => false);
  const generatedMarketQuote = await fs.access(path.join(process.cwd(), "src", "generated", "prisma", "models", "MarketQuote.ts")).then(() => true).catch(() => false);
  assert(generatedMarketItem && generatedMarketQuote, "Prisma generate emitted MarketItem and MarketQuote clients");

  // M4-A2: service and read-model fixtures are deliberately isolated by runId.
  const otherOwnerId = `${runId}-owner`;
  await db.user.create({ data: { id: otherOwnerId, name: `${runId} owner` } });
  created.ownerIds.push(otherOwnerId);
  const serviceNow = new Date("2026-07-16T12:00:00.000Z");
  const beforeCounts = await Promise.all([db.purchaseOrder.count(), db.inventoryItem.count(), db.saleOrder.count(), db.saleLine.count()]);
  const serviceItemResult = await marketItemService.createMarketItem(ownerId, {
    displayName: `  ${runId}  DW　Foundation  `, skuText: " 2c0 ", versionText: "  第一代 ", conditionText: "  全新 ", packageVariant: "  有盒 ", accessoryVariant: "  含泵头 ", note: "  人工行情 ", defaultTargetProfitAmount: "80.00",
  });
  const serviceItem = serviceItemResult.marketItem;
  created.itemIds.push(serviceItem.id);
  assert(serviceItem.displayName === `${runId} DW Foundation`, "createMarketItem trims and compresses displayName");
  assert(serviceItem.normalizedName === `${runId.toLocaleLowerCase("en-US")} dw foundation`, "createMarketItem uses deterministic normalizedName");
  assert(serviceItem.skuText === "2c0" && serviceItem.normalizedSku === "2C0", "createMarketItem reuses normalizeSku for normalizedSku");
  assert(serviceItemResult.potentialDuplicates.length === 0, "first MarketItem has no duplicate warning");
  await rejectsWithCode(() => marketItemService.createMarketItem(ownerId, { displayName: "x", defaultTargetProfitAmount: "-0.01" }), "MARKET_TARGET_PROFIT_INVALID", "negative target profit");
  const duplicate = await marketItemService.createMarketItem(ownerId, { displayName: serviceItem.displayName, skuText: serviceItem.skuText, versionText: serviceItem.versionText, conditionText: serviceItem.conditionText, packageVariant: serviceItem.packageVariant, accessoryVariant: serviceItem.accessoryVariant });
  created.itemIds.push(duplicate.marketItem.id);
  assert(duplicate.warnings.includes("POTENTIAL_DUPLICATE_MARKET_ITEM"), "same normalized item warns without automatic merge");
  const distinctVersion = await marketItemService.createMarketItem(ownerId, { displayName: serviceItem.displayName, skuText: serviceItem.skuText, versionText: "第二代", conditionText: serviceItem.conditionText, packageVariant: serviceItem.packageVariant, accessoryVariant: serviceItem.accessoryVariant });
  created.itemIds.push(distinctVersion.marketItem.id);
  assert(distinctVersion.potentialDuplicates.length === 0, "different version does not auto-merge or warn as exact duplicate");

  const initialQuote = await marketQuoteService.createMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.DEWU, quoteType: MarketQuoteType.EXPECTED_INCOME, amount: "300.00", recordedAt: "2026-07-16T10:00:00.000Z", note: "初始", confirmImmediately: true, now: serviceNow, confirmedAt: new Date(0) });
  created.quoteIds.push(initialQuote.quote.id);
  assert(initialQuote.quote.sourceType === MarketQuoteSourceType.MANUAL && initialQuote.quote.confirmedAt?.getTime() === serviceNow.getTime(), "createMarketQuote controls manual source and server confirmation time");
  const originalConfirmedAt = initialQuote.quote.confirmedAt?.getTime();
  const confirmedAgain = await marketQuoteService.confirmMarketQuote(ownerId, initialQuote.quote.id, new Date("2026-07-16T13:00:00.000Z"));
  assert(confirmedAgain.quote.confirmedAt?.getTime() === originalConfirmedAt, "repeat quote confirmation is idempotent and preserves confirmedAt");
  await rejectsWithCode(() => marketQuoteService.createMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.DEWU, quoteType: MarketQuoteType.EXPECTED_INCOME, amount: "300", recordedAt: "2026-07-17T00:00:00.000Z", now: serviceNow }), "MARKET_QUOTE_TIME_INVALID", "future recordedAt");
  const historyQuote = await marketQuoteService.createMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.DEWU, quoteType: MarketQuoteType.EXPECTED_INCOME, amount: "310", recordedAt: "2026-07-16T11:00:00.000Z", now: serviceNow });
  created.quoteIds.push(historyQuote.quote.id);
  assert((await db.marketQuote.count({ where: { ownerId, marketItemId: serviceItem.id, platform: MarketPlatform.DEWU, quoteType: MarketQuoteType.EXPECTED_INCOME } })) === 2, "new quote preserves older quote history");
  const confirmedHistory = await marketQuoteService.confirmMarketQuote(ownerId, historyQuote.quote.id, serviceNow);
  assert(confirmedHistory.quote.confirmedAt?.getTime() === serviceNow.getTime(), "unconfirmed quote can be confirmed");
  const current = await marketQuoteService.selectCurrentMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.DEWU, quoteType: MarketQuoteType.EXPECTED_INCOME, asOf: serviceNow });
  assert(current?.id === historyQuote.quote.id, "current quote uses latest effective recordedAt");

  const invalidated = await marketQuoteService.invalidateMarketQuote(ownerId, initialQuote.quote.id, " 录入错误 ", serviceNow);
  assert(invalidated.quote.invalidatedAt?.getTime() === serviceNow.getTime() && invalidated.quote.invalidationReason === "录入错误", "invalidateQuote writes reason and timestamp");
  const invalidatedAgain = await marketQuoteService.invalidateMarketQuote(ownerId, initialQuote.quote.id, "录入错误", new Date("2026-07-16T13:00:00.000Z"));
  assert(invalidatedAgain.quote.invalidatedAt?.getTime() === serviceNow.getTime(), "same invalidation reason is idempotent");
  await rejectsWithCode(() => marketQuoteService.invalidateMarketQuote(ownerId, initialQuote.quote.id, "其他原因"), "MARKET_QUOTE_ALREADY_FINALIZED", "different invalidation reason");
  await rejectsWithCode(() => marketQuoteService.confirmMarketQuote(ownerId, initialQuote.quote.id), "MARKET_QUOTE_INVALIDATED", "invalidated quote confirmation");

  const correctionSource = await marketQuoteService.createMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.XIANYU, quoteType: MarketQuoteType.LISTING_PRICE, amount: "360", recordedAt: "2026-07-16T10:30:00.000Z", now: serviceNow });
  created.quoteIds.push(correctionSource.quote.id);
  await rejectsWithCode(() => marketQuoteService.correctMarketQuote(ownerId, correctionSource.quote.id, { invalidationReason: "录错", platform: MarketPlatform.XIANYU, quoteType: MarketQuoteType.LISTING_PRICE, amount: "350", recordedAt: "2026-07-17T00:00:00.000Z", now: serviceNow }), "MARKET_QUOTE_TIME_INVALID", "failed correction validates before invalidating original");
  assert((await db.marketQuote.findUnique({ where: { id: correctionSource.quote.id } }))?.invalidatedAt === null, "failed correction rolls back before original quote mutation");
  const correction = await marketQuoteService.correctMarketQuote(ownerId, correctionSource.quote.id, { invalidationReason: "录错", platform: MarketPlatform.XIANYU, quoteType: MarketQuoteType.LISTING_PRICE, amount: "350", recordedAt: "2026-07-16T11:30:00.000Z", confirmImmediately: true, now: serviceNow });
  created.quoteIds.push(correction.replacementQuote.quote.id);
  assert(correction.originalQuote.quote.invalidatedAt !== null && correction.replacementQuote.quote.amount.equals("350.00"), "correction invalidates original and creates a replacement quote atomically");

  const concurrencySource = await marketQuoteService.createMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.NINETY_FIVE, quoteType: MarketQuoteType.MANUAL_REFERENCE, amount: "260", recordedAt: "2026-07-16T10:45:00.000Z", now: serviceNow });
  created.quoteIds.push(concurrencySource.quote.id);
  const concurrentResults = await Promise.allSettled([
    marketQuoteService.correctMarketQuote(ownerId, concurrencySource.quote.id, { invalidationReason: "修正 A", platform: MarketPlatform.NINETY_FIVE, quoteType: MarketQuoteType.MANUAL_REFERENCE, amount: "261", recordedAt: "2026-07-16T11:45:00.000Z", now: serviceNow }),
    marketQuoteService.correctMarketQuote(ownerId, concurrencySource.quote.id, { invalidationReason: "修正 B", platform: MarketPlatform.NINETY_FIVE, quoteType: MarketQuoteType.MANUAL_REFERENCE, amount: "262", recordedAt: "2026-07-16T11:46:00.000Z", now: serviceNow }),
  ]);
  const fulfilledCorrections = concurrentResults.filter((result) => result.status === "fulfilled");
  for (const result of fulfilledCorrections) created.quoteIds.push(result.value.replacementQuote.quote.id);
  assert(fulfilledCorrections.length === 1, "concurrent correction allows at most one replacement quote");

  await marketItemService.setMarketItemActive(ownerId, serviceItem.id, false);
  await rejectsWithCode(() => marketQuoteService.createMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.OTHER, quoteType: MarketQuoteType.EXPECTED_INCOME, amount: "1", recordedAt: "2026-07-16T11:00:00.000Z", now: serviceNow }), "MARKET_ITEM_INACTIVE", "inactive item quote creation");
  const inactiveUnconfirmed = await db.marketQuote.create({ data: { ownerId, marketItemId: serviceItem.id, platform: MarketPlatform.OTHER, quoteType: MarketQuoteType.MANUAL_REFERENCE, amount: new Prisma.Decimal("1"), recordedAt: serviceNow, sourceType: MarketQuoteSourceType.MANUAL } });
  created.quoteIds.push(inactiveUnconfirmed.id);
  await rejectsWithCode(() => marketQuoteService.confirmMarketQuote(ownerId, inactiveUnconfirmed.id, serviceNow), "MARKET_ITEM_INACTIVE", "inactive item quote confirmation");
  const inactiveInvalidation = await marketQuoteService.invalidateMarketQuote(ownerId, inactiveUnconfirmed.id, "停用后纠错", serviceNow);
  assert(inactiveInvalidation.quote.invalidatedAt !== null, "inactive item still allows quote invalidation");
  await marketItemService.setMarketItemActive(ownerId, serviceItem.id, true);
  const enabledQuote = await marketQuoteService.createMarketQuote(ownerId, { marketItemId: serviceItem.id, platform: MarketPlatform.OTHER, quoteType: MarketQuoteType.EXPECTED_INCOME, amount: "200", recordedAt: "2026-07-16T11:00:00.000Z", now: serviceNow });
  created.quoteIds.push(enabledQuote.quote.id);
  assert(enabledQuote.quote.id, "reactivated item can create a new quote");

  const otherItem = await marketItemService.createMarketItem(otherOwnerId, { displayName: `${runId} private` });
  created.itemIds.push(otherItem.marketItem.id);
  await rejectsWithCode(() => marketQuery.getMarketItemDetail(otherOwnerId, serviceItem.id), "MARKET_ITEM_NOT_FOUND", "cross-owner MarketItem detail");
  await rejectsWithCode(() => marketQuoteService.confirmMarketQuote(otherOwnerId, enabledQuote.quote.id), "MARKET_QUOTE_NOT_FOUND", "cross-owner MarketQuote operation");
  const ownerList = await marketQuery.listMarketItems(ownerId, { page: 1, pageSize: 1, asOf: serviceNow });
  assert(ownerList.items.every((item) => item.id !== otherItem.marketItem.id) && ownerList.total >= 3, "owner list excludes other owner data and keeps one row per MarketItem");
  assert(typeof ownerList.items[0]?.defaultTargetProfitAmount === "string" || ownerList.items[0]?.defaultTargetProfitAmount === null, "market list serializes Decimal amounts as strings");
  assert(ownerList.items[0]?.createdAt === null || /^\d{4}-\d{2}-\d{2}T/.test(ownerList.items[0]?.createdAt), "market list serializes dates as ISO strings");
  const detail = await marketQuery.getMarketItemDetail(ownerId, serviceItem.id, { page: 1, pageSize: 100, asOf: serviceNow });
  assert(detail.currentQuotesByPlatform.length === 4 && detail.currentQuotesByPlatform.every((entry) => entry.quoteTypes.length === 3), "detail returns four platforms and three quote types");
  assert(detail.history.items.some((quote) => quote.lifecycleStatus === "INVALIDATED") && detail.history.items.some((quote) => quote.lifecycleStatus === "CURRENT"), "detail derives quote lifecycle states without writes");
  const quotesPage = await marketQuery.listMarketQuotes(ownerId, { marketItemId: serviceItem.id, effectiveAt: serviceNow, page: 1, pageSize: 100 });
  assert(quotesPage.items.every((quote) => typeof quote.amount === "string" && quote.marketItem.id === serviceItem.id), "quote list is owner-scoped and JSON-safe");
  const rawServiceQuotes = await db.marketQuote.findMany({ where: { ownerId, marketItemId: serviceItem.id } });
  assert(selectCurrentQuote(rawServiceQuotes.filter((quote) => quote.platform === MarketPlatform.DEWU && quote.quoteType === MarketQuoteType.EXPECTED_INCOME), serviceNow)?.id === historyQuote.quote.id, "pure current quote selection works on persisted records");
  assert(quotesPage.items.some((quote) => quote.lifecycleStatus === "CURRENT"), "quote history identifies the current quote within each platform and type bucket");
  const afterCounts = await Promise.all([db.purchaseOrder.count(), db.inventoryItem.count(), db.saleOrder.count(), db.saleLine.count()]);
  assert(JSON.stringify(beforeCounts) === JSON.stringify(afterCounts), "M4-A2 quote operations do not modify purchase, inventory, sales, or sale lines");
  const marketSource = await Promise.all(["market-item-service.ts", "market-quote-service.ts", "market-query.ts", "market-rules.ts"].map((file) => fs.readFile(path.join(process.cwd(), "src", "server", "market", file), "utf8")));
  assert(!marketSource.join("\n").match(/estimatedProfit|maxPurchasePrice|recommendedPlatform|itemStatus:\s*["']SOLD["']/), "M4-A2 has no purchase calculation, platform recommendation, or SOLD write logic");

  // M4-A3: exercise the protected HTTP contract against an isolated Next server.
  await startTemporaryServer();
  const listResponse = await api("/api/market/items?page=1&pageSize=20");
  assert(listResponse.status === 200, "market item list is reachable through the protected HTTP API");
  assert(Array.isArray(listResponse.body.items) && listResponse.body.pagination.page === 1, "market item list returns items and stable pagination");
  assert("appliedFilters" in listResponse.body, "market item list returns applied filters");
  const unknownItemField = await apiJson("/api/market/items", "POST", { displayName: `${runId} invalid`, unexpected: true });
  assert(unknownItemField.status === 400 && unknownItemField.body.error?.code === "UNKNOWN_FIELD", "item create rejects unknown fields with a stable nested error");
  const clientOwnerAttempt = await apiJson("/api/market/items", "POST", { displayName: `${runId} invalid owner`, ownerId: otherOwnerId });
  assert(clientOwnerAttempt.status === 400 && clientOwnerAttempt.body.error?.code === "UNKNOWN_FIELD", "item create rejects client supplied ownerId");
  const createItemResponse = await apiJson("/api/market/items", "POST", {
    displayName: `  ${runId} HTTP  Market   Item  `,
    skuText: " 2c0 ",
    versionText: " first ",
    conditionText: " new ",
    packageVariant: " boxed ",
    accessoryVariant: " pump ",
    defaultTargetProfitAmount: "80.00",
    note: " HTTP fixture ",
  });
  assert(createItemResponse.status === 201, "market item HTTP create returns 201");
  const httpItemId = createItemResponse.body.marketItem?.id;
  assert(typeof httpItemId === "string", "market item HTTP create returns the new stable item id");
  created.itemIds.push(httpItemId);
  assert(createItemResponse.body.marketItem.displayName === `${runId} HTTP Market Item`, "item API delegates display-name normalization to the service");
  assert(createItemResponse.body.marketItem.normalizedSku === "2C0", "item API delegates SKU normalization to the service");
  assert(createItemResponse.body.marketItem.defaultTargetProfitAmount === "80.00", "item API serializes Decimal amounts as strings");
  const keywordList = await api(`/api/market/items?keyword=${encodeURIComponent("HTTP Market")}&page=1&pageSize=1`);
  assert(keywordList.status === 200 && keywordList.body.pagination.total >= 1 && keywordList.body.items.some((item) => item.id === httpItemId), "market item keyword filtering and pagination are stable");
  const invalidPage = await api("/api/market/items?page=0&pageSize=101");
  assert(invalidPage.status === 400 && invalidPage.body.error?.code === "VALIDATION_ERROR", "invalid market item pagination returns 400");
  const updateItemResponse = await apiJson(`/api/market/items/${httpItemId}`, "PATCH", { displayName: ` ${runId} HTTP Updated ` });
  assert(updateItemResponse.status === 200 && updateItemResponse.body.marketItem.normalizedName.includes("http updated"), "market item PATCH returns an updated normalized DTO");
  const quoteRecordedAt = new Date(Date.now() - 120_000).toISOString();
  const badQuoteField = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "100.00", recordedAt: quoteRecordedAt, sourceType: "MANUAL" });
  assert(badQuoteField.status === 400 && badQuoteField.body.error?.code === "UNKNOWN_FIELD", "quote create rejects service-controlled sourceType");
  const negativeQuote = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "-0.01", recordedAt: quoteRecordedAt });
  assert(negativeQuote.status === 400 && negativeQuote.body.error?.code === "VALIDATION_ERROR", "negative quote amount returns 400 before a service write");
  const invalidQuoteDate = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "100.00", recordedAt: "not-a-date" });
  assert(invalidQuoteDate.status === 400 && invalidQuoteDate.body.error?.code === "VALIDATION_ERROR", "invalid quote date returns 400");
  const firstQuoteResponse = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "300.00", recordedAt: quoteRecordedAt, note: "first HTTP quote" });
  assert(firstQuoteResponse.status === 201 && firstQuoteResponse.body.sourceType === "MANUAL", "quote HTTP create fixes the source to MANUAL");
  const firstHttpQuoteId = firstQuoteResponse.body.id;
  assert(firstQuoteResponse.body.lifecycleStatus === "UNCONFIRMED", "unconfirmed quote is not presented as current");
  const currentBeforeConfirm = await api(`/api/market/items/${httpItemId}`);
  const dewuExpectedBeforeConfirm = currentBeforeConfirm.body.currentQuotesByPlatform.find((entry) => entry.platform === "DEWU")?.quoteTypes.find((entry) => entry.quoteType === "EXPECTED_INCOME");
  assert(currentBeforeConfirm.status === 200 && dewuExpectedBeforeConfirm?.currentQuote === null, "unconfirmed EXPECTED_INCOME is excluded from current quotes");
  const confirmFirst = await api(`/api/market/quotes/${firstHttpQuoteId}/confirm`, { method: "POST" });
  assert(confirmFirst.status === 200 && confirmFirst.body.lifecycleStatus === "CURRENT" && typeof confirmFirst.body.confirmedAt === "string", "quote confirm returns a current, confirmed DTO");
  const newerRecordedAt = new Date(Date.now() - 60_000).toISOString();
  const secondQuoteResponse = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "310.00", recordedAt: newerRecordedAt, confirmImmediately: true });
  assert(secondQuoteResponse.status === 201 && secondQuoteResponse.body.lifecycleStatus === "CURRENT", "a newer immediately confirmed quote becomes current");
  const secondHttpQuoteId = secondQuoteResponse.body.id;
  const historyResponse = await api(`/api/market/items/${httpItemId}/quotes?platform=DEWU&quoteType=EXPECTED_INCOME&page=1&pageSize=20`);
  assert(historyResponse.status === 200 && historyResponse.body.total === 2 && historyResponse.body.items.every((quote) => typeof quote.amount === "string" && typeof quote.recordedAt === "string"), "quote history is filtered, paginated, and JSON-safe");
  const invalidateSecond = await apiJson(`/api/market/quotes/${secondHttpQuoteId}/invalidate`, "POST", { reason: "superseded HTTP quote" });
  assert(invalidateSecond.status === 200 && invalidateSecond.body.lifecycleStatus === "INVALIDATED", "quote invalidation returns an invalidated DTO");
  const detailAfterInvalidation = await api(`/api/market/items/${httpItemId}`);
  const dewuExpected = detailAfterInvalidation.body.currentQuotesByPlatform.find((entry) => entry.platform === "DEWU")?.quoteTypes.find((entry) => entry.quoteType === "EXPECTED_INCOME");
  assert(dewuExpected?.currentQuote?.id === firstHttpQuoteId, "invalidating the latest quote falls back to an older effective quote");
  const replacement = await apiJson(`/api/market/quotes/${firstHttpQuoteId}/replace`, "POST", { invalidationReason: "correct amount", platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "305.00", recordedAt: new Date(Date.now() - 30_000).toISOString(), confirmImmediately: true, note: "replacement quote" });
  assert(replacement.status === 201 && replacement.body.amount === "305.00" && replacement.body.lifecycleStatus === "CURRENT", "quote replacement invalidates history and creates a new current quote");
  const invalidatedOriginal = await api(`/api/market/items/${httpItemId}/quotes?lifecycleStatus=INVALIDATED&page=1&pageSize=20`);
  assert(invalidatedOriginal.status === 200 && invalidatedOriginal.body.items.some((quote) => quote.id === firstHttpQuoteId), "replaced original quote remains available as invalidated history");
  const deactivateResponse = await api(`/api/market/items/${httpItemId}/deactivate`, { method: "POST" });
  assert(deactivateResponse.status === 200 && deactivateResponse.body.marketItem.isActive === false, "market item deactivate is an explicit service action");
  const blockedQuote = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "XIANYU", quoteType: "EXPECTED_INCOME", amount: "200.00", recordedAt: quoteRecordedAt });
  assert(blockedQuote.status === 409 && blockedQuote.body.error?.code === "MARKET_ITEM_INACTIVE", "inactive market item cannot create a quote through the API");
  const reactivateResponse = await api(`/api/market/items/${httpItemId}/reactivate`, { method: "POST" });
  assert(reactivateResponse.status === 200 && reactivateResponse.body.marketItem.isActive === true, "market item reactivate restores quote creation eligibility");
  const afterReactivateQuote = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "XIANYU", quoteType: "LISTING_PRICE", amount: "220.00", recordedAt: quoteRecordedAt, confirmImmediately: true });
  assert(afterReactivateQuote.status === 201, "reactivated market item can create quote history again");
  const manualReferenceForDecision = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "OTHER", quoteType: "MANUAL_REFERENCE", amount: "199.00", recordedAt: quoteRecordedAt, confirmImmediately: true });
  assert(manualReferenceForDecision.status === 201 && manualReferenceForDecision.body.quoteType === "MANUAL_REFERENCE", "manual reference fixture is persisted through the HTTP API before decision verification");

  // M4-A6: decision API must stay read-only and use only current EXPECTED_INCOME quotes.
  const decisionPath = `/api/market/items/${httpItemId}/purchase-decision`;
  for (const field of ["ownerId", "expectedIncome", "quoteId", "expectedProfit", "maxPurchasePrice", "source", "unexpected"]) {
    const invalid = await apiJson(decisionPath, "POST", { proposedPurchasePrice: "210.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00", [field]: field === "ownerId" ? otherOwnerId : "x" });
    assert(invalid.status === 400 && invalid.body.error?.code === "UNKNOWN_FIELD", `purchase decision rejects client-controlled ${field}`);
  }
  for (const value of ["-1.00", "1.001", "1e3", "NaN", "Infinity", ""]) {
    const invalid = await apiJson(decisionPath, "POST", { proposedPurchasePrice: value, targetProfitAmount: "80.00", additionalCostAmount: "10.00", platform: "DEWU" });
    assert(invalid.status === 400 && invalid.body.error?.code === "VALIDATION_ERROR", `purchase decision rejects invalid money ${JSON.stringify(value)}`);
  }
  const invalidPlatform = await apiJson(decisionPath, "POST", { proposedPurchasePrice: "210.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00", platform: "INVALID" });
  assert(invalidPlatform.status === 400 && invalidPlatform.body.error?.code === "VALIDATION_ERROR", "purchase decision rejects an invalid platform");
  const decisionBefore = {
    item: await db.marketItem.findUnique({ where: { id: httpItemId } }),
    quotes: await db.marketQuote.findMany({ where: { marketItemId: httpItemId }, orderBy: { id: "asc" } }),
    counts: await Promise.all([db.purchaseOrder.count(), db.inventoryItem.count(), db.saleOrder.count(), db.saleActionLog.count()]),
  };
  const dewuDecision = await apiJson(decisionPath, "POST", { proposedPurchasePrice: "215.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00", platform: "DEWU" });
  assert(dewuDecision.status === 200 && dewuDecision.body.results.length === 1 && dewuDecision.body.results[0].expectedIncome === "305.00", "single-platform decision uses the current DEWU EXPECTED_INCOME quote");
  assert(dewuDecision.body.results[0].expectedProfit === "80.00" && dewuDecision.body.results[0].profitGap === "0.00" && dewuDecision.body.results[0].maxPurchasePrice === "215.00" && dewuDecision.body.results[0].meetsTarget === true, "purchase price equal to maximum meets the target with zero gap");
  const negativeDecision = await apiJson(decisionPath, "POST", { proposedPurchasePrice: "0.00", targetProfitAmount: "400.00", additionalCostAmount: "10.00", platform: "DEWU" });
  assert(negativeDecision.body.results[0].maxPurchasePrice === "-105.00" && negativeDecision.body.results[0].meetsTarget === false, "negative maximum purchase price remains visible and is not clamped");
  const multiDecision = await apiJson(decisionPath, "POST", { proposedPurchasePrice: "100.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00" });
  assert(multiDecision.status === 200 && multiDecision.body.results.length === 4 && multiDecision.body.comparablePlatformOrder.every((platform) => platform === "DEWU"), "multi-platform decision excludes listing-only and manual-reference-only platforms from comparison");
  const xianyu = multiDecision.body.results.find((result) => result.platform === "XIANYU");
  const other = multiDecision.body.results.find((result) => result.platform === "OTHER");
  assert(xianyu?.calculationStatus === "MISSING_FEE_RULE" && other?.calculationStatus === "NO_EXPECTED_INCOME", `LISTING_PRICE reports missing fee rules while MANUAL_REFERENCE never substitutes for EXPECTED_INCOME (XIANYU=${xianyu?.calculationStatus ?? "missing"}, OTHER=${other?.calculationStatus ?? "missing"})`);
  const concurrentDecisions = await Promise.all(Array.from({ length: 3 }, () => apiJson(decisionPath, "POST", { proposedPurchasePrice: "100.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00" })));
  assert(concurrentDecisions.every((result) => result.status === 200 && JSON.stringify(result.body.results) === JSON.stringify(multiDecision.body.results)), "concurrent read-only purchase decisions return stable results");
  const decisionAfter = {
    item: await db.marketItem.findUnique({ where: { id: httpItemId } }),
    quotes: await db.marketQuote.findMany({ where: { marketItemId: httpItemId }, orderBy: { id: "asc" } }),
    counts: await Promise.all([db.purchaseOrder.count(), db.inventoryItem.count(), db.saleOrder.count(), db.saleActionLog.count()]),
  };
  assert(JSON.stringify(decisionBefore.item) === JSON.stringify(decisionAfter.item) && JSON.stringify(decisionBefore.quotes) === JSON.stringify(decisionAfter.quotes) && JSON.stringify(decisionBefore.counts) === JSON.stringify(decisionAfter.counts), "purchase decisions do not create or update market, purchase, inventory, sales, or action-log records");
  const deactivateForDecision = await api(`/api/market/items/${httpItemId}/deactivate`, { method: "POST" });
  assert(deactivateForDecision.status === 200, "decision fixture can be explicitly deactivated");
  const inactiveDecision = await apiJson(decisionPath, "POST", { proposedPurchasePrice: "100.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00" });
  assert(inactiveDecision.status === 200 && inactiveDecision.body.results.every((result) => result.calculationStatus === "UNAVAILABLE" && result.unavailableReason === "MARKET_ITEM_INACTIVE"), "inactive MarketItem returns HTTP 200 with UNAVAILABLE results");
  const reactivateForDecision = await api(`/api/market/items/${httpItemId}/reactivate`, { method: "POST" });
  assert(reactivateForDecision.status === 200, "decision fixture can be reactivated without altering quote history");
  const refreshedExpectedIncome = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "330.00", recordedAt: new Date(Date.now() - 5_000).toISOString(), confirmImmediately: true });
  assert(refreshedExpectedIncome.status === 201, "newer EXPECTED_INCOME can be written through the normal quote API");
  const refreshedDecision = await apiJson(decisionPath, "POST", { proposedPurchasePrice: "100.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00", platform: "DEWU" });
  assert(refreshedDecision.status === 200 && refreshedDecision.body.results[0].expectedIncome === "330.00", "a subsequent decision request reads the newest current quote without caching an older value");

  const createDecisionLifecycleItem = async (suffix) => {
    const response = await apiJson("/api/market/items", "POST", { displayName: `${runId} decision ${suffix}` });
    assert(response.status === 201 && typeof response.body.marketItem?.id === "string", `decision lifecycle fixture ${suffix} is created through the HTTP API`);
    created.itemIds.push(response.body.marketItem.id);
    return response.body.marketItem.id;
  };
  const lifecycleDecisionPayload = { proposedPurchasePrice: "100.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00", platform: "DEWU" };
  const noQuoteItemId = await createDecisionLifecycleItem("no quote");
  const noQuoteDecision = await apiJson(`/api/market/items/${noQuoteItemId}/purchase-decision`, "POST", lifecycleDecisionPayload);
  assert(noQuoteDecision.status === 200 && noQuoteDecision.body.results[0].calculationStatus === "NO_EXPECTED_INCOME", "a market item without quotes is unavailable for purchase calculation");
  const unconfirmedItemId = await createDecisionLifecycleItem("unconfirmed");
  const unconfirmedQuote = await apiJson(`/api/market/items/${unconfirmedItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "200.00", recordedAt: quoteRecordedAt });
  assert(unconfirmedQuote.status === 201, "unconfirmed EXPECTED_INCOME lifecycle fixture is created through the HTTP API");
  const unconfirmedDecision = await apiJson(`/api/market/items/${unconfirmedItemId}/purchase-decision`, "POST", lifecycleDecisionPayload);
  assert(unconfirmedDecision.status === 200 && unconfirmedDecision.body.results[0].calculationStatus === "NO_EXPECTED_INCOME", "unconfirmed EXPECTED_INCOME does not participate in a purchase decision");
  const invalidatedItemId = await createDecisionLifecycleItem("invalidated");
  const invalidatedQuote = await apiJson(`/api/market/items/${invalidatedItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "200.00", recordedAt: quoteRecordedAt, confirmImmediately: true });
  assert(invalidatedQuote.status === 201, "confirmed EXPECTED_INCOME invalidation fixture is created through the HTTP API");
  const invalidatedFixture = await apiJson(`/api/market/quotes/${invalidatedQuote.body.id}/invalidate`, "POST", { reason: "decision lifecycle invalidation" });
  assert(invalidatedFixture.status === 200, "decision lifecycle quote can be invalidated through the HTTP API");
  const invalidatedDecision = await apiJson(`/api/market/items/${invalidatedItemId}/purchase-decision`, "POST", lifecycleDecisionPayload);
  assert(invalidatedDecision.status === 200 && invalidatedDecision.body.results[0].calculationStatus === "NO_EXPECTED_INCOME", "invalidated EXPECTED_INCOME does not participate in a purchase decision");
  const expiredItemId = await createDecisionLifecycleItem("expired");
  const expiredRecordedAt = new Date(Date.now() - 120_000).toISOString();
  const expiredQuote = await apiJson(`/api/market/items/${expiredItemId}/quotes`, "POST", { platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "200.00", recordedAt: expiredRecordedAt, expiresAt: new Date(Date.now() - 60_000).toISOString(), confirmImmediately: true });
  assert(expiredQuote.status === 201, "expired EXPECTED_INCOME fixture is accepted as historical quote data");
  const expiredDecision = await apiJson(`/api/market/items/${expiredItemId}/purchase-decision`, "POST", lifecycleDecisionPayload);
  assert(expiredDecision.status === 200 && expiredDecision.body.results[0].calculationStatus === "NO_EXPECTED_INCOME", "expired EXPECTED_INCOME does not participate in a purchase decision");
  const futureItemId = await createDecisionLifecycleItem("future");
  await db.marketQuote.create({ data: { ownerId, marketItemId: futureItemId, platform: MarketPlatform.DEWU, quoteType: MarketQuoteType.EXPECTED_INCOME, amount: new Prisma.Decimal("200.00"), recordedAt: new Date(Date.now() + 60_000), confirmedAt: new Date(), sourceType: MarketQuoteSourceType.MANUAL } });
  const futureDecision = await apiJson(`/api/market/items/${futureItemId}/purchase-decision`, "POST", lifecycleDecisionPayload);
  assert(futureDecision.status === 200 && futureDecision.body.results[0].calculationStatus === "NO_EXPECTED_INCOME", "a future-dated EXPECTED_INCOME never participates before its recorded time");

  const otherOwnerItem = await marketItemService.createMarketItem(otherOwnerId, { displayName: `${runId} HTTP private` });
  created.itemIds.push(otherOwnerItem.marketItem.id);
  const crossOwnerDetail = await api(`/api/market/items/${otherOwnerItem.marketItem.id}`);
  assert(crossOwnerDetail.status === 404 && crossOwnerDetail.body.error?.code === "MARKET_ITEM_NOT_FOUND", "API hides cross-owner market items with NotFound semantics");
  const crossOwnerQuotes = await api(`/api/market/items/${otherOwnerItem.marketItem.id}/quotes`);
  assert(crossOwnerQuotes.status === 404 && crossOwnerQuotes.body.error?.code === "MARKET_ITEM_NOT_FOUND", "API hides cross-owner quote history with NotFound semantics");
  const crossOwnerDecision = await apiJson(`/api/market/items/${otherOwnerItem.marketItem.id}/purchase-decision`, "POST", { proposedPurchasePrice: "100.00", targetProfitAmount: "80.00", additionalCostAmount: "10.00" });
  assert(crossOwnerDecision.status === 404 && crossOwnerDecision.body.error?.code === "MARKET_ITEM_NOT_FOUND", "purchase decision hides cross-owner MarketItems with the same NotFound semantics");

  const concurrentConfirmQuote = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "OTHER", quoteType: "MANUAL_REFERENCE", amount: "100.00", recordedAt: quoteRecordedAt });
  const concurrentConfirmResults = await Promise.all([api(`/api/market/quotes/${concurrentConfirmQuote.body.id}/confirm`, { method: "POST" }), api(`/api/market/quotes/${concurrentConfirmQuote.body.id}/confirm`, { method: "POST" })]);
  assert(concurrentConfirmResults.every((result) => result.status === 200 && typeof result.body.confirmedAt === "string"), "concurrent quote confirmation is idempotent through the HTTP API");
  const concurrentInvalidateQuote = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "OTHER", quoteType: "LISTING_PRICE", amount: "101.00", recordedAt: quoteRecordedAt });
  const concurrentInvalidations = await Promise.all([apiJson(`/api/market/quotes/${concurrentInvalidateQuote.body.id}/invalidate`, "POST", { reason: "same retry reason" }), apiJson(`/api/market/quotes/${concurrentInvalidateQuote.body.id}/invalidate`, "POST", { reason: "same retry reason" })]);
  assert(concurrentInvalidations.every((result) => result.status === 200 && result.body.invalidationReason === "same retry reason"), "concurrent same-reason invalidation is idempotent through the HTTP API");
  const concurrentReplacementQuote = await apiJson(`/api/market/items/${httpItemId}/quotes`, "POST", { platform: "NINETY_FIVE", quoteType: "MANUAL_REFERENCE", amount: "102.00", recordedAt: quoteRecordedAt });
  const concurrentReplacements = await Promise.all([
    apiJson(`/api/market/quotes/${concurrentReplacementQuote.body.id}/replace`, "POST", { invalidationReason: "parallel A", platform: "NINETY_FIVE", quoteType: "MANUAL_REFERENCE", amount: "103.00", recordedAt: new Date(Date.now() - 20_000).toISOString() }),
    apiJson(`/api/market/quotes/${concurrentReplacementQuote.body.id}/replace`, "POST", { invalidationReason: "parallel B", platform: "NINETY_FIVE", quoteType: "MANUAL_REFERENCE", amount: "104.00", recordedAt: new Date(Date.now() - 10_000).toISOString() }),
  ]);
  assert(concurrentReplacements.filter((result) => result.status === 201).length === 1 && concurrentReplacements.filter((result) => result.status === 409).length === 1, `concurrent quote replacement permits exactly one replacement and returns a stable conflict (${concurrentReplacements.map((result) => `${result.status}:${result.body.error?.code ?? "OK"}`).join(", ")})`);
  const marketRouteFiles = [
    "src/app/api/market/items/route.ts",
    "src/app/api/market/items/[marketItemId]/route.ts",
    "src/app/api/market/items/[marketItemId]/deactivate/route.ts",
    "src/app/api/market/items/[marketItemId]/reactivate/route.ts",
    "src/app/api/market/items/[marketItemId]/quotes/route.ts",
    "src/app/api/market/quotes/[quoteId]/confirm/route.ts",
    "src/app/api/market/quotes/[quoteId]/invalidate/route.ts",
    "src/app/api/market/quotes/[quoteId]/replace/route.ts",
  ];
  const marketRouteSource = await Promise.all(marketRouteFiles.map((file) => fs.readFile(path.join(process.cwd(), file), "utf8")));
  assert(!marketRouteSource.join("\n").match(/\bdb\.|\bprisma\.|itemStatus\s*:\s*["']SOLD["']|SalesService\.(confirm|cancel)|applyShipmentLineAction/), "market HTTP routes delegate through market services without direct inventory, SOLD, sales, or shipment writes");
  assert(!marketRouteSource.join("\n").match(/estimatedProfit|maxPurchasePrice|recommendedPlatform/), "market HTTP routes do not introduce decision calculation or platform recommendation fields");
  const marketUiFiles = [
    "src/app/market/page.tsx",
    "src/app/market/[marketItemId]/page.tsx",
    "src/components/market/market-client.ts",
    "src/components/market/market-display.tsx",
    "src/components/market/market-item-form.tsx",
    "src/components/market/market-list.tsx",
    "src/components/market/market-detail.tsx",
  ];
  for (const file of marketUiFiles) assert(await pathExists(file), `${file} exists for the market workbench`);
  const [marketPageSource, marketDetailPageSource, marketClientSource, marketDisplaySource, marketFormSource, marketListSource, marketDetailSource, appShellSource] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/app/market/page.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/market/[marketItemId]/page.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/market/market-client.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/market/market-display.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/market/market-item-form.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/market/market-list.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/market/market-detail.tsx"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/components/layout/app-shell.tsx"), "utf8"),
  ]);
  assert(marketPageSource.includes("MarketList") && marketDetailPageSource.includes("MarketDetail"), "market list and detail routes mount the client workbench components");
  assert(appShellSource.includes('label: "行情管理"') && appShellSource.includes('href: "/market"'), "application navigation exposes the Chinese market management entry");
  assert(marketClientSource.includes("body?.error") && marketClientSource.includes("fieldErrors"), "market client preserves the frozen nested API error contract");
  assert(marketClientSource.includes('method: "POST" | "PATCH"'), "market client permits only the existing market write verbs");
  assert(marketDisplaySource.includes('DEWU: "得物"') && marketDisplaySource.includes('NINETY_FIVE: "95分"') && marketDisplaySource.includes('XIANYU: "闲鱼"'), "market platform values have Chinese display labels");
  assert(marketDisplaySource.includes('EXPECTED_INCOME: "预计收入"') && marketDisplaySource.includes('LISTING_PRICE: "平台展示价格"') && marketDisplaySource.includes('MANUAL_REFERENCE: "人工参考价"'), "market quote meanings have Chinese display labels");
  assert(marketDisplaySource.includes('CURRENT: "当前有效"') && marketDisplaySource.includes('INVALIDATED: "已失效"') && marketDisplaySource.includes('SUPERSEDED: "已有更新报价"'), "market lifecycle values have Chinese display labels");
  assert(marketListSource.includes("useSearchParams") && marketListSource.includes("router.replace"), "market list keeps filters and pagination in the URL");
  for (const filter of ["keyword", "lifecycleStatus", "hasCurrentQuote", "platform", "page", "pageSize"]) assert(marketListSource.includes(filter), `market list exposes the ${filter} query filter`);
  assert(marketListSource.includes('md:hidden') && marketListSource.includes('md:block'), "market list has mobile cards and a desktop table");
  assert(marketListSource.includes("暂无当前有效行情，查看详情了解原因"), "market list directs no-current-quote explanations to the detail API view");
  assert(marketListSource.includes("/api/market/items?") && !marketListSource.match(/\bdb\.|\bprisma\.|itemStatus\s*:\s*["']SOLD["']/), "market list reads only the frozen market item API without inventory writes");
  assert(marketFormSource.includes('"/api/market/items"') && marketFormSource.includes('"PATCH"'), "market item form creates and edits only through existing item APIs");
  const marketFormPayloadSource = marketFormSource.slice(marketFormSource.indexOf("const payload ="), marketFormSource.indexOf("try {", marketFormSource.indexOf("const payload =")));
  assert(!marketFormPayloadSource.match(/ownerId|normalizedName|normalizedSku|\bdb\.|\bprisma\./), "market item form does not submit service-controlled owner or normalization fields");
  assert(marketDetailSource.includes("currentQuotesByPlatform") && marketDetailSource.includes("availabilityReason"), "market detail renders API-derived current quotes and availability reasons");
  assert(marketDetailSource.includes("标准化名称（服务端）") && marketDetailSource.includes("标准化 SKU（服务端）"), "market detail shows service-returned normalization facts");
  assert(marketDetailSource.includes("/confirm") && marketDetailSource.includes("/invalidate") && marketDetailSource.includes("/replace"), "market detail uses the official quote lifecycle endpoints");
  assert(marketDetailSource.includes("availableActions") && marketDetailSource.includes("确认报价") && marketDetailSource.includes("替代修正"), "market detail gates quote actions using API availableActions");
  assert(marketDetailSource.includes("停用商品") && marketDetailSource.includes("重新启用") && marketDetailSource.includes('"deactivate"') && marketDetailSource.includes('"reactivate"'), "market detail uses explicit item lifecycle endpoints");
  assert(marketDetailSource.includes("历史记录不会被覆盖或删除") && marketDetailSource.includes("替代修正会保留原报价"), "market detail communicates immutable quote history and correction behavior");
  assert(marketDetailSource.includes("marketLabel") && marketDetailSource.includes("MarketLifecycleBadge"), "market detail translates platform, type, and lifecycle display values");
  assert(!marketDetailSource.match(/\bdb\.|\bprisma\.|itemStatus\s*:\s*["']SOLD["']|SalesService\.(confirm|cancel)|applyShipmentLineAction/), "market detail contains no direct Prisma, inventory SOLD, sales, or shipment state write path");
  assert(![marketPageSource, marketDetailPageSource, marketClientSource, marketDisplaySource, marketFormSource, marketListSource, marketDetailSource].join("\n").match(/estimatedProfit|maxPurchasePrice|recommendedPlatform/), "M4-A4 UI does not introduce decision calculation or platform recommendation fields");
  const [decisionRulesSource, decisionServiceSource, decisionRouteSource] = await Promise.all([
    fs.readFile(path.join(process.cwd(), "src/server/market/market-decision-rules.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/server/market/market-decision-service.ts"), "utf8"),
    fs.readFile(path.join(process.cwd(), "src/app/api/market/items/[marketItemId]/purchase-decision/route.ts"), "utf8"),
  ]);
  assert(decisionRulesSource.includes("calculateMaxPurchasePrice") && decisionRulesSource.includes("comparePlatformDecisionResults") && !decisionRulesSource.match(/Prisma|Date\.now|process\.env/), "purchase decision rules stay pure and Decimal-operation based");
  assert(decisionServiceSource.includes("MarketQuoteType.EXPECTED_INCOME") && decisionServiceSource.includes("marketQuery.getMarketItemDetail") && decisionServiceSource.includes("MISSING_FEE_RULE"), "decision service reuses current expected-income quotes without listing-price fallback");
  assert(!decisionServiceSource.match(/\.create\(|\.update\(|\.delete\(|PurchaseOrder|InventoryItem|SaleOrder|itemStatus\s*:/), "decision service has no purchase, inventory, sales, or SOLD write path");
  assert(decisionRouteSource.includes("marketPurchaseDecisionSchema") && decisionRouteSource.includes("calculatePurchaseDecision") && !decisionRouteSource.match(/GET|PATCH|DELETE/), "purchase decision API is one strict read-only POST contract");
  console.log(`verify:m4-market passed ${checks} checks`);
} finally {
  const cleanupErrors = [];
  try {
    await stopTemporaryServer();
    assert(temporaryServer === null && temporaryPort === null, "temporary HTTP server is stopped and its verification port is released");
  } catch (error) {
    cleanupErrors.push(error);
  }
  try {
    if (created.itemIds.length) await db.marketQuote.deleteMany({ where: { marketItemId: { in: created.itemIds } } });
    if (created.itemIds.length) await db.marketItem.deleteMany({ where: { id: { in: created.itemIds } } });
    if (created.ownerIds.length) await db.user.deleteMany({ where: { id: { in: created.ownerIds } } });
    const remainingQuotes = created.itemIds.length ? await db.marketQuote.count({ where: { marketItemId: { in: created.itemIds } } }) : 0;
    const remainingItems = created.itemIds.length ? await db.marketItem.count({ where: { id: { in: created.itemIds } } }) : 0;
    const remainingOwners = created.ownerIds.length ? await db.user.count({ where: { id: { in: created.ownerIds } } }) : 0;
    if (remainingQuotes !== 0 || remainingItems !== 0 || remainingOwners !== 0) throw new Error("verify:m4-market cleanup left fixture data behind");
  } catch (error) {
    cleanupErrors.push(error);
  }
  if (cleanupErrors.length) {
    for (const error of cleanupErrors) {
      console.error("verify:m4-market cleanup failed", error);
    }
    process.exitCode = 1;
  }
  try {
    // This keeps the process alive until all final cleanup errors are reported.
  } catch (error) {
    console.error("verify:m4-market cleanup failed", error);
    process.exitCode = 1;
  } finally {
    await db.$disconnect();
  }
}
