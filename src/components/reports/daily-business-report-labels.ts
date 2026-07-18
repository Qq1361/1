export type DailyReportBadge = {
  label: string;
  variant: "destructive" | "outline" | "secondary";
};

export const dailyTodoLabels: Record<string, { title: string; description: string }> = {
  purchaseMissingTracking: { title: "采购单超过 2 天未填写快递单号", description: "请补充快递单号后再继续跟进。" },
  purchaseTrackingNotReceivedOverdue: { title: "快递单号已填写超过 5 天仍未确认收货", description: "请手动查询物流，并在确认收货后完成后续验货。" },
  purchaseAwaitingArrival: { title: "采购待到货", description: "已付款采购仍在等待到货或物流推进。" },
  purchaseAwaitingInspection: { title: "采购待验货", description: "已签收商品需要完成单件验货。" },
  problemItems: { title: "问题件待处理", description: "当前自有问题件需要人工判断后续处理。" },
  salesAwaitingConfirmation: { title: "销售待确认", description: "销售草稿尚未确认，不会占用库存。" },
  salesAwaitingSettlement: { title: "销售待到账", description: "已确认销售尚未登记实际到账。" },
  purchaseAfterSalesPending: { title: "采购售后待处理", description: "上游采购售后仍在进行中。" },
  saleAfterSalesPending: { title: "销售售后待处理", description: "销售售后案件仍在进行中。" },
  buyerReturnsAwaitingInspection: { title: "买家退货待验货", description: "买家退货已收到，等待人工验货结论。" },
  platformReturnsInTransit: { title: "平台退回途中", description: "平台退回商品仍在运输中。" },
  platformReturnsAwaitingInspection: { title: "平台退回待验货", description: "平台退回商品已到达，等待退回验货。" },
  platformReturnsPendingDecision: { title: "待进一步判断", description: "平台退回验货结论仍需人工进一步判断。" },
};

export const dailyRiskLabels: Record<string, { title: string; description: string }> = {
  salesSettlementOverdue: { title: "销售长期未到账", description: "已确认销售超过既有等待阈值仍未登记到账。" },
  purchaseInspectionOverdue: { title: "采购到货后长期未验货", description: "采购验货记录超过既有等待阈值仍未完成。" },
  buyerReturnInspectionOverdue: { title: "买家退货收到后长期未验货", description: "买家退货已收货，仍需尽快完成售后验货。" },
  platformReturnInspectionOverdue: { title: "平台退回收到后长期未验货", description: "平台退回库存已到达，仍需完成退回验货。" },
  problemItemBacklog: { title: "问题件积压", description: "问题件已超过既有积压阈值，建议人工核查。" },
};

export function formatDailyPriority(priority: string): DailyReportBadge {
  const map: Record<string, DailyReportBadge> = {
    P0: { label: "紧急处理", variant: "destructive" },
    P1: { label: "今日优先", variant: "destructive" },
    P2: { label: "常规处理", variant: "outline" },
    P3: { label: "信息提醒", variant: "secondary" },
  };
  return map[priority] ?? { label: "待处理", variant: "outline" };
}

export function formatDailyTodo(code: string) {
  return dailyTodoLabels[code] ?? { title: "其他待办", description: "该待办需要人工查看并处理。" };
}

export function formatDailyRisk(code: string) {
  return dailyRiskLabels[code] ?? { title: "其他风险", description: "该风险需要人工查看并处理。" };
}
