import { Suspense } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import { SalesAfterSaleForm } from "@/components/sales-after-sales/sales-after-sales-ui";

export default async function NewSalesAfterSalePage({ searchParams }: { searchParams: Promise<{ saleOrderId?: string; saleLineId?: string; inventoryItemId?: string }> }) {
  const params = await searchParams;
  return <main className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6"><h1 className="mb-5 text-2xl font-semibold">发起销售售后</h1>{params.saleOrderId ? <Suspense fallback={<div className="h-80 animate-pulse rounded-lg border" />}><SalesAfterSaleForm saleOrderId={params.saleOrderId} defaultSaleLineId={params.saleLineId} defaultInventoryItemId={params.inventoryItemId} /></Suspense> : <div className="space-y-4 rounded-lg border p-5 text-sm text-muted-foreground"><p>请从已到账销售订单或库存详情发起销售售后，以确定原销售订单。</p><Link href="/sales" className={buttonVariants({ variant: "outline" })}>查看销售订单</Link></div>}</main>;
}
