import { Suspense } from "react";
import { DailyBusinessReportPage } from "@/components/reports/daily-business-report";
import { Skeleton } from "@/components/ui/skeleton";

export default function DailyReportRoute() {
  return (
    <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <DailyBusinessReportPage />
      </Suspense>
    </div>
  );
}
