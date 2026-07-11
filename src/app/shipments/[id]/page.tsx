import { Suspense } from "react";
import { ShipmentDetail } from "@/components/shipments/shipment-detail";
import { Skeleton } from "@/components/ui/skeleton";

export default async function ShipmentDetailPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<Skeleton className="h-96 w-full" />}>
        <ShipmentDetail id={id} />
      </Suspense>
    </div>
  );
}
