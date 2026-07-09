"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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

export function InventoryList() {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [result, setResult] = useState<{ data: InventoryRow[]; total: number } | null>(
    null,
  );

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status !== "ALL") params.set("itemStatus", status);
    const response = await fetch(`/api/inventory?${params}`);
    setResult(await response.json());
  }, [query, status]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  return (
    <div className="space-y-5">
      <div>
        <p className="text-sm text-muted-foreground">单件库存</p>
        <h1 className="text-2xl font-semibold">库存</h1>
      </div>
      <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索库存编号、商品名或 SKU"
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
                      {statusLabels[item.itemStatus] ?? item.itemStatus}
                    </Badge>
                  </div>
                  <div className="grid grid-cols-3 gap-2 text-xs">
                    <span>成本 ¥{item.unitCost}</span>
                    <span>效期 {daysUntil(item.expiryDate)}</span>
                    <span>入库 {daysInStock(item.stockedAt)}</span>
                  </div>
                  <Button className="w-full" variant="outline" render={<Link href={`/inventory/${item.id}`} />}>
                    查看详情
                  </Button>
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
                    <TableCell>¥{item.unitCost}</TableCell>
                    <TableCell>{daysUntil(item.expiryDate)}</TableCell>
                    <TableCell>{daysInStock(item.stockedAt)}</TableCell>
                    <TableCell>
                      <Badge variant={item.itemStatus === "PROBLEM" ? "destructive" : "secondary"}>
                        {statusLabels[item.itemStatus] ?? item.itemStatus}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button variant="ghost" size="sm" render={<Link href={`/inventory/${item.id}`} />}>查看</Button>
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
