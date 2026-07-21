import { dailyRiskLabels, dailyTodoLabels } from "@/components/reports/daily-business-report-labels";
import type { DailyBusinessReportDto, DailyReportPriority } from "@/server/reports/daily-business-report-types";
import type { FeishuTextMessage } from "./feishu-webhook-client";

const PRIORITY_ORDER: DailyReportPriority[] = ["P0", "P1", "P2", "P3"];
const IMPORTANT_TODO_LIMIT = 6;
const IMPORTANT_RISK_LIMIT = 5;

function formatMoney(value: string | number | undefined) {
  return `¥${String(value ?? "0.00")}`;
}

function priorityItems<T extends { priority?: string; severity?: string; count: number }>(items: T[], field: "priority" | "severity", limit: number) {
  const important = items
    .filter((item) => item[field] === "P0" || item[field] === "P1")
    .sort((left, right) => PRIORITY_ORDER.indexOf(left[field] as DailyReportPriority) - PRIORITY_ORDER.indexOf(right[field] as DailyReportPriority) || right.count - left.count);
  const shown = important.slice(0, limit);
  const omitted = items.filter((item) => !shown.includes(item)).reduce((sum, item) => sum + item.count, 0);
  return { shown, omitted };
}

export type DailyBusinessReportFeishuMessage = {
  payload: FeishuTextMessage;
  messageSummary: { todoCount: number; riskCount: number; omittedItemCount: number; warnings: string[] };
};

export function formatDailyBusinessReportForFeishu(report: DailyBusinessReportDto): DailyBusinessReportFeishuMessage {
  const todos = priorityItems(report.todos.items, "priority", IMPORTANT_TODO_LIMIT);
  const risks = priorityItems(report.risks.items, "severity", IMPORTANT_RISK_LIMIT);
  const expiryCounts = report.inventoryExpiry?.counts ?? {
    EXPIRED: 0,
    WITHIN_30_DAYS: 0,
    WITHIN_90_DAYS: 0,
    WITHIN_180_DAYS: 0,
  };
  const todoLines = todos.shown.map((item) => `- ${dailyTodoLabels[item.code]?.title ?? "其他待办"}：${item.count} 项`);
  const riskLines = risks.shown.map((item) => `- ${dailyRiskLabels[item.code]?.title ?? "其他风险"}：${item.count} 项`);
  const warnings: string[] = [];
  if (todos.omitted > 0 || risks.omitted > 0) warnings.push("待办或风险仅发送优先摘要，其余项目已汇总。");

  const lines = [
    `每日经营报告｜${report.reportDate}`,
    "",
    "一、所选日期经营结果",
    `- 销售订单数：${report.sales.confirmedOrderCount}`,
    `- 销售件数：${report.sales.confirmedItemCount}`,
    `- 销售总额：${formatMoney(report.sales.grossSalesAmount)}`,
    `- 实际到账：${formatMoney(report.sales.actualReceivedAmount)}`,
    `- 实际退款：${formatMoney(report.sales.actualRefundAmount)}`,
    `- 净到账：${formatMoney(report.sales.netReceivedAmount)}`,
    `- 售后净利润：${formatMoney(report.sales.afterSaleNetProfitAmount)}`,
    "",
    "二、当前库存与资产（生成时快照）",
    `- 正常在库：${report.inventory.stockedCount} 件`,
    `- 平台处理中：${report.inventory.platformProcessingCount} 件`,
    `- 平台退回途中：${report.inventory.platformReturningCount} 件`,
    `- 已退回待处理：${report.inventory.platformReturnedPendingCount} 件`,
    `- 问题件：${report.inventory.problemCount} 件`,
    `- 总未售资产成本：${formatMoney(report.inventory.totalUnsoldAssetCost)}`,
    "- 库存效期风险：",
    `  - 已过期：${expiryCounts.EXPIRED} 件`,
    `  - 30天内到期：${expiryCounts.WITHIN_30_DAYS} 件`,
    `  - 90天内到期：${expiryCounts.WITHIN_90_DAYS} 件`,
    `  - 180天内到期：${expiryCounts.WITHIN_180_DAYS} 件`,
    "",
    "三、今日优先待办",
    ...(todoLines.length ? todoLines : ["- 暂无 P0/P1 优先待办"]),
    ...(todos.omitted > 0 ? [`- 其他待办汇总：${todos.omitted} 项`] : []),
    "",
    "四、风险提醒",
    ...(riskLines.length ? riskLines : ["- 暂无高优先级风险"]),
    ...(risks.omitted > 0 ? [`- 其他风险汇总：${risks.omitted} 项`] : []),
    "",
    "五、人工行情摘要",
    `- 启用行情商品：${report.market.activeMarketItemCount} 个`,
    `- 有当前有效预计收入：${report.market.withCurrentExpectedIncomeCount} 个`,
    `- 即将过期报价：${report.market.expiringQuoteCount} 条`,
    "- 行情数据来自人工录入，不代表系统自动获取平台价格。",
    "",
    "完整报告：请在库存系统中打开每日经营报告。",
  ];

  return {
    payload: { msg_type: "text", content: { text: lines.join("\n") } },
    messageSummary: { todoCount: report.todos.totalCount, riskCount: report.risks.totalCount, omittedItemCount: todos.omitted + risks.omitted, warnings },
  };
}
