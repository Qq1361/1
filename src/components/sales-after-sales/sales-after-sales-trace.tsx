"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatSaleStatus } from "@/lib/status-labels";

const statusLabels: Record<string, string> = { DRAFT: "草稿", REQUESTED: "已申请", APPROVED: "已同意", REJECTED: "已拒绝", RETURN_PENDING: "待买家寄回", RETURNING: "买家退货途中", RETURN_RECEIVED: "已收到退货", INSPECTED: "退货已验货", REFUND_PENDING: "待退款", PARTIALLY_REFUNDED: "部分退款", REFUNDED: "已退款", COMPLETED: "已完成", CANCELLED: "已取消" };
const typeLabels: Record<string, string> = { REFUND_ONLY: "仅退款", RETURN_AND_REFUND: "退货退款" };
const inspectionLabels: Record<string, string> = { RESTOCKED: "可重新入库", PROBLEM: "问题件", PENDING_DECISION: "待进一步判断" };
const money = (value: string | null | undefined) => value == null ? "未填写" : `¥${value}`;
const sumMoney = (values: string[]) => {
  const cents = values.reduce((total, value) => {
    const match = value.match(/^(\d+)(?:\.(\d{1,2}))?$/);
    return match ? total + Number(match[1]) * 100 + Number((match[2] || "").padEnd(2, "0")) : total;
  }, 0);
  return (cents / 100).toFixed(2);
};

type CaseItem = { id: string; caseNo: string; type: string; status: string; requestedRefundTotal: string; approvedRefundTotal: string; actualRefundTotal: string; orderNetReceivedAmount: string };
type LineDetail = { id: string; inventoryItemId: string; requestedRefundAmount: string; approvedRefundAmount: string | null; refundedAmount: string; lineRefundedAmount: string; originalProfit: string; restockedCostReversal: string; afterSaleNetProfit: string; inspection: { result: string } | null };
type CaseDetail = CaseItem & { lines: LineDetail[] };

async function get<T>(url: string): Promise<T> { const response = await fetch(url); const body = await response.json().catch(() => ({})); if (!response.ok) throw new Error(body.message || "加载失败"); return body as T; }

type OrderAfterSaleFinancials = {
  totalSalesRefundedAmount: string;
  netReceivedAmount: string;
  afterSaleCaseCount: number;
  activeAfterSaleCaseCount: number;
};

export function SalesAfterSaleOrderSummary({ saleOrderId, saleStatus, actualReceivedAmount, afterSaleFinancials }: { saleOrderId: string; saleStatus: string; actualReceivedAmount: string | null; afterSaleFinancials?: OrderAfterSaleFinancials }) {
  const [cases, setCases] = useState<CaseItem[] | null>(null); const [eligible, setEligible] = useState<boolean | null>(null);
  const load = useCallback(async () => { try { const list = await get<{ items: CaseItem[] }>(`/api/sales-after-sales?saleOrderId=${encodeURIComponent(saleOrderId)}&page=1&pageSize=100`); setCases(list.items); if (saleStatus === "SETTLED" && Number(actualReceivedAmount || "0") > 0) { const candidates = await get<{ items: unknown[] }>(`/api/sales-after-sales/eligible-lines?saleOrderId=${encodeURIComponent(saleOrderId)}&page=1&pageSize=1`); setEligible(candidates.items.length > 0); } else setEligible(false); } catch { setCases([]); setEligible(false); } }, [actualReceivedAmount, saleOrderId, saleStatus]);
  // The API is the source of the order-level after-sales summary.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  if (!cases) return <Card className="rounded-lg shadow-none"><CardContent className="p-4"><Skeleton className="h-8" /></CardContent></Card>;
  const active = cases.filter((item) => !["COMPLETED", "CANCELLED", "REJECTED"].includes(item.status));
  const refunded = afterSaleFinancials?.totalSalesRefundedAmount ?? sumMoney(cases.map((item) => item.actualRefundTotal));
  const orderNetReceived = afterSaleFinancials?.netReceivedAmount ?? cases[0]?.orderNetReceivedAmount ?? actualReceivedAmount;
  const caseCount = afterSaleFinancials?.afterSaleCaseCount ?? cases.length;
  const activeCaseCount = afterSaleFinancials?.activeAfterSaleCaseCount ?? active.length;
  return <Card className="rounded-lg shadow-none" data-testid="sale-after-sales-summary"><CardHeader className="flex-row items-center justify-between"><CardTitle className="text-base">销售售后</CardTitle><Link href={`/sales-after-sales?saleOrderId=${saleOrderId}`} className={buttonVariants({ variant: "outline", size: "sm" })}>查看全部售后</Link></CardHeader><CardContent className="space-y-3 text-sm"><div className="grid gap-3 sm:grid-cols-4"><Info label="关联售后" text={`${caseCount} 单`} /><Info label="进行中" text={`${activeCaseCount} 单`} /><Info label="已退款合计" text={`¥${refunded}`} /><Info label="订单净到账" text={money(orderNetReceived)} /></div>{cases[0] ? <p className="text-xs text-muted-foreground">最近售后：{statusLabels[cases[0].status] || cases[0].status}</p> : <p className="text-xs text-muted-foreground">暂无销售售后记录</p>}{eligible ? <Link href={`/sales-after-sales/new?saleOrderId=${saleOrderId}`} className={buttonVariants()}>发起销售售后</Link> : <p className="text-xs text-muted-foreground">仅已到账且存在可选已售商品的销售订单可发起销售售后。</p>}</CardContent></Card>;
}

