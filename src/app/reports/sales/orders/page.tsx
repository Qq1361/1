import { Suspense } from "react";
import { SalesOrdersReport } from "@/components/reports/sales-orders-report";
import { Skeleton } from "@/components/ui/skeleton";

export default function SalesReportOrdersPage() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SalesOrdersReport />
      </Suspense>
    </div>
  );
}
