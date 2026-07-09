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
import type { OrderDto } from "@/types/purchase";

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
