import { Suspense } from "react";
import { SaleDetail } from "@/components/sales/sale-detail";
import { Skeleton } from "@/components/ui/skeleton";

export default async function SaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8"><Suspense fallback={<Skeleton className="h-96 w-full" />}><SaleDetail id={(await params).id} /></Suspense></div>;
}
