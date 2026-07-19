"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Plus, Trash2, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  newBatchPurchaseItem,
  PurchaseCreateBatchItems,
  type BatchPurchaseItem,
} from "@/components/purchases/purchase-create-batch-items";
import { calculateShelfLifeExpiryDate, isDateOnlyBefore } from "@/lib/shelf-life-form";
import type { ApiError, OrderDto } from "@/types/purchase";

type FormItem = {
  clientId: string;
  name: string;
  skuText: string;
  quantity: number;
  referenceAmount: string;
  productionDate: string;
  shelfLifeMonths: string;
  expiryDate: string;
  notes: string;
  files: File[];
};

type FieldErrors = Record<string, string>;

let itemSequence = 0;

export function createItemClientId() {
  itemSequence += 1;
  return `item-${Date.now()}-${itemSequence}`;
}

function newItem(clientId = createItemClientId()): FormItem {
  return {
    clientId,
    name: "",
    skuText: "",
    quantity: 1,
    referenceAmount: "",
    productionDate: "",
    shelfLifeMonths: "",
    expiryDate: "",
    notes: "",
    files: [],
  };
}

function formatFileSize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SelectedFiles({
  files,
  label,
  onRemove,
}: {
  files: File[];
  label: string;
  onRemove: (index: number) => void;
}) {
  if (!files.length) return null;

  return (
    <ul className="space-y-2" aria-label={label}>
      {files.map((file, index) => (
        <li
          key={`${file.name}-${file.lastModified}-${index}`}
          className="flex items-center gap-3 rounded-md border bg-background px-3 py-2 text-sm"
        >
          <span className="min-w-0 flex-1 truncate" title={file.name}>
            {file.name}
          </span>
          <span className="shrink-0 text-xs text-muted-foreground">
            {formatFileSize(file.size)}
          </span>
          <button
            type="button"
            className={buttonVariants({
              variant: "ghost",
              size: "icon-sm",
              className: "h-11 w-11 sm:h-9 sm:w-9",
            })}
            onClick={() => onRemove(index)}
            aria-label={`移除附件 ${file.name}`}
          >
            <X />
          </button>
        </li>
      ))}
    </ul>
  );
}

