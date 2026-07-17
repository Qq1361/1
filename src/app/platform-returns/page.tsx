import { Suspense } from "react";
import { PlatformReturnList } from "@/components/platform-returns/platform-return-list";
import { Skeleton } from "@/components/ui/skeleton";

export default function PlatformReturnsPage() {
  return <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 sm:py-8"><Suspense fallback={<Skeleton className="h-[32rem]" />}><PlatformReturnList /></Suspense></div>;
}
