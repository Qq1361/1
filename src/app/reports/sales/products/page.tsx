import { Suspense } from "react";
import { SalesProductsReport } from "@/components/reports/sales-products-report";
import { Skeleton } from "@/components/ui/skeleton";

export default function SalesReportProductsPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SalesProductsReport />
      </Suspense>
    </div>
  );
}
