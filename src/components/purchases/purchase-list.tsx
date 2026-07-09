"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { ChevronLeft, ChevronRight, Plus, Search, X } from "lucide-react";
import { AllocationBadge, PurchaseStatusBadge } from "./status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
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

type Row = {
  id: string;
  orderNo: string;
  sellerNickname: string | null;
  status: string;
  allocationStatus: "UNALLOCATED" | "DRAFT" | "CONFIRMED";
  totalAmount: string;
  shippingAmount: string;
  paidAt: string;
  _count: { items: number };
};

type ResponseData = {
  data: Row[];
  page: number;
  total: number;
  totalPages: number;
};

const todoLabels: Record<string, string> = {
  missingTracking: "超48小时未填单号",
  logisticsIssues: "物流异常 / 停滞",
};

export function PurchaseList() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const todoParam = searchParams.get("todo") ?? "";
  const trackingParam = searchParams.get("tracking") ?? "";

  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const [allocationStatus, setAllocationStatus] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<ResponseData | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ page: String(page) });
    if (query) params.set("query", query);
    if (status) params.set("status", status);
    if (allocationStatus)
      params.set("allocationStatus", allocationStatus);
    if (todoParam) params.set("todo", todoParam);
    if (trackingParam) params.set("tracking", trackingParam);
    setResult(null);
    fetch(`/api/purchase-orders?${params}`)
      .then((response) => response.json())
      .then(setResult);
  }, [allocationStatus, page, query, status, todoParam, trackingParam]);

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
  }, [load]);

  let title = "采购订单";
  const clearHref = "/purchases";
  if (trackingParam === "missing") {
    title = "采购订单 · 未填快递单号";
  } else if (todoLabels[todoParam]) {
    title = `采购订单 · ${todoLabels[todoParam]}`;
  }
  const hasFilter = !!(todoParam || trackingParam);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">采购管理</p>
          <h1 className="text-2xl font-semibold">{title}</h1>
          {hasFilter ? (
            <Link
              href={clearHref}
              className="mt-1 inline-flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
              清除筛选
            </Link>
          ) : null}
        </div>
        <Link href="/purchases/new" className={buttonVariants()}>
          <Plus />
          新建采购订单
        </Link>
      </div>

      <div className="grid gap-3 sm:grid-cols-[1fr_160px_160px_160px]">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索订单号、卖家昵称、商品名"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value);
              setPage(1);
            }}
          />
        </div>
        <select
          className="h-8 rounded-lg border bg-background px-2.5 text-sm"
          value={status}
          onChange={(event) => {
            setStatus(event.target.value);
            setPage(1);
          }}
          aria-label="采购状态"
        >
          <option value="">全部采购状态</option>
          <option value="PAID">已付款</option>
          <option value="WAITING_SHIPMENT">待发货</option>
          <option value="CANCELLED">已取消</option>
        </select>
        <select
          className="h-8 rounded-lg border bg-background px-2.5 text-sm"
          value={trackingParam}
          onChange={(event) => {
            const v = event.target.value;
            if (v) {
              router.push("/purchases?tracking=missing");
            } else {
              router.push("/purchases");
            }
          }}
          aria-label="物流单号筛选"
        >
          <option value="">全部物流单号</option>
          <option value="missing">未填快递单号</option>
        </select>
        <select
          className="h-8 rounded-lg border bg-background px-2.5 text-sm"
          value={allocationStatus}
          onChange={(event) => {
            setAllocationStatus(event.target.value);
            setPage(1);
          }}
          aria-label="分摊状态"
        >
          <option value="">全部分摊状态</option>
          <option value="UNALLOCATED">未分摊</option>
          <option value="DRAFT">分摊草稿</option>
          <option value="CONFIRMED">已确认</option>
        </select>
      </div>

      <Card className="rounded-lg shadow-none">
        <CardContent className="p-0">
          {!result ? (
            <div className="space-y-2 p-4">
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
              <Skeleton className="h-12" />
            </div>
          ) : result.data.length ? (
            <>
              <div className="hidden md:block">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>订单号</TableHead>
                      <TableHead>付款日期</TableHead>
                      <TableHead>商品</TableHead>
                      <TableHead>实付金额</TableHead>
                      <TableHead>状态</TableHead>
                      <TableHead>分摊</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {result.data.map((order) => (
                      <TableRow
                        key={order.id}
                        className="cursor-pointer transition-colors hover:bg-muted/30"
                        onClick={() => router.push(`/purchases/${order.id}`)}
                      >
                        <TableCell>
                          <Link
                            href={`/purchases/${order.id}`}
                            className="font-medium hover:underline"
                            onClick={(e) => e.stopPropagation()}
                          >
                            {order.orderNo}
                          </Link>
                          {order.sellerNickname ? (
                            <p className="text-xs text-muted-foreground">{order.sellerNickname}</p>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          {new Date(order.paidAt).toLocaleDateString("zh-CN")}
                        </TableCell>
                        <TableCell>{order._count.items} 项</TableCell>
                        <TableCell>
                          ¥{" "}
                          {(
                            Number(order.totalAmount) +
                            Number(order.shippingAmount)
                          ).toFixed(2)}
                        </TableCell>
                        <TableCell>
                          <PurchaseStatusBadge status={order.status} />
                        </TableCell>
                        <TableCell>
                          <AllocationBadge status={order.allocationStatus} />
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
              <div className="divide-y md:hidden">
                {result.data.map((order) => (
                  <Link
                    key={order.id}
                    href={`/purchases/${order.id}`}
                    className="block space-y-3 rounded-lg p-4 transition-colors hover:bg-muted/30"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium">{order.orderNo}</p>
                        <p className="text-xs text-muted-foreground">
                          {order.sellerNickname ? `卖家：${order.sellerNickname} · ` : ""}{order._count.items} 项商品
                        </p>
                      </div>
                      <p className="text-sm font-semibold">
                        ¥{" "}
                        {(
                          Number(order.totalAmount) +
                          Number(order.shippingAmount)
                        ).toFixed(2)}
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <PurchaseStatusBadge status={order.status} />
                      <AllocationBadge status={order.allocationStatus} />
                    </div>
                  </Link>
                ))}
              </div>
            </>
          ) : (
            <div className="py-16 text-center text-sm text-muted-foreground">
              没有符合条件的采购订单
            </div>
          )}
        </CardContent>
      </Card>

      {result ? (
        <div className="flex items-center justify-between">
          <p className="text-xs text-muted-foreground">
            共 {result.total} 条
          </p>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page <= 1}
              onClick={() => setPage((value) => value - 1)}
              aria-label="上一页"
            >
              <ChevronLeft />
            </Button>
            <span className="text-sm">
              {page} / {result.totalPages}
            </span>
            <Button
              variant="outline"
              size="icon-sm"
              disabled={page >= result.totalPages}
              onClick={() => setPage((value) => value + 1)}
              aria-label="下一页"
            >
              <ChevronRight />
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