export function OrderForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = useState<FieldErrors>({});
  const [orderFiles, setOrderFiles] = useState<File[]>([]);
  const [items, setItems] = useState<FormItem[]>([newItem("initial-item")]);
  const [entryMode, setEntryMode] = useState<"SINGLE" | "BATCH">("SINGLE");
  const [batchItems, setBatchItems] = useState<BatchPurchaseItem[]>([
    newBatchPurchaseItem("initial-batch-item"),
  ]);
  const [form, setForm] = useState({
    orderNo: "",
    sellerNickname: "",
    paidAt: new Date().toISOString().slice(0, 10),
    totalAmount: "",
    shippingAmount: "0",
    notes: "",
  });

  function updateItem(clientId: string, patch: Partial<FormItem>) {
    setItems((current) =>
      current.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
  }

  function clearFieldError(field: string) {
    setFieldErrors((current) => {
      if (!current[field]) return current;
      const remaining = { ...current };
      delete remaining[field];
      return remaining;
    });
  }

  async function uploadFile(
    entityType: "PURCHASE_ORDER" | "PURCHASE_ORDER_ITEM",
    entityId: string,
    file: File,
  ) {
    const data = new FormData();
    data.set("entityType", entityType);
    data.set("entityId", entityId);
    data.set("file", file);
    const response = await fetch("/api/attachments", {
      method: "POST",
      body: data,
    });
    if (!response.ok) {
      const error = (await response.json()) as ApiError;
      throw new Error(`${file.name}: ${error.message}`);
    }
  }

  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFormError(null);

    const moneyPattern = /^\d{1,10}(\.\d{1,2})?$/;
    const errors: FieldErrors = {};
    if (!form.orderNo.trim()) errors.orderNo = "请填写闲鱼订单号。";
    if (!form.paidAt) errors.paidAt = "请选择付款日期。";
    if (!moneyPattern.test(form.totalAmount.trim())) {
      errors.totalAmount = "请输入最多两位小数的有效金额。";
    }
    if (!moneyPattern.test(form.shippingAmount.trim())) {
      errors.shippingAmount = "请输入最多两位小数的有效金额。";
    }
    if (entryMode === "SINGLE") items.forEach((item) => {
      if (!item.name.trim()) {
        errors[`${item.clientId}-name`] = "请填写商品名称。";
      }
      if (
        !Number.isInteger(item.quantity) ||
        item.quantity < 1 ||
        item.quantity > 999
      ) {
        errors[`${item.clientId}-quantity`] = "数量应为 1 到 999 的整数。";
      }
      if (item.shelfLifeMonths && (!/^\d+$/.test(item.shelfLifeMonths) || Number(item.shelfLifeMonths) < 1 || Number(item.shelfLifeMonths) > 600)) {
        errors[`${item.clientId}-shelf-life-months`] = "保质期月数必须是 1 到 600 的整数。";
      }
      if (isDateOnlyBefore(item.expiryDate, item.productionDate)) {
        errors[`${item.clientId}-expiry-date`] = "到期日期不能早于生产日期。";
      }
    });
    if (entryMode === "BATCH") batchItems.forEach((item) => {
      const prefix = `batch-${item.clientId}`;
      if (!item.name.trim()) {
        errors[`${prefix}-name`] = "请填写商品名称。";
      }
      if (item.referenceAmount && !moneyPattern.test(item.referenceAmount.trim())) {
        errors[`${prefix}-reference-amount`] = "请输入最多两位小数的有效金额。";
      }
      if (
        item.shelfLifeMonths &&
        (!/^\d+$/.test(item.shelfLifeMonths) ||
          Number(item.shelfLifeMonths) < 1 ||
          Number(item.shelfLifeMonths) > 600)
      ) {
        errors[`${prefix}-shelf-life-months`] = "保质期月数必须是 1 到 600 的整数。";
      }
      if (isDateOnlyBefore(item.expiryDate, item.productionDate)) {
        errors[`${prefix}-expiry-date`] = "到期日期不能早于生产日期。";
      }
    });
    if (Object.keys(errors).length) {
      setFieldErrors(errors);
      setFormError("请检查标记的字段后再创建订单。");
      const firstField = Object.keys(errors)[0];
      requestAnimationFrame(() => document.getElementById(firstField)?.focus());
      return;
    }

    setFieldErrors({});

    setSubmitting(true);
    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          paidAt: new Date(`${form.paidAt}T00:00:00+08:00`).toISOString(),
          ...(entryMode === "BATCH"
            ? {
                entryMode: "BATCH",
                batchItems: batchItems.map((item) => ({
                  name: item.name,
                  skuText: item.skuText,
                  referenceAmount: item.referenceAmount || null,
                  productionDate: item.productionDate || null,
                  shelfLifeMonths: item.shelfLifeMonths ? Number(item.shelfLifeMonths) : null,
                  expiryDate: item.expiryDate || null,
                  notes: null,
                })),
              }
            : {
                items: items.map((item) => ({
                  clientId: item.clientId,
                  name: item.name,
                  skuText: item.skuText,
                  quantity: item.quantity,
                  referenceAmount: item.referenceAmount,
                  productionDate: item.productionDate || null,
                  shelfLifeMonths: item.shelfLifeMonths ? Number(item.shelfLifeMonths) : null,
                  expiryDate: item.expiryDate || null,
                  notes: item.notes,
                })),
              }),
        }),
      });
      if (!response.ok) {
        const error = (await response.json()) as ApiError;
        setFormError(error.message);
        return;
      }

      const order = (await response.json()) as OrderDto;
      const failures: string[] = [];
      for (const file of orderFiles) {
        try {
          await uploadFile("PURCHASE_ORDER", order.id, file);
        } catch (error) {
          failures.push(error instanceof Error ? error.message : file.name);
        }
      }
      if (entryMode === "SINGLE") {
        for (const [index, item] of items.entries()) {
          for (const file of item.files) {
            try {
              await uploadFile(
                "PURCHASE_ORDER_ITEM",
                order.items[index].id,
                file,
              );
            } catch (error) {
              failures.push(error instanceof Error ? error.message : file.name);
            }
          }
        }
      }
      if (failures.length) {
        sessionStorage.setItem(
          `upload-failures:${order.id}`,
          JSON.stringify(failures),
        );
      }
      router.push(`/purchases/${order.id}`);
      router.refresh();
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "创建订单失败，请重试。";
      setFormError(message);
    } finally {
      setSubmitting(false);
    }
  }

  const totalItemQuantity =
    entryMode === "BATCH"
      ? batchItems.length
      : items.reduce(
          (total, item) => total + (Number.isFinite(item.quantity) ? item.quantity : 0),
          0,
        );
  const attachmentCount = orderFiles.length + (entryMode === "SINGLE"
    ? items.reduce((total, item) => total + item.files.length, 0)
    : 0);
  const totalValue = Number(form.totalAmount) + Number(form.shippingAmount);
  const totalLabel =
    /^\d{1,10}(\.\d{1,2})?$/.test(form.totalAmount.trim()) &&
    /^\d{1,10}(\.\d{1,2})?$/.test(form.shippingAmount.trim())
      ? `¥ ${totalValue.toFixed(2)}`
      : "金额待填写";

  return (
    <form onSubmit={submit} noValidate className="space-y-5">
      {formError ? (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive"
        >
          {formError}
        </div>
      ) : null}
      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">订单信息</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="orderNo">闲鱼订单号</Label>
            <Input
              id="orderNo"
              value={form.orderNo}
              onChange={(event) => {
                setForm({ ...form, orderNo: event.target.value });
                clearFieldError("orderNo");
              }}
              aria-invalid={Boolean(fieldErrors.orderNo)}
              aria-describedby={fieldErrors.orderNo ? "orderNo-error" : undefined}
              required
            />
            {fieldErrors.orderNo ? (
              <p id="orderNo-error" className="text-xs text-destructive" role="alert">
                {fieldErrors.orderNo}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="sellerNickname">卖家昵称</Label>
            <Input
              id="sellerNickname"
              value={form.sellerNickname}
              onChange={(event) =>
                setForm({ ...form, sellerNickname: event.target.value })
              }
              placeholder="选填，用于追溯订单"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="paidAt">付款日期</Label>
            <Input
              id="paidAt"
              type="date"
              value={form.paidAt}
              onChange={(event) => {
                setForm({ ...form, paidAt: event.target.value });
                clearFieldError("paidAt");
              }}
              aria-invalid={Boolean(fieldErrors.paidAt)}
              aria-describedby={fieldErrors.paidAt ? "paidAt-error" : undefined}
              required
            />
            {fieldErrors.paidAt ? (
              <p id="paidAt-error" className="text-xs text-destructive" role="alert">
                {fieldErrors.paidAt}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalAmount">商品金额</Label>
            <Input
              id="totalAmount"
              inputMode="decimal"
              value={form.totalAmount}
              onChange={(event) => {
                setForm({ ...form, totalAmount: event.target.value });
                clearFieldError("totalAmount");
              }}
              aria-invalid={Boolean(fieldErrors.totalAmount)}
              aria-describedby={fieldErrors.totalAmount ? "totalAmount-error" : undefined}
              placeholder="0.00"
              required
            />
            {fieldErrors.totalAmount ? (
              <p id="totalAmount-error" className="text-xs text-destructive" role="alert">
                {fieldErrors.totalAmount}
              </p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="shippingAmount">运费</Label>
            <Input
              id="shippingAmount"
              inputMode="decimal"
              value={form.shippingAmount}
              onChange={(event) => {
                setForm({ ...form, shippingAmount: event.target.value });
                clearFieldError("shippingAmount");
              }}
              aria-invalid={Boolean(fieldErrors.shippingAmount)}
              aria-describedby={fieldErrors.shippingAmount ? "shippingAmount-error" : undefined}
              required
            />
            {fieldErrors.shippingAmount ? (
              <p id="shippingAmount-error" className="text-xs text-destructive" role="alert">
                {fieldErrors.shippingAmount}
              </p>
            ) : null}
          </div>
          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="notes">订单备注</Label>
            <Textarea
              id="notes"
              value={form.notes}
              onChange={(event) =>
                setForm({ ...form, notes: event.target.value })
              }
              rows={3}
            />
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">录入方式</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid gap-2 sm:grid-cols-2" role="group" aria-label="商品录入方式">
            <button
              type="button"
              className={buttonVariants({ variant: entryMode === "SINGLE" ? "default" : "outline", className: "min-h-11" })}
              disabled={submitting}
              onClick={() => {
                setEntryMode("SINGLE");
                setFieldErrors({});
                setFormError(null);
              }}
            >
              普通录入
            </button>
            <button
              type="button"
              className={buttonVariants({ variant: entryMode === "BATCH" ? "default" : "outline", className: "min-h-11" })}
              disabled={submitting}
              onClick={() => {
                setEntryMode("BATCH");
                setFieldErrors({});
                setFormError(null);
              }}
            >
              批量录入
            </button>
          </div>
        </CardContent>
      </Card>

      <Card className="rounded-lg shadow-none">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">商品明细</CardTitle>
          {entryMode === "SINGLE" ? <button
            type="button"
            className={buttonVariants({ variant: "outline", size: "sm", className: "h-11 sm:h-9" })}
            disabled={submitting}
            onClick={() => {
              setFormError(null);
              setItems((current) => [...current, newItem()]);
            }}
          >
            <Plus />
            添加商品
          </button> : null}
        </CardHeader>
        <CardContent className="space-y-4">
          {entryMode === "SINGLE" ? <>{items.map((item, index) => (
            <div
              key={item.clientId}
              className="space-y-4 rounded-lg border bg-muted/20 p-4"
            >
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-medium">商品 {index + 1}</h3>
                <button
                  type="button"
                   className={buttonVariants({
                     variant: "ghost",
                     size: "icon-sm",
                     className: "h-11 w-11 sm:h-9 sm:w-9",
                   })}
                  disabled={items.length === 1 || submitting}
                  onClick={() =>
                    setItems((current) =>
                      current.filter(
                        (currentItem) =>
                          currentItem.clientId !== item.clientId,
                      ),
                    )
                  }
                  aria-label={`删除商品 ${index + 1}`}
                >
                  <Trash2 />
                </button>
              </div>
              <div className="grid gap-4 sm:grid-cols-[1fr_1fr_120px]">
                <div className="space-y-2">
                  <Label htmlFor={`${item.clientId}-name`}>商品名称</Label>
                  <Input
                    id={`${item.clientId}-name`}
                    value={item.name}
                    onChange={(event) => {
                      updateItem(item.clientId, { name: event.target.value });
                      clearFieldError(`${item.clientId}-name`);
                    }}
                    aria-invalid={Boolean(fieldErrors[`${item.clientId}-name`])}
                    aria-describedby={
                      fieldErrors[`${item.clientId}-name`]
                        ? `${item.clientId}-name-error`
                        : undefined
                    }
                    required
                  />
                  {fieldErrors[`${item.clientId}-name`] ? (
                    <p id={`${item.clientId}-name-error`} className="text-xs text-destructive" role="alert">
                      {fieldErrors[`${item.clientId}-name`]}
                    </p>
                  ) : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${item.clientId}-sku`}>规格 / SKU</Label>
                  <Input
                    id={`${item.clientId}-sku`}
                    value={item.skuText}
                    onChange={(event) =>
                      updateItem(item.clientId, { skuText: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${item.clientId}-quantity`}>数量</Label>
                  <Input
                    id={`${item.clientId}-quantity`}
                    type="number"
                    min={1}
                    max={999}
                    value={item.quantity}
                    onChange={(event) => {
                      updateItem(item.clientId, {
                        quantity: Number(event.target.value),
                      });
                      clearFieldError(`${item.clientId}-quantity`);
                    }}
                    aria-invalid={Boolean(fieldErrors[`${item.clientId}-quantity`])}
                    aria-describedby={
                      fieldErrors[`${item.clientId}-quantity`]
                        ? `${item.clientId}-quantity-error`
                        : undefined
                    }
                    required
                  />
                  {fieldErrors[`${item.clientId}-quantity`] ? (
                    <p id={`${item.clientId}-quantity-error`} className="text-xs text-destructive" role="alert">
                      {fieldErrors[`${item.clientId}-quantity`]}
                    </p>
                  ) : null}
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${item.clientId}-reference-amount`}>
                  商品参考成交总额（可选）
                </Label>
                <Input
                  id={`${item.clientId}-reference-amount`}
                  aria-describedby={`${item.clientId}-reference-help`}
                  inputMode="decimal"
                  value={item.referenceAmount}
                  onChange={(event) =>
                    updateItem(item.clientId, { referenceAmount: event.target.value })
                  }
                  placeholder="未填写"
                />
                <p
                  id={`${item.clientId}-reference-help`}
                  className="text-xs leading-5 text-muted-foreground"
                >
                  仅作采购明细参考，订单实付和最终库存成本不会因此自动变化。
                </p>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor={`${item.clientId}-production-date`}>生产日期（可选）</Label>
                  <Input id={`${item.clientId}-production-date`} type="date" value={item.productionDate} onChange={(event) => updateItem(item.clientId, { productionDate: event.target.value })} />
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${item.clientId}-shelf-life-months`}>保质期月数（可选）</Label>
                  <Input id={`${item.clientId}-shelf-life-months`} type="number" inputMode="numeric" min="1" max="600" step="1" value={item.shelfLifeMonths} onChange={(event) => updateItem(item.clientId, { shelfLifeMonths: event.target.value })} />
                  {fieldErrors[`${item.clientId}-shelf-life-months`] ? <p className="text-xs text-destructive">{fieldErrors[`${item.clientId}-shelf-life-months`]}</p> : null}
                </div>
                <div className="space-y-2">
                  <Label htmlFor={`${item.clientId}-expiry-date`}>到期日期（可选）</Label>
                  <Input id={`${item.clientId}-expiry-date`} type="date" value={item.expiryDate} onChange={(event) => updateItem(item.clientId, { expiryDate: event.target.value })} />
                  {fieldErrors[`${item.clientId}-expiry-date`] ? <p className="text-xs text-destructive">{fieldErrors[`${item.clientId}-expiry-date`]}</p> : null}
                </div>
                <div className="flex items-end">
                  <button
                    type="button"
                    className={buttonVariants({ variant: "outline", className: "min-h-11 w-full" })}
                    disabled={!calculateShelfLifeExpiryDate(item.productionDate, item.shelfLifeMonths) || submitting}
                    onClick={() => {
                      const expiryDate = calculateShelfLifeExpiryDate(item.productionDate, item.shelfLifeMonths);
                      if (expiryDate) updateItem(item.clientId, { expiryDate });
                    }}
                  >
                    计算到期日期
                  </button>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">同一商品行的全部数量共用这组保质期；不同批次请拆成独立商品行。</p>
              <div className="space-y-2">
                <Label htmlFor={`${item.clientId}-notes`}>商品备注</Label>
                <Textarea
                  id={`${item.clientId}-notes`}
                  value={item.notes}
                  onChange={(event) =>
                    updateItem(item.clientId, { notes: event.target.value })
                  }
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${item.clientId}-files`}>商品图片</Label>
                <label
                  htmlFor={`${item.clientId}-files`}
                  className="flex min-h-20 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-background text-sm text-muted-foreground transition-colors hover:border-primary/45 hover:bg-accent/35 hover:text-foreground"
                >
                  <ImagePlus className="size-4" />
                  {item.files.length
                    ? `已选择 ${item.files.length} 张`
                    : "选择商品图片"}
                  <input
                    id={`${item.clientId}-files`}
                    className="sr-only"
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    multiple
                    onChange={(event) =>
                      updateItem(item.clientId, {
                        files: Array.from(event.target.files ?? []),
                      })
                    }
                  />
                </label>
                <SelectedFiles
                  files={item.files}
                  label={`商品 ${index + 1} 已选择的图片`}
                  onRemove={(fileIndex) =>
                    updateItem(item.clientId, {
                      files: item.files.filter((_, currentIndex) => currentIndex !== fileIndex),
                    })
                  }
                />
              </div>
            </div>
          ))}</> : <PurchaseCreateBatchItems
            items={batchItems}
            fieldErrors={fieldErrors}
            submitting={submitting}
            createClientId={createItemClientId}
            onChange={setBatchItems}
            onClearFieldError={clearFieldError}
          />}
        </CardContent>
      </Card>

      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">订单附件</CardTitle>
        </CardHeader>
        <CardContent>
          <label
            htmlFor="order-files"
            className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground transition-colors hover:border-primary/45 hover:bg-accent/35 hover:text-foreground"
          >
            <ImagePlus className="size-4" />
            {orderFiles.length
              ? `已选择 ${orderFiles.length} 张`
              : "选择订单聊天记录或凭证图片"}
            <input
              id="order-files"
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) =>
                setOrderFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>
          <SelectedFiles
            files={orderFiles}
            label="已选择的订单附件"
            onRemove={(fileIndex) =>
              setOrderFiles((current) =>
                current.filter((_, currentIndex) => currentIndex !== fileIndex),
              )
            }
          />
        </CardContent>
      </Card>

      <div className="sticky bottom-0 -mx-4 flex flex-col gap-3 border-t bg-background/95 px-4 py-3 backdrop-blur sm:mx-0 sm:flex-row sm:items-center sm:justify-between sm:px-0">
        <p className="text-xs text-muted-foreground" aria-live="polite">
          {items.length} 件商品 · 共 {totalItemQuantity} 件 · {attachmentCount} 个附件 · {totalLabel}
        </p>
        <button
          type="submit"
          className={buttonVariants({ size: "lg", className: "w-full sm:w-auto" })}
          disabled={submitting}
        >
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {submitting ? "正在创建" : "创建订单"}
        </button>
      </div>
    </form>
  );
}
