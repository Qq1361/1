"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronLeft, ChevronRight, ExternalLink, Plus, RefreshCw, Search } from "lucide-react";
import { toast } from "sonner";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { marketErrorMessage, marketRequest } from "./market-client";
import { MarketItemBadge, marketLabel, marketPlatforms, money } from "./market-display";
import { MarketItemForm } from "./market-item-form";

type QuoteSummary = { platform: string; expectedIncomeCurrentQuote: string | null; listingPriceCurrentQuote: string | null; manualReferenceCurrentQuote: string | null; latestRecordedAt: string | null };
type Item = { id: string; displayName: string; skuText: string | null; versionText: string | null; conditionText: string | null; packageVariant: string | null; accessoryVariant: string | null; defaultTargetProfitAmount: string | null; isActive: boolean; quoteSummary: QuoteSummary[] };
type Response = { items: Item[]; pagination: { page: number; pageSize: number; total: number; totalPages: number }; appliedFilters: Record<string, string | boolean | null> };

function currentSummary(item: Item) {
  const current = item.quoteSummary.filter((quote) => quote.expectedIncomeCurrentQuote || quote.listingPriceCurrentQuote || quote.manualReferenceCurrentQuote);
  if (!current.length) return null;
  return current.map((quote) => ({
    platform: quote.platform,
    amount: quote.expectedIncomeCurrentQuote ?? quote.listingPriceCurrentQuote ?? quote.manualReferenceCurrentQuote,
  }));
}

