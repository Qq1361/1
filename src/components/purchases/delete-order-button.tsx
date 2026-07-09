"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Info, Loader2, Trash2 } from "lucide-react";
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
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import type { ApiError, OrderDto } from "@/types/purchase";

export function canDeleteOrder(order: {
  status: string;
  shippedAt: string | Date | null;
  deliveredAt: string | Date | null;
}) {
  return (
    !order.shippedAt &&
    !order.deliveredAt &&
    ["PAID", "WAITING_SHIPMENT"].includes(order.status)
  );
}

function nonDeletableReason(order: {
  status: string;
  shippedAt: string | Date | null;
  deliveredAt: string | Date | null;
}) {
  if (order.deliveredAt) return "订单已签收，不能直接删除。";
  if (order.shippedAt) return "订单已发货，不能直接删除。";
  const labels: Record<string, string> = {
    IN_TRANSIT: "订单运输中，不能直接删除。",
    PENDING_INSPECTION: "订单已签收待验货，不能直接删除。",
    PARTIALLY_STOCKED: "订单已部分入库，不能直接删除。",
    STOCKED: "订单已完成入库，不能直接删除。",
    CANCELLED: "订单已取消。",
  };
  return labels[order.status] ?? "订单已进入后续流程，不能直接删除。";
}

export function DeleteOrderButton({ order }: { order: OrderDto }) {
  const deletable = canDeleteOrder(order);

  if (!deletable) {
    return (
      <div
        className="inline-flex items-center gap-2 rounded-lg border border-muted bg-muted/30 px-3 py-2 text-sm text-muted-foreground"
        title={nonDeletableReason(order)}
      >
        <Info className="size-4" />
        <span className="hidden sm:inline">{nonDeletableReason(order)}</span>
        <span className="sm:hidden">不可删除</span>
      </div>
    );
  }

  return <DeletableOrderButton orderId={order.id} />;
}

function DeletableOrderButton({ orderId }: { orderId: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);

  async function remove() {
    setPending(true);
    const response = await fetch(`/api/purchase-orders/${orderId}`, {
      method: "DELETE",
    });
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      toast.error(error.message);
      setPending(false);
      return;
    }
    router.push("/purchases");
    router.refresh();
  }

  return (
    <AlertDialog>
      <AlertDialogTrigger
        render={
          <Button variant="outline" className="text-destructive" type="button" />
        }
      >
        <Trash2 />
        删除订单
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>确定删除采购订单？</AlertDialogTitle>
          <AlertDialogDescription>
            订单、商品明细和关联附件记录将被删除，此操作无法撤销。
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>取消</AlertDialogCancel>
          <AlertDialogAction onClick={remove} disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : null}
            确认删除
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
