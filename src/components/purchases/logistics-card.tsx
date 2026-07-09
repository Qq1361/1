"use client";

import { useState } from "react";
import { Loader2, PackageCheck, RefreshCw, Truck } from "lucide-react";
import { toast } from "sonner";
import { LogisticsStatusBadge } from "./status-badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import type {
  ApiError,
  LogisticsEventDto,
  OrderDto,
} from "@/types/purchase";

type LogisticsResponse = {
  order: OrderDto;
  events: LogisticsEventDto[];
};

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function LogisticsCard({
  order,
  onChange,
}: {
  order: OrderDto;
  onChange: (response: LogisticsResponse) => void;
}) {
  const [carrierCode, setCarrierCode] = useState(order.carrierCode ?? "");
  const [trackingNo, setTrackingNo] = useState(order.trackingNo ?? "");
  const [shippedAt, setShippedAt] = useState(toLocalDateTime(order.shippedAt));
  const [pending, setPending] = useState<"save" | "refresh" | null>(null);

  async function handleResponse(response: Response) {
    const data = (await response.json()) as LogisticsResponse | ApiError;
    if (!response.ok) {
      toast.error((data as ApiError).message);
      return false;
    }
    onChange(data as LogisticsResponse);
    return true;
  }

  async function saveTracking() {
    setPending("save");
    const response = await fetch(`/api/purchase-orders/${order.id}/tracking`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        carrierCode,
        trackingNo,
        shippedAt: shippedAt ? new Date(shippedAt).toISOString() : undefined,
      }),
    });
    if (await handleResponse(response)) {
      toast.success("物流信息已保存");
    }
    setPending(null);
  }

  async function refresh() {
    setPending("refresh");
    const response = await fetch(
      `/api/purchase-orders/${order.id}/refresh-logistics`,
      { method: "POST" },
    );
    if (await handleResponse(response)) {
      toast.success("物流状态已更新");
    }
    setPending(null);
  }

  return (
    <Card className="rounded-lg shadow-none">
      <CardHeader className="flex-row items-center justify-between">
        <div className="flex items-center gap-2">
          <Truck className="size-4 text-muted-foreground" />
          <CardTitle className="text-base">采购物流</CardTitle>
        </div>
        <LogisticsStatusBadge status={order.logisticsStatus} />
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="carrierCode">快递公司代码</Label>
            <Input
              id="carrierCode"
              value={carrierCode}
              onChange={(event) => setCarrierCode(event.target.value)}
              placeholder="例如 SF、YTO"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="trackingNo">快递单号</Label>
            <Input
              id="trackingNo"
              value={trackingNo}
              onChange={(event) => setTrackingNo(event.target.value)}
              placeholder="Mock：末尾 1 签收"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="shippedAt">发货时间</Label>
            <Input
              id="shippedAt"
              type="datetime-local"
              value={shippedAt}
              onChange={(event) => setShippedAt(event.target.value)}
            />
          </div>
        </div>
        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Button
            variant="outline"
            onClick={saveTracking}
            disabled={pending !== null || !carrierCode || !trackingNo}
          >
            {pending === "save" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <PackageCheck />
            )}
            保存物流信息
          </Button>
          <Button
            onClick={refresh}
            disabled={pending !== null || !order.trackingNo}
          >
            {pending === "refresh" ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            刷新物流
          </Button>
        </div>

        {order.trackingNo ? (
          <>
            <Separator />
            <div className="grid gap-3 text-sm sm:grid-cols-2">
              <div>
                <p className="text-xs text-muted-foreground">最新物流</p>
                <p className="mt-1">
                  {order.logisticsLastEventText ?? "尚未查询物流"}
                </p>
              </div>
              <div>
                <p className="text-xs text-muted-foreground">最后查询时间</p>
                <p className="mt-1">
                  {order.logisticsLastCheckedAt
                    ? new Date(order.logisticsLastCheckedAt).toLocaleString(
                        "zh-CN",
                      )
                    : "尚未查询"}
                </p>
              </div>
            </div>
            {order.logisticsExceptionMessage ? (
              <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                {order.logisticsExceptionMessage}
              </div>
            ) : null}
            <div className="space-y-3">
              <p className="text-xs font-medium text-muted-foreground">
                当前单号物流事件
              </p>
              {order.logisticsEvents.length ? (
                order.logisticsEvents.map((event) => (
                  <div
                    key={event.id}
                    className="grid gap-1 border-l-2 pl-3 text-sm"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span>{event.eventText}</span>
                      <LogisticsStatusBadge status={event.status} />
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {new Date(event.eventTime).toLocaleString("zh-CN")}
                      {event.location ? ` · ${event.location}` : ""}
                    </span>
                  </div>
                ))
              ) : (
                <p className="text-sm text-muted-foreground">暂无物流事件</p>
              )}
            </div>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}
