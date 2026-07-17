import { ServiceError } from "@/server/errors";
import { getDailyBusinessReport } from "@/server/reports/daily-business-report";
import { formatDailyBusinessReportForFeishu } from "./daily-business-report-feishu";
import { getFeishuDailyReportConfig } from "./feishu-config";
import { sendFeishuWebhookMessage } from "./feishu-webhook-client";

function isZeroAmount(value: string) {
  return /^-?0(?:\.0+)?$/.test(value);
}

export function isEmptyDailyBusinessReport(report: Awaited<ReturnType<typeof getDailyBusinessReport>>) {
  const eventValues = [
    report.sales.confirmedOrderCount,
    report.sales.confirmedItemCount,
    report.sales.grossSalesAmount,
    report.sales.expectedIncomeAmount,
    report.sales.actualReceivedAmount,
    report.sales.actualRefundAmount,
    report.purchases.createdOrderCount,
    report.purchases.arrivedOrderCount,
    report.purchases.inspectedItemCount,
    report.purchases.createdInventoryItemCount,
    report.purchases.purchaseRefundAmount,
    report.todos.totalCount,
    report.risks.totalCount,
    report.market.quotesCreatedInPeriodCount,
    report.market.quotesConfirmedInPeriodCount,
  ];
  return eventValues.every((value) => typeof value === "number" ? value === 0 : isZeroAmount(value));
}

export async function sendDailyBusinessReportToFeishu(input: {
  ownerId: string;
  date?: string;
  timezone?: string;
  requestedAt: Date;
}) {
  const config = getFeishuDailyReportConfig();
  const prepared = await prepareDailyBusinessReportForFeishu(input);
  const sent = await sendFeishuWebhookMessage({
    config,
    message: prepared.formatted.payload,
    now: input.requestedAt,
  });

  return {
    ...sent,
    reportDate: prepared.report.reportDate,
    messageSummary: prepared.formatted.messageSummary,
  };
}

export async function prepareDailyBusinessReportForFeishu(input: {
  ownerId: string;
  date?: string;
  timezone?: string;
  requestedAt: Date;
}) {
  let report;
  try {
    report = await getDailyBusinessReport({
      ownerId: input.ownerId,
      date: input.date,
      timezone: input.timezone,
      generatedAt: input.requestedAt,
    });
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    throw new ServiceError("DAILY_REPORT_GENERATION_FAILED", "生成每日经营报告失败，未发送飞书消息。", 500);
  }

  if (isEmptyDailyBusinessReport(report)) {
    throw new ServiceError("DAILY_REPORT_EMPTY", "日报没有可发送的经营事件、待办、风险或行情变化，已跳过发送。", 409);
  }

  let formatted;
  try {
    formatted = formatDailyBusinessReportForFeishu(report);
  } catch {
    throw new ServiceError("DAILY_REPORT_FORMATTING_FAILED", "生成日报消息失败，未发送飞书消息。", 500);
  }

  return { report, formatted };
}
