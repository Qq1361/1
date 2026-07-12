"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { formatSaleStatus, formatPlatform } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = {
  id: string; saleNo: string; platform: string; platformOrderNo: string | null;
  status: string; soldAt: string; grossAmount: string; expectedIncome: string | null;
  actualReceivedAmount: string | null; createdAt: string; _count: { lines: number };
};

export function SaleList() {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [platformFilter, setPlatformFilter] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: Row[]; total: number; totalPages: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (query) params.set("q", query);
      if (statusFilter) params.set("status", statusFilter);
      if (platformFilter) params.set("platform", platformFilter);
      const r = await fetch(`/api/sales?${params}`);
      if (!r.ok) { setError("加载失败"); return; }
      setResult(await r.json());
    } catch { setError("网络异常"); }
  }, [query, statusFilter, platformFilter, page]);

  useEffect(() => { const t = setTimeout(load, 300); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-5">
      <div><p className="text-sm text-muted-foreground">销售管理</p><h1 className="text-2xl font-semibold">销售订单</h1></div>

      <div className="grid gap-3 sm:grid-cols-[1fr_140px_120px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input className="pl-9" placeholder="搜索销售单号、平台订单号、库存编号、商品名" value={query} onChange={e => { setQuery(e.target.value); setPage(1); }} />
        </div>
        <select className="h-8 rounded-lg border bg-background px-2.5 text-sm" value={statusFilter} onChange={e => { setStatusFilter(e.target.value); setPage(1); }}>
          <option value="">全部状态</option>
          <option value="DRAFT">草稿</option><option value="CONFIRMED">已确认销售</option><option value="SETTLED">已到账</option><option value="CANCELLED">已取消</option>
        </select>
        <select className="h-8 rounded-lg border bg-background px-2.5 text-sm" value={platformFilter} onChange={e => { setPlatformFilter(e.target.value); setPage(1); }}>
          <option value="">全部平台</option>
          <option value="DEWU">得物</option><option value="NINETY_FIVE">95分</option><option value="XIANYU">闲鱼</option><option value="OTHER">其他</option>
        </select>
      </div>

      {error ? <p className="py-8 text-center text-sm text-destructive">{error}</p> : !result ? <Skeleton className="h-48" /> : result.data.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">暂无销售订单</div>
      ) : (
        <div className="hidden rounded-lg border md:block">
          <Table>
            <TableHeader><TableRow>
              <TableHead>销售单号</TableHead><TableHead>平台</TableHead><TableHead>平台订单号</TableHead><TableHead>状态</TableHead>
              <TableHead>成交价</TableHead><TableHead>预计收入</TableHead><TableHead>实际到账</TableHead><TableHead>件数</TableHead><TableHead />
            </TableRow></TableHeader>
            <TableBody>
              {result.data.map(s => (
                <TableRow key={s.id} className="cursor-pointer hover:bg-muted/30" onClick={() => window.location.href = `/sales/${s.id}`}>
                  <TableCell className="font-medium">{s.saleNo}</TableCell>
                  <TableCell>{formatPlatform(s.platform)}</TableCell>
                  <TableCell className="text-xs">{s.platformOrderNo || "—"}</TableCell>
                  <TableCell><Badge variant="secondary">{formatSaleStatus(s.status)}</Badge></TableCell>
                  <TableCell>¥{s.grossAmount}</TableCell>
                  <TableCell>{s.expectedIncome ? `¥${s.expectedIncome}` : "—"}</TableCell>
                  <TableCell>{s.actualReceivedAmount ? `¥${s.actualReceivedAmount}` : "—"}</TableCell>
                  <TableCell>{s._count.lines} 件</TableCell>
                  <TableCell><Link href={`/sales/${s.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>详情</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}
    </div>
  );
}
