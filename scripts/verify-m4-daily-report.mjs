import "dotenv/config";
import { createHmac, randomUUID } from "node:crypto";
import { once } from "node:events";
import fs from "node:fs/promises";
import http from "node:http";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { promisify } from "node:util";
import { db } from "../src/server/db.ts";
import { isEmptyDailyBusinessReport } from "../src/server/notifications/daily-business-report-delivery-service.ts";

let baseUrl = "";
const runId = `M4D-${randomUUID().slice(0, 8)}`;
const checks = [];
const assert = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
let accessCookie = null;
let verificationApp = null;
let noConfigApp = null;
let mockServer = null;
let mockPort = null;
let mockMode = "success";
let mockRequests = [];
const execFileAsync = promisify(execFile);

function freePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close((error) => error ? reject(error) : resolve(address.port));
    });
  });
}

async function waitForApp(url, child) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error("temporary daily report app exited before becoming ready");
    try {
      const response = await fetch(`${url}/access`, { redirect: "manual" });
      if (response.status === 200) return;
    } catch {}
    await new Promise((resolve) => setTimeout(resolve, 400));
  }
  throw new Error("temporary daily report app did not become ready");
}

async function startTemporaryApp(extraEnv) {
  const port = await freePort();
  const logPath = path.join(os.tmpdir(), `resale-erp-m4-daily-${runId}-${port}.log`);
  const log = await fs.open(logPath, "w");
  // Use the production build so this isolated verifier can run while a user
  // keeps their own `next dev` process active on port 3000.
  const child = spawn(process.execPath, [path.join(process.cwd(), "node_modules", "next", "dist", "bin", "next"), "start", "--port", String(port)], {
    cwd: process.cwd(),
    env: { ...process.env, APP_BASE_URL: "", ...extraEnv },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  child.stdout.on("data", (chunk) => { void log.write(chunk); });
  child.stderr.on("data", (chunk) => { void log.write(chunk); });
  const app = { child, log, logPath, port, url: `http://127.0.0.1:${port}` };
  await waitForApp(app.url, child);
  return app;
}

async function stopTemporaryApp(app) {
  if (!app) return;
  if (app.child.exitCode === null) {
    app.child.kill();
    await Promise.race([once(app.child, "exit"), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
  if (process.platform === "win32") {
    await execFileAsync("taskkill", ["/PID", String(app.child.pid), "/T", "/F"]).catch(() => undefined);
    await Promise.race([once(app.child, "exit"), new Promise((resolve) => setTimeout(resolve, 10_000))]);
  }
  await app.log.close();
  await fs.rm(app.logPath, { force: true });
  let released = false;
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const probe = net.createConnection({ host: "127.0.0.1", port: app.port });
    released = await new Promise((resolve) => {
      probe.once("connect", () => { probe.destroy(); resolve(false); });
      probe.once("error", () => resolve(true));
      setTimeout(() => { probe.destroy(); resolve(true); }, 500);
    });
    if (released) break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  assert(released, `temporary application port ${app.port} is released`);
}

async function startMockWebhook() {
  const port = await freePort();
  mockServer = http.createServer((request, response) => {
    const chunks = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      mockRequests.push({ method: request.method, headers: request.headers, body: Buffer.concat(chunks).toString("utf8") });
      if (mockMode === "timeout") return;
      if (mockMode === "drop") return request.socket.destroy();
      if (mockMode === "http400") return response.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ code: 19022, msg: "rejected" }));
      if (mockMode === "http500") return response.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ code: 999, msg: "failure" }));
      if (mockMode === "business") return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ code: 19021, msg: "rejected" }));
      if (mockMode === "nonjson") return response.writeHead(200, { "content-type": "text/plain" }).end("not-json");
      return response.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ code: 0 }));
    });
  });
  mockServer.listen(port, "127.0.0.1");
  await once(mockServer, "listening");
  mockPort = port;
}

async function stopMockWebhook() {
  if (!mockServer) return;
  await new Promise((resolve, reject) => mockServer.close((error) => error ? reject(error) : resolve()));
  const port = mockPort;
  mockServer = null;
  mockPort = null;
  const probe = net.createConnection({ host: "127.0.0.1", port });
  await new Promise((resolve) => {
    probe.once("connect", () => { probe.destroy(); resolve(false); });
    probe.once("error", () => resolve(true));
    setTimeout(() => { probe.destroy(); resolve(true); }, 1_000);
  }).then((released) => assert(released, `mock webhook port ${port} is released`));
}

async function establishSession(url) {
  const access = await fetch(`${url}/api/access`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ password: process.env.APP_PASSWORD }),
  });
  const cookie = access.headers.get("set-cookie")?.split(";")[0] ?? null;
  assert(access.ok && cookie, "temporary HTTP verification establishes an access-password session");
  return cookie;
}

async function getReadOnlyBoundarySnapshot() {
  const ownerId = "default-user";
  const [
    marketItems,
    marketQuotes,
    purchaseOrders,
    inventoryItems,
    saleOrders,
    purchaseAfterSaleCases,
    saleAfterSaleCases,
    platformReturnInspections,
    purchaseRefundRecords,
    saleRefundRecords,
    saleActionLogs,
    purchaseAfterSaleActionLogs,
    saleAfterSaleActionLogs,
    platformReturnActionLogs,
  ] = await Promise.all([
    db.marketItem.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.marketQuote.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.purchaseOrder.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.inventoryItem.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.saleOrder.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.purchaseAfterSaleCase.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.saleAfterSaleCase.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.platformReturnInspection.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { updatedAt: true } }),
    db.purchaseRefundRecord.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { createdAt: true } }),
    db.saleRefundRecord.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { createdAt: true } }),
    db.saleActionLog.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { createdAt: true } }),
    db.purchaseAfterSaleActionLog.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { createdAt: true } }),
    db.saleAfterSaleActionLog.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { createdAt: true } }),
    db.platformReturnActionLog.aggregate({ where: { ownerId }, _count: { _all: true }, _max: { createdAt: true } }),
  ]);

  return JSON.stringify({
    marketItems,
    marketQuotes,
    purchaseOrders,
    inventoryItems,
    saleOrders,
    purchaseAfterSaleCases,
    saleAfterSaleCases,
    platformReturnInspections,
    purchaseRefundRecords,
    saleRefundRecords,
    saleActionLogs,
    purchaseAfterSaleActionLogs,
    saleAfterSaleActionLogs,
    platformReturnActionLogs,
  });
}

