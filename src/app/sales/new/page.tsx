import { Suspense } from "react";
import { SaleDraftForm } from "@/components/sales/sale-draft-form";
import { Skeleton } from "@/components/ui/skeleton";

export default function NewSalePage() {
  return (
    <div className="px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <SaleDraftForm />
      </Suspense>
    </div>
  );
}
