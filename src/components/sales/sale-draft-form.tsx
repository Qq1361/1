"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowLeft, Loader2, Plus, Search, Trash2, X } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { formatItemStatus, formatLineStatus, formatSaleMode } from "@/lib/status-labels";

const amountPattern = /^\d{1,10}(\.\d{1,2})?$/;
const feeTypeLabels: Record<string, string> = {
  PLATFORM_COMMISSION: "平台佣金",
  AUTHENTICATION: "鉴定费",
  SHIPPING: "运费",
  PACKAGING: "包材费",
  OTHER: "其他",
};

type SearchItem = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  unitCost: string;
  storageLocation: string | null;
  saleMode: string;
  itemStatus: string;
  selectable: boolean;
  selectableReason: string;
  purchaseOrderItem: {
    purchaseOrder: { id: string; orderNo: string; sellerNickname: string | null };
  };
  currentShipmentLine: {
    lineStatus: string;
    batch: { id: string; batchNo: string; status: string };
    group: { platformOrderNo: string | null; platformTradeNo: string | null; groupName: string | null } | null;
  } | null;
};

type FeeLine = {
  id: string;
  feeType: string;
  amount: string;
  note: string;
};

function newFeeLine(): FeeLine {
  return {
    id: `${Date.now()}-${Math.random().toString(36).slice(2)}`,
    feeType: "PLATFORM_COMMISSION",
    amount: "",
    note: "",
  };
}

function money(value: string) {
  const n = Number(value || "0");
  return Number.isFinite(n) ? n : 0;
}

