"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { ImagePlus, Loader2, Plus, Trash2 } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { ApiError, OrderDto } from "@/types/purchase";

type FormItem = {
  clientId: string;
  name: string;
  skuText: string;
  quantity: number;
  notes: string;
  files: File[];
};

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
    notes: "",
    files: [],
  };
}

export function OrderForm() {
  const router = useRouter();
  const [submitting, setSubmitting] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [orderFiles, setOrderFiles] = useState<File[]>([]);
  const [items, setItems] = useState<FormItem[]>([newItem("initial-item")]);
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
    if (!form.orderNo.trim()) {
      setFormError("请填写闲鱼订单号。");
      return;
    }
    if (!form.paidAt) {
      setFormError("请选择付款日期。");
      return;
    }
    if (
      !moneyPattern.test(form.totalAmount.trim()) ||
      !moneyPattern.test(form.shippingAmount.trim())
    ) {
      setFormError("请输入有效金额，金额最多保留两位小数。");
      return;
    }
    if (
      items.some(
        (item) =>
          !item.name.trim() ||
          !Number.isInteger(item.quantity) ||
          item.quantity < 1 ||
          item.quantity > 999,
      )
    ) {
      setFormError("请填写每条商品明细的名称和有效数量。");
      return;
    }

    setSubmitting(true);
    try {
      const response = await fetch("/api/purchase-orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...form,
          paidAt: new Date(`${form.paidAt}T00:00:00+08:00`).toISOString(),
          items: items.map((item) => ({
            clientId: item.clientId,
            name: item.name,
            skuText: item.skuText,
            quantity: item.quantity,
            notes: item.notes,
          })),
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
              onChange={(event) =>
                setForm({ ...form, orderNo: event.target.value })
              }
              required
            />
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
              onChange={(event) =>
                setForm({ ...form, paidAt: event.target.value })
              }
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="totalAmount">商品金额</Label>
            <Input
              id="totalAmount"
              inputMode="decimal"
              value={form.totalAmount}
              onChange={(event) =>
                setForm({ ...form, totalAmount: event.target.value })
              }
              placeholder="0.00"
              required
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shippingAmount">运费</Label>
            <Input
              id="shippingAmount"
              inputMode="decimal"
              value={form.shippingAmount}
              onChange={(event) =>
                setForm({ ...form, shippingAmount: event.target.value })
              }
              required
            />
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
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">商品明细</CardTitle>
          <button
            type="button"
            className={buttonVariants({ variant: "outline", size: "sm" })}
            disabled={submitting}
            onClick={() => {
              setFormError(null);
              setItems((current) => [...current, newItem()]);
            }}
          >
            <Plus />
            添加商品
          </button>
        </CardHeader>
        <CardContent className="space-y-4">
          {items.map((item, index) => (
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
                  <Label>商品名称</Label>
                  <Input
                    value={item.name}
                    onChange={(event) =>
                      updateItem(item.clientId, { name: event.target.value })
                    }
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label>规格 / SKU</Label>
                  <Input
                    value={item.skuText}
                    onChange={(event) =>
                      updateItem(item.clientId, { skuText: event.target.value })
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label>数量</Label>
                  <Input
                    type="number"
                    min={1}
                    max={999}
                    value={item.quantity}
                    onChange={(event) =>
                      updateItem(item.clientId, {
                        quantity: Number(event.target.value),
                      })
                    }
                    required
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>商品备注</Label>
                <Textarea
                  value={item.notes}
                  onChange={(event) =>
                    updateItem(item.clientId, { notes: event.target.value })
                  }
                  rows={2}
                />
              </div>
              <div className="space-y-2">
                <Label>商品图片</Label>
                <label className="flex min-h-16 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-background text-sm text-muted-foreground">
                  <ImagePlus className="size-4" />
                  {item.files.length
                    ? `已选择 ${item.files.length} 张`
                    : "选择商品图片"}
                  <input
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
              </div>
            </div>
          ))}
        </CardContent>
      </Card>

      <Card className="rounded-lg shadow-none">
        <CardHeader>
          <CardTitle className="text-base">订单附件</CardTitle>
        </CardHeader>
        <CardContent>
          <label className="flex min-h-24 cursor-pointer items-center justify-center gap-2 rounded-lg border border-dashed bg-muted/20 text-sm text-muted-foreground">
            <ImagePlus className="size-4" />
            {orderFiles.length
              ? `已选择 ${orderFiles.length} 张`
              : "选择订单聊天记录或凭证图片"}
            <input
              className="sr-only"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              multiple
              onChange={(event) =>
                setOrderFiles(Array.from(event.target.files ?? []))
              }
            />
          </label>
        </CardContent>
      </Card>

      <div className="sticky bottom-0 flex justify-end border-t bg-background/95 py-4 backdrop-blur">
        <button
          type="submit"
          className={buttonVariants({ size: "lg" })}
          disabled={submitting}
        >
          {submitting ? <Loader2 className="animate-spin" /> : null}
          {submitting ? "正在创建" : "创建订单"}
        </button>
      </div>
    </form>
  );
}
