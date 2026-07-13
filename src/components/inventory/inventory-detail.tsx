"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { formatItemStatus, formatSaleMode, formatLineStatus, formatBatchStatus, formatPurpose, formatPlatform, formatSaleStatus } from "@/lib/status-labels";
import { AttachmentUploader } from "@/components/purchases/attachment-uploader";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AttachmentDto } from "@/types/purchase";

const locationStatusLabels: Record<string, string> = {
  LOCAL: "本地仓",
  DEWU_WAREHOUSE: "得物仓",
  RETURNING: "退回中",
  SOLD: "已售出",
};

type Detail = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  unitCost: string;
  expiryDate: string | null;
  stockedAt: string;
  locationStatus: string;
  storageLocation: string | null;
  saleMode: string;
  itemStatus: string;
  inspectionId: string;
  inspection: {
    sequence: number;
    result: string;
    hasBox: boolean | null;
    capCondition: string | null;
    paintCondition: string | null;
    leakageCondition: string | null;
    isNew: boolean | null;
    hasUsageTrace: boolean | null;
    batchCode: string | null;
    appearanceNotes: string | null;
    notes: string | null;
    completedAt: string | null;
  };
  purchaseOrderItem: {
    name: string;
    skuText: string | null;
    purchaseOrder: { id: string; orderNo: string; sellerNickname: string | null };
  };
  attachments: AttachmentDto[];
  shipmentLines?: ShipmentLineInfo[];
  saleLines?: SaleLineInfo[];
};

interface ShipmentLineInfo {
  id: string; lineStatus: string; inventoryCodeSnapshot: string;
  rejectedReason: string | null; returnCarrierCode: string | null;
  returnTrackingNo: string | null; returnedAt: string | null; returnedStorageLocation: string | null;
  batch: { id: string; batchNo: string; platform: string; defaultPurpose: string; status: string; carrierCode: string | null; trackingNo: string | null; shippedAt: string | null; receivedAt: string | null; };
  group: { groupName: string | null; platformOrderNo: string | null; } | null;
}

interface SaleLineInfo {
  id: string;
  unitCostSnapshot: string;
  saleAmount: string;
  costAmount: string;
  profitAmount: string;
  saleOrder: {
    id: string;
    saleNo: string;
    platform: string;
    platformOrderNo: string | null;
    platformTradeNo: string | null;
    soldAt: string;
    grossAmount: string;
    expectedIncome: string | null;
    actualReceivedAmount: string | null;
    shippingCost: string;
    otherCost: string;
    status: string;
    cancelledAt: string | null;
    feeLines: { amount: string }[];
  };
}

function value(value: unknown) {
  if (value === true) return "是";
  if (value === false) return "否";
  return value ? String(value) : "未填写";
}

export function InventoryDetail({ id }: { id: string }) {
  const [item, setItem] = useState<Detail | null>(null);
  useEffect(() => {
    fetch(`/api/inventory/${id}`).then((response) => response.json()).then(setItem);
  }, [id]);

  if (!item) return <Skeleton className="h-[30rem]" />;
  const fields: [string, unknown][] = [
    ["是否有盒", item.inspection.hasBox],
    ["是否全新", item.inspection.isNew],
  ];
  if (item.inspection.isNew === false) {
    fields.push(
      ["使用痕迹", item.inspection.hasUsageTrace],
      ["盖子状态", item.inspection.capCondition],
      ["掉漆情况", item.inspection.paintCondition],
      ["漏液情况", item.inspection.leakageCondition],
    );
  }
  fields.push(
    ["批号", item.inspection.batchCode],
    ["外观备注", item.inspection.appearanceNotes],
    ["验货备注", item.inspection.notes],
  );

  return (
    <div className="space-y-5">
      <Link href="/inventory" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft /> 返回库存
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{item.inventoryCode}</p>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <p className="text-sm text-muted-foreground">{item.skuText || "无 SKU"}</p>
        </div>
        <Badge variant={item.itemStatus === "PROBLEM" ? "destructive" : "secondary"}>
          {formatItemStatus(item.itemStatus)}
        </Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-lg shadow-none">
          <CardHeader><CardTitle className="text-base">库存信息</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Info label="单件成本" text={`¥${item.unitCost}`} />
            <Info label="入库时间" text={new Date(item.stockedAt).toLocaleString("zh-CN")} />
            <Info label="效期" text={item.expiryDate ? new Date(item.expiryDate).toLocaleDateString("zh-CN") : "未填写"} />
            <Info label="位置大类" text={locationStatusLabels[item.locationStatus] ?? item.locationStatus} />
            <Info label="具体库位" text={item.storageLocation || "未填写"} />
            <SaleModeField itemId={id} currentMode={item.saleMode} onUpdate={(mode) => setItem({ ...item, saleMode: mode })} />
            <Info label="验货结果" text={item.inspection.result} />
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardHeader><CardTitle className="text-base">采购来源</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="采购订单" text={item.purchaseOrderItem.purchaseOrder.orderNo} />
            {item.purchaseOrderItem.purchaseOrder.orderNo ? (
              <Info label="闲鱼订单号" text={item.purchaseOrderItem.purchaseOrder.orderNo} />
            ) : null}
            <Info label="卖家昵称" text={item.purchaseOrderItem.purchaseOrder.sellerNickname || "未填写"} />
            <Info label="采购明细" text={item.purchaseOrderItem.name} />
            <Info label="SKU" text={item.purchaseOrderItem.skuText || "未填写"} />
            <Info label="单件序号" text={`第 ${item.inspection.sequence} 件`} />
            <Link href={`/purchases/${item.purchaseOrderItem.purchaseOrder.id}?returnTo=/inventory/${item.id}`} className={buttonVariants({ variant: "outline" })}>
              查看采购订单
            </Link>
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-lg shadow-none">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">验货记录</CardTitle>
          <Link
            href={`/inspections/${item.inspectionId}?edit=true`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Pencil />
            编辑验货信息
          </Link>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([label, fieldValue]) => (
            <Info key={String(label)} label={String(label)} text={value(fieldValue)} />
          ))}
        </CardContent>
      </Card>
      <ShipmentTraceCard item={item} />
      <SalesTraceCard item={item} />
      <AttachmentUploader
        entityType="INSPECTION"
        entityId={item.inspectionId}
        initialAttachments={item.attachments}
      />
    </div>
  );
}

