"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { ArrowLeft, CircleDollarSign, Copy, ImageIcon, Loader2, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { AttachmentUploader } from "./attachment-uploader";
import { DeleteOrderButton } from "./delete-order-button";
import { LogisticsCard } from "./logistics-card";
import { RealLogisticsCard } from "./real-logistics-card";
import { AllocationBadge, PurchaseStatusBadge } from "./status-badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import { Skeleton } from "@/components/ui/skeleton";
import { formatItemStatus, formatPlatform, formatSaleStatus } from "@/lib/status-labels";
import type { ApiError, OrderDto, OrderItemDto, PurchaseInventoryItemDto } from "@/types/purchase";

type ItemDraft = {
  name: string;
  skuText: string;
  quantity: string;
  referenceAmount: string;
  notes: string;
};

type BatchItemDraft = Omit<ItemDraft, "quantity">;

function emptyItemDraft(): ItemDraft {
  return { name: "", skuText: "", quantity: "1", referenceAmount: "", notes: "" };
}

function emptyBatchItemDraft(): BatchItemDraft {
  return { name: "", skuText: "", referenceAmount: "", notes: "" };
}

export function OrderDetail({ orderId }: { orderId: string }) {
  const searchParams = useSearchParams();
  const returnTo = searchParams.get("returnTo") ?? "";
  const [order, setOrder] = useState<OrderDto | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [itemDialog, setItemDialog] = useState<{ mode: "add" | "edit"; item?: OrderItemDto } | null>(null);
  const [itemDraft, setItemDraft] = useState<ItemDraft>(emptyItemDraft);
  const [savingItem, setSavingItem] = useState(false);
  const [batchDialogOpen, setBatchDialogOpen] = useState(false);
  const [batchItems, setBatchItems] = useState<BatchItemDraft[]>([emptyBatchItemDraft()]);
  const [batchCopyCount, setBatchCopyCount] = useState("2");
  const [batchError, setBatchError] = useState<string | null>(null);
  const [batchRowErrors, setBatchRowErrors] = useState<string[][]>([]);
  const [savingBatch, setSavingBatch] = useState(false);
  const [deletingItem, setDeletingItem] = useState<OrderItemDto | null>(null);
  const [deleting, setDeleting] = useState(false);

  const loadOrder = useCallback(() => {
    return fetch(`/api/purchase-orders/${orderId}`)
      .then(async (response) => {
        const payload: unknown = await response.json();
        const hasItems = Boolean(
          payload
          && typeof payload === "object"
          && Array.isArray((payload as { items?: unknown }).items),
        );

        if (!response.ok || !hasItems) {
          const error = payload as Partial<ApiError> | null;
          setOrder(null);
          setLoadError(error?.message || "订单不存在、已被删除，或暂时无法加载。");
          return;
        }

        setOrder(payload as OrderDto);
      })
      .catch(() => {
        setOrder(null);
        setLoadError("加载采购订单失败，请检查网络后重试。");
      });
  }, [orderId]);

  useEffect(() => {
    void loadOrder();
  }, [loadOrder]);

  function openAddItem() {
    setItemDraft(emptyItemDraft());
    setItemDialog({ mode: "add" });
  }

  function openEditItem(item: OrderItemDto) {
    setItemDraft({
      name: item.name,
      skuText: item.skuText ?? "",
      quantity: String(item.quantity),
      referenceAmount: item.referenceAmount ?? "",
      notes: item.notes ?? "",
    });
    setItemDialog({ mode: "edit", item });
  }

  function openBatchItems() {
    setBatchItems([emptyBatchItemDraft()]);
    setBatchCopyCount("2");
    setBatchError(null);
    setBatchRowErrors([]);
    setBatchDialogOpen(true);
  }

  function updateBatchItem(index: number, patch: Partial<BatchItemDraft>) {
    setBatchItems((items) => items.map((item, itemIndex) => itemIndex === index ? { ...item, ...patch } : item));
    setBatchRowErrors((errors) => errors.map((error, errorIndex) => errorIndex === index ? [] : error));
  }

  function addBatchItem() {
    if (batchItems.length >= 50) {
      setBatchError("批量模式最多保存 50 行商品明细。");
      return;
    }
    setBatchItems((items) => [...items, emptyBatchItemDraft()]);
    setBatchError(null);
  }

  function duplicateBatchItem(index: number) {
    if (batchItems.length >= 50) {
      setBatchError("批量模式最多保存 50 行商品明细。");
      return;
    }
    const source = batchItems[index];
    setBatchItems((items) => [...items.slice(0, index + 1), { ...source }, ...items.slice(index + 1)]);
    setBatchError(null);
  }

  function removeBatchItem(index: number) {
    if (batchItems.length <= 1) {
      setBatchError("至少保留一行商品明细。");
      return;
    }
    setBatchItems((items) => items.filter((_, itemIndex) => itemIndex !== index));
    setBatchRowErrors((errors) => errors.filter((_, itemIndex) => itemIndex !== index));
    setBatchError(null);
  }

  function duplicateFirstBatchItems() {
    const count = Number(batchCopyCount);
    if (!Number.isInteger(count) || count < 1 || count > 50) {
      setBatchError("复制件数必须是 1 到 50 的整数。");
      return;
    }
    const first = batchItems[0] ?? emptyBatchItemDraft();
    setBatchItems(Array.from({ length: count }, () => ({ ...first })));
    setBatchRowErrors([]);
    setBatchError(null);
  }

  function validateBatchItems() {
    const errors = batchItems.map((item) => {
      const rowErrors: string[] = [];
      if (!item.name.trim()) rowErrors.push("商品名称不能为空。");
      if (item.skuText.trim().length > 200) rowErrors.push("SKU / 规格不能超过 200 个字符。");
      if (item.referenceAmount.trim() && !/^\d{1,10}(\.\d{1,2})?$/.test(item.referenceAmount.trim())) {
        rowErrors.push("参考成交总额必须是非负且最多两位小数的金额。");
      }
      if (item.notes.trim().length > 1000) rowErrors.push("备注不能超过 1000 个字符。");
      return rowErrors;
    });
    setBatchRowErrors(errors);
    return errors.every((errorsForRow) => errorsForRow.length === 0);
  }

  async function saveBatchItems(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBatchError(null);
    if (!order || !validateBatchItems()) return;
    setSavingBatch(true);
    try {
      const response = await fetch(`/api/purchases/${order.id}/items/batch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batchItems }),
      });
      const payload = await response.json() as OrderDto | (ApiError & { fieldErrors?: unknown });
      if (!response.ok) {
        setBatchError((payload as ApiError).message || "批量保存商品明细失败，请重试。");
        return;
      }
      setOrder(payload as OrderDto);
      setBatchDialogOpen(false);
      toast.success("批量商品明细已保存");
    } catch {
      setBatchError("批量保存商品明细失败，请重试。");
    } finally {
      setSavingBatch(false);
    }
  }

  async function saveItem(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!itemDialog || !order) return;
    setSavingItem(true);
    try {
      const path = itemDialog.mode === "add"
        ? `/api/purchases/${order.id}/items`
        : `/api/purchases/${order.id}/items/${itemDialog.item?.id}`;
      const response = await fetch(path, {
        method: itemDialog.mode === "add" ? "POST" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: itemDraft.name,
          skuText: itemDraft.skuText,
          quantity: itemDraft.quantity,
          referenceAmount: itemDraft.referenceAmount,
          notes: itemDraft.notes,
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as ApiError;
        toast.error(error.message);
        return;
      }
      setOrder((await response.json()) as OrderDto);
      setItemDialog(null);
      toast.success(itemDialog.mode === "add" ? "商品明细已添加" : "商品明细已更新");
    } catch {
      toast.error("保存商品明细失败，请重试。");
    } finally {
      setSavingItem(false);
    }
  }

  async function removeItem() {
    if (!deletingItem || !order) return;
    setDeleting(true);
    try {
      const response = await fetch(`/api/purchases/${order.id}/items/${deletingItem.id}`, { method: "DELETE" });
      if (!response.ok) {
        const error = (await response.json()) as ApiError;
        toast.error(error.message);
        return;
      }
      setOrder((await response.json()) as OrderDto);
      setDeletingItem(null);
      toast.success("商品明细已删除");
    } catch {
      toast.error("删除商品明细失败，请重试。");
    } finally {
      setDeleting(false);
    }
  }

  if (loadError) {
    return (
      <Card className="rounded-lg shadow-none" data-testid="purchase-order-load-error">
        <CardHeader>
          <CardTitle>订单加载失败</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">{loadError}</p>
          <div className="flex flex-wrap gap-2">
            <Button type="button" data-testid="purchase-order-reload" onClick={() => {
              setLoadError(null);
              void loadOrder();
            }}>重新加载</Button>
            <Link href="/purchases" className={buttonVariants({ variant: "outline" })}>返回采购订单</Link>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (!order) {
    return <Skeleton className="h-[32rem] w-full" />;
  }

  const paidTotal = (
    Number(order.totalAmount) + Number(order.shippingAmount)
  ).toFixed(2);
  const orderItems = Array.isArray(order.items) ? order.items : [];
  const purchaseItemsEditability = order.purchaseItemsEditability ?? {
    editable: false,
    reason: "商品明细状态加载不完整，请重新加载订单。",
  };
  const inventoryItems = orderItems.flatMap((item) => item.inventoryItems ?? []);
  const salesSummary = buildSalesSummary(inventoryItems);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div className="space-y-2">
          <Link
            href={returnTo || "/purchases"}
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft />
            {returnTo ? "返回库存详情" : "返回采购订单"}
          </Link>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold">{order.orderNo}</h1>
            <PurchaseStatusBadge status={order.status} />
            <AllocationBadge status={order.allocationStatus} />
          </div>
          <p className="text-sm text-muted-foreground">
            付款于 {new Date(order.paidAt).toLocaleDateString("zh-CN")}
            {order.sellerNickname ? ` · 卖家：${order.sellerNickname}` : " · 卖家：未填写"}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href={`/purchase-after-sales/new?purchaseOrderId=${order.id}`} className={buttonVariants({ variant: "outline" })}>
            发起采购售后
          </Link>
          <Link href={`/purchase-after-sales?purchaseOrderId=${order.id}`} className={buttonVariants({ variant: "outline" })}>
            查看采购售后
          </Link>
          <Link href={`/purchases/${order.id}/allocate`} className={buttonVariants()}>
            <CircleDollarSign />
            成本分摊
          </Link>
          <DeleteOrderButton order={order} />
        </div>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <LogisticsCard
            order={order}
            onChange={(response) =>
              setOrder({
                ...order,
                ...response.order,
                logisticsEvents: response.events,
              })
            }
          />
          <RealLogisticsCard
            orderId={order.id}
            legacyCarrierCode={order.carrierCode}
            legacyTrackingNumber={order.trackingNo}
          />
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <CardTitle className="text-base">商品明细维护</CardTitle>
                <div className="flex flex-wrap gap-2">
                  <Button type="button" size="sm" onClick={openAddItem} disabled={!purchaseItemsEditability.editable}>
                    <Plus />
                    添加商品
                  </Button>
                  <Button type="button" size="sm" variant="outline" onClick={openBatchItems} disabled={!purchaseItemsEditability.editable}>
                    <Copy />
                    批量添加商品
                  </Button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                商品参考成交总额仅作采购明细参考，订单实付和最终库存成本不会因此自动变化。
              </p>
              {purchaseItemsEditability.reason ? (
                <p className="text-sm text-amber-700">{purchaseItemsEditability.reason}</p>
              ) : null}
            </CardHeader>
          </Card>
          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">商品明细</CardTitle>
            </CardHeader>
            <CardContent className="space-y-5">
              {orderItems.map((item, index) => (
                <div key={item.id} className="space-y-4">
                  {index ? <Separator /> : null}
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm font-medium">{item.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {item.skuText || "未填写规格"} · 数量 {item.quantity}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-xs text-muted-foreground">分摊总成本</p>
                      <p className="text-sm font-medium">
                        {item.allocatedTotalCost
                          ? `¥ ${item.allocatedTotalCost}`
                          : "未分摊"}
                      </p>
                    </div>
                  </div>
                  {item.notes ? (
                    <p className="rounded-md bg-muted/50 p-3 text-xs leading-5">
                      {item.notes}
                    </p>
                  ) : null}
                  <InventorySalesList inventoryItems={item.inventoryItems ?? []} />
                  <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border bg-muted/20 p-3 text-sm">
                    <span>商品参考成交总额：{item.referenceAmount ? `¥ ${item.referenceAmount}` : "未填写"}</span>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => openEditItem(item)} disabled={!purchaseItemsEditability.editable}>
                        <Pencil />
                        编辑
                      </Button>
                      <Button type="button" variant="outline" size="sm" onClick={() => setDeletingItem(item)} disabled={!purchaseItemsEditability.editable || orderItems.length <= 1}>
                        <Trash2 />
                        删除
                      </Button>
                    </div>
                  </div>
                  <div>
                    <div className="mb-2 flex items-center gap-2 text-xs font-medium">
                      <ImageIcon className="size-3.5" />
                      商品图片
                    </div>
                    <AttachmentUploader
                      entityType="PURCHASE_ORDER_ITEM"
                      entityId={item.id}
                      initialAttachments={[]}
                      compact
                    />
                  </div>
                </div>
              ))}
            </CardContent>
          </Card>

          <Dialog open={itemDialog !== null} onOpenChange={(open) => !savingItem && !open && setItemDialog(null)}>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>{itemDialog?.mode === "add" ? "添加商品" : "编辑商品"}</DialogTitle>
                <DialogDescription>填写采购商品明细，参考成交总额为可选字段。</DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={saveItem}>
                <div className="space-y-2"><Label htmlFor="purchase-item-name">商品名称</Label><Input id="purchase-item-name" value={itemDraft.name} onChange={(event) => setItemDraft({ ...itemDraft, name: event.target.value })} required /></div>
                <div className="space-y-2"><Label htmlFor="purchase-item-sku">SKU / 规格</Label><Input id="purchase-item-sku" value={itemDraft.skuText} onChange={(event) => setItemDraft({ ...itemDraft, skuText: event.target.value })} /></div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-2"><Label htmlFor="purchase-item-quantity">数量</Label><Input id="purchase-item-quantity" type="number" min="1" max="999" step="1" value={itemDraft.quantity} onChange={(event) => setItemDraft({ ...itemDraft, quantity: event.target.value })} required /></div>
                  <div className="space-y-2"><Label htmlFor="purchase-item-reference">商品参考成交总额（可选）</Label><Input id="purchase-item-reference" inputMode="decimal" placeholder="未填写" value={itemDraft.referenceAmount} onChange={(event) => setItemDraft({ ...itemDraft, referenceAmount: event.target.value })} /></div>
                </div>
                <p className="text-xs text-muted-foreground">仅作采购明细参考，订单实付和最终库存成本不会因此自动变化。</p>
                <div className="space-y-2"><Label htmlFor="purchase-item-notes">备注</Label><Textarea id="purchase-item-notes" value={itemDraft.notes} onChange={(event) => setItemDraft({ ...itemDraft, notes: event.target.value })} /></div>
                <DialogFooter><Button type="button" variant="outline" onClick={() => setItemDialog(null)} disabled={savingItem}>取消</Button><Button type="submit" disabled={savingItem}>{savingItem ? <Loader2 className="animate-spin" /> : null}{savingItem ? "保存中..." : "保存"}</Button></DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <Dialog open={batchDialogOpen} onOpenChange={(open) => !savingBatch && !open && setBatchDialogOpen(false)}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
              <DialogHeader>
                <DialogTitle>批量添加商品</DialogTitle>
                <DialogDescription>
                  批量模式会将每一行保存为独立商品明细，每条数量固定为 1。相同名称和 SKU 也不会合并。
                </DialogDescription>
              </DialogHeader>
              <form className="space-y-4" onSubmit={saveBatchItems}>
                <div className="space-y-3">
                  {batchItems.map((item, index) => (
                    <div key={index} className="space-y-3 rounded-lg border p-3 sm:p-4">
                      <div className="flex items-center justify-between gap-3">
                        <p className="font-medium">商品 {index + 1}</p>
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button type="button" variant="outline" size="sm" onClick={() => duplicateBatchItem(index)} disabled={savingBatch || batchItems.length >= 50}>
                            <Copy />
                            复制此行
                          </Button>
                          <Button type="button" variant="outline" size="sm" onClick={() => removeBatchItem(index)} disabled={savingBatch || batchItems.length <= 1}>
                            <Trash2 />
                            删除此行
                          </Button>
                        </div>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`batch-item-name-${index}`}>商品名称</Label>
                          <Input id={`batch-item-name-${index}`} value={item.name} onChange={(event) => updateBatchItem(index, { name: event.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`batch-item-sku-${index}`}>SKU / 规格</Label>
                          <Input id={`batch-item-sku-${index}`} value={item.skuText} onChange={(event) => updateBatchItem(index, { skuText: event.target.value })} />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor={`batch-item-reference-${index}`}>商品参考成交总额（可选）</Label>
                          <Input id={`batch-item-reference-${index}`} inputMode="decimal" placeholder="未填写" value={item.referenceAmount} onChange={(event) => updateBatchItem(index, { referenceAmount: event.target.value })} />
                        </div>
                        <div className="space-y-2 sm:col-span-2">
                          <Label htmlFor={`batch-item-notes-${index}`}>备注（可选）</Label>
                          <Textarea id={`batch-item-notes-${index}`} value={item.notes} onChange={(event) => updateBatchItem(index, { notes: event.target.value })} />
                        </div>
                      </div>
                      <p className="text-xs text-muted-foreground">数量固定为 1，不在批量模式中编辑数量。</p>
                      {batchRowErrors[index]?.length ? (
                        <div className="space-y-1 text-sm text-destructive">
                          {batchRowErrors[index].map((error) => <p key={error}>{error}</p>)}
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
                {batchError ? <p className="text-sm text-destructive">{batchError}</p> : null}
                <div className="flex flex-col gap-3 rounded-lg bg-muted/40 p-3 sm:flex-row sm:items-end sm:justify-between">
                  <Button type="button" variant="outline" onClick={addBatchItem} disabled={savingBatch || batchItems.length >= 50}>
                    <Plus />
                    添加空白行
                  </Button>
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="batch-copy-count">复制第一行多件</Label>
                      <Input id="batch-copy-count" className="w-full sm:w-24" type="number" min="1" max="50" step="1" value={batchCopyCount} onChange={(event) => setBatchCopyCount(event.target.value)} />
                    </div>
                    <Button type="button" variant="outline" onClick={duplicateFirstBatchItems} disabled={savingBatch}>生成对应总行数</Button>
                  </div>
                </div>
                <DialogFooter>
                  <Button type="button" variant="outline" onClick={() => setBatchDialogOpen(false)} disabled={savingBatch}>取消</Button>
                  <Button type="submit" disabled={savingBatch}>{savingBatch ? <Loader2 className="animate-spin" /> : null}{savingBatch ? "保存中..." : "保存全部"}</Button>
                </DialogFooter>
              </form>
            </DialogContent>
          </Dialog>

          <AlertDialog open={deletingItem !== null} onOpenChange={(open) => !deleting && !open && setDeletingItem(null)}>
            <AlertDialogContent>
              <AlertDialogHeader><AlertDialogTitle>确认删除商品明细？</AlertDialogTitle><AlertDialogDescription>将删除“{deletingItem?.name}”数量 {deletingItem?.quantity} 的商品明细，订单实付和其他商品不会改变。</AlertDialogDescription></AlertDialogHeader>
              <AlertDialogFooter><AlertDialogCancel disabled={deleting}>取消</AlertDialogCancel><AlertDialogAction onClick={removeItem} disabled={deleting}>{deleting ? "删除中..." : "确认删除"}</AlertDialogAction></AlertDialogFooter>
            </AlertDialogContent>
          </AlertDialog>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">订单附件</CardTitle>
            </CardHeader>
            <CardContent>
              <AttachmentUploader
                entityType="PURCHASE_ORDER"
                entityId={order.id}
                initialAttachments={[]}
              />
            </CardContent>
          </Card>
        </div>

        <div className="space-y-4">
          <Card className="rounded-lg shadow-none" data-testid="purchase-after-sales-summary">
            <CardHeader>
              <CardTitle className="text-base">采购售后财务摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SummaryRow label="原采购实付" value={money(paidTotal)} />
              <SummaryRow label="累计采购退款" value={money(order.purchaseAfterSalesSummary.totalPurchaseRefundedAmount)} />
              <SummaryRow label="净采购实付" value={money(order.purchaseAfterSalesSummary.netPurchasePaidAmount)} strong />
              <Separator />
              <SummaryRow label="采购售后单数" value={`${order.purchaseAfterSalesSummary.totalCaseCount} 单`} />
              <SummaryRow label="进行中售后" value={`${order.purchaseAfterSalesSummary.inProgressCaseCount} 单`} />
              <SummaryRow label="已完成售后" value={`${order.purchaseAfterSalesSummary.completedCaseCount} 单`} />
              <Link href={`/purchase-after-sales?purchaseOrderId=${order.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "w-full" })}>
                查看采购售后
              </Link>
            </CardContent>
          </Card>
          <Card className="rounded-lg shadow-none" data-testid="purchase-sales-summary">
            <CardHeader>
              <CardTitle className="text-base">销售汇总</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <SummaryRow label="库存总件数" value={`${salesSummary.totalCount} 件`} />
              <SummaryRow label="已售件数" value={`${salesSummary.soldCount} 件`} />
              <SummaryRow label="未售件数" value={`${salesSummary.unsoldCount} 件`} />
              <Separator />
              <SummaryRow label="已售库存成本合计" value={money(salesSummary.costTotal)} />
              <SummaryRow label="已售成交价合计" value={money(salesSummary.grossTotal)} />
              <SummaryRow label="已售实际到账合计" value={money(salesSummary.receivedTotal)} />
              <SummaryRow label="已售原利润合计" value={money(salesSummary.profitTotal)} />
              <SummaryRow label="累计销售退款（按商品分配）" value={money(salesSummary.salesRefundTotal)} />
              <SummaryRow label="恢复库存成本" value={money(salesSummary.restockedCostTotal)} />
              <SummaryRow label="销售售后净利润" value={money(salesSummary.afterSaleNetProfitTotal)} strong />
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">金额摘要</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div className="flex justify-between">
                <span className="text-muted-foreground">商品金额</span>
                <span>¥ {order.totalAmount}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-muted-foreground">运费</span>
                <span>¥ {order.shippingAmount}</span>
              </div>
              <Separator />
              <div className="flex justify-between font-semibold">
                <span>原采购实付</span>
                <span>¥ {paidTotal}</span>
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">订单备注</CardTitle>
            </CardHeader>
            <CardContent className="text-sm leading-6 text-muted-foreground">
              {order.notes || "暂无备注"}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}

function effectiveSaleLine(item: PurchaseInventoryItemDto) {
  const lines = item.saleLines ?? [];
  return lines.find((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status)) ?? null;
}

function cancelledSaleLine(item: PurchaseInventoryItemDto) {
  const lines = item.saleLines ?? [];
  return lines.find((line) => line.saleOrder.status === "CANCELLED") ?? null;
}

function money(value: number | string | null | undefined) {
  if (value === null || value === undefined || value === "") return "未填写";
  return `¥ ${Number(value).toFixed(2)}`;
}

function buildSalesSummary(items: PurchaseInventoryItemDto[]) {
  let soldCount = 0;
  let costTotal = 0;
  let grossTotal = 0;
  let receivedTotal = 0;
  let profitTotal = 0;
  let salesRefundTotal = 0;
  let restockedCostTotal = 0;
  let afterSaleNetProfitTotal = 0;
  const countedSaleOrderIds = new Set<string>();

  for (const item of items) {
    const line = effectiveSaleLine(item);
    if (!line) continue;
    soldCount += 1;
    costTotal += Number(line.costAmount);
    profitTotal += Number(line.profitAmount);
    salesRefundTotal += Number(line.salesAfterSaleFinancials?.refundedAmount ?? 0);
    restockedCostTotal += Number(line.salesAfterSaleFinancials?.restockedCostReversal ?? 0);
    afterSaleNetProfitTotal += Number(line.salesAfterSaleFinancials?.afterSaleNetProfit ?? line.profitAmount);

    // A combined sale can contain several inventory lines from this purchase
    // order. SaleOrder amounts belong to the order, so count them once.
    if (!countedSaleOrderIds.has(line.saleOrder.id)) {
      countedSaleOrderIds.add(line.saleOrder.id);
      grossTotal += Number(line.saleOrder.grossAmount);
      receivedTotal += Number(line.saleOrder.actualReceivedAmount ?? 0);
    }
  }

  return {
    totalCount: items.length,
    soldCount,
    unsoldCount: Math.max(0, items.length - soldCount),
    costTotal,
    grossTotal,
    receivedTotal,
    profitTotal,
    salesRefundTotal,
    restockedCostTotal,
    afterSaleNetProfitTotal,
  };
}

function SummaryRow({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function InventorySalesList({ inventoryItems }: { inventoryItems: PurchaseInventoryItemDto[] }) {
  if (!inventoryItems.length) {
    return (
      <div className="rounded-lg border p-3 text-xs text-muted-foreground">
        暂无库存记录
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <p className="text-xs font-medium">库存销售追溯</p>
      <div className="space-y-2">
        {inventoryItems.map((inventoryItem) => (
          <InventorySaleCard key={inventoryItem.id} item={inventoryItem} />
        ))}
      </div>
    </div>
  );
}

function InventorySaleCard({ item }: { item: PurchaseInventoryItemDto }) {
  const effectiveLines = (item.saleLines ?? []).filter((line) => ["CONFIRMED", "SETTLED"].includes(line.saleOrder.status));
  const currentLine = effectiveLines[0] ?? null;
  const cancelledLine = cancelledSaleLine(item);
  const hasDataIssue = effectiveLines.length > 1;

  return (
    <div className="rounded-lg border p-3 text-xs">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="font-medium">{item.inventoryCode}</p>
          <p className="text-muted-foreground">
            {formatItemStatus(item.itemStatus)}
            {item.storageLocation ? ` · ${item.storageLocation}` : ""}
          </p>
        </div>
        <Link href={`/inventory/${item.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>
          查看库存
        </Link>
      </div>

      {hasDataIssue ? (
        <p className="mt-3 text-destructive">数据异常：存在多个有效销售记录。</p>
      ) : currentLine ? (
        <div className="mt-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          <TraceField label="是否已售出" value="已售出" />
          <TraceField label="销售单号" value={currentLine.saleOrder.saleNo} />
          <TraceField label="销售平台" value={formatPlatform(currentLine.saleOrder.platform)} />
          <TraceField label="销售状态" value={formatSaleStatus(currentLine.saleOrder.status)} />
          <TraceField label="成交价" value={money(currentLine.saleOrder.grossAmount)} />
          <TraceField label="实际到账" value={money(currentLine.saleOrder.actualReceivedAmount)} />
          <TraceField label="原利润" value={money(currentLine.profitAmount)} />
          <TraceField label="销售退款分配" value={money(currentLine.salesAfterSaleFinancials?.refundedAmount)} />
          <TraceField label="销售售后净利润" value={money(currentLine.salesAfterSaleFinancials?.afterSaleNetProfit ?? currentLine.profitAmount)} />
          <Link href={`/sales/${currentLine.saleOrder.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "w-fit" })}>
            查看销售订单
          </Link>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <p className="text-muted-foreground">未售出</p>
          {item.itemStatus === "SOLD" ? <p className="text-destructive">销售记录缺失，请检查数据。</p> : null}
          {cancelledLine ? (
            <div className="rounded-md bg-muted/50 p-2">
              <p className="font-medium">曾取消销售</p>
              <p className="mt-1 text-muted-foreground">
                {cancelledLine.saleOrder.saleNo}
                {cancelledLine.saleOrder.cancelledAt ? ` · ${new Date(cancelledLine.saleOrder.cancelledAt).toLocaleString("zh-CN")}` : ""}
              </p>
              <Link href={`/sales/${cancelledLine.saleOrder.id}`} className={buttonVariants({ variant: "outline", size: "sm", className: "mt-2" })}>
                查看销售订单
              </Link>
            </div>
          ) : null}
        </div>
      )}
    </div>
  );
}

function TraceField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-0.5 break-words">{value}</p>
    </div>
  );
}
