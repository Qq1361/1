"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  productionDate: string | null;
  shelfLifeMonths: number | null;
  expiryDate: string | null;
  stockedAt: string;
  itemStatus: string;
  locationStatus: string;
  storageLocation: string | null;
  displayStorageLocation: string;
  saleMode: string;
  ownershipStatus: string;
  warehouseId: string | null;
  storageLocationId: string | null;
  condition: "NEW" | "LIKE_NEW" | "LIGHTLY_USED" | "USED" | "FLAWED";
};

type SelectedInventoryMeta = Pick<InventoryRow, "id" | "name" | "skuText" | "warehouseId" | "itemStatus">;
type WarehouseOption = { id: string; name: string; locations: { id: string; name: string; isActive: boolean }[] };
type BulkOperation = "MOVE_LOCATION" | "SET_CONDITION" | "SET_SALE_MODE" | "SET_SHELF_LIFE";
type BulkSkuPreview = {
  selectionFingerprint: string;
  selectedCount: number;
  updateCount: number;
  skippedCount: number;
  changes: {
    inventoryItemId: string;
    inventoryCode: string;
    name: string;
    oldSku: string | null;
    newSku: string | null;
    result: string;
    willUpdate: boolean;
  }[];
};

const inventoryStatusOptions = SUPPORTED_INVENTORY_ITEM_STATUSES;

