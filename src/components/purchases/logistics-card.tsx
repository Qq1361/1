"use client";

import { useState } from "react";
import { AlertTriangle, CheckCheck, Info, Loader2, PackageCheck, RefreshCw, Truck } from "lucide-react";
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
  const [saving, setSaving] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [manualPending, setManualPending] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<{ carrierCode?: string; trackingNo?: string }>({});
  const [showManualConfirm, setShowManualConfirm] = useState(false);

  async function handleResponse(response: Response) {
    let data: LogisticsResponse | ApiError;
    try {
      data = await response.json();
    } catch {
      toast.error("服务器返回数据异常，请重试。");
      return false;
    }
    if (!response.ok) {
      toast.error((data as ApiError).message || "保存物流信息失败");
      return false;
    }
    try {
      onChange(data as LogisticsResponse);
    } catch {
      // onChange may throw, don't let it break our state
    }
    return true;
  }

  async function saveTracking() {
    setFieldErrors({});
    if (!carrierCode.trim() || !trackingNo.trim()) {
      if (!carrierCode.trim()) setFieldErrors((prev) => ({ ...prev, carrierCode: "请填写快递公司代码" }));
      if (!trackingNo.trim()) setFieldErrors((prev) => ({ ...prev, trackingNo: "请填写快递单号" }));
      toast.error("请填写快递公司代码和快递单号。");
      return;
    }
    setSaving(true);
    try {
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
    } catch {
      toast.error("网络异常，保存物流信息失败，请检查网络后重试。");
    } finally {
      setSaving(false);
    }
  }

  async function refresh() {
    if (!order.carrierCode || !order.trackingNo) {
      toast.error("请先填写并保存快递单号。");
      return;
    }
    if (saving) return;
    setRefreshing(true);
    try {
      const response = await fetch(
        `/api/purchase-orders/${order.id}/refresh-logistics`,
        { method: "POST" },
      );
      if (await handleResponse(response)) {
        toast.success("物流状态已更新");
      }
    } catch {
      toast.error("网络异常，刷新物流失败，请检查网络后重试。");
    } finally {
      setRefreshing(false);
    }
  }

  async function manualDeliver() {
    if (!order.carrierCode || !order.trackingNo) {
      toast.error("请先保存物流信息。");
      return;
    }
    setShowManualConfirm(false);
    setManualPending(true);
    try {
      const response = await fetch(
        `/api/purchase-orders/${order.id}/manual-delivery`,
        { method: "POST" },
      );
      if (await handleResponse(response)) {
        toast.success("已手动标记为已签收，待验货记录已生成。");
      }
    } catch {
      toast.error("网络异常，操作失败，请检查网络后重试。");
    } finally {
      setManualPending(false);
    }
  }

  const hasSavedTracking = !!(order.carrierCode && order.trackingNo);

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
        {/* Mock notification banner */}
        <div className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm">
          <div className="mb-2 flex items-center gap-2 font-medium text-amber-800">
            <Info className="size-4" />
            当前为 Mock 物流测试，不会查询真实快递接口。
          </div>
          <div className="space-y-1 text-amber-700">
            <p className="text-xs font-medium">测试规则：</p>
            <ul className="list-inside list-disc space-y-0.5 text-xs">
              <li>单号以 <code className="rounded bg-amber-100 px-1 text-xs">1</code> 结尾或包含 <code className="rounded bg-amber-100 px-1 text-xs">DELIVERED</code> = 已签收</li>
              <li>单号以 <code className="rounded bg-amber-100 px-1 text-xs">2</code> 结尾或包含 <code className="rounded bg-amber-100 px-1 text-xs">EXCEPTION</code> = 物流异常</li>
              <li>单号以 <code className="rounded bg-amber-100 px-1 text-xs">3</code> 结尾或包含 <code className="rounded bg-amber-100 px-1 text-xs">STALLED</code> = 物流停滞</li>
              <li>其他单号 = 运输中</li>
            </ul>
          </div>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <div className="space-y-2">
            <Label htmlFor="carrierCode">
              快递公司代码 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="carrierCode"
              value={carrierCode}
              onChange={(event) => {
                setCarrierCode(event.target.value);
                if (fieldErrors.carrierCode) setFieldErrors((prev) => ({ ...prev, carrierCode: undefined }));
              }}
              placeholder="例如 SF、YTO"
            />
            {fieldErrors.carrierCode ? (
              <p className="text-xs text-destructive">{fieldErrors.carrierCode}</p>
            ) : null}
          </div>
          <div className="space-y-2">
            <Label htmlFor="trackingNo">
              快递单号 <span className="text-destructive">*</span>
            </Label>
            <Input
              id="trackingNo"
              value={trackingNo}
              onChange={(event) => {
                setTrackingNo(event.target.value);
                if (fieldErrors.trackingNo) setFieldErrors((prev) => ({ ...prev, trackingNo: undefined }));
              }}
              placeholder="Mock 测试：DELIVERED1"
            />
            {fieldErrors.trackingNo ? (
              <p className="text-xs text-destructive">{fieldErrors.trackingNo}</p>
            ) : null}
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
            disabled={saving || refreshing || manualPending}
          >
            {saving ? (
              <Loader2 className="animate-spin" />
            ) : (
              <PackageCheck />
            )}
            保存物流信息
          </Button>
          <Button
            onClick={refresh}
            disabled={refreshing || saving || manualPending || !hasSavedTracking}
            title={!hasSavedTracking ? "请先保存物流信息" : undefined}
          >
            {refreshing ? (
              <Loader2 className="animate-spin" />
            ) : (
              <RefreshCw />
            )}
            刷新物流
          </Button>
        </div>

        {hasSavedTracking && order.logisticsStatus !== "DELIVERED" ? (
          <div className="border-t pt-4">
            {showManualConfirm ? (
              <div className="rounded-lg border border-amber-200 bg-amber-50 p-4">
                <p className="mb-3 text-sm font-medium text-amber-800">
                  确认手动标记已签收？
                </p>
                <p className="mb-3 text-xs text-amber-700">
                  此操作将把当前订单标记为已签收并生成待验货记录，仅用于 Mock 测试或物流接口延迟时的兜底处理。
                </p>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={manualPending}
                    onClick={() => setShowManualConfirm(false)}
                  >
                    取消
                  </Button>
                  <Button
                    size="sm"
                    disabled={manualPending}
                    onClick={manualDeliver}
                  >
                    {manualPending ? (
                      <Loader2 className="animate-spin" />
                    ) : (
                      <CheckCheck />
                    )}
                    确认标记已签收
                  </Button>
                </div>
              </div>
            ) : (
              <Button
                variant="outline"
                onClick={() => setShowManualConfirm(true)}
                disabled={saving || refreshing || manualPending}
              >
                <CheckCheck />
                手动标记已签收
              </Button>
            )}
          </div>
        ) : null}

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
              <div className="flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
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
