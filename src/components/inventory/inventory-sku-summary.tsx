"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = {
  productName: string; skuText: string | null; unsoldCount: number; immediatelySellableCount: number;
  localStockedCount: number; platformListedCount: number; platformTransitCount: number;
  platformWarehouseCount: number; exceptionCount: number; soldCount: number;
  historicalTotalCount: number; averageUnsoldCost: string | null; minUnsoldCost: string | null;
  maxUnsoldCost: string | null; unsoldCostTotal: string;
};

const filters = [
  ["ALL", "全部"], ["LOCAL_AVAILABLE", "本地现货"], ["PLATFORM", "平台中"],
  ["SOLD", "已售出"], ["UNAVAILABLE", "异常待处理"],
] as const;

function detailHref(row: Row) {
  const params = new URLSearchParams({ tab: "details", productNameExact: row.productName });
  if (row.skuText) params.set("skuExact", row.skuText);
  else params.set("skuEmpty", "true");
  return `/inventory?${params.toString()}`;
}

function money(value: string | null) { return value == null ? "—" : `¥${value}`; }

export function InventorySkuSummary() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [result, setResult] = useState<{ items: Row[] } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (filter !== "ALL") params.set("filter", filter);
      const response = await fetch(`/api/inventory/sku-summary?${params}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "SKU 汇总加载失败。"); return; }
      setResult(body);
    } catch { setError("网络异常，SKU 汇总加载失败。"); }
  }, [filter, query]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 200); return () => window.clearTimeout(timer); }, [load]);

  return <div className="space-y-5">
    <div className="space-y-1 text-sm text-muted-foreground">
      <p>未售总数仅统计当前正式支持的库存状态；平台已上架 / 可售不等于已售出。</p>
    </div>
    <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
      <div className="relative"><Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" placeholder="搜索商品名、SKU / 色号" value={query} onChange={(event) => setQuery(event.target.value)} /></div>
      <select className="h-9 rounded-lg border bg-background px-2.5 text-sm" value={filter} onChange={(event) => setFilter(event.target.value)}>{filters.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select>
    </div>
    {error ? <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{error}</div> : null}
    {!result ? <Skeleton className="h-48" /> : result.items.length ? <>
      <div className="grid gap-3 md:hidden">{result.items.map((row) => <Card key={`${row.productName}-${row.skuText ?? ""}`} className="rounded-lg shadow-none"><CardContent className="space-y-3 p-4">
        <div><p className="font-medium">{row.productName}</p><p className="text-xs text-muted-foreground">SKU / 色号：{row.skuText || "未填写"}</p></div>
        <div className="grid grid-cols-2 gap-2 text-xs"><span>未售 {row.unsoldCount}</span><span>立即可卖 {row.immediatelySellableCount}</span><span>已售 {row.soldCount}</span><span>异常待处理 {row.exceptionCount}</span><span>未售成本 {money(row.unsoldCostTotal)}</span></div>
        <Link href={detailHref(row)} className={buttonVariants({ variant: "outline", className: "w-full" })}>查看明细</Link>
      </CardContent></Card>)}</div>
      <div className="overflow-x-auto rounded-lg border"><Table className="min-w-[1300px]"><TableHeader><TableRow>
        <TableHead>商品名</TableHead><TableHead>SKU / 色号</TableHead><TableHead>未售</TableHead><TableHead>立即可卖</TableHead><TableHead>已售</TableHead><TableHead>异常待处理</TableHead><TableHead>本地现货</TableHead><TableHead>平台已上架</TableHead><TableHead>平台流转中</TableHead><TableHead>平台待上架</TableHead><TableHead>历史总件数</TableHead><TableHead>未售平均成本</TableHead><TableHead>未售成本合计</TableHead><TableHead />
      </TableRow></TableHeader><TableBody>{result.items.map((row) => <TableRow key={`${row.productName}-${row.skuText ?? ""}`}>
        <TableCell className="font-medium">{row.productName}</TableCell><TableCell>{row.skuText || "未填写"}</TableCell><TableCell>{row.unsoldCount}</TableCell><TableCell>{row.immediatelySellableCount}</TableCell><TableCell>{row.soldCount}</TableCell><TableCell>{row.exceptionCount}</TableCell><TableCell>{row.localStockedCount}</TableCell><TableCell>{row.platformListedCount}</TableCell><TableCell>{row.platformTransitCount}</TableCell><TableCell>{row.platformWarehouseCount}</TableCell><TableCell>{row.historicalTotalCount}</TableCell><TableCell>{money(row.averageUnsoldCost)}</TableCell><TableCell>{money(row.unsoldCostTotal)}</TableCell><TableCell><Link href={detailHref(row)} className={buttonVariants({ variant: "ghost", size: "sm" })}>查看明细</Link></TableCell>
      </TableRow>)}</TableBody></Table></div>
    </> : <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">暂无数据</div>}
  </div>;
}
