"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { formatSaleStatus, formatPlatform, formatFeeType, formatItemStatus } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

interface SaleDetail {
  id: string; saleNo: string; platform: string; platformOrderNo: string | null;
  platformTradeNo: string | null; buyerName: string | null; soldAt: string;
  grossAmount: string; expectedIncome: string | null; actualReceivedAmount: string | null;
  shippingCost: string; otherCost: string; status: string; note: string | null;
  confirmedAt: string | null; settledAt: string | null; cancelledAt: string | null;
  createdAt: string;
  lines: { id: string; inventoryCodeSnapshot: string; productNameSnapshot: string; skuSnapshot: string | null; unitCostSnapshot: string; saleAmount: string; costAmount: string; profitAmount: string; preSaleItemStatus: string; sourceShipmentBatchId: string | null; sourceShipmentLineId: string | null; sourcePurchaseOrderId: string | null; inventoryItem: { id: string; itemStatus: string } | null }[];
  feeLines: { id: string; feeType: string; amount: string; note: string | null }[];
  actionLogs: { id: string; actionType: string; note: string | null; createdAt: string }[];
}

export function SaleDetail({ id }: { id: string }) {
  const [sale, setSale] = useState<SaleDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/sales/${id}`)
      .then(r => { if (!r.ok) throw new Error(r.status === 404 ? "销售订单不存在" : "加载失败"); return r.json(); })
      .then(setSale)
      .catch(e => setError(e.message));
  }, [id]);

  if (error === "销售订单不存在") return <div className="space-y-4 py-8 text-center"><p className="text-sm text-muted-foreground">销售订单不存在</p><Link href="/sales" className={buttonVariants()}>返回列表</Link></div>;
  if (error) return <div className="space-y-4 py-8 text-center"><p className="text-sm text-destructive">{error}</p><button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => window.location.reload()}>重试</button></div>;
  if (!sale) return <Skeleton className="h-96 w-full" />;

  const feeTotal = sale.feeLines.reduce((s, fl) => s + parseFloat(fl.amount), 0);
  const profit = parseFloat(sale.actualReceivedAmount || sale.expectedIncome || sale.grossAmount) - feeTotal - parseFloat(sale.shippingCost) - parseFloat(sale.otherCost) - sale.lines.reduce((s, l) => s + parseFloat(l.unitCostSnapshot), 0);

  return (
    <div className="space-y-5">
      <Link href="/sales" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft />返回销售订单</Link>
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-2xl font-semibold">{sale.saleNo}</h1><p className="text-sm text-muted-foreground">{formatPlatform(sale.platform)}{sale.platformOrderNo ? ` · ${sale.platformOrderNo}` : ""}</p></div>
        <Badge variant="secondary">{formatSaleStatus(sale.status)}</Badge>
      </div>

      <Card><CardHeader><CardTitle className="text-base">基本信息</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="平台" text={formatPlatform(sale.platform)} /><Info label="平台订单号" text={sale.platformOrderNo || "未填写"} />
          <Info label="平台交易号" text={sale.platformTradeNo || "未填写"} /><Info label="买家" text={sale.buyerName || "未填写"} />
          <Info label="销售时间" text={new Date(sale.soldAt).toLocaleString("zh-CN")} />
          <Info label="备注" text={sale.note || "无"} />
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base">金额</CardTitle></CardHeader>
        <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
          <Info label="成交价" text={`¥${sale.grossAmount}`} />
          <Info label="预计收入" text={sale.expectedIncome ? `¥${sale.expectedIncome}` : "未填写"} />
          <Info label="实际到账" text={sale.actualReceivedAmount ? `¥${sale.actualReceivedAmount}` : "未到账"} />
          <Info label="销售侧运费" text={`¥${sale.shippingCost}`} />
          <Info label="其他成本" text={`¥${sale.otherCost}`} />
          <Info label="费用合计" text={`¥${feeTotal.toFixed(2)}`} />
          <Info label="利润（参考）" text={`¥${profit.toFixed(2)}`} />
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base">销售明细（{sale.lines.length} 件）</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          {sale.lines.map(l => (
            <div key={l.id} className="rounded-lg border p-4">
              <div className="grid gap-3 text-sm sm:grid-cols-3">
                <div>
                  <p className="font-medium">{l.productNameSnapshot}</p>
                  <p className="text-xs text-muted-foreground">{l.inventoryCodeSnapshot}{l.skuSnapshot ? ` · ${l.skuSnapshot}` : ""}</p>
                  <p className="text-xs text-muted-foreground">销售前状态：{formatItemStatus(l.preSaleItemStatus)}</p>
                </div>
                <div>
                  <Info label="单件成本" text={`¥${l.unitCostSnapshot}`} />
                  <Info label="销售金额" text={`¥${l.saleAmount}`} />
                </div>
                <div>
                  <Info label="成本" text={`¥${l.costAmount}`} />
                  <Info label="利润" text={`¥${l.profitAmount}`} />
                  {l.inventoryItem ? (
                    <Link href={`/inventory/${l.inventoryItem.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-1" })}>查看库存</Link>
                  ) : null}
                </div>
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      {sale.feeLines.length > 0 ? (
        <Card><CardHeader><CardTitle className="text-base">费用明细</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {sale.feeLines.map(fl => (
              <div key={fl.id} className="flex justify-between"><span>{formatFeeType(fl.feeType)}{fl.note ? `（${fl.note}）` : ""}</span><span>¥{fl.amount}</span></div>
            ))}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}

function Info({ label, text }: { label: string; text: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1">{text}</p></div>;
}
