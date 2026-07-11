"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Plus, Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type Row = {
  id: string;
  batchNo: string;
  platform: string;
  purpose: string;
  status: string;
  carrierCode: string | null;
  trackingNo: string | null;
  shippedAt: string | null;
  _count: { lines: number };
};

const platformLabels: Record<string, string> = { DEWU: "得物", NINETY_FIVE: "95分", OTHER: "其他" };
const purposeLabels: Record<string, string> = {
  DEWU_LIGHTNING_INBOUND: "闪电入仓",
  DEWU_STANDARD_FULFILLMENT: "普通寄送",
  NINETY_FIVE_INBOUND: "95分寄送",
  OTHER: "其他",
};
const statusLabels: Record<string, string> = {
  DRAFT: "草稿", SHIPPED: "已发货", RECEIVED: "已签收",
  PARTIALLY_RECEIVED: "部分签收", PARTIALLY_LISTED: "部分上架",
  LISTED: "已上架", PARTIALLY_REJECTED: "部分拒收",
  RETURNING: "退回中", COMPLETED: "已完成", CANCELLED: "已取消",
};

export function ShipmentList() {
  const [query, setQuery] = useState("");
  const [result, setResult] = useState<{ data: Row[]; total: number } | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    setResult(null);
    const r = await fetch(`/api/shipments?${params}`);
    setResult(await r.json());
  }, [query]);

  useEffect(() => { const t = setTimeout(load, 200); return () => clearTimeout(t); }, [load]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">平台寄送</p>
          <h1 className="text-2xl font-semibold">寄送批次</h1>
        </div>
        <Link href="/shipments/new" className={buttonVariants()}><Plus />新建寄送批次</Link>
      </div>

      <div className="relative">
        <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
        <Input className="pl-9" placeholder="搜索批次号、快递单号、库存编号、商品名" value={query} onChange={e => setQuery(e.target.value)} />
      </div>

      {!result ? <Skeleton className="h-48" /> : result.data.length ? (
        <div className="hidden rounded-lg border md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>批次号</TableHead><TableHead>平台</TableHead><TableHead>目的</TableHead>
                <TableHead>库存</TableHead><TableHead>快递</TableHead><TableHead>状态</TableHead><TableHead />
              </TableRow>
            </TableHeader>
            <TableBody>
              {result.data.map(b => (
                <TableRow key={b.id} className="cursor-pointer hover:bg-muted/30" onClick={() => window.location.href = `/shipments/${b.id}`}>
                  <TableCell className="font-medium">{b.batchNo}</TableCell>
                  <TableCell>{platformLabels[b.platform] ?? b.platform}</TableCell>
                  <TableCell className="text-xs">{purposeLabels[b.purpose] ?? b.purpose}</TableCell>
                  <TableCell>{b._count.lines} 件</TableCell>
                  <TableCell className="text-xs">{b.trackingNo || "未填写"}</TableCell>
                  <TableCell><Badge variant="secondary">{statusLabels[b.status] ?? b.status}</Badge></TableCell>
                  <TableCell><Link href={`/shipments/${b.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>详情</Link></TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      ) : (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">暂无寄送批次</div>
      )}
    </div>
  );
}
