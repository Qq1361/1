import { Suspense } from "react";
import { SaleList } from "@/components/sales/sale-list";
import { Skeleton } from "@/components/ui/skeleton";

export default function SalesPage() {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><Suspense fallback={<Skeleton className="h-96 w-full" />}><SaleList /></Suspense></div>;
}
