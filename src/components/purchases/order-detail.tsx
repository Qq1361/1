"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CircleDollarSign, ImageIcon } from "lucide-react";
import { AttachmentUploader } from "./attachment-uploader";
import { DeleteOrderButton } from "./delete-order-button";
import { LogisticsCard } from "./logistics-card";
import { AllocationBadge, PurchaseStatusBadge } from "./status-badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatItemStatus, formatPlatform, formatSaleStatus } from "@/lib/status-labels";
import type { OrderDto, PurchaseInventoryItemDto } from "@/types/purchase";

export function OrderDetail({ orderId }: { orderId: string }) {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "";
  const [order, setOrder] = useState<OrderDto | null>(null);

  useEffect(() => {
    fetch(`/api/purchase-orders/${orderId}`)
      .then((response) => response.json())
      .then(setOrder);
  }, [orderId]);

  if (!order) {
    return <Skeleton className="h-[32rem] w-full" />;
  }

  const paidTotal = (
    Number(order.totalAmount) + Number(order.shippingAmount)
  ).toFixed(2);
  const inventoryItems = order.items.flatMap((item) => item.inventoryItems ?? []);
  const salesSummary = buildSalesSummary(inventoryItems);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Link
            href={returnTo || "/purchases"}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft />
            {returnTo ? "返回库存详情" : "返回采购订单"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{order.orderNo}</h1>
            <PurchaseStatusBadge status={order.status} />
            <AllocationBadge status={order.allocationStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            付款于 {new Date(order.paidAt).toLocaleDateString("zh-CN")}
            {order.sellerNickname ? ` · 卖家：${order.sellerNickname}` : " · 卖家：未填写"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/purchases/${order.id}/allocate`} className={buttonVariants()}>
            <CircleDollarSign />
            成本分摊
          </Link>
          <DeleteOrderButton order={order} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <LogisticsCard
            order={order}
            onChange={(response) =>
              setOrder({
                ...order,
                ...response.order,
                logisticsEvents: response.events,
              })
            }
          />
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">商品明细</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {order.items.map((item, index) => (
                <div key={item.id} className="space-y-4">
                  {index ? <Separator /> : null}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.skuText || "未填写规格"} · 数量 {item.quantity}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">分摊总成本</p>
                      <p className="text-sm font-medium">
                        {item.allocatedTotalCost
                          ? `¥ ${item.allocatedTotalCost}`
                          : "未分摊"}
                      </p>
                    </div>
                  </div>
                  {item.notes ? (
                    <p className="rounded-md bg-muted/50 p-3 text-xs leading-5">
                      {item.notes}
                    </p>
                  ) : null}
                  <InventorySalesList inventoryItems={item.inventoryItems ?? []} />
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                      <ImageIcon className="size-3.5" />
                      商品图片
                    </div>
                    <AttachmentUploader
                      entityType="PURCHASE_ORDER_ITEM"
                      entityId={item.id}
                      initialAttachments={[]}
                      compact
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">订单附件</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentUploader
                entityType="PURCHASE_ORDER"
                entityId={order.id}
                initialAttachments={[]}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">销售汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SummaryRow label="库存总件数" value={`${salesSummary.totalCount} 件`} />
              <SummaryRow label="已售件数" value={`${salesSummary.soldCount} 件`} />
              <SummaryRow label="未售件数" value={`${salesSummary.unsoldCount} 件`} />
              <Separator />
              <SummaryRow label="已售库存成本合计" value={money(salesSummary.costTotal)} />
              <SummaryRow label="已售成交价合计" value={money(salesSummary.grossTotal)} />
              <SummaryRow label="已售实际到账合计" value={money(salesSummary.receivedTotal)} />
              <SummaryRow label="已售利润合计" value={money(salesSummary.profitTotal)} strong />
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">金额摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">商品金额</span>
                <span>¥ {order.totalAmount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">运费</span>
                <span>¥ {order.shippingAmount}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>实付总额</span>
                <span>¥ {paidTotal}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">订单备注</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              {order.notes || "暂无备注"}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function effectiveSaleLine(item: PurchaseInventoryItemDto) {
  const lines = item.saleLines ?? [];
  return lines.find((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status)) ?? null;
}

function cancelledSaleLine(item: PurchaseInventoryItemDto) {
  const lines = item.saleLines ?? [];
  return lines.find((line) => line.saleOrder.status === "CANCELLED") ?? null;
}

function money(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "未填写";
  return `¥ ${Number(value).toFixed(2)}`;
}

function buildSalesSummary(items: PurchaseInventoryItemDto[]) {
  let soldCount = 0;
  let costTotal = 0;
  let grossTotal = 0;
  let receivedTotal = 0;
  let profitTotal = 0;

  for (const item of items) {
    const line = effectiveSaleLine(item);
    if (!line) continue;
    soldCount += 1;
    costTotal += Number(line.costAmount);
    grossTotal += Number(line.saleOrder.grossAmount);
    receivedTotal += Number(line.saleOrder.actualReceivedAmount ?? 0);
    profitTotal += Number(line.profitAmount);
  }

  return {
    totalCount: items.length,
    soldCount,
    unsoldCount: Math.max(0, items.length - soldCount),
    costTotal,
    grossTotal,
    receivedTotal,
    profitTotal,
  };
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function InventorySalesList({ inventoryItems }: { inventoryItems: PurchaseInventoryItemDto[] }) {
  if (!inventoryItems.length) {
    return (
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">
        暂无库存记录
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">库存销售追溯</p>
      <div className="space-y-2">
        {inventoryItems.map((inventoryItem) => (
          <InventorySaleCard key={inventoryItem.id} item={inventoryItem} />
        ))}
      </div>
    </div>
  );
}

function InventorySaleCard({ item }: { item: PurchaseInventoryItemDto }) {
  const effectiveLines = (item.saleLines ?? []).filter((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status));
  const currentLine = effectiveLines[0] ?? null;
  const cancelledLine = cancelledSaleLine(item);
  const hasDataIssue = effectiveLines.length > 1;

  return (
    <div className="rounded-lg border p-3 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium">{item.inventoryCode}</p>
          <p className="text-muted-foreground">
            {formatItemStatus(item.itemStatus)}
            {item.storageLocation ? ` · ${item.storageLocation}` : ""}
          </p>
        </div>
        <Link href={`/inventory/${item.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          查看库存
        </Link>
      </div>

      {hasDataIssue ? (
        <p className="mt-3 text-destructive">数据异常：存在多个有效销售记录。</p>
      ) : currentLine ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <TraceField label="是否已售出" value="已售出" />
          <TraceField label="销售单号" value={currentLine.saleOrder.saleNo} />
          <TraceField label="销售平台" value={formatPlatform(currentLine.saleOrder.platform)} />
          <TraceField label="销售状态" value={formatSaleStatus(currentLine.saleOrder.status)} />
          <TraceField label="成交价" value={money(currentLine.saleOrder.grossAmount)} />
          <TraceField label="实际到账" value={money(currentLine.saleOrder.actualReceivedAmount)} />
          <TraceField label="利润" value={money(currentLine.profitAmount)} />
          <Link href={`/sales/${currentLine.saleOrder.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })}>
            查看销售订单
          </Link>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground">未售出</p>
          {item.itemStatus === "SOLD" ? <p className="text-destructive">销售记录缺失，请检查数据。</p> : null}
          {cancelledLine ? (
            <div className="rounded-md bg-muted/50 p-2">
              <p className="font-medium">曾取消销售</p>
              <p className="mt-1 text-muted-foreground">
                {cancelledLine.saleOrder.saleNo}
                {cancelledLine.saleOrder.cancelledAt ? ` · ${new Date(cancelledLine.saleOrder.cancelledAt).toLocaleString("zh-CN")}` : ""}
              </p>
              <Link href={`/sales/${cancelledLine.saleOrder.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}>
                查看销售订单
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TraceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words">{value}</p>
    </div>
  );
}
