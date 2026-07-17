import { Suspense } from "react";
import { MarketDetail } from "@/components/market/market-detail";
import { Skeleton } from "@/components/ui/skeleton";

export default async function MarketItemPage({ params }: { params: Promise<{ marketItemId: string }> }) {
  const { marketItemId } = await params;
  return (
    <main className="mx-auto max-w-[1440px] p-4 sm:p-6">
      <Suspense fallback={<Skeleton className="h-[42rem]" />}>
        <MarketDetail marketItemId={marketItemId} />
      </Suspense>
    </main>
  );
}
