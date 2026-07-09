"use client";

import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { OrderForm } from "@/components/purchases/order-form";
import { buttonVariants } from "@/components/ui/button";

export default function NewPurchasePage() {
  return (
    <div className="mx-auto w-full max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
      <div className="mb-5 space-y-2">
        <Link
          href="/purchases"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft />
          返回采购订单
        </Link>
        <h1 className="text-2xl font-semibold">新建采购订单</h1>
        <p className="text-sm text-muted-foreground">
          记录闲鱼付款订单及本单包含的全部商品。
        </p>
      </div>
      <OrderForm />
    </div>
  );
}
