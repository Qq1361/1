import { Suspense } from "react";
import { SalesSettlementPage } from "@/components/sales/sales-settlement-page";
import { Skeleton } from "@/components/ui/skeleton";

export default function SalesSettlementsPage() {
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SalesSettlementPage />
      </Suspense>
    </div>
  );
}
