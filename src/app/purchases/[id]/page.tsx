import { Suspense } from "react";
import { OrderDetail } from "@/components/purchases/order-detail";
import { Skeleton } from "@/components/ui/skeleton";

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <Suspense fallback={<Skeleton className="h-[32rem] w-full" />}>
        <OrderDetail orderId={id} />
      </Suspense>
    </div>
  );
}
