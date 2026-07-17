"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";
import { formatInventoryOwnershipStatus, formatItemStatus, formatSaleMode } from "@/lib/status-labels";
import { SUPPORTED_INVENTORY_ITEM_STATUSES } from "@/lib/inventory-item-status-contract";
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
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
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
  ownershipStatus: string;
};

const inventoryStatusOptions = SUPPORTED_INVENTORY_ITEM_STATUSES;

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

export function InventoryList(_props: { showHeader?: boolean } = {}) {
  void _props;
  const searchParams = useSearchParams();
  const reminderParam = searchParams.get("reminder") ?? "";
  const queryParam = searchParams.get("query") ?? "";
  const productNameExact = searchParams.get("productNameExact") ?? "";
  const skuExact = searchParams.get("skuExact") ?? "";
  const skuEmpty = searchParams.get("skuEmpty") === "true";

  const [query, setQuery] = useState(queryParam);
  const [status, setStatus] = useState("ALL");
  const [result, setResult] = useState<{ data: InventoryRow[]; total: number } | null>(
    null,
  );
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSkuText, setBulkSkuText] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [allowMixedProducts, setAllowMixedProducts] = useState(false);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status !== "ALL") params.set("itemStatus", status);
    if (reminderParam) params.set("reminder", reminderParam);
    if (productNameExact) params.set("productNameExact", productNameExact);
    if (skuExact) params.set("skuExact", skuExact);
    if (skuEmpty) params.set("skuEmpty", "true");
    const response = await fetch(`/api/inventory?${params}`);
    const body = await response.json();
    if (!response.ok) { setError(body?.message ?? "库存加载失败。"); return; }
    setError(null); setResult(body);
  }, [query, status, reminderParam, productNameExact, skuExact, skuEmpty]);

  useEffect(() => {
    const timer = setTimeout(load, 200);
    return () => clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setQuery(queryParam);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [queryParam]);

  const title = reminderLabels[reminderParam] ? `库存 · ${reminderLabels[reminderParam]}` : "库存";

  const selectedItems = result?.data.filter((item) => selectedIds.includes(item.id)) ?? [];
  const productCount = new Set(selectedItems.map((item) => item.name)).size;
  const historicalCount = selectedItems.filter((item) => item.itemStatus === "SOLD").length;
  const toggleSelected = (id: string) => setSelectedIds((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]);
  async function submitBulkSku() {
    setBulkPending(true);
    try {
      const response = await fetch("/api/inventory/bulk-sku", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inventoryItemIds: selectedIds, skuText: bulkSkuText, overwriteExisting, allowMixedProducts, includeHistorical }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "批量设置 SKU 失败。"); return; }
      setBulkOpen(false); setSelectedIds([]); await load();
    } catch { setError("网络异常，批量设置 SKU 失败。"); }
    finally { setBulkPending(false); }
  }

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
      {(productNameExact || skuExact || skuEmpty) ? <div className="flex flex-wrap items-center gap-2 text-xs"><span className="rounded-full border px-2 py-1">商品：{productNameExact}</span><span className="rounded-full border px-2 py-1">SKU：{skuEmpty ? "未填写" : skuExact}</span><Link href="/inventory?tab=details" className={buttonVariants({ variant: "ghost", size: "sm" })}>清除精确筛选</Link></div> : null}
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
            {inventoryStatusOptions.map((value) => (
              <SelectItem key={value} value={value}>
                {formatItemStatus(value)}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {selectedIds.length ? <div className="flex items-center justify-between rounded-lg border p-3 text-sm"><span>已选择 {selectedIds.length} 件库存</span><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => setBulkOpen(true)}>批量设置 SKU / 色号</button></div> : null}
      {!result ? (
        <Skeleton className="h-48" />
      ) : result.data.length ? (
        <>
          <div className="grid gap-3 md:hidden">
            {result.data.map((item) => (
              <Card key={item.id} className="rounded-lg shadow-none">
                <CardContent className="space-y-3 p-4">
                  <label className="flex items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} /> 选择此库存</label>
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
                  <p className="text-xs text-muted-foreground">{formatInventoryOwnershipStatus(item.ownershipStatus)}</p>
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
                  <TableHead className="w-10">选择</TableHead>
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
                    <TableCell><input aria-label={`选择 ${item.inventoryCode}`} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item.id)} /></TableCell>
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
                      <p className="mt-1 text-xs text-muted-foreground">{formatInventoryOwnershipStatus(item.ownershipStatus)}</p>
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
      <Dialog open={bulkOpen} onOpenChange={setBulkOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>批量设置 SKU / 色号</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>已选择 {selectedIds.length} 件库存，涉及 {productCount} 个商品。</p>
            {productCount > 1 ? <p className="rounded-md bg-amber-50 p-2 text-amber-800">包含多个不同商品。默认拒绝提交，需明确确认。</p> : null}
            {historicalCount ? <p className="rounded-md bg-amber-50 p-2 text-amber-800">包含 {historicalCount} 件已售出库存档案。默认不会批量修改。</p> : null}
            <div className="space-y-2"><Label htmlFor="bulkSkuText">新 SKU / 色号</Label><Input id="bulkSkuText" value={bulkSkuText} onChange={(event) => setBulkSkuText(event.target.value)} placeholder="例如 2C0、1W1" /></div>
            <label className="flex gap-2"><input type="checkbox" checked={overwriteExisting} onChange={(event) => setOverwriteExisting(event.target.checked)} />覆盖已有 SKU（默认只补空 SKU）</label>
            <label className="flex gap-2"><input type="checkbox" checked={allowMixedProducts} onChange={(event) => setAllowMixedProducts(event.target.checked)} />我确认允许跨商品批量设置</label>
            <label className="flex gap-2"><input type="checkbox" checked={includeHistorical} onChange={(event) => setIncludeHistorical(event.target.checked)} />我确认包含已售出库存档案</label>
          </div>
          <DialogFooter><button type="button" className={buttonVariants({ variant: "outline" })} disabled={bulkPending} onClick={() => setBulkOpen(false)}>取消</button><button type="button" className={buttonVariants()} disabled={bulkPending} onClick={submitBulkSku}>{bulkPending ? "保存中..." : "确认批量设置"}</button></DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
