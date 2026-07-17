import { Suspense } from "react";
import { MarketList } from "@/components/market/market-list";
import { Skeleton } from "@/components/ui/skeleton";

export default function MarketPage() {
  return (
    <main className="mx-auto max-w-[1440px] p-4 sm:p-6">
      <Suspense fallback={<Skeleton className="h-[34rem]" />}>
        <MarketList />
      </Suspense>
    </main>
  );
}