function normalizeAmount(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

function amountOrZero(value: string) {
  return normalizeAmount(value) ?? "0";
}

export function SaleDraftForm() {
  const router = useRouter();
  const [form, setForm] = useState({
    platform: "DEWU",
    platformOrderNo: "",
    platformTradeNo: "",
    buyerName: "",
    soldAt: new Date().toISOString().slice(0, 16),
    grossAmount: "",
    expectedIncome: "",
    actualReceivedAmount: "",
    shippingCost: "0",
    otherCost: "0",
    note: "",
  });
  const [feeLines, setFeeLines] = useState<FeeLine[]>([]);
  const [selected, setSelected] = useState<Map<string, SearchItem>>(new Map());
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);
  const [results, setResults] = useState<{ data: SearchItem[]; total: number; totalPages: number } | null>(null);
  const [searchLoading, setSearchLoading] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const loadInventory = useCallback(async () => {
    setSearchLoading(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: "20" });
      if (query.trim()) params.set("query", query.trim());
      const response = await fetch(`/api/inventory/selectable-for-sale?${params.toString()}`);
      const body = await response.json();
      if (!response.ok) {
        setSearchError(body.message ?? "库存搜索失败");
        return;
      }
      setResults(body);
    } catch {
      setSearchError("库存搜索失败，请稍后重试。");
    } finally {
      setSearchLoading(false);
    }
  }, [query, page]);

  useEffect(() => {
    const timer = setTimeout(() => void loadInventory(), 250);
    return () => clearTimeout(timer);
  }, [loadInventory]);

  const selectedItems = useMemo(() => [...selected.values()], [selected]);
  const inventoryCostTotal = useMemo(
    () => selectedItems.reduce((sum, item) => sum + money(item.unitCost), 0),
    [selectedItems],
  );
  const feeTotal = useMemo(
    () => feeLines.reduce((sum, line) => sum + money(line.amount), 0),
    [feeLines],
  );
  const preview = useMemo(() => {
    const shipping = money(form.shippingCost);
    const other = money(form.otherCost);
    if (normalizeAmount(form.actualReceivedAmount)) {
      return {
        basis: "实际到账",
        feeDeducted: 0,
        profit: money(form.actualReceivedAmount) - inventoryCostTotal - shipping - other,
      };
    }
    if (normalizeAmount(form.expectedIncome)) {
      return {
        basis: "预计收入",
        feeDeducted: 0,
        profit: money(form.expectedIncome) - inventoryCostTotal - shipping - other,
      };
    }
    return {
      basis: "成交价 - 费用明细",
      feeDeducted: feeTotal,
      profit: money(form.grossAmount) - feeTotal - inventoryCostTotal - shipping - other,
    };
  }, [feeTotal, form.actualReceivedAmount, form.expectedIncome, form.grossAmount, form.otherCost, form.shippingCost, inventoryCostTotal]);

  function toggleItem(item: SearchItem) {
    if (!item.selectable) return;
    setSelected((prev) => {
      const next = new Map(prev);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });
  }

  function removeSelected(id: string) {
    setSelected((prev) => {
      const next = new Map(prev);
      next.delete(id);
      return next;
    });
  }

  function addFeeLine() {
    setFeeLines((prev) => [...prev, newFeeLine()]);
  }

  function updateFeeLine(id: string, patch: Partial<FeeLine>) {
    setFeeLines((prev) => prev.map((line) => (line.id === id ? { ...line, ...patch } : line)));
  }

  function removeFeeLine(id: string) {
    setFeeLines((prev) => prev.filter((line) => line.id !== id));
  }

  function validate() {
    if (selected.size === 0) return "请至少选择一件可销售库存。";
    if (!form.platform) return "请选择销售平台。";
    if (!form.soldAt) return "请填写销售时间。";
    if (!amountPattern.test(form.grossAmount.trim())) return "请填写有效成交价。";
    for (const [label, value] of [
      ["预计收入", form.expectedIncome],
      ["实际到账", form.actualReceivedAmount],
      ["销售侧运费", form.shippingCost],
      ["其他成本", form.otherCost],
    ] as const) {
      if (value.trim() && !amountPattern.test(value.trim())) return `${label}金额格式不正确。`;
    }
    for (const line of feeLines) {
      if (!line.amount.trim() || !amountPattern.test(line.amount.trim())) return "费用明细金额格式不正确。";
    }
    return null;
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (submitting) return;
    const error = validate();
    if (error) {
      setFormError(error);
      toast.error(error);
      return;
    }
    setSubmitting(true);
    setFormError(null);
    try {
      const payload = {
        platform: form.platform,
        platformOrderNo: form.platformOrderNo.trim() || undefined,
        platformTradeNo: form.platformTradeNo.trim() || undefined,
        buyerName: form.buyerName.trim() || undefined,
        soldAt: new Date(form.soldAt).toISOString(),
        grossAmount: form.grossAmount.trim(),
        expectedIncome: normalizeAmount(form.expectedIncome),
        actualReceivedAmount: normalizeAmount(form.actualReceivedAmount),
        shippingCost: amountOrZero(form.shippingCost),
        otherCost: amountOrZero(form.otherCost),
        note: form.note.trim() || undefined,
        items: selectedItems.map((item) => ({ inventoryItemId: item.id })),
        feeLines: feeLines
          .filter((line) => line.amount.trim())
          .map((line) => ({
            feeType: line.feeType,
            amount: line.amount.trim(),
            note: line.note.trim() || undefined,
          })),
      };
      const response = await fetch("/api/sales", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const body = await response.json();
      if (!response.ok) {
        const message = body.message ?? "创建销售草稿失败";
        setFormError(message);
        toast.error(message);
        return;
      }
      toast.success("销售草稿已创建");
      router.push(`/sales/${body.id}`);
      router.refresh();
    } catch {
      setFormError("网络异常，创建销售草稿失败。");
      toast.error("网络异常，创建销售草稿失败。");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl space-y-5">
      <Link href="/sales" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft />
        返回销售订单
      </Link>
      <div>
        <p className="text-sm text-muted-foreground">只创建 DRAFT 草稿，不确认销售，不改变库存状态</p>
        <h1 className="text-2xl font-semibold">新建销售订单</h1>
      </div>
      {formError ? (
        <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
          {formError}
        </div>
      ) : null}

      <form onSubmit={submit} className="grid gap-5 lg:grid-cols-[1fr_340px]">
        <div className="space-y-5">
          <Card className="rounded-lg shadow-none">
            <CardHeader><CardTitle className="text-base">销售基础信息</CardTitle></CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="平台">
                <select className="h-9 w-full rounded-lg border bg-background px-3 text-sm" value={form.platform} onChange={(e) => setForm({ ...form, platform: e.target.value })}>
                  <option value="DEWU">得物</option>
                  <option value="NINETY_FIVE">95分</option>
                  <option value="XIANYU">闲鱼</option>
                  <option value="OTHER">其他</option>
                </select>
              </Field>
              <Field label="销售时间">
                <Input type="datetime-local" value={form.soldAt} onChange={(e) => setForm({ ...form, soldAt: e.target.value })} />
              </Field>
              <Field label="平台订单号">
                <Input value={form.platformOrderNo} onChange={(e) => setForm({ ...form, platformOrderNo: e.target.value })} placeholder="可选" />
              </Field>
              <Field label="平台交易号">
                <Input value={form.platformTradeNo} onChange={(e) => setForm({ ...form, platformTradeNo: e.target.value })} placeholder="可选" />
              </Field>
              <Field label="买家">
                <Input value={form.buyerName} onChange={(e) => setForm({ ...form, buyerName: e.target.value })} placeholder="可选" />
              </Field>
              <Field label="成交价">
                <Input inputMode="decimal" value={form.grossAmount} onChange={(e) => setForm({ ...form, grossAmount: e.target.value })} placeholder="0.00" />
              </Field>
              <Field label="预计收入">
                <Input inputMode="decimal" value={form.expectedIncome} onChange={(e) => setForm({ ...form, expectedIncome: e.target.value })} placeholder="可选" />
              </Field>
              <Field label="实际到账">
                <Input inputMode="decimal" value={form.actualReceivedAmount} onChange={(e) => setForm({ ...form, actualReceivedAmount: e.target.value })} placeholder="草稿阶段可不填" />
              </Field>
              <Field label="销售侧运费">
                <Input inputMode="decimal" value={form.shippingCost} onChange={(e) => setForm({ ...form, shippingCost: e.target.value })} />
              </Field>
              <Field label="其他成本">
                <Input inputMode="decimal" value={form.otherCost} onChange={(e) => setForm({ ...form, otherCost: e.target.value })} />
              </Field>
              <div className="space-y-2 sm:col-span-2">
                <Label>备注</Label>
                <Textarea value={form.note} onChange={(e) => setForm({ ...form, note: e.target.value })} placeholder="可选" />
              </div>
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="text-base">费用明细</CardTitle>
              <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} onClick={addFeeLine}>
                <Plus />
                新增费用
              </button>
            </CardHeader>
            <CardContent className="space-y-3">
              {feeLines.length === 0 ? (
                <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">暂无费用明细</p>
              ) : (
                feeLines.map((line) => (
                  <div key={line.id} className="grid gap-2 rounded-lg border p-3 sm:grid-cols-[140px_120px_1fr_auto]">
                    <select className="h-9 rounded-lg border bg-background px-3 text-sm" value={line.feeType} onChange={(e) => updateFeeLine(line.id, { feeType: e.target.value })}>
                      {Object.entries(feeTypeLabels).map(([value, label]) => (
                        <option key={value} value={value}>{label}</option>
                      ))}
                    </select>
                    <Input inputMode="decimal" placeholder="金额" value={line.amount} onChange={(e) => updateFeeLine(line.id, { amount: e.target.value })} />
                    <Input placeholder="备注，可选" value={line.note} onChange={(e) => updateFeeLine(line.id, { note: e.target.value })} />
                    <button type="button" className={buttonVariants({ variant: "ghost", size: "icon" })} onClick={() => removeFeeLine(line.id)} aria-label="删除费用">
                      <Trash2 />
                    </button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader>
              <CardTitle className="text-base">选择库存</CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
                PLATFORM_LISTED 可选择销售，但它只是“平台已上架 / 可售”，不等于已售出；本页只创建草稿，不会写入 SOLD。
              </div>
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
                <Input
                  className="pl-9"
                  placeholder="搜索库存编号、商品名、SKU、库位、出售方式、采购订单号、卖家昵称、寄送批次号"
                  value={query}
                  onChange={(event) => { setQuery(event.target.value); setPage(1); }}
                />
              </div>
              {searchError ? (
                <div className="rounded-lg border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
                  {searchError}
                </div>
              ) : null}
              <div className="space-y-3">
                {searchLoading ? (
                  <Skeleton className="h-52" />
                ) : !results || results.data.length === 0 ? (
                  <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">没有匹配的库存</div>
                ) : (
                  results.data.map((item) => {
                    const isSelected = selected.has(item.id);
                    return (
                      <InventoryRow key={item.id} item={item} selected={isSelected} onToggle={() => toggleItem(item)} />
                    );
                  })
                )}
              </div>
              {results && results.totalPages > 1 ? (
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">共 {results.total} 件</span>
                  <div className="flex items-center gap-2">
                    <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>上一页</button>
                    <span>{page}/{results.totalPages}</span>
                    <button type="button" className={buttonVariants({ variant: "outline", size: "sm" })} disabled={page >= results.totalPages} onClick={() => setPage((value) => value + 1)}>下一页</button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        </div>

        <aside className="space-y-5">
          <Card className="rounded-lg shadow-none">
            <CardHeader><CardTitle className="text-base">已选择库存</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <Metric label="已选择件数" value={`${selectedItems.length}`} />
                <Metric label="成本合计" value={`¥${inventoryCostTotal.toFixed(2)}`} />
              </div>
              {selectedItems.length === 0 ? (
                <p className="rounded-lg border border-dashed py-8 text-center text-sm text-muted-foreground">尚未选择库存</p>
              ) : (
                <div className="max-h-72 space-y-2 overflow-y-auto">
                  {selectedItems.map((item) => (
                    <div key={item.id} className="rounded-lg border p-3 text-sm">
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{item.name}</p>
                          <p className="text-xs text-muted-foreground">{item.inventoryCode}{item.skuText ? ` · ${item.skuText}` : ""}</p>
                          <p className="text-xs text-muted-foreground">¥{item.unitCost} · {formatItemStatus(item.itemStatus)}</p>
                        </div>
                        <button type="button" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-destructive" onClick={() => removeSelected(item.id)} aria-label="移除库存">
                          <X className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="rounded-lg shadow-none">
            <CardHeader><CardTitle className="text-base">金额预览</CardTitle></CardHeader>
            <CardContent className="space-y-3 text-sm">
              <Line label="库存成本合计" value={`¥${inventoryCostTotal.toFixed(2)}`} />
              <Line label="费用合计" value={`¥${feeTotal.toFixed(2)}`} />
              <Line label="本次扣费用" value={`¥${preview.feeDeducted.toFixed(2)}`} />
              <Line label="销售侧运费" value={`¥${money(form.shippingCost).toFixed(2)}`} />
              <Line label="其他成本" value={`¥${money(form.otherCost).toFixed(2)}`} />
              <Line label="计算口径" value={preview.basis} />
              <div className="border-t pt-3">
                <Line label="预计利润" value={`¥${preview.profit.toFixed(2)}`} strong />
              </div>
              <p className="text-xs leading-5 text-muted-foreground">预览仅供填写参考，最终利润以后端 SalesService 计算为准。</p>
            </CardContent>
          </Card>

          <div className="sticky top-20">
            <button type="submit" className={buttonVariants({ size: "lg", className: "w-full" })} disabled={submitting}>
              {submitting ? <Loader2 className="animate-spin" /> : <Plus />}
              {submitting ? "正在创建" : "创建销售草稿"}
            </button>
          </div>
        </aside>
      </form>
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return <div className="space-y-2"><Label>{label}</Label>{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-muted/30 p-3 text-center">
      <p className="text-xl font-semibold">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className={`flex justify-between gap-3 ${strong ? "font-semibold" : ""}`}>
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}

function InventoryRow({ item, selected, onToggle }: { item: SearchItem; selected: boolean; onToggle: () => void }) {
  const isListed = item.itemStatus === "PLATFORM_LISTED";
  return (
    <button
      type="button"
      className={`w-full rounded-lg border p-3 text-left transition ${item.selectable ? "hover:bg-muted/30" : "cursor-not-allowed opacity-60"} ${selected ? "border-primary bg-primary/5" : ""}`}
      onClick={onToggle}
      disabled={!item.selectable}
    >
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-medium">{item.name}</p>
            <Badge variant={selected ? "default" : item.selectable ? "secondary" : "outline"}>{selected ? "已选择" : item.selectable ? "可选择" : "不可选择"}</Badge>
            {isListed ? <Badge variant="outline">可售不等于已售出</Badge> : null}
          </div>
          <p className="text-xs text-muted-foreground">{item.inventoryCode}{item.skuText ? ` · ${item.skuText}` : " · 无 SKU"}</p>
          <p className="text-xs text-muted-foreground">
            状态：{formatItemStatus(item.itemStatus)} · 出售方式：{formatSaleMode(item.saleMode)} · 库位：{item.storageLocation || "未填写"}
          </p>
          <p className="text-xs text-muted-foreground">
            来源采购订单：{item.purchaseOrderItem.purchaseOrder.orderNo}
            {item.purchaseOrderItem.purchaseOrder.sellerNickname ? ` · 卖家：${item.purchaseOrderItem.purchaseOrder.sellerNickname}` : ""}
          </p>
          {item.currentShipmentLine ? (
            <p className="text-xs text-muted-foreground">
              当前寄送：{item.currentShipmentLine.batch.batchNo} · {formatLineStatus(item.currentShipmentLine.lineStatus)}
              {item.currentShipmentLine.group?.platformOrderNo ? ` · 平台订单：${item.currentShipmentLine.group.platformOrderNo}` : ""}
            </p>
          ) : null}
          <p className={`text-xs ${item.selectable ? "text-muted-foreground" : "text-destructive"}`}>{item.selectableReason}</p>
        </div>
        <div className="shrink-0 text-right text-sm">
          <p className="text-xs text-muted-foreground">单件成本</p>
          <p className="font-semibold">¥{item.unitCost}</p>
        </div>
      </div>
    </button>
  );
}
