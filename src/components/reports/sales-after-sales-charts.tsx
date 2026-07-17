"use client";

import Link from "next/link";
import { useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { buttonVariants } from "@/components/ui/button";

type TrendRow = { period: string; originalActualReceivedAmount: string; refundedAmount: string; netReceivedAmount: string; originalProfit: string; afterSaleNetProfit: string };
type PlatformRow = { platform: string; actualReceivedAmountTotal: string; totalSalesRefundedAmount: string; netReceivedAmount: string; afterSaleNetProfit: string };
type ProductRow = { productName: string; sku: string | null; originalProfitTotal: string; refundedAmountTotal: string; restockedCostReversal: string; afterSaleNetProfit: string; soldItemCount: number };
type StatusRow = { status: string; count: number };
type InspectionRow = { result: string; count: number };

const platformLabel: Record<string, string> = { DEWU: "得物", NINETY_FIVE: "95分", XIANYU: "闲鱼", OTHER: "其他" };
const afterSaleStatusLabel: Record<string, string> = { DRAFT: "草稿", REQUESTED: "已申请", APPROVED: "已同意", REJECTED: "已拒绝", RETURN_PENDING: "待买家寄回", RETURNING: "买家退货途中", RETURN_RECEIVED: "已收到退货", INSPECTED: "退货已验货", REFUND_PENDING: "待退款", PARTIALLY_REFUNDED: "部分退款", REFUNDED: "已退款", COMPLETED: "已完成", CANCELLED: "已取消" };
const inspectionLabel: Record<string, string> = { RESTOCKED: "可重新入库", PROBLEM: "问题件", PENDING_DECISION: "待进一步判断" };

const money = (value: number | string) => `¥${Number(value).toFixed(2)}`;

function ChartTooltip({ active, payload, label }: { active?: boolean; payload?: { name?: string; value?: number | string; color?: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return <div className="rounded-md border bg-background p-3 text-xs shadow-sm"><p className="mb-1 font-medium">{label}</p>{payload.map((item) => <p key={item.name} style={{ color: item.color }}>{item.name}：{money(item.value ?? 0)}</p>)}</div>;
}

export function SalesAfterSalesCharts({
  trend,
  platformBreakdown,
  productBreakdown,
  afterSaleStatusBreakdown,
  returnInspectionBreakdown,
}: {
  trend: TrendRow[];
  platformBreakdown: PlatformRow[];
  productBreakdown: ProductRow[];
  afterSaleStatusBreakdown: StatusRow[];
  returnInspectionBreakdown: InspectionRow[];
}) {
  const [visibleTrendKeys, setVisibleTrendKeys] = useState(() => new Set(["originalActualReceivedAmount", "refundedAmount", "netReceivedAmount", "afterSaleNetProfit"]));
  const toggleTrendKey = (key: string) => {
    setVisibleTrendKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };
  const platformData = platformBreakdown.map((row) => ({
    name: platformLabel[row.platform] ?? "未填写",
    platform: row.platform,
    originalActualReceivedAmount: Number(row.actualReceivedAmountTotal),
    refundedAmount: Number(row.totalSalesRefundedAmount),
    netReceivedAmount: Number(row.netReceivedAmount),
    afterSaleNetProfit: Number(row.afterSaleNetProfit),
  }));
  const productData = [...productBreakdown]
    .sort((left, right) => Number(right.afterSaleNetProfit) - Number(left.afterSaleNetProfit))
    .slice(0, 10)
    .map((row) => ({
      name: `${row.productName}${row.sku ? ` ${row.sku}` : ""}`,
      productName: row.productName,
      sku: row.sku,
      originalProfit: Number(row.originalProfitTotal),
      refundedAmount: Number(row.refundedAmountTotal),
      restockedCostReversal: Number(row.restockedCostReversal),
      afterSaleNetProfit: Number(row.afterSaleNetProfit),
    }));
  const trendData = trend.map((row) => ({
    ...row,
    originalActualReceivedAmount: Number(row.originalActualReceivedAmount),
    refundedAmount: Number(row.refundedAmount),
    netReceivedAmount: Number(row.netReceivedAmount),
    originalProfit: Number(row.originalProfit),
    afterSaleNetProfit: Number(row.afterSaleNetProfit),
  }));
  const statusData = afterSaleStatusBreakdown.map((row) => ({ name: afterSaleStatusLabel[row.status] ?? "未填写", count: row.count }));
  const inspectionData = returnInspectionBreakdown.map((row) => ({ name: inspectionLabel[row.result] ?? "未填写", count: row.count }));

  return <div className="space-y-4" data-testid="sales-after-sales-charts">
    <Card className="rounded-lg shadow-none">
      <CardHeader><CardTitle className="text-base">销售与售后趋势</CardTitle><p className="text-xs text-muted-foreground">销售事实按销售报表日期口径归属；退款按实际退款登记时间归属，不回填到原销售日期。</p></CardHeader>
      <CardContent>{trendData.length ? <><div className="mb-3 flex flex-wrap gap-2" aria-label="趋势图例开关"><TrendLegendButton label="原实际到账" color="#2563eb" active={visibleTrendKeys.has("originalActualReceivedAmount")} onClick={() => toggleTrendKey("originalActualReceivedAmount")} /><TrendLegendButton label="累计退款" color="#dc2626" active={visibleTrendKeys.has("refundedAmount")} onClick={() => toggleTrendKey("refundedAmount")} /><TrendLegendButton label="净到账" color="#059669" active={visibleTrendKeys.has("netReceivedAmount")} onClick={() => toggleTrendKey("netReceivedAmount")} /><TrendLegendButton label="售后净利润" color="#7c3aed" active={visibleTrendKeys.has("afterSaleNetProfit")} onClick={() => toggleTrendKey("afterSaleNetProfit")} /></div><div className="h-80 min-w-0"><ResponsiveContainer width="100%" height="100%"><LineChart data={trendData} margin={{ left: 8, right: 16, top: 8 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="period" /><YAxis tickFormatter={(value) => `¥${value}`} /><Tooltip content={<ChartTooltip />} />{visibleTrendKeys.has("originalActualReceivedAmount") ? <Line type="monotone" dataKey="originalActualReceivedAmount" name="原实际到账" stroke="#2563eb" strokeWidth={2} dot={false} /> : null}{visibleTrendKeys.has("refundedAmount") ? <Line type="monotone" dataKey="refundedAmount" name="累计退款" stroke="#dc2626" strokeWidth={2} dot={false} /> : null}{visibleTrendKeys.has("netReceivedAmount") ? <Line type="monotone" dataKey="netReceivedAmount" name="净到账" stroke="#059669" strokeWidth={2} dot={false} /> : null}{visibleTrendKeys.has("afterSaleNetProfit") ? <Line type="monotone" dataKey="afterSaleNetProfit" name="售后净利润" stroke="#7c3aed" strokeWidth={2} dot={false} /> : null}</LineChart></ResponsiveContainer></div></> : <p className="py-12 text-center text-sm text-muted-foreground">当前筛选条件下暂无趋势数据</p>}</CardContent>
    </Card>
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="rounded-lg shadow-none"><CardHeader><CardTitle className="text-base">各平台销售与售后表现</CardTitle></CardHeader><CardContent>{platformData.length ? <><div className="h-80 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={platformData} margin={{ left: 8, right: 8, top: 8 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis tickFormatter={(value) => `¥${value}`} /><Tooltip content={<ChartTooltip />} /><Legend /><Bar dataKey="originalActualReceivedAmount" name="原实际到账" fill="#2563eb" /><Bar dataKey="refundedAmount" name="累计退款" fill="#dc2626" /><Bar dataKey="netReceivedAmount" name="净到账" fill="#059669" /><Bar dataKey="afterSaleNetProfit" name="售后净利润" fill="#7c3aed" /></BarChart></ResponsiveContainer></div><div className="mt-3 flex flex-wrap gap-2">{platformData.map((row) => <Link key={row.platform} href={`/reports/sales/orders?platform=${encodeURIComponent(row.platform)}`} className={buttonVariants({ variant: "outline", size: "sm" })}>查看{row.name}销售明细</Link>)}</div></> : <p className="py-12 text-center text-sm text-muted-foreground">暂无平台数据</p>}</CardContent></Card>
      <Card className="rounded-lg shadow-none"><CardHeader><CardTitle className="text-base">售后单状态分布</CardTitle></CardHeader><CardContent>{statusData.length ? <div className="h-80 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={statusData} margin={{ left: 40, right: 16, top: 8 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" allowDecimals={false} /><YAxis type="category" dataKey="name" width={92} /><Tooltip /><Bar dataKey="count" name="售后单数" fill="#0f766e" /></BarChart></ResponsiveContainer></div> : <p className="py-12 text-center text-sm text-muted-foreground">暂无售后单数据</p>}</CardContent></Card>
    </div>
    <div className="grid gap-4 xl:grid-cols-2">
      <Card className="rounded-lg shadow-none"><CardHeader><CardTitle className="text-base">商品 / SKU 售后净利润 Top 10</CardTitle><p className="text-xs text-muted-foreground">退款只读取用户明确登记的行级退款分配；不分摊订单实际到账。</p></CardHeader><CardContent>{productData.length ? <div className="h-96 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart layout="vertical" data={productData} margin={{ left: 88, right: 16, top: 8 }}><CartesianGrid strokeDasharray="3 3" /><XAxis type="number" tickFormatter={(value) => `¥${value}`} /><YAxis type="category" dataKey="name" width={82} tickFormatter={(value) => value.length > 14 ? `${value.slice(0, 14)}…` : value} /><Tooltip content={<ChartTooltip />} /><Bar dataKey="afterSaleNetProfit" name="售后净利润" fill="#7c3aed" /></BarChart></ResponsiveContainer></div> : <p className="py-12 text-center text-sm text-muted-foreground">暂无商品 / SKU 数据</p>}<Link href="/reports/sales/products" className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>查看完整商品 / SKU 分析</Link></CardContent></Card>
      <Card className="rounded-lg shadow-none"><CardHeader><CardTitle className="text-base">退货验货结果分布</CardTitle><p className="text-xs text-muted-foreground">统计单位为退货商品件数。</p></CardHeader><CardContent>{inspectionData.length ? <div className="h-80 min-w-0"><ResponsiveContainer width="100%" height="100%"><BarChart data={inspectionData} margin={{ left: 8, right: 16, top: 8 }}><CartesianGrid strokeDasharray="3 3" /><XAxis dataKey="name" /><YAxis allowDecimals={false} /><Tooltip /><Bar dataKey="count" name="商品件数" fill="#b45309" /></BarChart></ResponsiveContainer></div> : <p className="py-12 text-center text-sm text-muted-foreground">暂无退货验货数据</p>}</CardContent></Card>
    </div>
  </div>;
}

function TrendLegendButton({ label, color, active, onClick }: { label: string; color: string; active: boolean; onClick: () => void }) {
  return <button type="button" onClick={onClick} className={`inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs ${active ? "bg-muted" : "opacity-50"}`} aria-pressed={active}><span className="size-2 rounded-full" style={{ backgroundColor: color }} />{label}</button>;
}
