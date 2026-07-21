import { describe, expect, it } from "vitest";
import { formatDailyBusinessReportForFeishu } from "@/server/notifications/daily-business-report-feishu";
import { createFeishuWebhookSignature, sendFeishuWebhookMessage } from "@/server/notifications/feishu-webhook-client";
import type { DailyBusinessReportDto } from "@/server/reports/daily-business-report-types";

function reportFixture(): DailyBusinessReportDto {
  return {
    reportDate: "2026-07-16",
    timezone: "Asia/Shanghai",
    periodStart: "2026-07-15T16:00:00.000Z",
    periodEnd: "2026-07-16T16:00:00.000Z",
    generatedAt: "2026-07-16T02:00:00.000Z",
    sales: { confirmedOrderCount: 2, confirmedItemCount: 3, grossSalesAmount: "500.00", expectedIncomeAmount: "460.00", actualReceivedAmount: "450.00", actualRefundAmount: "-20.00", netReceivedAmount: "430.00", originalProfitAmount: "110.00", afterSaleNetProfitAmount: "90.00" },
    purchases: { createdOrderCount: 1, arrivedOrderCount: 1, inspectedItemCount: 2, createdInventoryItemCount: 2, purchaseRefundAmount: "0.00" },
    inventory: { stockedCount: 4, stockedAssetCost: "300.00", platformProcessingCount: 2, platformReturningCount: 1, platformReturnedPendingCount: 1, pendingDecisionCount: 0, problemCount: 1, problemAssetCost: "30.00", totalUnsoldAssetCount: 8, totalUnsoldAssetCost: "630.00" },
    inventoryExpiry: {
      businessDate: "2026-07-16",
      counts: { EXPIRED: 1, WITHIN_30_DAYS: 2, WITHIN_90_DAYS: 0, WITHIN_180_DAYS: 0 },
      samples: [{ id: "expiry-item", name: "fixture item", skuText: null, displayStorageLocation: "A warehouse / A-01", expiryDate: "2026-07-20", risk: "WITHIN_30_DAYS" }],
    },
    todos: {
      items: [
        { code: "salesAwaitingSettlement", priority: "P1", count: 2, href: "/sales/settlements", samples: [{ id: "private-id", label: "private order", at: null }] },
        { code: "problemItems", priority: "P2", count: 3, href: "/inventory", samples: [] },
      ],
      totalCount: 5,
      priorityCounts: { P0: 0, P1: 2, P2: 3, P3: 0 },
    },
    risks: { items: [], totalCount: 0, severityCounts: { P0: 0, P1: 0, P2: 0, P3: 0 } },
    market: { activeMarketItemCount: 3, withCurrentExpectedIncomeCount: 2, withoutCurrentExpectedIncomeCount: 1, quotesCreatedInPeriodCount: 1, quotesConfirmedInPeriodCount: 1, expiringQuoteCount: 1, expiredQuoteCount: 0 },
  };
}

describe("daily business report Feishu formatter", () => {
  it("formats the frozen report values without sending private samples or recalculating money", () => {
    const formatted = formatDailyBusinessReportForFeishu(reportFixture());
    const text = formatted.payload.content.text;
    expect(formatted.payload.msg_type).toBe("text");
    expect(text).toContain("每日经营报告｜2026-07-16");
    expect(text).toContain("销售总额：¥500.00");
    expect(text).toContain("实际退款：¥-20.00");
    expect(text).toContain("当前库存与资产（生成时快照）");
    expect(text).toContain("销售待到账：2 项");
    expect(text).toContain("暂无高优先级风险");
    expect(text).toContain("行情数据来自人工录入，不代表系统自动获取平台价格。");
    expect(text).not.toContain("private-id");
    expect(text).not.toContain("private order");
  });
});

describe("Feishu custom bot adapter", () => {
  it("uses the official deterministic signature and does not expose it in the result", async () => {
    const now = new Date("2026-07-16T00:00:00.000Z");
    const expectedSignature = createFeishuWebhookSignature("unit-secret", "1784160000");
    let requestBody: Record<string, unknown> | null = null;
    const result = await sendFeishuWebhookMessage({
      config: { webhookUrl: "http://127.0.0.1:39101/hook", secret: "unit-secret" },
      message: { msg_type: "text", content: { text: "test" } },
      now,
      fetchImpl: async (_url, init) => {
        requestBody = JSON.parse(String(init?.body));
        return new Response(JSON.stringify({ code: 0 }), { status: 200, headers: { "content-type": "application/json" } });
      },
    });
    expect(requestBody).toMatchObject({ timestamp: "1784160000", sign: expectedSignature, msg_type: "text" });
    expect(JSON.stringify(result)).not.toContain("unit-secret");
    expect(JSON.stringify(result)).not.toContain(expectedSignature);
  });

  it("maps timeout, rejected and invalid responses to stable safe errors", async () => {
    await expect(sendFeishuWebhookMessage({
      config: { webhookUrl: "http://127.0.0.1:39101/hook", secret: null },
      message: { msg_type: "text", content: { text: "test" } },
      now: new Date(),
      timeoutMs: 1,
      fetchImpl: async (_url, init) => new Promise((_, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")))),
    })).rejects.toMatchObject({ code: "FEISHU_TIMEOUT", status: 503 });

    await expect(sendFeishuWebhookMessage({
      config: { webhookUrl: "http://127.0.0.1:39101/hook", secret: null },
      message: { msg_type: "text", content: { text: "test" } },
      now: new Date(),
      fetchImpl: async () => new Response(JSON.stringify({ code: 19021, msg: "secret" }), { status: 200 }),
    })).rejects.toMatchObject({ code: "FEISHU_REJECTED_REQUEST", status: 503 });

    await expect(sendFeishuWebhookMessage({
      config: { webhookUrl: "http://127.0.0.1:39101/hook", secret: null },
      message: { msg_type: "text", content: { text: "test" } },
      now: new Date(),
      fetchImpl: async () => new Response("not-json", { status: 200 }),
    })).rejects.toMatchObject({ code: "FEISHU_INVALID_RESPONSE", status: 503 });
  });
});