function Info({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words">{text}</p>
    </div>
  );
}

function money(value: string | null | undefined) {
  return value ? `¥${Number(value).toFixed(2)}` : "未填写";
}

function incomeBasis(sale: SaleLineInfo["saleOrder"]) {
  if (sale.actualReceivedAmount) return "实际到账";
  if (sale.expectedIncome) return "预计收入";
  return "成交价扣费用";
}

function SalesTraceCard({ item }: { item: Detail }) {
  const lines = item.saleLines || [];
  const effectiveLines = lines.filter((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status));
  const cancelledLine = lines.find((line) => line.saleOrder.status === "CANCELLED");

  if (effectiveLines.length > 1) {
    return (
      <Card className="rounded-lg shadow-none">
        <CardHeader><CardTitle className="text-base">销售结果</CardTitle></CardHeader>
        <CardContent className="space-y-3 text-sm">
          <p className="text-destructive">数据异常：该库存存在多个有效销售记录，请检查数据。</p>
          {effectiveLines.map((line) => (
            <Link key={line.id} href={`/sales/${line.saleOrder.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
              查看销售订单 {line.saleOrder.saleNo}
            </Link>
          ))}
        </CardContent>
      </Card>
    );
  }

  const line = effectiveLines[0];
  if (line) {
    const sale = line.saleOrder;
    const feeTotal = sale.feeLines.reduce((sum, fee) => sum + Number(fee.amount), 0);
    return (
      <Card className="rounded-lg shadow-none">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">销售结果</CardTitle>
          <Link href={`/sales/${sale.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
            查看销售订单
          </Link>
        </CardHeader>
        <CardContent className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-3">
          <Info label="销售单号" text={sale.saleNo} />
          <Info label="销售状态" text={formatSaleStatus(sale.status)} />
          <Info label="销售平台" text={formatPlatform(sale.platform)} />
          <Info label="平台订单号" text={sale.platformOrderNo || "未填写"} />
          <Info label="平台交易号" text={sale.platformTradeNo || "未填写"} />
          <Info label="销售时间" text={new Date(sale.soldAt).toLocaleString("zh-CN")} />
          <Info label="成交价" text={money(sale.grossAmount)} />
          <Info label="预计收入" text={money(sale.expectedIncome)} />
          <Info label="实际到账" text={money(sale.actualReceivedAmount)} />
          <Info label="销售侧运费" text={money(sale.shippingCost)} />
          <Info label="其他成本" text={money(sale.otherCost)} />
          <Info label="费用合计" text={`¥${feeTotal.toFixed(2)}`} />
          <Info label="库存成本快照" text={money(line.unitCostSnapshot)} />
          <Info label="销售行成本" text={money(line.costAmount)} />
          <Info label="利润" text={money(line.profitAmount)} />
          <Info label="收入口径" text={incomeBasis(sale)} />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="rounded-lg shadow-none">
      <CardHeader><CardTitle className="text-base">销售结果</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        {item.itemStatus === "SOLD" ? (
          <p className="text-destructive">销售记录缺失，请检查数据。</p>
        ) : (
          <p className="text-muted-foreground">暂无销售记录</p>
        )}
        {cancelledLine ? (
          <div className="rounded-lg border p-3">
            <p className="font-medium">曾取消销售</p>
            <p className="mt-1 text-muted-foreground">
              {cancelledLine.saleOrder.saleNo}
              {cancelledLine.saleOrder.cancelledAt ? ` · ${new Date(cancelledLine.saleOrder.cancelledAt).toLocaleString("zh-CN")}` : ""}
            </p>
            <Link href={`/sales/${cancelledLine.saleOrder.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3" })}>
              查看销售订单
            </Link>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function ShipmentTraceCard({ item }: { item: { id: string; itemStatus: string; shipmentLines?: ShipmentLineInfo[] } }) {
  // Find active line (not RETURNED/CANCELLED) or latest
  const lines = item.shipmentLines || [];
  const activeLine = lines.find(l => !["RETURNED", "CANCELLED", "SOLD"].includes(l.lineStatus));
  const latestLine = activeLine || lines[0];

  if (!latestLine) {
    return (
      <Card className="rounded-lg shadow-none">
        <CardHeader><CardTitle className="text-base">平台寄送追溯</CardTitle></CardHeader>
        <CardContent><p className="text-sm text-muted-foreground">暂无平台寄送记录</p></CardContent>
      </Card>
    );
  }

  const b = latestLine.batch;
  const g = latestLine.group;
  const isHistorical = !activeLine && !!latestLine;

  return (
    <Card className="rounded-lg shadow-none">
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">
          平台寄送追溯{isHistorical ? "（历史记录）" : ""}
        </CardTitle>
        <Link href={`/shipments/${b.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          查看寄送批次
        </Link>
      </CardHeader>
      <CardContent className="grid grid-cols-2 gap-3 text-sm">
        <Info label="所属寄送批次" text={b.batchNo} />
        <Info label="平台" text={formatPlatform(b.platform)} />
        <Info label="寄送目的" text={formatPurpose(b.defaultPurpose)} />
        <Info label="批次状态" text={formatBatchStatus(b.status)} />
        <Info label="单件寄送状态" text={formatLineStatus(latestLine.lineStatus)} />
        <Info label="当前库存状态" text={formatItemStatus(item.itemStatus)} />
        <Info label="快递公司" text={b.carrierCode || "未填写"} />
        <Info label="快递单号" text={b.trackingNo || "未填写"} />
        <Info label="发货时间" text={b.shippedAt ? new Date(b.shippedAt).toLocaleString("zh-CN") : "未填写"} />
        <Info label="签收时间" text={b.receivedAt ? new Date(b.receivedAt).toLocaleString("zh-CN") : "未签收"} />
        {g?.platformOrderNo ? <Info label="平台订单号" text={g.platformOrderNo} /> : null}
        {g?.groupName ? <Info label="平台订单组" text={g.groupName} /> : null}
        {latestLine.rejectedReason ? <Info label="拒收原因" text={latestLine.rejectedReason} /> : null}
        {latestLine.returnCarrierCode ? <Info label="退回快递公司" text={latestLine.returnCarrierCode} /> : null}
        {latestLine.returnTrackingNo ? <Info label="退回快递单号" text={latestLine.returnTrackingNo} /> : null}
        {latestLine.returnedAt ? <Info label="已退回时间" text={new Date(latestLine.returnedAt).toLocaleString("zh-CN")} /> : null}
        {latestLine.returnedStorageLocation ? <Info label="退回库位" text={latestLine.returnedStorageLocation} /> : null}
      </CardContent>
    </Card>
  );
}

function SaleModeField({
  itemId,
  currentMode,
  onUpdate,
}: {
  itemId: string;
  currentMode: string;
  onUpdate: (mode: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState(currentMode);

  async function save(newMode: string) {
    if (newMode === mode) return;
    setPending(true);
    const response = await fetch(`/api/inventory/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleMode: newMode }),
    });
    setPending(false);
    if (!response.ok) {
      const err = await response.json();
      toast.error(err.message ?? "保存失败");
      return;
    }
    setMode(newMode);
    onUpdate(newMode);
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">出售方式</p>
      <div className="mt-1 flex items-center gap-2">
        <select
          className="h-7 rounded-lg border bg-background px-2 text-xs"
          value={mode}
          disabled={pending}
          onChange={(e) => save(e.target.value)}
        >
          {["NONE", "DEWU_LIGHTNING", "DEWU_STANDARD", "NINETY_FIVE", "XIANYU", "OTHER"].map(value => (
            <option key={value} value={value}>{formatSaleMode(value)}</option>
          ))}
        </select>
        {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
      </div>
    </div>
  );
}
