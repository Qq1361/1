"use client";

import { useCallback, useEffect, useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

type Bucket = { count: number; assetCost: string };
type Summary = {
  currentAssets: {
    normalLocal: Bucket;
    platformReturning: Bucket;
    platformReturnedPending: Bucket;
    platformReturnProblem: Bucket;
    otherOwnedUnsold: Bucket;
    totalUnsold: Bucket;
  };
};

function money(value: string) {
  return `¥${value}`;
}

export function InventoryAssetSummary() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/platform-returns/summary");
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.message ?? "库存资产统计加载失败。");
      setSummary(body);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "库存资产统计加载失败。");
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  if (!summary && !error) return <Skeleton className="h-28" />;
  if (error) return <p className="text-sm text-destructive">{error}</p>;

  const assets = summary!.currentAssets;
  const cards = [
    ["本地在库资产", assets.normalLocal],
    ["平台退回途中资产", assets.platformReturning],
    ["已退回待处理资产", assets.platformReturnedPending],
    ["平台退回问题件资产", assets.platformReturnProblem],
    ["其他未售处理中资产", assets.otherOwnedUnsold],
    ["未售资产合计", assets.totalUnsold],
  ] as const;

  return <Card className="rounded-lg shadow-none" data-testid="inventory-asset-summary">
    <CardHeader className="pb-3"><CardTitle className="text-base">库存资产口径</CardTitle></CardHeader>
    <CardContent>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map(([label, bucket]) => <div key={label} className="rounded-md border p-3"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 text-lg font-semibold">{bucket.count} 件</p><p className="text-xs text-muted-foreground">成本 {money(bucket.assetCost)}</p></div>)}
      </div>
      <p className="mt-3 text-xs text-muted-foreground">已退回待处理资产包含“已退回待验货”和“待进一步判断”，后者为子集，不重复计入合计。未售资产合计还包含其他平台流转中的自有库存。</p>
    </CardContent>
  </Card>;
}