export function MarketList() {
  const router = useRouter();
  const pathname = usePathname();
  const search = useSearchParams();
  const query = useMemo(() => new URLSearchParams(search.toString()), [search]);
  const [data, setData] = useState<Response | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null); setData(null);
    try { setData(await marketRequest<Response>(`/api/market/items?${query.toString()}`)); }
    catch (cause) { setError(marketErrorMessage(cause)); }
    finally { setLoading(false); }
  }, [query]);
  useEffect(() => { void Promise.resolve().then(load); }, [load]);

  function update(values: Record<string, string | null>, resetPage = true) {
    const next = new URLSearchParams(query);
    for (const [key, value] of Object.entries(values)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (resetPage) next.set("page", "1");
    router.replace(`${pathname}?${next.toString()}`, { scroll: false });
  }
  const page = Number(query.get("page") ?? "1");

  return <div className="space-y-5" data-testid="market-list">
    <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div><p className="text-sm text-muted-foreground">仅记录人工录入的市场行情，不代表实际到账或自动出售建议。</p><h1 className="text-2xl font-semibold">行情管理</h1></div>
      <div className="flex gap-2"><Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={loading ? "animate-spin" : ""}/>刷新</Button><Button onClick={() => setCreateOpen(true)}><Plus/>新建行情商品</Button></div>
    </div>
    <Card className="rounded-lg shadow-none"><CardContent className="grid gap-3 p-4 md:grid-cols-5">
      <div className="relative md:col-span-2"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground"/><Input className="pl-9" defaultValue={query.get("keyword") ?? ""} placeholder="商品名、SKU、版本、包装或配件" onKeyDown={(event) => { if (event.key === "Enter") update({ keyword: event.currentTarget.value.trim() || null }); }}/></div>
      <select aria-label="商品生命周期" className="h-9 rounded-md border bg-background px-3 text-sm" value={query.get("lifecycleStatus") ?? ""} onChange={(event) => update({ lifecycleStatus: event.target.value || null })}><option value="">全部生命周期</option><option value="ACTIVE">启用中</option><option value="INACTIVE">已停用</option></select>
      <select aria-label="当前行情" className="h-9 rounded-md border bg-background px-3 text-sm" value={query.get("hasCurrentQuote") ?? ""} onChange={(event) => update({ hasCurrentQuote: event.target.value || null })}><option value="">全部当前行情</option><option value="true">有当前有效行情</option><option value="false">暂无当前有效行情</option></select>
      <select aria-label="行情平台" className="h-9 rounded-md border bg-background px-3 text-sm" value={query.get("platform") ?? ""} onChange={(event) => update({ platform: event.target.value || null })}><option value="">全部平台</option>{marketPlatforms.map((platform) => <option key={platform} value={platform}>{marketLabel(platform)}</option>)}</select>
      <select aria-label="每页数量" className="h-9 rounded-md border bg-background px-3 text-sm" value={query.get("pageSize") ?? "20"} onChange={(event) => update({ pageSize: event.target.value })}><option value="20">每页 20 条</option><option value="50">每页 50 条</option><option value="100">每页 100 条</option></select>
    </CardContent></Card>
    {loading ? <Skeleton className="h-[28rem]"/> : error ? <Card className="rounded-lg shadow-none"><CardContent className="space-y-3 py-16 text-center"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => void load()}>重试</Button></CardContent></Card> : !data?.items.length ? <Card className="rounded-lg shadow-none"><CardContent className="py-16 text-center text-sm text-muted-foreground">暂无行情商品</CardContent></Card> : <>
      <div className="space-y-3 md:hidden">{data.items.map((item) => <MarketCard key={item.id} item={item}/>)}</div>
      <Card className="hidden overflow-x-auto rounded-lg shadow-none md:block"><CardContent className="p-0"><table className="w-full min-w-[960px] text-left text-sm"><thead className="border-b bg-muted/30 text-xs text-muted-foreground"><tr><th className="p-3">行情商品</th><th className="p-3">生命周期</th><th className="p-3">当前平台行情</th><th className="p-3">默认目标利润</th><th className="p-3">规格信息</th><th className="p-3"/></tr></thead><tbody>{data.items.map((item) => <tr key={item.id} className="border-b last:border-0 hover:bg-muted/20"><td className="p-3"><Link className="font-medium underline" href={`/market/${item.id}`}>{item.displayName}</Link><p className="mt-1 text-xs text-muted-foreground">SKU / 色号：{item.skuText ?? "未填写"}</p></td><td className="p-3"><MarketItemBadge active={item.isActive}/></td><td className="p-3"><CurrentSummary item={item}/></td><td className="p-3">{money(item.defaultTargetProfitAmount)}</td><td className="p-3 text-xs text-muted-foreground">{[item.versionText, item.conditionText, item.packageVariant, item.accessoryVariant].filter(Boolean).join(" · ") || "未填写"}</td><td className="p-3"><Link href={`/market/${item.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>查看详情<ExternalLink/></Link></td></tr>)}</tbody></table></CardContent></Card>
      <div className="flex items-center justify-between text-sm"><p className="text-muted-foreground">共 {data.pagination.total} 条</p><div className="flex gap-2"><Button variant="outline" size="sm" disabled={page <= 1} onClick={() => update({ page: String(page - 1) }, false)}><ChevronLeft/>上一页</Button><Button variant="outline" size="sm" disabled={page >= data.pagination.totalPages} onClick={() => update({ page: String(page + 1) }, false)}>下一页<ChevronRight/></Button></div></div>
    </>}
    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>新建行情商品</DialogTitle><DialogDescription>系统会在服务端标准化名称和 SKU，不会自动合并疑似重复商品。</DialogDescription></DialogHeader><MarketItemForm onSuccess={(result) => { toast.success("行情商品已创建"); setCreateOpen(false); router.push(`/market/${result.marketItem.id}`); }}/></DialogContent></Dialog>
  </div>;
}

function CurrentSummary({ item }: { item: Item }) {
  const current = currentSummary(item);
  if (!current) return <span className="text-xs text-muted-foreground">暂无当前有效行情，查看详情了解原因</span>;
  return <div className="flex flex-wrap gap-1">{current.map((quote) => <span key={quote.platform} className="rounded border px-2 py-1 text-xs">{marketLabel(quote.platform)} {money(quote.amount)}</span>)}</div>;
}

function MarketCard({ item }: { item: Item }) {
  return <Card className="rounded-lg shadow-none"><CardContent className="space-y-3 p-4"><div className="flex items-start justify-between gap-3"><div className="min-w-0"><Link href={`/market/${item.id}`} className="font-medium underline">{item.displayName}</Link><p className="mt-1 text-xs text-muted-foreground">SKU / 色号：{item.skuText ?? "未填写"}</p></div><MarketItemBadge active={item.isActive}/></div><CurrentSummary item={item}/><div className="grid grid-cols-2 gap-3 text-xs"><p><span className="text-muted-foreground">目标利润</span><br/>{money(item.defaultTargetProfitAmount)}</p><p><span className="text-muted-foreground">规格</span><br/>{[item.versionText, item.conditionText, item.packageVariant, item.accessoryVariant].filter(Boolean).join(" · ") || "未填写"}</p></div><Link href={`/market/${item.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>查看行情详情</Link></CardContent></Card>;
}
