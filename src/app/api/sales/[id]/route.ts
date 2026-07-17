import { DEFAULT_OWNER_ID } from "@/server/constants";
import { toErrorResponse } from "@/server/errors";
import { db } from "@/server/db";
import { emptySaleOrderAfterSaleFinancial, getSalesAfterSaleFinancials } from "@/server/reports/sales-after-sales-financials";

type C = { params: Promise<{ id: string }> };

export async function GET(_r: Request, c: C) {
  try {
    const { id } = await c.params;
    const sale = await db.saleOrder.findFirst({
      where: { id, ownerId: DEFAULT_OWNER_ID },
      include: {
        lines: { include: { inventoryItem: { select: { id: true, inventoryCode: true, name: true, itemStatus: true, saleMode: true, storageLocation: true } } } },
        feeLines: true,
        actionLogs: { orderBy: { createdAt: "desc" }, take: 30 },
      },
    });
    if (!sale) return Response.json({ code: "NOT_FOUND", message: "销售订单不存在。" }, { status: 404 });
    const financials = await getSalesAfterSaleFinancials(DEFAULT_OWNER_ID, [sale.id]);
    const financial = financials.orders.get(sale.id)
      ?? emptySaleOrderAfterSaleFinancial(sale.id);
    const money = (value: { toFixed: (fractionDigits: number) => string }) => value.toFixed(2);
    return Response.json({
      ...sale,
      lines: sale.lines.map((line) => {
        const lineFinancial = financials.lines.get(line.id);
        return {
          ...line,
          afterSaleFinancials: lineFinancial ? {
            refundedAmount: money(lineFinancial.refundedAmount),
            restockedCostReversal: money(lineFinancial.restockedCostReversal),
            afterSaleNetProfit: money(lineFinancial.afterSaleNetProfit),
          } : null,
        };
      }),
      afterSaleFinancials: {
        originalProfit: money(financial.originalProfit),
        totalSalesRefundedAmount: money(financial.totalSalesRefundedAmount),
        netReceivedAmount: money(financial.netReceivedAmount),
        restockedCostReversal: money(financial.restockedCostReversal),
        afterSaleNetProfit: money(financial.afterSaleNetProfit),
        afterSaleCaseCount: financial.afterSaleCaseCount,
        activeAfterSaleCaseCount: financial.activeAfterSaleCaseCount,
        afterSaleStatusSummary: financial.afterSaleStatusSummary,
      },
    });
  } catch (error) { return toErrorResponse(error); }
}
