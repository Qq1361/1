"use client";

import { Copy, Plus, Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  calculateShelfLifeExpiryDate,
  isDateOnlyBefore,
} from "@/lib/shelf-life-form";

export type BatchPurchaseItem = {
  clientId: string;
  name: string;
  skuText: string;
  referenceAmount: string;
  productionDate: string;
  shelfLifeMonths: string;
  expiryDate: string;
};

export type PurchaseBatchFieldErrors = Record<string, string>;

export function newBatchPurchaseItem(clientId: string): BatchPurchaseItem {
  return {
    clientId,
    name: "",
    skuText: "",
    referenceAmount: "",
    productionDate: "",
    shelfLifeMonths: "",
    expiryDate: "",
  };
}

function parseReferenceAmountToCents(value: string) {
  const match = value.trim().match(/^(\d{1,10})(?:\.(\d{1,2}))?$/);
  if (!match) return null;
  return BigInt(match[1]) * 100n + BigInt((match[2] ?? "").padEnd(2, "0"));
}

function formatCents(cents: bigint) {
  const whole = cents / 100n;
  const fraction = (cents % 100n).toString().padStart(2, "0");
  return `${whole.toString()}.${fraction}`;
}

function cloneBatchItem(item: BatchPurchaseItem, clientId: string): BatchPurchaseItem {
  return { ...item, clientId };
}

