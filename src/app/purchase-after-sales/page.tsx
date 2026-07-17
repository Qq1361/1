import { Suspense } from "react";
import { PurchaseAfterSalesList } from "@/components/purchase-after-sales/purchase-after-sales-ui";
export default function Page() { return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"><Suspense fallback={<div className="h-80 animate-pulse rounded-lg border" />}><PurchaseAfterSalesList /></Suspense></main>; }
