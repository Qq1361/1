"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Loader2, Search } from "lucide-react";
import { toast } from "sonner";
import { formatPlatform, formatSaleStatus } from "@/lib/status-labels";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

type SettlementRow = {
  id: string;
  saleNo: string;
  platform: string;
  platformOrderNo: string | null;
  buyerName: string | null;
  soldAt: string;
  confirmedAt: string | null;
  settledAt: string | null;
  grossAmount: string;
  expectedIncome: string | null;
  actualReceivedAmount: string | null;
  feeTotal: string;
  profitTotal: string;
  status: string;
  lineCount: number;
  itemsSummary: string;
};

type SettlementResult = {
  data: SettlementRow[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
};

const settlementOptions = [
  { value: "UNSETTLED", label: "待到账" },
  { value: "SETTLED", label: "已到账" },
  { value: "ALL", label: "全部" },
];

function money(value: string | null) {
  return value ? `¥${value}` : "未填写";
}

function dateText(value: string | null) {
  return value ? new Date(value).toLocaleString("zh-CN") : "未填写";
}

async function readError(response: Response) {
  const body = await response.json().catch(() => null);
  return body?.message ?? `请求失败：${response.status}`;
}

export function SalesSettlementPage() {
  const [platform, setPlatform] = useState("");
  const [settlementStatus, setSettlementStatus] = useState("UNSETTLED");
  const [keyword, setKeyword] = useState("");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<SettlementResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selectedSale, setSelectedSale] = useState<SettlementRow | null>(null);
  const [actualReceivedAmount, setActualReceivedAmount] = useState("");
  const [settledAt, setSettledAt] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setError(null);
    try {
      const params = new URLSearchParams({
        page: String(page),
        pageSize: "20",
        settlementStatus,
      });
      if (platform) params.set("platform", platform);
      if (keyword.trim()) params.set("keyword", keyword.trim());
      const response = await fetch(`/api/sales/settlements?${params.toString()}`);
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        setError(body?.message ?? "到账数据加载失败。");
        return;
      }
      setResult(body);
    } catch {
      setError("网络异常，到账数据加载失败。");
    }
  }, [keyword, page, platform, settlementStatus]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 250);
    return () => clearTimeout(timer);
  }, [load]);

  function openSettle(row: SettlementRow) {
    setSelectedSale(row);
    setActualReceivedAmount(row.actualReceivedAmount ?? row.expectedIncome ?? "");
    setSettledAt("");
    setNote("");
    setFormError(null);
  }

  async function submitSettle() {
    if (!selectedSale) return;
    if (!/^\d{1,10}(\.\d{1,2})?$/.test(actualReceivedAmount.trim())) {
      setFormError("请输入有效到账金额。");
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const response = await fetch(`/api/sales/${selectedSale.id}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          actualReceivedAmount: actualReceivedAmount.trim(),
          settledAt: settledAt.trim() || undefined,
          note: note.trim() || undefined,
        }),
      });
      if (!response.ok) throw new Error(await readError(response));
      toast.success(selectedSale.status === "SETTLED" ? "到账金额已更新" : "已登记到账");
      setSelectedSale(null);
      await load();
    } catch (err) {
      const message = err instanceof Error ? err.message : "登记到账失败。";
      setFormError(message);
      toast.error(message);
    } finally {
      setSubmitting(false);
    }
  }

  const rows = result?.data ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">销售管理</p>
          <h1 className="text-2xl font-semibold tracking-tight">到账管理</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            集中处理已确认销售的实际到账。登记到账不会修改库存状态。
          </p>
        </div>
        <Link href="/sales" className={buttonVariants({ variant: "outline" })}>
          返回销售订单
        </Link>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">筛选</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-[1fr_140px_140px]">
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input
              className="pl-9"
              placeholder="销售单号、平台订单号、买家、库存编号、商品名、SKU"
              value={keyword}
              onChange={(event) => { setKeyword(event.target.value); setPage(1); }}
            />
          </div>
          <select
            className="h-9 rounded-lg border bg-background px-2.5 text-sm"
            value={settlementStatus}
            onChange={(event) => { setSettlementStatus(event.target.value); setPage(1); }}
          >
            {settlementOptions.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <select
            className="h-9 rounded-lg border bg-background px-2.5 text-sm"
            value={platform}
            onChange={(event) => { setPlatform(event.target.value); setPage(1); }}
          >
            <option value="">全部平台</option>
            <option value="DEWU">得物</option>
            <option value="NINETY_FIVE">95分</option>
            <option value="XIANYU">闲鱼</option>
            <option value="OTHER">其他</option>
          </select>
        </CardContent>
      </Card>

      {error ? (
        <div className="rounded-lg border py-12 text-center text-sm text-destructive">{error}</div>
      ) : !result ? (
        <Skeleton className="h-64 w-full" />
      ) : rows.length === 0 ? (
        <div className="rounded-lg border py-16 text-center text-sm text-muted-foreground">暂无到账数据</div>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">到账订单</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-3 md:hidden">
              {rows.map((row) => (
                <div key={row.id} className="rounded-lg border p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-medium">{row.saleNo}</p>
                      <p className="text-xs text-muted-foreground">{formatPlatform(row.platform)} · {row.itemsSummary || "未填写商品"}</p>
                    </div>
                    <Badge variant="secondary">{formatSaleStatus(row.status)}</Badge>
                  </div>
                  <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                    <Info label="预计收入" value={money(row.expectedIncome)} />
                    <Info label="实际到账" value={money(row.actualReceivedAmount)} />
                    <Info label="利润" value={money(row.profitTotal)} />
                    <Info label="件数" value={`${row.lineCount} 件`} />
                  </div>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => openSettle(row)}>
                      {row.status === "SETTLED" ? "修改到账金额" : "登记到账"}
                    </button>
                    <Link href={`/sales/${row.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
                      查看销售订单
                    </Link>
                  </div>
                </div>
              ))}
            </div>

            <div className="hidden rounded-lg border md:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>销售单号</TableHead>
                    <TableHead>平台</TableHead>
                    <TableHead>状态</TableHead>
                    <TableHead>预计收入</TableHead>
                    <TableHead>实际到账</TableHead>
                    <TableHead>利润</TableHead>
                    <TableHead>到账时间</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <p className="font-medium">{row.saleNo}</p>
                        <p className="text-xs text-muted-foreground">{row.platformOrderNo || "未填写平台订单号"}</p>
                      </TableCell>
                      <TableCell>{formatPlatform(row.platform)}</TableCell>
                      <TableCell><Badge variant="secondary">{formatSaleStatus(row.status)}</Badge></TableCell>
                      <TableCell>{money(row.expectedIncome)}</TableCell>
                      <TableCell>{money(row.actualReceivedAmount)}</TableCell>
                      <TableCell>{money(row.profitTotal)}</TableCell>
                      <TableCell>{dateText(row.settledAt)}</TableCell>
                      <TableCell className="space-x-2 text-right">
                        <button type="button" className={buttonVariants({ size: "sm" })} onClick={() => openSettle(row)}>
                          {row.status === "SETTLED" ? "修改到账金额" : "登记到账"}
                        </button>
                        <Link href={`/sales/${row.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}>
                          详情
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>

            <div className="mt-4 flex items-center justify-between text-sm text-muted-foreground">
              <span>共 {result.total} 条</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  disabled={page <= 1}
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                >
                  上一页
                </button>
                <button
                  type="button"
                  className={buttonVariants({ variant: "outline", size: "sm" })}
                  disabled={result.totalPages === 0 || page >= result.totalPages}
                  onClick={() => setPage((value) => value + 1)}
                >
                  下一页
                </button>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={!!selectedSale} onOpenChange={(open) => { if (!open && !submitting) setSelectedSale(null); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{selectedSale?.status === "SETTLED" ? "修改到账金额" : "登记到账"}</DialogTitle>
            <DialogDescription>
              到账操作只更新销售结算信息和销售行利润，不修改库存状态。
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="actualReceivedAmount">实际到账金额</Label>
              <Input
                id="actualReceivedAmount"
                inputMode="decimal"
                placeholder="0.00"
                value={actualReceivedAmount}
                onChange={(event) => setActualReceivedAmount(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settledAt">到账时间（可选）</Label>
              <Input
                id="settledAt"
                type="datetime-local"
                value={settledAt}
                onChange={(event) => setSettledAt(event.target.value)}
                disabled={submitting}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="settleNote">备注（可选）</Label>
              <Input
                id="settleNote"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                disabled={submitting}
                placeholder="到账流水、差异说明等"
              />
            </div>
            {formError ? <p className="text-sm text-destructive">{formError}</p> : null}
          </div>
          <DialogFooter>
            <button type="button" className={buttonVariants({ variant: "outline" })} disabled={submitting} onClick={() => setSelectedSale(null)}>
              取消
            </button>
            <button type="button" className={buttonVariants()} disabled={submitting} onClick={() => void submitSettle()}>
              {submitting ? <Loader2 className="animate-spin" /> : null}
              确认到账
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1">{value}</p>
    </div>
  );
}
