import { Suspense } from "react";
import { InventoryPageContent } from "@/components/inventory/inventory-page-content";
import { Skeleton } from "@/components/ui/skeleton";

export default function InventoryPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <InventoryPageContent />
      </Suspense>
    </div>
  );
}
