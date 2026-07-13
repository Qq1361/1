"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type SkuSummaryRow = {
  productName: string;
  sku: string | null;
  localAvailableCount: number;
  platformCount: number;
  soldCount: number;
  unavailableCount: number;
  totalCount: number;
  averageCost: string;
  minCost: string;
  maxCost: string;
  totalCost: string;
};

const filterOptions = [
  { value: "ALL", label: "全部" },
  { value: "LOCAL_AVAILABLE", label: "只看本地可卖 > 0" },
  { value: "PLATFORM", label: "只看平台中 > 0" },
  { value: "SOLD", label: "只看已售 > 0" },
  { value: "UNAVAILABLE", label: "只看不可售 / 异常 > 0" },
];

function detailQuery(row: SkuSummaryRow) {
  return row.sku?.trim() || row.productName;
}

export function InventorySkuSummary() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("ALL");
  const [result, setResult] = useState<{ items: SkuSummaryRow[]; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams();
      if (query.trim()) params.set("query", query.trim());
      if (filter !== "ALL") params.set("filter", filter);
      const response = await fetch(`/api/inventory/sku-summary?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message ?? "SKU 汇总加载失败。");
        return;
      }
      setResult(body);
    } catch {
      setError("网络异常，SKU 汇总加载失败。");
    }
  }, [filter, query]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void load();
    }, 200);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">按商品和 SKU / 色号汇总库存数量。平台已上架 / 可售不等于已售出，只有已售出才计入已售。</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_220px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索商品名、SKU / 色号"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <select
          className="h-9 rounded-lg border bg-background px-2.5 text-sm"
          value={filter}
          onChange={(event) => setFilter(event.target.value)}
        >
          {filterOptions.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
      </div>

      {error ? (
        <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
          {error}
        </div>
      ) : null}

      {!result ? (
        <Skeleton className="h-48" />
      ) : result.items.length ? (
        <>
          <div className="grid gap-3 md:hidden">
            {result.items.map((row) => (
              <Card key={`${row.productName}-${row.sku ?? ""}`} className="rounded-lg shadow-none">
                <CardContent className="space-y-3 p-4">
                  <div>
                    <p className="font-medium">{row.productName}</p>
                    <p className="text-xs text-muted-foreground">SKU / 色号：{row.sku || "未填写"}</p>
                  </div>
                  <div className="grid grid-cols-2 gap-2 text-xs">
                    <span>本地可卖 {row.localAvailableCount}</span>
                    <span>平台中 {row.platformCount}</span>
                    <span>已售 {row.soldCount}</span>
                    <span>不可售 / 异常 {row.unavailableCount}</span>
                    <span>总件数 {row.totalCount}</span>
                    <span>库存成本 ¥{row.totalCost}</span>
                  </div>
                  <Link
                    href={`/inventory?tab=details&query=${encodeURIComponent(detailQuery(row))}`}
                    className={buttonVariants({ variant: "outline", className: "w-full" })}
                  >
                    查看明细
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>商品名</TableHead>
                  <TableHead>SKU / 色号</TableHead>
                  <TableHead>本地可卖数量</TableHead>
                  <TableHead>平台中数量</TableHead>
                  <TableHead>已售数量</TableHead>
                  <TableHead>不可售 / 异常数量</TableHead>
                  <TableHead>总件数</TableHead>
                  <TableHead>平均成本</TableHead>
                  <TableHead>最低成本</TableHead>
                  <TableHead>最高成本</TableHead>
                  <TableHead>库存成本合计</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.items.map((row) => (
                  <TableRow key={`${row.productName}-${row.sku ?? ""}`}>
                    <TableCell className="font-medium">{row.productName}</TableCell>
                    <TableCell>{row.sku || "未填写"}</TableCell>
                    <TableCell>{row.localAvailableCount}</TableCell>
                    <TableCell>{row.platformCount}</TableCell>
                    <TableCell>{row.soldCount}</TableCell>
                    <TableCell>{row.unavailableCount}</TableCell>
                    <TableCell>{row.totalCount}</TableCell>
                    <TableCell>¥{row.averageCost}</TableCell>
                    <TableCell>¥{row.minCost}</TableCell>
                    <TableCell>¥{row.maxCost}</TableCell>
                    <TableCell>¥{row.totalCost}</TableCell>
                    <TableCell className="text-right">
                      <Link
                        href={`/inventory?tab=details&query=${encodeURIComponent(detailQuery(row))}`}
                        className={buttonVariants({ variant: "ghost", size: "sm" })}
                      >
                        查看明细
                      </Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
          暂无数据
        </div>
      )}
    </div>
  );
}
