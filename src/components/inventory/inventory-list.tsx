"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { formatItemStatus, formatSaleMode } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

type InventoryRow = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  unitCost: string;
  expiryDate: string | null;
  stockedAt: string;
  itemStatus: string;
  locationStatus: string;
  storageLocation: string | null;
  saleMode: string;
};

const statusLabels: Record<string, string> = {
  STOCKED: "已入库",
  PROBLEM: "问题件",
};

function daysUntil(date: string | null) {
  if (!date) return "未填写";
  return `${Math.ceil((new Date(date).getTime() - Date.now()) / 86_400_000)} 天`;
}

function daysInStock(date: string) {
  return `${Math.max(0, Math.floor((Date.now() - new Date(date).getTime()) / 86_400_000))} 天`;
}

const reminderLabels: Record<string, string> = {
  DISTANCE_TO_395_WITHIN_7_DAYS: "距395天不足7天",
  EXPIRY_UNDER_395: "效期低于395天",
  DISTANCE_TO_365_WITHIN_10_DAYS: "距365天不足10天",
  EXPIRY_UNDER_365: "效期低于365天",
  NINETY_FIVE_EXPIRY_UNDER_90: "95分效期接近限制",
  NINETY_FIVE_EXPIRY_UNDER_60: "95分效期低于60天",
  STOCKED_OVER_3_DAYS: "入库满3天",
};

export function InventoryList() {
  const searchParams = useSearchParams();
  const reminderParam = searchParams.get("reminder") ?? "";

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [result, setResult] = useState<{ data: InventoryRow[]; total: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status !== "ALL") params.set("itemStatus", status);
    if (reminderParam) params.set("reminder", reminderParam);
    const response = await fetch(`/api/inventory?${params}`);
    setResult(await response.json());
  }, [query, status, reminderParam]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  const title = reminderLabels[reminderParam] ? `库存 · ${reminderLabels[reminderParam]}` : "库存";

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">单件库存</p>
        <h1 className="text-2xl font-semibold">{title}</h1>
        {reminderParam ? (
          <Link
            href="/inventory"
            className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
          >
            <X className="size-3" />
            清除筛选
          </Link>
        ) : null}
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索库存编号、商品名、SKU、库位、采购订单号、卖家昵称"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </div>
        <Select value={status} onValueChange={(value) => setStatus(value ?? "ALL")}>
          <SelectTrigger><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="ALL">全部状态</SelectItem>
            <SelectItem value="STOCKED">已入库</SelectItem>
            <SelectItem value="PROBLEM">问题件</SelectItem>
          </SelectContent>
        </Select>
      </div>

      {!result ? (
        <Skeleton className="h-48" />
      ) : result.data.length ? (
        <>
          <div className="grid gap-3 md:hidden">
            {result.data.map((item) => (
              <Card key={item.id} className="rounded-lg shadow-none">
                <CardContent className="space-y-3 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.inventoryCode}</p>
                    </div>
                    <Badge variant={item.itemStatus === "PROBLEM" ? "destructive" : "secondary"}>
                      {formatItemStatus(item.itemStatus)}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <span>成本 ¥{item.unitCost}</span>
                    <span>库位 {item.storageLocation || "未填写"}</span>
                    <span>{formatSaleMode(item.saleMode)}</span>
                  </div>
                  <Link href={`/inventory/${item.id}`} className={buttonVariants({ variant: "outline", className: "w-full" })}>
                    查看详情
                  </Link>
                </CardContent>
              </Card>
            ))}
          </div>
          <div className="hidden rounded-lg border md:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>库存编号</TableHead>
                  <TableHead>商品</TableHead>
                  <TableHead>库位</TableHead>
                  <TableHead>出售方式</TableHead>
                  <TableHead>成本</TableHead>
                  <TableHead>剩余效期</TableHead>
                  <TableHead>入库天数</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>{item.inventoryCode}</TableCell>
                    <TableCell>
                      <p>{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.skuText || "无 SKU"}</p>
                    </TableCell>
                    <TableCell className="text-xs">{item.storageLocation || "未填写"}</TableCell>
                    <TableCell className="text-xs">{formatSaleMode(item.saleMode)}</TableCell>
                    <TableCell>¥{item.unitCost}</TableCell>
                    <TableCell>{daysUntil(item.expiryDate)}</TableCell>
                    <TableCell>{daysInStock(item.stockedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={item.itemStatus === "PROBLEM" ? "destructive" : "secondary"}>
                        {formatItemStatus(item.itemStatus)}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Link href={`/inventory/${item.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>查看</Link>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        </>
      ) : (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">
          暂无符合条件的库存
        </div>
      )}
    </div>
  );
}
