"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AttachmentUploader } from "@/components/purchases/attachment-uploader";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { AttachmentDto } from "@/types/purchase";

type Detail = {
  id: string;
  inventoryCode: string;
  name: string;
  skuText: string | null;
  unitCost: string;
  expiryDate: string | null;
  stockedAt: string;
  locationStatus: string;
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
    purchaseOrder: { id: string; orderNo: string };
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
  const fields = [
    ["是否有盒", item.inspection.hasBox],
    ["盖子状态", item.inspection.capCondition],
    ["掉漆情况", item.inspection.paintCondition],
    ["漏液情况", item.inspection.leakageCondition],
    ["是否全新", item.inspection.isNew],
    ["使用痕迹", item.inspection.hasUsageTrace],
    ["批号", item.inspection.batchCode],
    ["外观备注", item.inspection.appearanceNotes],
    ["验货备注", item.inspection.notes],
  ];

  return (
    <div className="space-y-5">
      <Button variant="ghost" size="sm" render={<Link href="/inventory" />}>
        <ArrowLeft /> 返回库存
      </Button>
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
            <Info label="库位" text={item.locationStatus} />
            <Info label="出售模式" text={item.saleMode} />
            <Info label="验货结果" text={item.inspection.result} />
          </CardContent>
        </Card>
        <Card className="rounded-lg shadow-none">
          <CardHeader><CardTitle className="text-base">采购来源</CardTitle></CardHeader>
          <CardContent className="space-y-3 text-sm">
            <Info label="采购订单" text={item.purchaseOrderItem.purchaseOrder.orderNo} />
            <Info label="采购明细" text={item.purchaseOrderItem.name} />
            <Info label="单件序号" text={`第 ${item.inspection.sequence} 件`} />
            <Button variant="outline" render={<Link href={`/purchases/${item.purchaseOrderItem.purchaseOrder.id}`} />}>
              查看采购订单
            </Button>
          </CardContent>
        </Card>
      </div>
      <Card className="rounded-lg shadow-none">
        <CardHeader><CardTitle className="text-base">验货记录</CardTitle></CardHeader>
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