const bulkSkuResultLabels: Record<string, string> = {
  WILL_UPDATE: "将更新",
  SKU_ALREADY_EXISTS: "已有 SKU，默认保留",
  HISTORICAL_ITEM_EXCLUDED: "已售档案，未选择包含",
  LEGACY_STATUS_EXCLUDED: "旧状态档案，未处理",
  NO_CHANGE: "与新 SKU 相同，无需修改",
};

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
  const [warehouseId, setWarehouseId] = useState("ALL");
  const [condition, setCondition] = useState("ALL");
  const [saleMode, setSaleMode] = useState("ALL");
  const [shelfLife, setShelfLife] = useState("ALL");
  const [sort, setSort] = useState("STOCKED_AT_DESC");
  const [page, setPage] = useState(1);
  const [result, setResult] = useState<{ data: InventoryRow[]; total: number; page: number; totalPages: number } | null>(
    null,
  );
  const [warehouses, setWarehouses] = useState<WarehouseOption[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [selectedMetadata, setSelectedMetadata] = useState<Record<string, SelectedInventoryMeta>>({});
  const selectedIdsRef = useRef<string[]>([]);
  const [bulkOpen, setBulkOpen] = useState(false);
  const [bulkSkuText, setBulkSkuText] = useState("");
  const [overwriteExisting, setOverwriteExisting] = useState(false);
  const [allowMixedProducts, setAllowMixedProducts] = useState(false);
  const [includeHistorical, setIncludeHistorical] = useState(false);
  const [bulkSkuPreview, setBulkSkuPreview] = useState<BulkSkuPreview | null>(null);
  const [bulkSkuPreviewPending, setBulkSkuPreviewPending] = useState(false);
  const [bulkPending, setBulkPending] = useState(false);
  // A concrete operation owns its dialog.  There is no generic field-patch dialog.
  const [maintenanceDialog, setMaintenanceDialog] = useState<BulkOperation | null>(null);
  const [operation, setOperation] = useState<BulkOperation>("MOVE_LOCATION");
  const [targetWarehouseId, setTargetWarehouseIdState] = useState("");
  const [targetLocationId, setTargetLocationIdState] = useState("");
  const [targetCondition, setTargetConditionState] = useState("LIKE_NEW");
  const [targetSaleMode, setTargetSaleModeState] = useState("NONE");
  const setTargetWarehouseId = (value: string | null) => setTargetWarehouseIdState(value ?? "");
  const setTargetLocationId = (value: string | null) => setTargetLocationIdState(value ?? "");
  const setTargetCondition = (value: string | null) => setTargetConditionState(value ?? "");
  const setTargetSaleMode = (value: string | null) => setTargetSaleModeState(value ?? "");
  const [productionDate, setProductionDate] = useState("");
  const [shelfLifeMonths, setShelfLifeMonths] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [productionDateMode, setProductionDateMode] = useState<"KEEP" | "SET" | "CLEAR">("KEEP");
  const [shelfLifeMonthsMode, setShelfLifeMonthsMode] = useState<"KEEP" | "SET" | "CLEAR">("KEEP");
  const [expiryDateMode, setExpiryDateMode] = useState<"KEEP" | "SET" | "CLEAR" | "AUTO">("KEEP");
  const [shelfReason, setShelfReason] = useState("");
  const [confirmMixed, setConfirmMixed] = useState(false);
  const [preview, setPreview] = useState<{ selectionFingerprint: string; blockedItems: { inventoryCode: string; reason: string }[]; changedCount: number; productSkuCount: number; warehouseCount: number; changes: { inventoryCode: string; changed: boolean; before: Record<string, unknown>; after: Record<string, unknown> }[] } | null>(null);
  const [previewPending, setPreviewPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const params = new URLSearchParams();
    if (query) params.set("query", query);
    if (status !== "ALL") params.set("itemStatus", status);
    if (warehouseId !== "ALL") params.set("warehouseId", warehouseId);
    if (condition !== "ALL") params.set("condition", condition);
    if (saleMode !== "ALL") params.set("saleMode", saleMode);
    if (shelfLife !== "ALL") params.set("shelfLife", shelfLife);
    params.set("sort", sort);
    params.set("page", String(page));
    if (reminderParam) params.set("reminder", reminderParam);
    if (productNameExact) params.set("productNameExact", productNameExact);
    if (skuExact) params.set("skuExact", skuExact);
    if (skuEmpty) params.set("skuEmpty", "true");
    const response = await fetch(`/api/inventory?${params}`);
    const body = await response.json();
    if (!response.ok) { setError(body?.message ?? "库存加载失败。"); return; }
    setError(null); setResult(body);
    // A refresh may follow another tab deleting or transferring an item.  Retain
    // cross-page selections that still exist, but drop only IDs that became stale.
    const idsAtRequest = selectedIdsRef.current;
    if (idsAtRequest.length) {
      void fetch("/api/inventory/selection-status", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inventoryItemIds: idsAtRequest }) })
        .then(async (selectionResponse) => selectionResponse.ok ? selectionResponse.json() : null)
        .then((selection) => {
          if (!selection) return;
          const validIds = new Set<string>(selection.inventoryItemIds);
          const queriedIds = new Set(idsAtRequest);
          setSelectedIds((current) => current.filter((id) => !queriedIds.has(id) || validIds.has(id)));
          setSelectedMetadata((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !queriedIds.has(id) || validIds.has(id))));
        })
        .catch(() => undefined);
    }
  }, [query, status, warehouseId, condition, saleMode, shelfLife, sort, page, reminderParam, productNameExact, skuExact, skuEmpty]);

  useEffect(() => { selectedIdsRef.current = selectedIds; }, [selectedIds]);

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

  useEffect(() => { void fetch("/api/inventory/warehouses?activeOnly=true").then((response) => response.ok ? response.json() : []).then(setWarehouses).catch(() => setWarehouses([])); }, []);

  const title = reminderLabels[reminderParam] ? `库存 · ${reminderLabels[reminderParam]}` : "库存";

  const selectedItems = useMemo(() => Object.values(selectedMetadata), [selectedMetadata]);
  const productCount = new Set(selectedItems.map((item) => item.name)).size;
  const historicalCount = selectedItems.filter((item) => item.itemStatus === "SOLD").length;
  const toSelectedMeta = (item: InventoryRow): SelectedInventoryMeta => ({ id: item.id, name: item.name, skuText: item.skuText, warehouseId: item.warehouseId, itemStatus: item.itemStatus });
  const addSelectedItems = (items: SelectedInventoryMeta[]) => {
    setSelectedIds((current) => [...new Set([...current, ...items.map((item) => item.id)])]);
    setSelectedMetadata((current) => ({ ...current, ...Object.fromEntries(items.map((item) => [item.id, item])) }));
  };
  const clearSelection = () => { setSelectedIds([]); setSelectedMetadata({}); };
  const toggleSelected = (item: InventoryRow) => {
    const isSelected = selectedIds.includes(item.id);
    setSelectedIds((current) => isSelected ? current.filter((value) => value !== item.id) : [...current, item.id]);
    setSelectedMetadata((current) => {
      if (!isSelected) return { ...current, [item.id]: toSelectedMeta(item) };
      const remaining = { ...current };
      delete remaining[item.id];
      return remaining;
    });
  };
  const pageAllSelected = Boolean(result?.data.length) && result?.data.every((item) => selectedIds.includes(item.id));
  const targetLocations = warehouses.find((warehouse) => warehouse.id === targetWarehouseId)?.locations.filter((location) => location.isActive) ?? [];
  const selectionStats = useMemo(() => ({ products: new Set(selectedItems.map((item) => `${item.name}\u0000${item.skuText ?? ""}`)).size, warehouses: new Set(selectedItems.map((item) => item.warehouseId).filter(Boolean)).size, statuses: new Set(selectedItems.map((item) => item.itemStatus)).size }), [selectedItems]);
  const selectionQuery = () => ({ query: query || undefined, itemStatus: status === "ALL" ? undefined : status, warehouseId: warehouseId === "ALL" ? undefined : warehouseId, condition: condition === "ALL" ? undefined : condition, saleMode: saleMode === "ALL" ? undefined : saleMode, shelfLife: shelfLife === "ALL" ? undefined : shelfLife, sort, reminder: reminderParam || undefined, productNameExact: productNameExact || undefined, skuExact: skuExact || undefined, skuEmpty: skuEmpty || undefined });
  const toggleCurrentPage = () => {
    const pageItems = result?.data ?? [];
    if (!pageAllSelected) { addSelectedItems(pageItems.map(toSelectedMeta)); return; }
    const pageIds = new Set(pageItems.map((item) => item.id));
    setSelectedIds((current) => current.filter((id) => !pageIds.has(id)));
    setSelectedMetadata((current) => Object.fromEntries(Object.entries(current).filter(([id]) => !pageIds.has(id))));
  };
  async function selectAllMatching() {
    const response = await fetch("/api/inventory/bulk-selection", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(selectionQuery()) });
    const body = await response.json().catch(() => null);
    if (!response.ok) { setError(body?.message ?? "无法获取当前筛选的库存。"); return; }
    setSelectedIds(body.inventoryItemIds); setSelectedMetadata(Object.fromEntries(body.items.map((item: SelectedInventoryMeta) => [item.id, item]))); setError(null);
  }
  function buildOperationPayload() {
    if (operation === "MOVE_LOCATION") return { warehouseId: targetWarehouseId, storageLocationId: targetLocationId };
    if (operation === "SET_CONDITION") return { condition: targetCondition };
    if (operation === "SET_SALE_MODE") return { saleMode: targetSaleMode };
    return {
      productionDate: productionDateMode === "SET" ? { mode: "SET", value: productionDate } : { mode: productionDateMode },
      shelfLifeMonths: shelfLifeMonthsMode === "SET" ? { mode: "SET", value: Number(shelfLifeMonths) } : { mode: shelfLifeMonthsMode },
      expiryDate: expiryDateMode === "SET" ? { mode: "SET", value: expiryDate } : { mode: expiryDateMode },
    };
  }
  async function requestPreview() {
    setPreviewPending(true); setPreview(null);
    try {
      const response = await fetch("/api/inventory/bulk-preview", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inventoryItemIds: selectedIds, operation, payload: buildOperationPayload(), reason: shelfReason || null, confirmMixedProducts: confirmMixed }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "无法预览批量变更。"); return; }
      setPreview(body); setError(null);
    } finally { setPreviewPending(false); }
  }
  async function submitMaintenance() {
    if (!preview) return;
    setBulkPending(true);
    try {
      const response = await fetch("/api/inventory/bulk-update", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inventoryItemIds: selectedIds, operation, payload: buildOperationPayload(), reason: shelfReason || null, confirmMixedProducts: confirmMixed, selectionFingerprint: preview.selectionFingerprint }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "批量维护失败，请重新预览。"); return; }
      setMaintenanceDialog(null); setPreview(null); clearSelection(); await load(); setError(`已更新 ${body.updatedCount} 件库存。`);
    } finally { setBulkPending(false); }
  }
  function clearBulkSkuPreview() {
    setBulkSkuPreview(null);
  }

  async function requestBulkSkuPreview() {
    setBulkSkuPreviewPending(true);
    setBulkSkuPreview(null);
    try {
      const response = await fetch("/api/inventory/bulk-sku", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ inventoryItemIds: selectedIds, skuText: bulkSkuText, overwriteExisting, allowMixedProducts, includeHistorical }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "无法预览批量 SKU 变更。"); return; }
      setBulkSkuPreview(body as BulkSkuPreview);
      setError(null);
    } catch {
      setError("网络异常，无法预览批量 SKU 变更。");
    } finally {
      setBulkSkuPreviewPending(false);
    }
  }

  async function submitBulkSku() {
    if (!bulkSkuPreview) return;
    setBulkPending(true);
    try {
      const response = await fetch("/api/inventory/bulk-sku", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ inventoryItemIds: selectedIds, skuText: bulkSkuText, overwriteExisting, allowMixedProducts, includeHistorical, selectionFingerprint: bulkSkuPreview.selectionFingerprint }) });
      const body = await response.json().catch(() => null);
      if (!response.ok) { setError(body?.message ?? "批量设置 SKU 失败，请重新预览。"); return; }
      setBulkOpen(false); setBulkSkuPreview(null); clearSelection(); await load();
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
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        <div className="relative">
          <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="搜索库存编号、商品名、SKU、库位、采购订单号、卖家昵称"
            value={query}
            onChange={(event) => { setQuery(event.target.value); clearSelection(); setPage(1); }}
          />
        </div>
        <Select value={status} onValueChange={(value) => { setStatus(value ?? "ALL"); clearSelection(); setPage(1); }}>
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
        <Select value={warehouseId} onValueChange={(value) => { setWarehouseId(value ?? "ALL"); clearSelection(); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="仓库" /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">全部仓库</SelectItem>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent>
        </Select>
        <Select value={condition} onValueChange={(value) => { setCondition(value ?? "ALL"); clearSelection(); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="成色" /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">全部成色</SelectItem><SelectItem value="NEW">全新</SelectItem><SelectItem value="LIKE_NEW">近全新</SelectItem><SelectItem value="LIGHTLY_USED">轻微使用</SelectItem><SelectItem value="USED">使用痕迹</SelectItem><SelectItem value="FLAWED">瑕疵</SelectItem></SelectContent>
        </Select>
        <Select value={saleMode} onValueChange={(value) => { setSaleMode(value ?? "ALL"); clearSelection(); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="计划出售方式" /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">全部计划出售方式</SelectItem><SelectItem value="NONE">未设置</SelectItem><SelectItem value="DEWU_LIGHTNING">得物闪购</SelectItem><SelectItem value="DEWU_STANDARD">得物普通</SelectItem><SelectItem value="NINETY_FIVE">95分</SelectItem><SelectItem value="XIANYU">闲鱼</SelectItem><SelectItem value="OTHER">其他</SelectItem></SelectContent>
        </Select>
        <Select value={shelfLife} onValueChange={(value) => { setShelfLife(value ?? "ALL"); clearSelection(); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="保质期" /></SelectTrigger>
          <SelectContent><SelectItem value="ALL">全部保质期</SelectItem><SelectItem value="HAS_EXPIRY">已填写到期日</SelectItem><SelectItem value="NO_EXPIRY">未填写到期日</SelectItem><SelectItem value="EXPIRED">已过期</SelectItem></SelectContent>
        </Select>
        <Select value={sort} onValueChange={(value) => { setSort(value ?? "STOCKED_AT_DESC"); clearSelection(); setPage(1); }}>
          <SelectTrigger><SelectValue placeholder="排序" /></SelectTrigger>
          <SelectContent><SelectItem value="STOCKED_AT_DESC">最近入库</SelectItem><SelectItem value="STOCKED_AT_ASC">最早入库</SelectItem><SelectItem value="EXPIRY_DATE_ASC">到期日优先</SelectItem></SelectContent>
        </Select>
      </div>

      {error ? <p className="text-sm text-destructive">{error}</p> : null}
      {selectedIds.length ? <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
        <div className="flex flex-wrap items-center justify-between gap-2"><span>已选择 {selectedIds.length} 件库存（商品 {selectionStats.products}，仓库 {selectionStats.warehouses}，状态 {selectionStats.statuses}）</span><button type="button" className={buttonVariants({ variant: "ghost", size: "sm" })} onClick={clearSelection}>取消选择</button></div>
       <div className="flex gap-2 overflow-x-auto pb-1"><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={toggleCurrentPage}>{pageAllSelected ? "取消当前页" : "全选当前页"}</button><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => void selectAllMatching()}>全选当前筛选结果</button><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => { setBulkSkuPreview(null); setBulkOpen(true); }}>批量设置 SKU / 色号</button>{([ ["MOVE_LOCATION", "批量调整仓位"], ["SET_CONDITION", "批量设置成色"], ["SET_SALE_MODE", "批量设置计划出售方式"], ["SET_SHELF_LIFE", "批量修正保质期"] ] as const).map(([nextOperation, label]) => <button key={nextOperation} type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => { setOperation(nextOperation); setPreview(null); setMaintenanceDialog(nextOperation); }}>{label}</button>)}</div>
      </div> : result?.data.length ? <div className="flex flex-wrap gap-2"><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={toggleCurrentPage}>全选当前页</button><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={() => void selectAllMatching()}>全选当前筛选结果</button></div> : null}
      {!result ? (
        <Skeleton className="h-48" />
      ) : result.data.length ? (
        <>
          <div className="grid gap-3 md:hidden">
            {result.data.map((item) => (
              <Card key={item.id} className="rounded-lg shadow-none">
                <CardContent className="space-y-3 p-4">
                  <label className="flex min-h-11 items-center gap-2 text-xs text-muted-foreground"><input type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item)} /> 选择此库存</label>
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
                    <span>库位 {item.displayStorageLocation}</span>
                    <span>{formatSaleMode(item.saleMode)}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">到期日期：{item.expiryDate ?? "—"}{item.expiryDate && item.expiryDate < new Date().toISOString().slice(0, 10) ? "（已过期）" : ""}</p>
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
                  <TableHead>到期日期</TableHead>
                  <TableHead>入库天数</TableHead>
                  <TableHead>状态</TableHead>
                  <TableHead />
                </TableRow>
              </TableHeader>
              <TableBody>
                {result.data.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell><input aria-label={`选择 ${item.inventoryCode}`} type="checkbox" checked={selectedIds.includes(item.id)} onChange={() => toggleSelected(item)} /></TableCell>
                    <TableCell>{item.inventoryCode}</TableCell>
                    <TableCell>
                      <p>{item.name}</p>
                      <p className="text-xs text-muted-foreground">{item.skuText || "无 SKU"}</p>
                    </TableCell>
                    <TableCell className="text-xs">{item.displayStorageLocation}</TableCell>
                    <TableCell className="text-xs">{formatSaleMode(item.saleMode)}</TableCell>
                    <TableCell>¥{item.unitCost}</TableCell>
                    <TableCell className="text-xs">{item.expiryDate ?? "—"}{item.expiryDate && item.expiryDate < new Date().toISOString().slice(0, 10) ? <span className="ml-1 text-amber-700">已过期</span> : null}</TableCell>
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
      {result && result.totalPages > 1 ? <div className="flex items-center justify-between text-sm"><span>第 {result.page} / {result.totalPages} 页，共 {result.total} 件</span><div className="flex gap-2"><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={result.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>上一页</button><button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={result.page >= result.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button></div></div> : null}
      <Dialog key={maintenanceDialog ?? "closed"} open={maintenanceDialog !== null} onOpenChange={(open) => { if (!open) { setMaintenanceDialog(null); setPreview(null); } }}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader><DialogTitle>{operation === "MOVE_LOCATION" ? "批量调整仓位" : operation === "SET_CONDITION" ? "批量设置成色" : operation === "SET_SALE_MODE" ? "批量设置计划出售方式" : "批量修正保质期"}</DialogTitle></DialogHeader>
          <div className="space-y-4 text-sm">
            <p>将预览 {selectedIds.length} 件库存的变更；确认后整批原子提交。</p>
            {operation === "MOVE_LOCATION" ? <><div className="space-y-2"><Label htmlFor="bulk-target-warehouse">目标仓库</Label><Select value={targetWarehouseId} onValueChange={(value) => { setTargetWarehouseId(value); setTargetLocationId(""); setPreview(null); }}><SelectTrigger id="bulk-target-warehouse"><SelectValue placeholder="选择仓库" /></SelectTrigger><SelectContent>{warehouses.map((warehouse) => <SelectItem key={warehouse.id} value={warehouse.id}>{warehouse.name}</SelectItem>)}</SelectContent></Select></div><div className="space-y-2"><Label htmlFor="bulk-target-location">目标库位</Label><Select value={targetLocationId} onValueChange={(value) => { setTargetLocationId(value); setPreview(null); }} disabled={!targetWarehouseId}><SelectTrigger id="bulk-target-location"><SelectValue placeholder="选择库位" /></SelectTrigger><SelectContent>{targetLocations.map((location) => <SelectItem key={location.id} value={location.id}>{location.name}</SelectItem>)}</SelectContent></Select></div></> : null}
            {operation === "SET_CONDITION" ? <div className="space-y-2"><Label htmlFor="bulk-target-condition">目标成色</Label><Select value={targetCondition} onValueChange={(value) => { setTargetCondition(value); setPreview(null); }}><SelectTrigger id="bulk-target-condition"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NEW">全新</SelectItem><SelectItem value="LIKE_NEW">近全新</SelectItem><SelectItem value="LIGHTLY_USED">轻微使用</SelectItem><SelectItem value="USED">使用痕迹</SelectItem><SelectItem value="FLAWED">瑕疵</SelectItem></SelectContent></Select></div> : null}
            {operation === "SET_SALE_MODE" ? <div className="space-y-2"><Label htmlFor="bulk-target-sale-mode">计划出售方式</Label><Select value={targetSaleMode} onValueChange={(value) => { setTargetSaleMode(value); setPreview(null); }}><SelectTrigger id="bulk-target-sale-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="NONE">未设置</SelectItem><SelectItem value="DEWU_LIGHTNING">得物闪购</SelectItem><SelectItem value="DEWU_STANDARD">得物普通</SelectItem><SelectItem value="NINETY_FIVE">95分</SelectItem><SelectItem value="XIANYU">闲鱼</SelectItem><SelectItem value="OTHER">其他</SelectItem></SelectContent></Select></div> : null}
            {operation === "SET_SHELF_LIFE" ? <><p className="rounded-md bg-amber-50 p-2 text-amber-900">保质期修正必须填写原因；到期日可根据生产日期和保质期自动计算。</p><div className="grid gap-3 sm:grid-cols-3"><div className="space-y-2"><Label htmlFor="bulk-production-date">生产日期</Label><Select value={productionDateMode} onValueChange={(value) => { setProductionDateMode((value ?? "KEEP") as "KEEP" | "SET" | "CLEAR"); setPreview(null); }}><SelectTrigger id="bulk-production-date-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="KEEP">保持原值</SelectItem><SelectItem value="SET">设置日期</SelectItem><SelectItem value="CLEAR">清空</SelectItem></SelectContent></Select>{productionDateMode === "SET" ? <Input id="bulk-production-date" type="date" value={productionDate} onChange={(event) => { setProductionDate(event.target.value); setPreview(null); }} /> : null}</div><div className="space-y-2"><Label htmlFor="bulk-shelf-life-months">保质期（月）</Label><Select value={shelfLifeMonthsMode} onValueChange={(value) => { setShelfLifeMonthsMode((value ?? "KEEP") as "KEEP" | "SET" | "CLEAR"); setPreview(null); }}><SelectTrigger id="bulk-shelf-life-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="KEEP">保持原值</SelectItem><SelectItem value="SET">设置月数</SelectItem><SelectItem value="CLEAR">清空</SelectItem></SelectContent></Select>{shelfLifeMonthsMode === "SET" ? <Input id="bulk-shelf-life-months" type="number" min="1" max="600" value={shelfLifeMonths} onChange={(event) => { setShelfLifeMonths(event.target.value); setPreview(null); }} /> : null}</div><div className="space-y-2"><Label htmlFor="bulk-expiry-date">到期日期</Label><Select value={expiryDateMode} onValueChange={(value) => { setExpiryDateMode((value ?? "KEEP") as "KEEP" | "SET" | "CLEAR" | "AUTO"); setPreview(null); }}><SelectTrigger id="bulk-expiry-date-mode"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="KEEP">保持原值</SelectItem><SelectItem value="SET">设置日期</SelectItem><SelectItem value="AUTO">自动计算</SelectItem><SelectItem value="CLEAR">清空</SelectItem></SelectContent></Select>{expiryDateMode === "SET" ? <Input id="bulk-expiry-date" type="date" value={expiryDate} onChange={(event) => { setExpiryDate(event.target.value); setPreview(null); }} /> : null}</div></div><div className="space-y-2"><Label htmlFor="bulk-shelf-reason">修改原因</Label><Input id="bulk-shelf-reason" value={shelfReason} onChange={(event) => { setShelfReason(event.target.value); setPreview(null); }} placeholder="请填写根据实物包装修正保质期的原因" /></div></> : null}
            {(operation === "SET_CONDITION" || operation === "SET_SHELF_LIFE") ? <label className="flex gap-2"><input type="checkbox" checked={confirmMixed} onChange={(event) => { setConfirmMixed(event.target.checked); setPreview(null); }} />我确认跨商品或 SKU 应用相同规则</label> : null}
            {preview ? <div className="space-y-2 rounded-md border p-3"><p>预览：将变更 {preview.changedCount} 件；涉及 {preview.productSkuCount} 个商品 / SKU、{preview.warehouseCount} 个仓库。</p>{preview.blockedItems.length ? <div className="rounded bg-destructive/10 p-2 text-destructive">{preview.blockedItems.map((item) => <p key={item.inventoryCode}>{item.inventoryCode}：{item.reason}</p>)}</div> : <><p className="text-emerald-700">未发现锁定库存，确认后将整批提交。</p><div className="max-h-48 space-y-2 overflow-y-auto">{preview.changes.filter((change) => change.changed).map((change) => <div key={change.inventoryCode} className="rounded-md bg-muted/50 p-2 text-xs"><p className="font-medium">{change.inventoryCode}</p><p>变更前：{Object.entries(change.before).map(([key, value]) => `${key}: ${String(value ?? "—")}`).join("；")}</p><p>变更后：{Object.entries(change.after).map(([key, value]) => `${key}: ${String(value ?? "—")}`).join("；")}</p></div>)}</div></>}</div> : null}
          </div>
          <DialogFooter><button type="button" className={buttonVariants({ variant: "outline" })} disabled={bulkPending || previewPending} onClick={() => setMaintenanceDialog(null)}>取消</button>{!preview ? <button type="button" className={buttonVariants()} disabled={previewPending || !selectedIds.length} onClick={() => void requestPreview()}>{previewPending ? "正在预览…" : "预览变更"}</button> : <button type="button" className={buttonVariants()} disabled={bulkPending || preview.blockedItems.length > 0} onClick={() => void submitMaintenance()}>{bulkPending ? "正在提交…" : "确认并批量更新"}</button>}</DialogFooter>
        </DialogContent>
      </Dialog>
      <Dialog open={bulkOpen} onOpenChange={(open) => { setBulkOpen(open); if (!open) setBulkSkuPreview(null); }}>
        <DialogContent className="max-w-lg">
          <DialogHeader><DialogTitle>批量设置 SKU / 色号</DialogTitle></DialogHeader>
          <div className="space-y-3 text-sm">
            <p>已选择 {selectedIds.length} 件库存，涉及 {productCount} 个商品。</p>
            {productCount > 1 ? <p className="rounded-md bg-amber-50 p-2 text-amber-800">包含多个不同商品。默认拒绝提交，需明确确认。</p> : null}
            {historicalCount ? <p className="rounded-md bg-amber-50 p-2 text-amber-800">包含 {historicalCount} 件已售出库存档案。默认不会批量修改。</p> : null}
            <div className="space-y-2"><Label htmlFor="bulkSkuText">新 SKU / 色号</Label><Input id="bulkSkuText" value={bulkSkuText} onChange={(event) => { setBulkSkuText(event.target.value); clearBulkSkuPreview(); }} placeholder="例如 2C0、1W1" /></div>
            <label className="flex gap-2"><input type="checkbox" checked={overwriteExisting} onChange={(event) => { setOverwriteExisting(event.target.checked); clearBulkSkuPreview(); }} />覆盖已有 SKU（默认只补空 SKU）</label>
            <label className="flex gap-2"><input type="checkbox" checked={allowMixedProducts} onChange={(event) => { setAllowMixedProducts(event.target.checked); clearBulkSkuPreview(); }} />我确认允许跨商品批量设置</label>
            <label className="flex gap-2"><input type="checkbox" checked={includeHistorical} onChange={(event) => { setIncludeHistorical(event.target.checked); clearBulkSkuPreview(); }} />我确认包含已售出库存档案</label>
            {bulkSkuPreview ? <div className="space-y-2 rounded-md border p-3"><p>预览：将更新 {bulkSkuPreview.updateCount} 件，保留 {bulkSkuPreview.skippedCount} 件。</p><div className="max-h-52 space-y-2 overflow-y-auto">{bulkSkuPreview.changes.map((change) => <div key={change.inventoryItemId} className="rounded-md bg-muted/50 p-2 text-xs"><p className="font-medium">{change.inventoryCode} · {change.name}</p><p>旧 SKU：{change.oldSku ?? "未填写"}；新 SKU：{change.newSku ?? "未填写"}</p><p className={change.willUpdate ? "text-emerald-700" : "text-amber-700"}>{bulkSkuResultLabels[change.result] ?? change.result}</p></div>)}</div></div> : null}
          </div>
          <DialogFooter><button type="button" className={buttonVariants({ variant: "outline" })} disabled={bulkPending || bulkSkuPreviewPending} onClick={() => setBulkOpen(false)}>取消</button>{!bulkSkuPreview ? <button type="button" className={buttonVariants()} disabled={bulkSkuPreviewPending || !selectedIds.length} onClick={() => void requestBulkSkuPreview()}>{bulkSkuPreviewPending ? "正在预览…" : "预览变更"}</button> : <button type="button" className={buttonVariants()} disabled={bulkPending || bulkSkuPreview.updateCount === 0} onClick={() => void submitBulkSku()}>{bulkPending ? "保存中..." : "确认并批量更新"}</button>}</DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
