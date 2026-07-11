"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft, Loader2, Pencil } from "lucide-react";
import { toast } from "sonner";
import { AttachmentUploader } from "@/components/purchases/attachment-uploader";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AttachmentDto } from "@/types/purchase";

const locationStatusLabels: Record<string, string> = {
  LOCAL: "本地仓",
  DEWU_WAREHOUSE: "得物仓",
  RETURNING: "退回中",
  SOLD: "已售出",
};

const saleModeLabels: Record<string, string> = {
  NONE: "未选择",
  DEWU_LIGHTNING: "得物闪电",
  DEWU_STANDARD: "得物普通",
  NINETY_FIVE: "95分",
  XIANYU: "闲鱼",
  OTHER: "其他",
};

type Detail = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  unitCost: string;
  expiryDate: string | null;
  stockedAt: string;
  locationStatus: string;
  storageLocation: string | null;
  saleMode: string;
  itemStatus: string;
  inspectionId: string;
  inspection: {
    sequence: number;
    result: string;
    hasBox: boolean | null;
    capCondition: string | null;
    paintCondition: string | null;
    leakageCondition: string | null;
    isNew: boolean | null;
    hasUsageTrace: boolean | null;
    batchCode: string | null;
    appearanceNotes: string | null;
    notes: string | null;
    completedAt: string | null;
  };
  purchaseOrderItem: {
    name: string;
    skuText: string | null;
    purchaseOrder: { id: string; orderNo: string; sellerNickname: string | null };
  };
  attachments: AttachmentDto[];
};

function value(value: unknown) {
  if (value === true) return "是";
  if (value === false) return "否";
  return value ? String(value) : "未填写";
}

export function InventoryDetail({ id }: { id: string }) {
  const [item, setItem] = useState<Detail | null>(null);
  useEffect(() => {
    fetch(`/api/inventory/${id}`).then((response) => response.json()).then(setItem);
  }, [id]);

  if (!item) return <Skeleton className="h-[30rem]" />;
  const fields: [string, unknown][] = [
    ["是否有盒", item.inspection.hasBox],
    ["是否全新", item.inspection.isNew],
  ];
  if (item.inspection.isNew === false) {
    fields.push(
      ["使用痕迹", item.inspection.hasUsageTrace],
      ["盖子状态", item.inspection.capCondition],
      ["掉漆情况", item.inspection.paintCondition],
      ["漏液情况", item.inspection.leakageCondition],
    );
  }
  fields.push(
    ["批号", item.inspection.batchCode],
    ["外观备注", item.inspection.appearanceNotes],
    ["验货备注", item.inspection.notes],
  );

  return (
    <div className="space-y-5">
      <Link href="/inventory" className={buttonVariants({ variant: "ghost", size: "sm" })}>
        <ArrowLeft /> 返回库存
      </Link>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">{item.inventoryCode}</p>
          <h1 className="text-2xl font-semibold">{item.name}</h1>
          <p className="text-sm text-muted-foreground">{item.skuText || "无 SKU"}</p>
        </div>
        <Badge variant={item.itemStatus === "PROBLEM" ? "destructive" : "secondary"}>
          {item.itemStatus === "PROBLEM" ? "问题件" : "已入库"}
        </Badge>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card className="rounded-lg shadow-none">
          <CardHeader><CardTitle className="text-base">库存信息</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <Info label="单件成本" text={`¥${item.unitCost}`} />
            <Info label="入库时间" text={new Date(item.stockedAt).toLocaleString("zh-CN")} />
            <Info label="效期" text={item.expiryDate ? new Date(item.expiryDate).toLocaleDateString("zh-CN") : "未填写"} />
            <Info label="位置大类" text={locationStatusLabels[item.locationStatus] ?? item.locationStatus} />
            <Info label="具体库位" text={item.storageLocation || "未填写"} />
            <SaleModeField itemId={id} currentMode={item.saleMode} onUpdate={(mode) => setItem({ ...item, saleMode: mode })} />
            <Info label="验货结果" text={item.inspection.result} />
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardHeader><CardTitle className="text-base">采购来源</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="采购订单" text={item.purchaseOrderItem.purchaseOrder.orderNo} />
            {item.purchaseOrderItem.purchaseOrder.orderNo ? (
              <Info label="闲鱼订单号" text={item.purchaseOrderItem.purchaseOrder.orderNo} />
            ) : null}
            <Info label="卖家昵称" text={item.purchaseOrderItem.purchaseOrder.sellerNickname || "未填写"} />
            <Info label="采购明细" text={item.purchaseOrderItem.name} />
            <Info label="SKU" text={item.purchaseOrderItem.skuText || "未填写"} />
            <Info label="单件序号" text={`第 ${item.inspection.sequence} 件`} />
            <Link href={`/purchases/${item.purchaseOrderItem.purchaseOrder.id}?returnTo=/inventory/${item.id}`} className={buttonVariants({ variant: "outline" })}>
              查看采购订单
            </Link>
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-lg shadow-none">
        <CardHeader className="flex-row items-center justify-between">
          <CardTitle className="text-base">验货记录</CardTitle>
          <Link
            href={`/inspections/${item.inspectionId}?edit=true`}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            <Pencil />
            编辑验货信息
          </Link>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {fields.map(([label, fieldValue]) => (
            <Info key={String(label)} label={String(label)} text={value(fieldValue)} />
          ))}
        </CardContent>
      </Card>
      <AttachmentUploader
        entityType="INSPECTION"
        entityId={item.inspectionId}
        initialAttachments={item.attachments}
      />
    </div>
  );
}

function Info({ label, text }: { label: string; text: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words">{text}</p>
    </div>
  );
}

function SaleModeField({
  itemId,
  currentMode,
  onUpdate,
}: {
  itemId: string;
  currentMode: string;
  onUpdate: (mode: string) => void;
}) {
  const [pending, setPending] = useState(false);
  const [mode, setMode] = useState(currentMode);

  async function save(newMode: string) {
    if (newMode === mode) return;
    setPending(true);
    const response = await fetch(`/api/inventory/${itemId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ saleMode: newMode }),
    });
    setPending(false);
    if (!response.ok) {
      const err = await response.json();
      toast.error(err.message ?? "保存失败");
      return;
    }
    setMode(newMode);
    onUpdate(newMode);
  }

  return (
    <div>
      <p className="text-xs text-muted-foreground">出售方式</p>
      <div className="mt-1 flex items-center gap-2">
        <select
          className="h-7 rounded-lg border bg-background px-2 text-xs"
          value={mode}
          disabled={pending}
          onChange={(e) => save(e.target.value)}
        >
          {Object.entries(saleModeLabels).map(([value, label]) => (
            <option key={value} value={value}>{label}</option>
          ))}
        </select>
        {pending ? <Loader2 className="size-3 animate-spin text-muted-foreground" /> : null}
      </div>
    </div>
  );
}
