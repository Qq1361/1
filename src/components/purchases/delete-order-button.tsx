"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Trash2 } from "lucide-react";
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
import type { ApiError } from "@/types/purchase";

export function DeleteOrderButton({ orderId }: { orderId: string }) {
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