async function request(path, options = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: { ...(options.headers ?? {}), ...(accessCookie ? { cookie: accessCookie } : {}) },
  });
  return { response, body: await response.json().catch(() => null) };
}

let itemId;
const quoteIds = [];
const deliveryIds = [];
const reportDateSeed = Number.parseInt(runId.slice(-6), 16) % 350;
const reportDates = Array.from({ length: 12 }, (_, index) => {
  const date = new Date(Date.UTC(2099, 0, 1 + reportDateSeed + index));
  return date.toISOString().slice(0, 10);
});

async function trackDelivery(reportDate) {
  const delivery = await db.dailyBusinessReportDelivery.findUnique({
    where: {
      ownerId_reportDate_channel: {
        ownerId: "default-user",
        reportDate: new Date(`${reportDate}T00:00:00.000Z`),
        channel: "FEISHU",
      },
    },
  });
  if (delivery && !deliveryIds.includes(delivery.id)) deliveryIds.push(delivery.id);
  return delivery;
}

async function createReportFixtureQuote(marketItemId, reportDate) {
  const at = new Date(`${reportDate}T12:00:00.000Z`);
  const quote = await db.marketQuote.create({
    data: {
      ownerId: "default-user",
      marketItemId,
      platform: "DEWU",
      quoteType: "MANUAL_REFERENCE",
      amount: "100.00",
      recordedAt: at,
      sourceType: "MANUAL",
      createdAt: at,
      updatedAt: at,
    },
  });
  quoteIds.push(quote.id);
  return quote;
}
try {
  const fixtureItem = await db.marketItem.create({ data: { ownerId: "default-user", displayName: `${runId} quote`, normalizedName: `${runId} quote`.toLowerCase(), isActive: true } });
  itemId = fixtureItem.id;
  await createReportFixtureQuote(itemId, reportDates[0]);
  noConfigApp = await startTemporaryApp({ FEISHU_DAILY_REPORT_WEBHOOK_URL: "", FEISHU_DAILY_REPORT_SECRET: "" });
  const noConfigCookie = await establishSession(noConfigApp.url);
  const noConfigResponse = await fetch(`${noConfigApp.url}/api/reports/daily-business/send-feishu`, {
    method: "POST",
    headers: { "content-type": "application/json", cookie: noConfigCookie },
    body: JSON.stringify({ date: reportDates[0], timezone: "Asia/Shanghai" }),
  });
  const noConfigBody = await noConfigResponse.json();
  const noConfigDelivery = await trackDelivery(reportDates[0]);
  assert(noConfigResponse.status === 503 && noConfigBody.code === "FEISHU_NOT_CONFIGURED", `unconfigured Feishu delivery returns the stable safe configuration error (got ${noConfigResponse.status} ${JSON.stringify(noConfigBody)})`);
  assert(noConfigDelivery?.status === "FAILED" && noConfigDelivery.lastErrorCode === "FEISHU_NOT_CONFIGURED", "missing configuration is recorded as a non-retryable failed delivery");
  await stopTemporaryApp(noConfigApp);
  noConfigApp = null;

  await startMockWebhook();
  verificationApp = await startTemporaryApp({
    FEISHU_DAILY_REPORT_WEBHOOK_URL: `http://127.0.0.1:${mockPort}/hook`,
    FEISHU_DAILY_REPORT_SECRET: "m4-daily-verification-secret",
    FEISHU_DAILY_REPORT_TEST_ALLOW_LOCAL_WEBHOOK: "1",
  });
  baseUrl = verificationApp.url;
  accessCookie = await establishSession(baseUrl);
  const pageResponse = await fetch(`${baseUrl}/reports/daily`, { headers: { cookie: accessCookie } });
  const pageHtml = await pageResponse.text();
  assert(pageResponse.status === 200 && pageHtml.includes("每日经营报告"), "daily report page route is accessible behind access protection");
  const empty = await request("/api/reports/daily-business?date=2026-07-15&timezone=Asia%2FShanghai");
  assert(empty.response.status === 200, "daily report API returns 200");
  assert(empty.body.timezone === "Asia/Shanghai" && empty.body.periodStart && empty.body.periodEnd && empty.body.generatedAt, "DTO exposes explicit timezone and period instants");
  assert(empty.body.reportDate === "2026-07-15", "explicit report date is preserved");
  assert(Date.parse(empty.body.periodStart) < Date.parse(empty.body.periodEnd), "period has increasing ISO instants");
  assert(Date.parse(empty.body.periodEnd) - Date.parse(empty.body.periodStart) === 86_400_000, "period uses one Shanghai calendar day");
  assert(Date.parse(empty.body.generatedAt) > 0, "generatedAt is an ISO instant");
  assert(typeof empty.body.sales.grossSalesAmount === "string" && /^-?\d+\.\d{2}$/.test(empty.body.sales.grossSalesAmount), "money values are JSON-safe two-decimal strings");
  assert(Object.prototype.hasOwnProperty.call(empty.body.sales, "actualRefundAmount") && Object.prototype.hasOwnProperty.call(empty.body.sales, "netReceivedAmount"), "sales section exposes refund and net received metrics");
  assert(Object.prototype.hasOwnProperty.call(empty.body.purchases, "purchaseRefundAmount"), "purchase section keeps purchase refunds separate");
  assert(Object.prototype.hasOwnProperty.call(empty.body.inventory, "totalUnsoldAssetCost"), "inventory section exposes current asset cost");
  assert(Array.isArray(empty.body.todos.items) && Array.isArray(empty.body.risks.items), "DTO returns bounded todo and risk sections");
  assert(Number.isInteger(empty.body.todos.totalCount) && Number.isInteger(empty.body.risks.totalCount), "todo and risk counts are integers");
  assert(empty.body.todos.priorityCounts && empty.body.risks.severityCounts, "todo and risk priority summaries are present");
  assert(empty.body.market && Number.isInteger(empty.body.market.activeMarketItemCount), "market section exposes active item count");
  for (const key of ["reportDate", "timezone", "periodStart", "periodEnd", "generatedAt", "sales", "purchases", "inventory", "inventoryExpiry", "todos", "risks", "market"]) {
    assert(Object.prototype.hasOwnProperty.call(empty.body, key), `DTO includes top-level field ${key}`);
  }
  for (const key of ["confirmedOrderCount", "confirmedItemCount", "grossSalesAmount", "expectedIncomeAmount", "actualReceivedAmount", "actualRefundAmount", "netReceivedAmount", "originalProfitAmount", "afterSaleNetProfitAmount"]) {
    assert(Object.prototype.hasOwnProperty.call(empty.body.sales, key), `sales DTO includes ${key}`);
  }
  for (const key of ["createdOrderCount", "arrivedOrderCount", "inspectedItemCount", "createdInventoryItemCount", "purchaseRefundAmount"]) {
    assert(Object.prototype.hasOwnProperty.call(empty.body.purchases, key), `purchases DTO includes ${key}`);
  }
  for (const key of ["stockedCount", "stockedAssetCost", "platformProcessingCount", "platformReturningCount", "platformReturnedPendingCount", "pendingDecisionCount", "problemCount", "problemAssetCost", "totalUnsoldAssetCount", "totalUnsoldAssetCost"]) {
    assert(Object.prototype.hasOwnProperty.call(empty.body.inventory, key), `inventory DTO includes ${key}`);
  }
  for (const key of ["activeMarketItemCount", "withCurrentExpectedIncomeCount", "withoutCurrentExpectedIncomeCount", "quotesCreatedInPeriodCount", "quotesConfirmedInPeriodCount", "expiringQuoteCount", "expiredQuoteCount"]) {
    assert(Object.prototype.hasOwnProperty.call(empty.body.market, key), `market DTO includes ${key}`);
  }
  for (const key of ["EXPIRED", "WITHIN_30_DAYS", "WITHIN_90_DAYS", "WITHIN_180_DAYS"]) {
    assert(Number.isInteger(empty.body.inventoryExpiry.counts[key]) && empty.body.inventoryExpiry.counts[key] >= 0, `inventory expiry DTO includes non-negative ${key} count`);
  }
  assert(typeof empty.body.inventoryExpiry.businessDate === "string" && /^\d{4}-\d{2}-\d{2}$/.test(empty.body.inventoryExpiry.businessDate), "inventory expiry DTO exposes the Shanghai business date");
  assert(Array.isArray(empty.body.inventoryExpiry.samples) && empty.body.inventoryExpiry.samples.length <= 5, "inventory expiry DTO returns at most five samples");
  assert(empty.body.inventoryExpiry.samples.every((sample) => typeof sample.id === "string" && typeof sample.name === "string" && typeof sample.displayStorageLocation === "string" && typeof sample.expiryDate === "string"), "inventory expiry samples are JSON-safe and include locations");
  for (const section of ["sales", "purchases", "inventory"]) {
    assert(Object.values(empty.body[section]).every((value) => typeof value === "string" || Number.isInteger(value)), `${section} DTO values are JSON-safe strings or integers`);
  }
  assert(Object.values(empty.body.todos.priorityCounts).every((value) => Number.isInteger(value) && value >= 0), "todo priority counts are non-negative integers");
  assert(Object.values(empty.body.risks.severityCounts).every((value) => Number.isInteger(value) && value >= 0), "risk severity counts are non-negative integers");
  assert(empty.body.todos.items.every((item) => typeof item.code === "string" && Number.isInteger(item.count) && item.count > 0), "todo items expose positive counts and codes");
  assert(empty.body.risks.items.every((item) => typeof item.code === "string" && Number.isInteger(item.count) && item.count > 0), "risk items expose positive counts and codes");
  assert(new Set(empty.body.todos.items.map((item) => item.code)).size === empty.body.todos.items.length, "todo item codes are unique");
  assert(new Set(empty.body.risks.items.map((item) => item.code)).size === empty.body.risks.items.length, "risk item codes are unique");
  assert(empty.body.todos.totalCount === empty.body.todos.items.reduce((sum, item) => sum + item.count, 0), "todo totalCount equals item counts");
  assert(empty.body.risks.totalCount === empty.body.risks.items.reduce((sum, item) => sum + item.count, 0), "risk totalCount equals item counts");
  assert(empty.body.todos.items.every((item) => item.samples.every((sample) => typeof sample.id === "string" && typeof sample.label === "string" && (sample.at === null || Date.parse(sample.at) > 0))), "todo samples are JSON-safe and dated");
  assert(empty.body.risks.items.every((item) => item.samples.every((sample) => typeof sample.id === "string" && typeof sample.label === "string" && (sample.at === null || Date.parse(sample.at) > 0))), "risk samples are JSON-safe and dated");
  assert(Object.values(empty.body.market).every((value) => typeof value === "number" ? Number.isInteger(value) && value >= 0 : typeof value === "string"), "market DTO values are JSON-safe and non-negative");

  const invalidDate = await request("/api/reports/daily-business?date=2026-02-30");
  assert(invalidDate.response.status === 400 && invalidDate.body.code === "INVALID_DATE" && typeof invalidDate.body.message === "string", "invalid report date returns stable 400 with message");
  const invalidTimezone = await request("/api/reports/daily-business?timezone=UTC");
  assert(invalidTimezone.response.status === 400 && invalidTimezone.body.code === "INVALID_TIMEZONE" && typeof invalidTimezone.body.message === "string", "unsupported timezone returns stable 400 with message");
  const unknown = await request("/api/reports/daily-business?ownerId=other-owner");
  assert(unknown.response.status === 400, "ownerId and unknown query fields are rejected");
  const unknownField = await request("/api/reports/daily-business?unexpected=true");
  assert(unknownField.response.status === 400 && unknownField.body.code === "VALIDATION_ERROR", "unknown query fields return VALIDATION_ERROR");
  const explicitDefault = await request("/api/reports/daily-business?timezone=Asia%2FShanghai");
  assert(explicitDefault.response.status === 200 && explicitDefault.body.timezone === "Asia/Shanghai", "explicit supported timezone succeeds");

  const beforeReadOnlyReport = await getReadOnlyBoundarySnapshot();
  const report = await request("/api/reports/daily-business?date=2026-07-15");
  const afterReadOnlyReport = await getReadOnlyBoundarySnapshot();
  assert(report.response.status === 200 && beforeReadOnlyReport === afterReadOnlyReport, "report API leaves market, purchase, inventory, sales, after-sales, refund, and action-log records unchanged");

  const item = fixtureItem;
  const now = new Date();
  const quote = await db.marketQuote.create({ data: { ownerId: "default-user", marketItemId: item.id, platform: "DEWU", quoteType: "EXPECTED_INCOME", amount: "100.00", recordedAt: now, sourceType: "MANUAL", confirmedAt: now } });
  quoteIds.push(quote.id);
  const itemBeforeReport = await db.marketItem.findUniqueOrThrow({ where: { id: item.id }, select: { displayName: true, normalizedName: true, updatedAt: true, isActive: true } });
  const quoteBeforeReport = await db.marketQuote.findUniqueOrThrow({ where: { id: quote.id }, select: { amount: true, recordedAt: true, confirmedAt: true, invalidatedAt: true, updatedAt: true } });
  const market = await request("/api/reports/daily-business");
  const itemAfterReport = await db.marketItem.findUniqueOrThrow({ where: { id: item.id }, select: { displayName: true, normalizedName: true, updatedAt: true, isActive: true } });
  const quoteAfterReport = await db.marketQuote.findUniqueOrThrow({ where: { id: quote.id }, select: { amount: true, recordedAt: true, confirmedAt: true, invalidatedAt: true, updatedAt: true } });
  assert(JSON.stringify(itemBeforeReport) === JSON.stringify(itemAfterReport), "report leaves MarketItem fields and updatedAt unchanged");
  assert(JSON.stringify(quoteBeforeReport) === JSON.stringify(quoteAfterReport), "report leaves MarketQuote fields and updatedAt unchanged");
  assert(market.body.market.activeMarketItemCount >= 1 && market.body.market.withCurrentExpectedIncomeCount >= 1, "manual confirmed EXPECTED_INCOME contributes to market summary");
  assert(market.body.market.withoutCurrentExpectedIncomeCount >= 0, "market coverage counts are non-negative");
  assert(Number.isInteger(market.body.market.quotesCreatedInPeriodCount) && Number.isInteger(market.body.market.quotesConfirmedInPeriodCount), "market event counts are integers");
  assert(Number.isInteger(market.body.market.expiringQuoteCount) && Number.isInteger(market.body.market.expiredQuoteCount), "market freshness counts are integers");
  assert(!market.body.market.automatedQuoteCount, "market summary does not claim automated platform collection");
  assert(!JSON.stringify(market.body).includes("ownerId"), "DTO does not expose ownerId");
  assert(!JSON.stringify(market.body).includes("Infinity") && !JSON.stringify(market.body).includes("NaN"), "DTO has no non-finite numeric values");
  for (const item of market.body.todos.items) {
    assert(item.samples.length <= 3 && /^P[0-3]$/.test(item.priority) && item.href.startsWith("/"), `todo ${item.code} has bounded samples, priority and href`);
  }
  for (const item of market.body.risks.items) {
    assert(item.samples.length <= 3 && /^P[0-3]$/.test(item.severity) && item.href.startsWith("/"), `risk ${item.code} has bounded samples, severity and href`);
  }

  const sendPath = "/api/reports/daily-business/send-feishu";
  const sendJson = (body) => request(sendPath, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const notSentDeliveryStatus = await request(`/api/reports/daily-business/delivery-status?date=${reportDates[2]}&timezone=Asia%2FShanghai`);
  assert(notSentDeliveryStatus.response.status === 200 && notSentDeliveryStatus.body.delivery?.status === "NOT_SENT" && notSentDeliveryStatus.body.delivery?.nextAction === "SEND", "delivery status returns the explicit not-sent state before any delivery exists");
  const itemBeforeSend = await db.marketItem.findUniqueOrThrow({ where: { id: item.id }, select: { displayName: true, normalizedName: true, isActive: true, updatedAt: true } });
  const quoteBeforeSend = await db.marketQuote.findUniqueOrThrow({ where: { id: quote.id }, select: { amount: true, recordedAt: true, confirmedAt: true, invalidatedAt: true, updatedAt: true } });
  mockRequests = [];
  mockMode = "success";
  await createReportFixtureQuote(itemId, reportDates[1]);
  const beforeSendSnapshot = await getReadOnlyBoundarySnapshot();
  const send = await sendJson({ date: reportDates[1], timezone: "Asia/Shanghai" });
  const firstSentDelivery = await trackDelivery(reportDates[1]);
  const afterSendSnapshot = await getReadOnlyBoundarySnapshot();
  const itemAfterSend = await db.marketItem.findUniqueOrThrow({ where: { id: item.id }, select: { displayName: true, normalizedName: true, isActive: true, updatedAt: true } });
  const quoteAfterSend = await db.marketQuote.findUniqueOrThrow({ where: { id: quote.id }, select: { amount: true, recordedAt: true, confirmedAt: true, invalidatedAt: true, updatedAt: true } });
  assert(send.response.status === 200 && send.body.outcome === "SENT" && send.body.delivery?.status === "SENT", "manual Feishu send creates a sent delivery record");
  assert(send.body.reportDate === reportDates[1] && typeof send.body.delivery?.sentAt === "string", "manual Feishu send returns the sent report date and ISO time");
  assert(firstSentDelivery?.attemptCount === 1 && firstSentDelivery.sentAt, "first delivery persists one successful attempt");
  assert(!JSON.stringify(send.body).includes("m4-daily-verification-secret") && !JSON.stringify(send.body).includes("127.0.0.1"), "delivery response does not expose the secret or webhook URL");
  assert(mockRequests.length === 1 && mockRequests[0].method === "POST", "normal delivery invokes the configured mock webhook exactly once");
  assert(mockRequests[0].headers["content-type"]?.includes("application/json"), "Feishu delivery uses a JSON content type");
  const webhookPayload = JSON.parse(mockRequests[0].body);
  assert(webhookPayload.msg_type === "text" && webhookPayload.content?.text.includes(`每日经营报告｜${reportDates[1]}`), "Feishu payload contains the selected report date title");
  assert(webhookPayload.content.text.includes("所选日期经营结果") && webhookPayload.content.text.includes("当前库存与资产（生成时快照）"), "Feishu payload contains sales and current inventory sections");
  assert(webhookPayload.content.text.includes("今日优先待办") && webhookPayload.content.text.includes("风险提醒") && webhookPayload.content.text.includes("行情数据来自人工录入"), "Feishu payload contains todo, risk and manual-market summaries");
  assert(!webhookPayload.content.text.includes(item.id) && !webhookPayload.content.text.includes(quote.id) && !webhookPayload.content.text.includes("ownerId"), "Feishu payload excludes database identifiers and owner scope");
  assert(typeof webhookPayload.timestamp === "string" && typeof webhookPayload.sign === "string", "configured Feishu secret adds timestamp and signature fields");
  const expectedSignature = createHmac("sha256", `${webhookPayload.timestamp}\nm4-daily-verification-secret`).update("").digest("base64");
  assert(webhookPayload.sign === expectedSignature, "Feishu signature follows the official deterministic V2 custom bot protocol");
  assert(beforeSendSnapshot === afterSendSnapshot, "manual delivery leaves purchase, inventory, sales, after-sales, refunds, market and action logs unchanged");
  assert(JSON.stringify(itemBeforeSend) === JSON.stringify(itemAfterSend), "manual delivery leaves target MarketItem business fields and updatedAt unchanged");
  assert(JSON.stringify(quoteBeforeSend) === JSON.stringify(quoteAfterSend), "manual delivery leaves target MarketQuote business fields and updatedAt unchanged");

  const duplicateSend = await sendJson({ date: reportDates[1], timezone: "Asia/Shanghai" });
  assert(duplicateSend.response.status === 200 && duplicateSend.body.outcome === "ALREADY_SENT" && mockRequests.length === 1, "same report date is skipped without a second webhook call");
  const deliveryStatus = await request(`/api/reports/daily-business/delivery-status?date=${reportDates[1]}&timezone=Asia%2FShanghai`);
  assert(deliveryStatus.response.status === 200 && deliveryStatus.body.delivery?.status === "SENT" && deliveryStatus.body.delivery?.attemptCount === 1 && !JSON.stringify(deliveryStatus.body).includes("ownerId"), "delivery status returns safe sent state without owner scope");
  assert(deliveryStatus.body.delivery?.retryable === false && deliveryStatus.body.delivery?.nextAction === "NONE" && typeof deliveryStatus.body.delivery?.sentAt === "string", "sent delivery status is terminal and exposes a safe sent timestamp");

  const requestCountBeforeBadDate = mockRequests.length;
  const badDate = await sendJson({ date: "2026-02-30" });
  assert(badDate.response.status === 400 && badDate.body.code === "INVALID_DATE" && mockRequests.length === requestCountBeforeBadDate, "invalid send date returns stable 400 without calling Feishu");
  const invalidStatusDate = await request("/api/reports/daily-business/delivery-status?date=2026-02-30&timezone=Asia%2FShanghai");
  assert(invalidStatusDate.response.status === 400 && invalidStatusDate.body.code === "INVALID_DATE", "delivery status rejects an invalid report date with the same stable error contract");
  const invalidStatusTimezone = await request(`/api/reports/daily-business/delivery-status?date=${reportDates[1]}&timezone=UTC`);
  assert(invalidStatusTimezone.response.status === 400 && invalidStatusTimezone.body.code === "INVALID_TIMEZONE", "delivery status rejects an unsupported timezone before querying delivery state");
  const sensitiveStatusQuery = await request(`/api/reports/daily-business/delivery-status?date=${reportDates[1]}&timezone=Asia%2FShanghai&ownerId=other`);
  assert(sensitiveStatusQuery.response.status === 400 && sensitiveStatusQuery.body.code === "UNKNOWN_FIELD", "delivery status rejects caller-supplied owner scope");
  const requestCountAfterBadDate = mockRequests.length;
  for (const [field, value] of Object.entries({ ownerId: "other", webhook: "https://example.invalid", secret: "x", url: "https://example.invalid", report: {}, message: "x", content: "x", destination: "x", retryCount: 1, sentAt: "now", idempotencyKey: "x", expectedIncome: "1", quoteId: "x", maxPurchasePrice: "1", source: "x" })) {
    const invalid = await sendJson({ [field]: value });
    assert(invalid.response.status === 400 && invalid.body.code === "UNKNOWN_FIELD", `send API rejects sensitive or unknown field ${field}`);
  }
  assert(mockRequests.length === requestCountAfterBadDate, "invalid delivery requests never invoke the external webhook");
  for (const body of [{ date: "2026-07-15", timezone: "UTC" }, { date: "2026-07-15", timezone: "Asia/Shanghai", extra: true }]) {
    const invalid = await sendJson(body);
    assert(invalid.response.status === 400, "invalid timezone or unknown payload is rejected before external delivery");
  }

  const emptyReportFixture = {
    sales: { confirmedOrderCount: 0, confirmedItemCount: 0, grossSalesAmount: "0.00", expectedIncomeAmount: "0.00", actualReceivedAmount: "0.00", actualRefundAmount: "0.00" },
    purchases: { createdOrderCount: 0, arrivedOrderCount: 0, inspectedItemCount: 0, createdInventoryItemCount: 0, purchaseRefundAmount: "0.00" },
    todos: { totalCount: 0 },
    risks: { totalCount: 0 },
    market: { quotesCreatedInPeriodCount: 0, quotesConfirmedInPeriodCount: 0 },
  };
  assert(isEmptyDailyBusinessReport(emptyReportFixture), "an all-zero daily report is recognized before the webhook");
  assert(!isEmptyDailyBusinessReport({ ...emptyReportFixture, todos: { totalCount: 1 } }), "a report with a todo is not treated as a fake empty report");

  await createReportFixtureQuote(itemId, reportDates[3]);
  mockMode = "http400";
  const rejected = await sendJson({ date: reportDates[3] });
  const rejectedDelivery = await trackDelivery(reportDates[3]);
  assert(rejected.response.status === 503 && rejected.body.code === "FEISHU_REJECTED_REQUEST", "webhook 4xx maps to a stable non-retryable delivery error");
  assert(rejectedDelivery?.status === "FAILED" && rejectedDelivery.attemptCount === 1 && rejectedDelivery.lastErrorCode === "FEISHU_REJECTED_REQUEST", "webhook 4xx failure persists a single non-retryable attempt");
  const rejectedAgain = await sendJson({ date: reportDates[3] });
  assert(rejectedAgain.response.status === 200 && rejectedAgain.body.outcome === "NOT_RETRYABLE", "a non-retryable delivery cannot be resent automatically");

  await createReportFixtureQuote(itemId, reportDates[4]);
  mockMode = "http500";
  const retryableFailure = await sendJson({ date: reportDates[4] });
  const failedDelivery = await trackDelivery(reportDates[4]);
  assert(retryableFailure.response.status === 503 && retryableFailure.body.code === "FEISHU_5XX", "webhook 5xx maps to a stable retryable delivery error");
  assert(failedDelivery?.status === "FAILED" && failedDelivery.attemptCount === 1 && failedDelivery.lastErrorCode === "FEISHU_5XX", "retryable failure persists safe error metadata and attempt count");
  const retryableDeliveryStatus = await request(`/api/reports/daily-business/delivery-status?date=${reportDates[4]}&timezone=Asia%2FShanghai`);
  assert(retryableDeliveryStatus.response.status === 200 && retryableDeliveryStatus.body.delivery?.status === "FAILED" && retryableDeliveryStatus.body.delivery?.retryable === true && retryableDeliveryStatus.body.delivery?.nextAction === "RETRY", "delivery status exposes a retryable failed record without sending another webhook request");
  mockMode = "success";
  const retried = await sendJson({ date: reportDates[4] });
  assert(retried.response.status === 200 && retried.body.outcome === "SENT" && retried.body.delivery.attemptCount === 2, "a retryable failed delivery is resent once and advances its attempt count");
  const retriedDelivery = await trackDelivery(reportDates[4]);
  assert(retriedDelivery?.status === "SENT" && retriedDelivery.attemptCount === 2, "successful retry finalizes the same idempotency record");

  await createReportFixtureQuote(itemId, reportDates[5]);
  mockMode = "drop";
  const networkFailure = await sendJson({ date: reportDates[5] });
  const networkDelivery = await trackDelivery(reportDates[5]);
  assert(networkFailure.response.status === 503 && networkFailure.body.code === "FEISHU_NETWORK_ERROR", "dropped webhook connection maps to a retryable network error");
  assert(networkDelivery?.status === "FAILED" && networkDelivery.lastErrorCode === "FEISHU_NETWORK_ERROR", "network failure persists a safe retryable delivery record");

  await createReportFixtureQuote(itemId, reportDates[6]);
  mockMode = "success";
  const requestsBeforeConcurrent = mockRequests.length;
  const concurrent = await Promise.all(Array.from({ length: 3 }, () => sendJson({ date: reportDates[6] })));
  const concurrentDelivery = await trackDelivery(reportDates[6]);
  assert(concurrent.every((result) => result.response.status === 200), "concurrent manual sends receive stable idempotency outcomes");
  assert(concurrent.filter((result) => result.body.outcome === "SENT").length === 1 && mockRequests.length === requestsBeforeConcurrent + 1, "concurrent sends make exactly one external webhook call");
  assert(concurrentDelivery?.status === "SENT" && concurrentDelivery.attemptCount === 1, "concurrent sends leave one sent delivery record");

  await createReportFixtureQuote(itemId, reportDates[7]);
  mockMode = "http500";
  let cappedDelivery = null;
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const limited = await sendJson({ date: reportDates[7] });
    cappedDelivery = await trackDelivery(reportDates[7]);
    assert(limited.response.status === 503 && limited.body.code === "FEISHU_5XX", `retryable attempt ${attempt} returns its stable transport error`);
  }
  assert(cappedDelivery?.status === "FAILED" && cappedDelivery.attemptCount === 3, "retryable delivery stops after the frozen maximum attempt count");
  const callsBeforeCappedRetry = mockRequests.length;
  const cappedRetry = await sendJson({ date: reportDates[7] });
  assert(cappedRetry.response.status === 200 && cappedRetry.body.outcome === "NOT_RETRYABLE" && mockRequests.length === callsBeforeCappedRetry, "attempt limit prevents a fourth external delivery call");
  mockMode = "success";

  const source = await fs.readFile(new URL("../src/server/reports/daily-business-report.ts", import.meta.url), "utf8");
  assert(!/\.(create|update|delete|upsert)\(/.test(source), "daily report aggregation has no write path");
  assert(!source.includes("itemStatus: \"SOLD\""), "daily report aggregation has no SOLD write path");
  assert(source.includes("getSalesAfterSaleFinancials") && source.includes("getPlatformReturnSummary"), "daily report reuses frozen financial and asset aggregations");
  assert(source.includes("generatedAt") && !source.includes("Date.now()"), "aggregation uses caller-provided generatedAt");
  assert(source.includes("PENDING_DECISION"), "platform return aggregation preserves pending decision distinction");
  assert(source.includes("PurchaseRefundRecord") || source.includes("purchaseRefundRecord"), "purchase refund source remains separate in implementation");
  assert(source.includes("SaleRefundRecord") || source.includes("saleRefundRecord"), "sales refund source remains separate in implementation");
  assert(!source.includes("fetch("), "shared aggregation does not call HTTP services internally");
  assert(!source.includes("send") && !source.includes("webhook"), "shared daily aggregation remains independent from notifications");

  const [deliverySource, coordinatorSource, configSource, webhookSource, formatterSource, sendRouteSource] = await Promise.all([
    fs.readFile(new URL("../src/server/notifications/daily-business-report-delivery-service.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/server/notifications/daily-business-report-delivery-coordinator.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/server/notifications/feishu-config.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/server/notifications/feishu-webhook-client.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/server/notifications/daily-business-report-feishu.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/app/api/reports/daily-business/send-feishu/route.ts", import.meta.url), "utf8"),
  ]);
  assert(configSource.includes("FEISHU_DAILY_REPORT_WEBHOOK_URL") && configSource.includes("FEISHU_DAILY_REPORT_SECRET"), "Feishu configuration is read from server-side environment variables only");
  assert(formatterSource.includes("formatDailyBusinessReportForFeishu") && !formatterSource.includes("@/server/db") && !formatterSource.includes(".plus("), "Feishu formatter is pure and does not query or recalculate report values");
  assert(webhookSource.includes("AbortController") && webhookSource.includes("FEISHU_TIMEOUT") && webhookSource.includes("createFeishuWebhookSignature"), "Feishu adapter has explicit timeout and signature handling");
  assert(deliverySource.includes("getDailyBusinessReport") && !/\.(create|update|delete|upsert)\(/.test(deliverySource), "delivery formatter service reuses the report DTO without persistence writes");
  assert(coordinatorSource.includes("DAILY_REPORT_MAX_ATTEMPTS") && coordinatorSource.includes("updateMany") && coordinatorSource.includes("idempotencyKey"), "delivery coordinator owns bounded retries and conditional idempotency claims");
  assert(!coordinatorSource.includes("itemStatus") && !coordinatorSource.includes("SalesService.confirm"), "delivery coordinator has no inventory or SOLD write path");
  assert(sendRouteSource.includes(".strict()") && !sendRouteSource.includes("@/server/db") && sendRouteSource.includes("deliverDailyBusinessReport"), "send API uses strict input validation and delegates to the delivery coordinator");

  const [dailyPageRoute, dailyPageSource, dailyLabels, appShell] = await Promise.all([
    fs.readFile(new URL("../src/app/reports/daily/page.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/components/reports/daily-business-report.tsx", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/components/reports/daily-business-report-labels.ts", import.meta.url), "utf8"),
    fs.readFile(new URL("../src/components/layout/app-shell.tsx", import.meta.url), "utf8"),
  ]);
  assert(!dailyPageSource.includes("FEISHU_DAILY_REPORT_WEBHOOK_URL") && !dailyPageSource.includes("FEISHU_DAILY_REPORT_SECRET"), "Webhook and secret values do not enter the client report bundle");
  assert(dailyPageRoute.includes("DailyBusinessReportPage") && dailyPageRoute.includes("Suspense"), "daily report route mounts the report client component with loading fallback");
  assert(appShell.includes('label: "每日经营报告"') && appShell.includes('href: "/reports/daily"'), "navigation exposes the daily business report entry");
  assert(dailyPageSource.includes('fetch(requestUrl)') && dailyPageSource.includes('`/api/reports/daily-business?${params.toString()}`'), "page calls the formal daily report read API");
  assert(dailyPageSource.includes('timezone: "Asia/Shanghai"') && dailyPageSource.includes('params.set("date", value)'), "page submits the fixed timezone and only the selected report date");
  assert(dailyPageSource.includes('router.replace') && dailyPageSource.includes('"/reports/daily"'), "date filter is synchronized to the URL");
  assert(dailyPageSource.includes("查看昨日") && !dailyPageSource.includes("Date.now"), "default-yesterday action delegates date selection to the API without local date calculations");
  assert(dailyPageSource.includes("报告日期") && dailyPageSource.includes("事件统计区间") && dailyPageSource.includes("报告生成时间"), "page displays report date, event period, and generation time");
  assert(dailyPageSource.includes("北京时间（Asia/Shanghai）"), "page presents the fixed business timezone in Chinese");
  assert(dailyPageSource.includes("所选日期经营结果") && dailyPageSource.includes("当前库存与资产"), "page separates dated events from current asset snapshot");
  assert(dailyPageSource.includes("不代表所选历史日期当天的库存状态"), "page explicitly warns that current snapshot is not historical inventory");
  assert(dailyPageSource.includes("confirmedOrderCount") && dailyPageSource.includes("afterSaleNetProfitAmount"), "sales summary uses all frozen sales fields including after-sales net profit");
  assert(dailyPageSource.includes("createdOrderCount") && dailyPageSource.includes("purchaseRefundAmount"), "purchase summary uses reliable purchase events and separate upstream refunds");
  assert(dailyPageSource.includes("totalUnsoldAssetCost") && dailyPageSource.includes("pendingDecisionCount"), "inventory snapshot uses server totals and exposes pending decision as a subset");
  assert(dailyPageSource.includes("属于已退回待处理的子集，不重复计入总未售资产"), "pending decision is not visually added as a second asset total");
  assert(dailyPageSource.includes("report.todos.items") && dailyPageSource.includes("formatDailyTodo"), "todo cards render the API list with shared Chinese labels");
  assert(dailyPageSource.includes("report.risks.items") && dailyPageSource.includes("formatDailyRisk"), "risk cards render the API list with shared Chinese labels");
  assert(dailyPageSource.includes("风险阈值由服务端统一判断"), "risk thresholds are not defined in the page");
  assert(dailyPageSource.includes("人工行情摘要") && dailyPageSource.includes("当前行情由人工录入"), "market summary states the manual data source");
  assert(dailyPageSource.includes("不代表系统已自动读取得物或 95 分数据"), "page explicitly states that market data is not automatically collected");
  assert(dailyPageSource.includes("预计收入") && dailyPageSource.includes("实际到账") && dailyPageSource.includes("实际退款"), "page separates expected income, actual received, and actual refunds");
  assert(!dailyPageSource.includes("parseFloat") && !dailyPageSource.includes(".reduce("), "page does not recalculate report money or totals");
  assert(dailyPageSource.includes("formatMoney") && dailyPageSource.includes("negative"), "money formatter preserves server decimal strings including negative values");
  assert(dailyPageSource.includes("暂无待办") && dailyPageSource.includes("暂无需要重点关注的经营风险"), "page provides distinct empty states for todos and risks");
  assert(dailyPageSource.includes("报告日期或时区参数无效") && dailyPageSource.includes("每日经营报告生成失败") && dailyPageSource.includes("无法连接到报告服务"), "page has safe 400, 500, and network error states");
  assert(dailyPageSource.includes("重新加载") && dailyPageSource.includes("setReport(null)"), "failed or changed requests hide stale data and allow reload");
  assert(dailyPageSource.includes("sm:grid-cols-2") && dailyPageSource.includes("lg:grid-cols-3") && dailyPageSource.includes("break-words"), "page uses responsive card grids and long-text wrapping for mobile layouts");
  assert(dailyPageSource.includes("safeHref") && dailyPageSource.includes("查看处理入口"), "todo and risk links use server-provided paths through a safe local-link guard");
  assert(!dailyPageSource.includes("@/server/db") && !dailyPageSource.includes("prisma") && !dailyPageSource.includes("ownerId"), "page has no direct database access or client owner scope");
  assert(dailyPageSource.includes('"/api/reports/daily-business/send-feishu"') && dailyPageSource.includes('method: "POST"'), "page uses only the formal daily report Feishu send API for delivery");
  assert(!dailyPageSource.includes("itemStatus: \"SOLD\"") && !dailyPageSource.includes("ownerId") && !dailyPageSource.includes("webhook"), "page has no SOLD path, owner scope or webhook input");
  assert(dailyPageSource.includes("发送到飞书") && dailyPageSource.includes("发送每日经营报告") && dailyPageSource.includes("同一日期已发送的日报会自动跳过；") && dailyPageSource.includes("失败且可重试"), "page has a confirmed manual Feishu send flow with duplicate-send notice");
  assert(dailyPageSource.includes("sending") && dailyPageSource.includes("disabled={loading || !report || sending || !canSend}"), "page disables repeat delivery while a request is in progress");
  assert(dailyPageSource.includes("每日经营报告已发送到飞书") && dailyPageSource.includes("toast.error"), "page has safe success and error feedback for delivery");
  assert(Object.keys((await import("../src/components/reports/daily-business-report-labels.ts")).dailyTodoLabels).length >= 11, "daily label map covers all current todo categories");
  assert(Object.keys((await import("../src/components/reports/daily-business-report-labels.ts")).dailyRiskLabels).length >= 5, "daily label map covers all current risk categories");
  assert(!dailyPageSource.match(/>\s*(purchaseAwaiting|salesAwaiting|platformReturns|salesSettlement|purchaseInspection)/), "page does not render raw todo or risk codes as user-facing text");
  assert(!dailyLabels.includes("PLATFORM_LISTED") && !dailyLabels.includes("SOLD"), "daily report labels do not expose raw inventory status enums");

  console.log(JSON.stringify({ ok: true, checks: checks.length, details: checks }, null, 2));
} finally {
  try {
    for (const createdDeliveryId of deliveryIds) {
      await db.dailyBusinessReportDelivery.delete({ where: { id: createdDeliveryId } });
    }
    for (const createdQuoteId of quoteIds) {
      await db.marketQuote.delete({ where: { id: createdQuoteId } });
    }
    if (itemId) await db.marketItem.delete({ where: { id: itemId } });
  } finally {
    await stopTemporaryApp(verificationApp);
    await stopTemporaryApp(noConfigApp);
    await stopMockWebhook();
  }
}
