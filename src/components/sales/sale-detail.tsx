"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { formatSaleStatus, formatPlatform, formatFeeType, formatItemStatus } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [settleOpen, setSettleOpen] = useState(false);
  const [settleAmount, setSettleAmount] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingSale, setConfirmingSale] = useState(false);
  const [settlingSale, setSettlingSale] = useState(false);
  const [cancellingSale, setCancellingSale] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const response = await fetch(`/api/sales/${id}`);
      const body = await response.json();
      if (!response.ok) throw new Error(response.status === 404 ? "销售订单不存在" : body.message ?? "加载失败");
      setSale(body);
    } catch (e) {
      setError(e instanceof Error ? e.message : "加载失败");
    }
  }, [id]);

  useEffect(() => {
    fetch(`/api/sales/${id}`)
      .then(async (response) => {
        const body = await response.json();
        if (!response.ok) throw new Error(response.status === 404 ? "销售订单不存在" : body.message ?? "加载失败");
        return body;
      })
      .then(setSale)
      .catch((e) => setError(e instanceof Error ? e.message : "加载失败"));
  }, [id]);

  if (error === "销售订单不存在") return <div className="space-y-4 py-8 text-center"><p className="text-sm text-muted-foreground">销售订单不存在</p><Link href="/sales" className={buttonVariants()}>返回列表</Link></div>;
  if (error) return <div className="space-y-4 py-8 text-center"><p className="text-sm text-destructive">{error}</p><button type="button" className={buttonVariants({ variant: "outline" })} onClick={() => window.location.reload()}>重试</button></div>;
  if (!sale) return <Skeleton className="h-96 w-full" />;

  const feeTotal = sale.feeLines.reduce((s, fl) => s + parseFloat(fl.amount), 0);
  const inventoryCostTotal = sale.lines.reduce((s, l) => s + parseFloat(l.unitCostSnapshot), 0);
  const incomeAmount = parseFloat(sale.actualReceivedAmount || sale.expectedIncome || sale.grossAmount);
  const feeDeducted = sale.actualReceivedAmount || sale.expectedIncome ? 0 : feeTotal;
  const profit = incomeAmount - feeDeducted - parseFloat(sale.shippingCost) - parseFloat(sale.otherCost) - inventoryCostTotal;
  const isBusy = confirmingSale || settlingSale || cancellingSale;

  async function readError(response: Response) {
    const body = await response.json().catch(() => null);
    return body?.message ?? `请求失败（${response.status}）`;
  }

  async function confirmSale() {
    if (!sale) return;
    setConfirmingSale(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/sales/${sale.id}/confirm`, { method: "POST" });
      if (!response.ok) throw new Error(await readError(response));
      toast.success("已确认销售");
      setConfirmOpen(false);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "确认销售失败";
      setActionError(message);
      toast.error(message);
    } finally {
      setConfirmingSale(false);
    }
  }

  async function settleSale() {
    if (!sale) return;
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(settleAmount.trim())) {
      const message = "请输入有效到账金额";
      setActionError(message);
      toast.error(message);
      return;
    }
    setSettlingSale(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/sales/${sale.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ actualReceivedAmount: settleAmount.trim() }),
      });
      if (!response.ok) throw new Error(await readError(response));
      toast.success("已登记到账");
      setSettleOpen(false);
      setSettleAmount("");
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "登记到账失败";
      setActionError(message);
      toast.error(message);
    } finally {
      setSettlingSale(false);
    }
  }

  async function cancelSale() {
    if (!sale) return;
    setCancellingSale(true);
    setActionError(null);
    try {
      const response = await fetch(`/api/sales/${sale.id}/cancel`, { method: "POST" });
      if (!response.ok) throw new Error(await readError(response));
      toast.success(sale.status === "DRAFT" ? "草稿已取消" : "销售已取消");
      setCancelOpen(false);
      await load();
    } catch (e) {
      const message = e instanceof Error ? e.message : "取消销售失败";
      setActionError(message);
      toast.error(message);
    } finally {
      setCancellingSale(false);
    }
  }

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
          <Info label="本次扣费用" text={`¥${feeDeducted.toFixed(2)}`} />
          <Info label="利润（参考）" text={`¥${profit.toFixed(2)}`} />
        </CardContent>
      </Card>

      <Card><CardHeader><CardTitle className="text-base">销售操作</CardTitle></CardHeader>
        <CardContent>
          <SaleActions
            sale={sale}
            isBusy={isBusy}
            confirmingSale={confirmingSale}
            settlingSale={settlingSale}
            cancellingSale={cancellingSale}
            actionError={actionError}
            onOpenConfirm={() => { setActionError(null); setConfirmOpen(true); }}
            onOpenSettle={() => { setActionError(null); setSettleOpen(true); }}
            onOpenCancel={() => { setActionError(null); setCancelOpen(true); }}
          />
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

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>确认销售</AlertDialogTitle>
            <AlertDialogDescription>
              确认销售后，所选库存将变为已售出 SOLD。该操作会写入库存状态。
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={confirmingSale}>取消</AlertDialogCancel>
            <AlertDialogAction disabled={confirmingSale} onClick={(event) => { event.preventDefault(); void confirmSale(); }}>
              {confirmingSale ? <Loader2 className="animate-spin" /> : null}
              确认销售
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={settleOpen} onOpenChange={setSettleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>登记到账</DialogTitle>
            <DialogDescription>
              登记实际到账金额后，销售订单将变为已到账，库存保持已售出。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2">
            <Label htmlFor="actualReceivedAmount">实际到账金额</Label>
            <Input
              id="actualReceivedAmount"
              inputMode="decimal"
              placeholder="0.00"
              value={settleAmount}
              onChange={(event) => setSettleAmount(event.target.value)}
              disabled={settlingSale}
            />
          </div>
          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          <DialogFooter>
            <button type="button" className={buttonVariants({ variant: "outline" })} disabled={settlingSale} onClick={() => setSettleOpen(false)}>取消</button>
            <button type="button" className={buttonVariants()} disabled={settlingSale} onClick={() => void settleSale()}>
              {settlingSale ? <Loader2 className="animate-spin" /> : null}
              确认到账
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={cancelOpen} onOpenChange={setCancelOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>取消销售</AlertDialogTitle>
            <AlertDialogDescription>
              {sale.status === "DRAFT"
                ? "取消草稿不会影响库存。"
                : "取消已确认销售会把库存恢复到确认销售前的状态快照，不一定是已入库。"}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={cancellingSale}>返回</AlertDialogCancel>
            <AlertDialogAction disabled={cancellingSale} onClick={(event) => { event.preventDefault(); void cancelSale(); }}>
              {cancellingSale ? <Loader2 className="animate-spin" /> : null}
              确认取消
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function SaleActions({
  sale,
  isBusy,
  confirmingSale,
  settlingSale,
  cancellingSale,
  actionError,
  onOpenConfirm,
  onOpenSettle,
  onOpenCancel,
}: {
  sale: SaleDetail;
  isBusy: boolean;
  confirmingSale: boolean;
  settlingSale: boolean;
  cancellingSale: boolean;
  actionError: string | null;
  onOpenConfirm: () => void;
  onOpenSettle: () => void;
  onOpenCancel: () => void;
}) {
  const disabled = isBusy;
  if (sale.status === "DRAFT") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonVariants()} disabled={disabled} onClick={onOpenConfirm}>
            {confirmingSale ? <Loader2 className="animate-spin" /> : null}
            确认销售
          </button>
          <button type="button" className={buttonVariants({ variant: "outline" })} disabled={disabled} onClick={onOpenCancel}>
            {cancellingSale ? <Loader2 className="animate-spin" /> : null}
            取消草稿
          </button>
        </div>
        <p className="text-sm text-muted-foreground">草稿不占用库存。只有确认销售后，库存才会由后端变为已售出。</p>
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      </div>
    );
  }
  if (sale.status === "CONFIRMED") {
    return (
      <div className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <button type="button" className={buttonVariants()} disabled={disabled} onClick={onOpenSettle}>
            {settlingSale ? <Loader2 className="animate-spin" /> : null}
            登记到账
          </button>
          <button type="button" className={buttonVariants({ variant: "outline" })} disabled={disabled} onClick={onOpenCancel}>
            {cancellingSale ? <Loader2 className="animate-spin" /> : null}
            取消销售
          </button>
        </div>
        <p className="text-sm text-muted-foreground">已确认销售的库存由后端保持为已售出。取消时会恢复确认销售前的状态快照。</p>
        {actionError ? <p className="text-sm text-destructive">{actionError}</p> : null}
      </div>
    );
  }
  if (sale.status === "SETTLED") {
    return <p className="text-sm text-muted-foreground">已到账销售暂不支持直接取消。如发生退款/退货，后续走退款/退货流程。</p>;
  }
  return <p className="text-sm text-muted-foreground">该销售订单已取消。</p>;
}

function Info({ label, text }: { label: string; text: string }) {
  return <div><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1">{text}</p></div>;
}
