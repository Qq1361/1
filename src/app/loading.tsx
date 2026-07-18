import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <div
      className="mx-auto w-full max-w-6xl space-y-5 px-4 py-6 sm:px-6 sm:py-8"
      role="status"
      aria-live="polite"
      aria-label="正在加载页面"
    >
      <div className="fixed inset-x-0 top-0 z-40 h-0.5 overflow-hidden bg-foreground/10">
        <span className="route-progress block h-full w-full bg-foreground" />
      </div>
      <span className="sr-only">正在加载页面</span>

      <div className="flex items-center justify-between gap-4">
        <div className="space-y-2">
          <Skeleton className="h-7 w-32" />
          <Skeleton className="h-4 w-56 max-w-[70vw]" />
        </div>
        <Skeleton className="h-10 w-32" />
      </div>

      <div className="overflow-hidden rounded-xl border bg-card">
        <div className="space-y-2 border-b p-4">
          <Skeleton className="h-5 w-28" />
          <Skeleton className="h-4 w-44" />
        </div>
        <div className="grid gap-px bg-border sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="space-y-3 bg-card p-4">
              <Skeleton className="h-4 w-24" />
              <Skeleton className="h-7 w-14" />
            </div>
          ))}
        </div>
      </div>

      <div className="space-y-3 rounded-xl border bg-card p-4">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-12 w-full" />
      </div>
    </div>
  );
}