export function PurchaseCreateBatchItems({
  items,
  fieldErrors,
  submitting,
  createClientId,
  onChange,
  onClearFieldError,
}: {
  items: BatchPurchaseItem[];
  fieldErrors: PurchaseBatchFieldErrors;
  submitting: boolean;
  createClientId: () => string;
  onChange: (items: BatchPurchaseItem[]) => void;
  onClearFieldError: (field: string) => void;
}) {
  const totalCents = items.reduce((total, item) => {
    const cents = parseReferenceAmountToCents(item.referenceAmount);
    return cents === null ? total : total + cents;
  }, 0n);
  const referenceAmountCount = items.filter(
    (item) => parseReferenceAmountToCents(item.referenceAmount) !== null,
  ).length;
  const expiryDateCount = items.filter((item) => Boolean(item.expiryDate)).length;

  function updateItem(clientId: string, patch: Partial<BatchPurchaseItem>) {
    onChange(
      items.map((item) =>
        item.clientId === clientId ? { ...item, ...patch } : item,
      ),
    );
  }

  function addBlankRow() {
    if (items.length >= 50) return;
    onChange([...items, newBatchPurchaseItem(createClientId())]);
  }

  function copyRow(item: BatchPurchaseItem) {
    if (items.length >= 50) return;
    onChange([...items, cloneBatchItem(item, createClientId())]);
  }

  function removeRow(clientId: string) {
    if (items.length <= 1) return;
    onChange(items.filter((item) => item.clientId !== clientId));
  }

  function copyFirstRow(count: number) {
    const first = items[0];
    if (!first || !Number.isInteger(count) || count < 1) return;
    const available = Math.min(count, 50 - items.length);
    onChange([
      ...items,
      ...Array.from({ length: available }, () =>
        cloneBatchItem(first, createClientId()),
      ),
    ]);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 rounded-lg border bg-muted/20 p-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-sm text-muted-foreground">
          每行代表一件独立商品，数量固定为 1。相同商品和 SKU 不会自动合并。
        </p>
        <button
          type="button"
          className={buttonVariants({ variant: "outline", size: "sm", className: "min-h-11 shrink-0" })}
          disabled={submitting || items.length >= 50}
          onClick={addBlankRow}
        >
          <Plus /> 添加空白行
        </button>
      </div>

      <div className="flex flex-col gap-3 rounded-lg border p-3 sm:flex-row sm:items-end">
        <div className="space-y-2 sm:w-40">
          <Label htmlFor="batch-copy-count">复制第一行次数</Label>
          <Input id="batch-copy-count" type="number" min="1" max={Math.max(1, 50 - items.length)} defaultValue="1" />
        </div>
        <button
          type="button"
          className={buttonVariants({ variant: "outline", className: "min-h-11" })}
          disabled={submitting || items.length >= 50}
          onClick={(event) => {
            const root = event.currentTarget.parentElement;
            const input = root?.querySelector<HTMLInputElement>("#batch-copy-count");
            copyFirstRow(Number(input?.value));
          }}
        >
          <Copy /> 复制第一行
        </button>
      </div>

      {items.map((item, index) => {
        const prefix = `batch-${item.clientId}`;
        return (
          <section key={item.clientId} className="space-y-4 rounded-lg border bg-muted/20 p-4">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-medium">批量商品 {index + 1}</h3>
              <div className="flex gap-1">
                <button
                  type="button"
                  className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "h-11 w-11 sm:h-9 sm:w-9" })}
                  disabled={submitting || items.length >= 50}
                  onClick={() => copyRow(item)}
                  aria-label={`复制批量商品 ${index + 1}`}
                >
                  <Copy />
                </button>
                <button
                  type="button"
                  className={buttonVariants({ variant: "ghost", size: "icon-sm", className: "h-11 w-11 text-destructive sm:h-9 sm:w-9" })}
                  disabled={submitting || items.length <= 1}
                  onClick={() => removeRow(item.clientId)}
                  aria-label={`删除批量商品 ${index + 1}`}
                >
                  <Trash2 />
                </button>
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-name`}>商品名称</Label>
                <Input
                  id={`${prefix}-name`}
                  value={item.name}
                  onChange={(event) => {
                    updateItem(item.clientId, { name: event.target.value });
                    onClearFieldError(`${prefix}-name`);
                  }}
                  aria-invalid={Boolean(fieldErrors[`${prefix}-name`])}
                  required
                />
                {fieldErrors[`${prefix}-name`] ? <p className="text-xs text-destructive">{fieldErrors[`${prefix}-name`]}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-sku`}>规格 / SKU</Label>
                <Input id={`${prefix}-sku`} value={item.skuText} onChange={(event) => updateItem(item.clientId, { skuText: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-reference-amount`}>商品参考成交总额（可选）</Label>
                <Input
                  id={`${prefix}-reference-amount`}
                  inputMode="decimal"
                  value={item.referenceAmount}
                  placeholder="未填写"
                  onChange={(event) => {
                    updateItem(item.clientId, { referenceAmount: event.target.value });
                    onClearFieldError(`${prefix}-reference-amount`);
                  }}
                  aria-invalid={Boolean(fieldErrors[`${prefix}-reference-amount`])}
                />
                {fieldErrors[`${prefix}-reference-amount`] ? <p className="text-xs text-destructive">{fieldErrors[`${prefix}-reference-amount`]}</p> : null}
              </div>
              <div className="flex items-end pb-1 text-sm text-muted-foreground">数量固定为 1</div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-production-date`}>生产日期（可选）</Label>
                <Input id={`${prefix}-production-date`} type="date" value={item.productionDate} onChange={(event) => updateItem(item.clientId, { productionDate: event.target.value })} />
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-shelf-life-months`}>保质期月数（可选）</Label>
                <Input
                  id={`${prefix}-shelf-life-months`}
                  type="number"
                  inputMode="numeric"
                  min="1"
                  max="600"
                  step="1"
                  value={item.shelfLifeMonths}
                  onChange={(event) => {
                    updateItem(item.clientId, { shelfLifeMonths: event.target.value });
                    onClearFieldError(`${prefix}-shelf-life-months`);
                  }}
                  aria-invalid={Boolean(fieldErrors[`${prefix}-shelf-life-months`])}
                />
                {fieldErrors[`${prefix}-shelf-life-months`] ? <p className="text-xs text-destructive">{fieldErrors[`${prefix}-shelf-life-months`]}</p> : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor={`${prefix}-expiry-date`}>到期日期（可选）</Label>
                <Input
                  id={`${prefix}-expiry-date`}
                  type="date"
                  value={item.expiryDate}
                  onChange={(event) => {
                    updateItem(item.clientId, { expiryDate: event.target.value });
                    onClearFieldError(`${prefix}-expiry-date`);
                  }}
                  aria-invalid={Boolean(fieldErrors[`${prefix}-expiry-date`])}
                />
                {fieldErrors[`${prefix}-expiry-date`] ? <p className="text-xs text-destructive">{fieldErrors[`${prefix}-expiry-date`]}</p> : null}
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
            {isDateOnlyBefore(item.expiryDate, item.productionDate) ? <p className="text-xs text-destructive">到期日期不能早于生产日期。</p> : null}
          </section>
        );
      })}

      <div className="grid gap-3 rounded-lg border bg-background p-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
        <p>商品数量：{items.length} 件</p>
        <p>已填写参考金额：{referenceAmountCount} 件</p>
        <p>参考金额合计：¥{formatCents(totalCents)}</p>
        <p>已填写到期日期：{expiryDateCount} 件</p>
      </div>
      <p className="text-xs leading-5 text-muted-foreground">
        商品参考成交总额仅作每件采购商品的记录参考，不会自动修改订单实际付款金额或确认成本分摊。
      </p>
    </div>
  );
}