export function InventorySalesAfterSaleTrace({ inventoryItemId, itemStatus, ownershipStatus, saleLines }: { inventoryItemId: string; itemStatus: string; ownershipStatus: string; saleLines: { id: string; saleOrder: { id: string; saleNo: string; status: string; actualReceivedAmount: string | null } }[] }) {
  const effective = saleLines.find((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status)); const [cases, setCases] = useState<CaseDetail[] | null>(null); const [canStart, setCanStart] = useState(false);
  const load = useCallback(async () => { if (!effective) { setCases([]); return; } try { const list = await get<{ items: CaseItem[] }>(`/api/sales-after-sales?saleOrderId=${encodeURIComponent(effective.saleOrder.id)}&page=1&pageSize=100`); const details = await Promise.all(list.items.map((item) => get<CaseDetail>(`/api/sales-after-sales/${item.id}`))); setCases(details.filter((item) => item.lines.some((line) => line.inventoryItemId === inventoryItemId))); if (itemStatus === "SOLD" && ownershipStatus === "OWNED" && effective.saleOrder.status === "SETTLED") { const candidates = await get<{ items: { saleLineId: string; inventoryItemId: string }[] }>(`/api/sales-after-sales/eligible-lines?saleOrderId=${encodeURIComponent(effective.saleOrder.id)}&page=1&pageSize=100`); setCanStart(candidates.items.some((line) => line.saleLineId === effective.id && line.inventoryItemId === inventoryItemId)); } } catch { setCases([]); setCanStart(false); } }, [effective, inventoryItemId, itemStatus, ownershipStatus]);
  // The API is the source of the inventory after-sales trace.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { void load(); }, [load]);
  if (!effective) return null;
  return <Card className="rounded-lg shadow-none" data-testid="inventory-sales-after-sales-trace"><CardHeader><CardTitle className="text-base">销售售后追溯</CardTitle></CardHeader><CardContent className="space-y-3 text-sm"><p>原销售：<Link className="underline" href={`/sales/${effective.saleOrder.id}`}>{effective.saleOrder.saleNo}</Link> · {formatSaleStatus(effective.saleOrder.status)}</p>{cases === null ? <Skeleton className="h-10"/> : cases.length ? cases.map((afterSale) => { const line = afterSale.lines.find((item) => item.inventoryItemId === inventoryItemId); return <div key={afterSale.id} className="rounded-md border p-3"><Link className="font-medium underline" href={`/sales-after-sales/${afterSale.id}`}>{afterSale.caseNo}</Link><p className="mt-1 text-xs text-muted-foreground">{typeLabels[afterSale.type]} · {statusLabels[afterSale.status] || afterSale.status}</p>{line ? <div className="mt-2 grid gap-1 text-xs text-muted-foreground"><p>申请 {money(line.requestedRefundAmount)} · 批准 {money(line.approvedRefundAmount)} · 行退款分配 {money(line.lineRefundedAmount)}</p><p>原行利润 {money(line.originalProfit)} · 成本冲回 {money(line.restockedCostReversal)} · 售后净利润 {money(line.afterSaleNetProfit)}</p><p>退货验货：{line.inspection ? inspectionLabels[line.inspection.result] || "待进一步判断" : "未验货"}</p></div> : null}</div>; }) : <p className="text-muted-foreground">暂无销售售后历史</p>}{canStart ? <Link href={`/sales-after-sales/new?saleOrderId=${effective.saleOrder.id}&saleLineId=${effective.id}&inventoryItemId=${inventoryItemId}`} className={buttonVariants({ variant: "outline" })}>发起销售售后</Link> : null}</CardContent></Card>;
}

function Info({ label, text }: { label: string; text: string }) { return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1">{text}</p></div>; }
