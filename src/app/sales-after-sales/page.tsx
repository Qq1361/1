import { Suspense } from "react";
import { SalesAfterSalesList } from "@/components/sales-after-sales/sales-after-sales-ui";

export default function SalesAfterSalesPage() {
  return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"><Suspense fallback={<div className="h-80 animate-pulse rounded-lg border" />}><SalesAfterSalesList /></Suspense></main>;
}
