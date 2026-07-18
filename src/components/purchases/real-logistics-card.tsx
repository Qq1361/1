"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw, Route, Truck } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

type ProviderStatus = {
  provider: "KDNIAO";
  configured: boolean;
  mode: "disabled" | "sandbox" | "production";
};

type TrackingEvent = {
  id: string;
  eventTime: string;
  status: string;
  location: string | null;
  description: string;
  rawStatusCode: string | null;
  createdAt: string;
};

type Shipment = {
  id: string;
  businessType: string;
  businessId: string;
  provider: string;
  carrierCode: string;
  carrierName: string | null;
  trackingNumber: string;
  currentStatus: string;
  rawStatusCode: string | null;
  lastEventAt: string | null;
  lastSyncedAt: string | null;
  nextSyncAt: string | null;
  syncStatus: string;
  failureCount: number;
  lastErrorCode: string | null;
  deliveredAt: string | null;
  createdAt: string;
  updatedAt: string;
};

type ShipmentResponse = { shipment: Shipment | null; events: TrackingEvent[] };
type ApiError = { error?: { code?: string; message?: string }; message?: string };

const COMMON_CARRIERS = [
  { code: "SF", name: "顺丰速运" },
  { code: "ZTO", name: "中通快递" },
  { code: "YTO", name: "圆通速递" },
  { code: "STO", name: "申通快递" },
  { code: "YD", name: "韵达速递" },
  { code: "JTSD", name: "极兔速递" },
  { code: "EMS", name: "EMS" },
  { code: "JD", name: "京东物流" },
] as const;

const STATUS_LABELS: Record<string, string> = {
  UNKNOWN: "暂无有效轨迹",
  PENDING_PICKUP: "待揽收",
  PICKED_UP: "已揽收",
  IN_TRANSIT: "运输中",
  ARRIVED_AT_DESTINATION: "已到达目的地",
  OUT_FOR_DELIVERY: "派送中",
  DELIVERED: "已签收",
  EXCEPTION: "物流异常",
  RETURNING: "退回中",
  CANCELLED: "已取消",
};

const SYNC_ERROR_LABELS: Record<string, string> = {
  LOGISTICS_PROVIDER_NOT_CONFIGURED: "真实物流查询尚未配置。",
  LOGISTICS_PROVIDER_AUTH_FAILED: "快递鸟认证失败，请检查服务端配置。",
  LOGISTICS_PROVIDER_RATE_LIMITED: "快递鸟查询次数已受限，请稍后重试。",
  LOGISTICS_PROVIDER_TIMEOUT: "快递鸟查询超时，请稍后重试。",
  LOGISTICS_PROVIDER_NETWORK_ERROR: "暂时无法连接快递鸟，请稍后重试。",
  LOGISTICS_PROVIDER_INVALID_RESPONSE: "快递鸟返回数据无效。",
  LOGISTICS_PROVIDER_REJECTED: "快递鸟拒绝了本次查询。",
};

function formatTime(value: string | null) {
  if (!value) return "未填写";
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date(value));
}

async function readJson<T>(response: Response) {
  let payload: T | ApiError;
  try {
    payload = await response.json() as T | ApiError;
  } catch {
    throw new Error("服务器返回数据异常，请重试。");
  }
  if (!response.ok) {
    const error = payload as ApiError;
    throw new Error(error.error?.message || error.message || "真实物流请求失败，请重试。");
  }
  return payload as T;
}

export function RealLogisticsCard({
  orderId,
  legacyCarrierCode,
  legacyTrackingNumber,
}: {
  orderId: string;
  legacyCarrierCode?: string | null;
  legacyTrackingNumber?: string | null;
}) {
  const initialCarrier = COMMON_CARRIERS.some((item) => item.code === legacyCarrierCode?.toUpperCase())
    ? legacyCarrierCode!.toUpperCase()
    : "SF";
  const [providerStatus, setProviderStatus] = useState<ProviderStatus | null>(null);
  const [data, setData] = useState<ShipmentResponse>({ shipment: null, events: [] });
  const [carrierChoice, setCarrierChoice] = useState(initialCarrier);
  const [customCarrierCode, setCustomCarrierCode] = useState("");
  const [trackingNumber, setTrackingNumber] = useState(legacyTrackingNumber ?? "");
  const [loading, setLoading] = useState(true);
  const [registering, setRegistering] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadSavedData = useCallback(async (signal?: AbortSignal) => {
    setLoading(true);
    setError(null);
    try {
      const query = new URLSearchParams({ businessType: "PURCHASE_INBOUND", businessId: orderId });
      const [statusResponse, shipmentResponse] = await Promise.all([
        fetch("/api/logistics/provider-status", { signal }),
        fetch(`/api/logistics/shipments?${query}`, { signal }),
      ]);
      const [status, shipmentData] = await Promise.all([
        readJson<ProviderStatus>(statusResponse),
        readJson<ShipmentResponse>(shipmentResponse),
      ]);
      setProviderStatus(status);
      setData(shipmentData);
    } catch (loadError) {
      if (loadError instanceof DOMException && loadError.name === "AbortError") return;
      setError(loadError instanceof Error ? loadError.message : "加载真实物流信息失败。");
    } finally {
      setLoading(false);
    }
  }, [orderId]);

  useEffect(() => {
    const controller = new AbortController();
    const timer = window.setTimeout(() => void loadSavedData(controller.signal), 0);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [loadSavedData]);

  const selectedCarrier = useMemo(() => {
    const code = carrierChoice === "OTHER" ? customCarrierCode.trim().toUpperCase() : carrierChoice;
    const common = COMMON_CARRIERS.find((item) => item.code === code);
    return { code, name: common?.name ?? code };
  }, [carrierChoice, customCarrierCode]);

  async function registerShipment() {
    setError(null);
    if (!/^[A-Z0-9]{2,20}$/.test(selectedCarrier.code)) {
      setError("快递公司代码必须为 2 到 20 位大写字母或数字。");
      return;
    }
    if (!/^[A-Za-z0-9\-/]{1,100}$/.test(trackingNumber.trim())) {
      setError("快递单号只能包含字母、数字、连字符或斜杠。");
      return;
    }
    setRegistering(true);
    try {
      const response = await fetch("/api/logistics/shipments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          businessType: "PURCHASE_INBOUND",
          businessId: orderId,
          provider: "KDNIAO",
          carrierCode: selectedCarrier.code,
          carrierName: selectedCarrier.name,
          trackingNumber: trackingNumber.trim(),
        }),
      });
      const shipmentData = await readJson<ShipmentResponse>(response);
      setData(shipmentData);
      toast.success("真实物流单号已绑定，请点击查询物流获取轨迹。");
    } catch (registerError) {
      const message = registerError instanceof Error ? registerError.message : "绑定真实物流失败。";
      setError(message);
      toast.error(message);
    } finally {
      setRegistering(false);
    }
  }

  async function syncShipment() {
    if (!data.shipment || syncing) return;
    setSyncing(true);
    setError(null);
    try {
      const response = await fetch(`/api/logistics/shipments/${data.shipment.id}/sync`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
      const shipmentData = await readJson<ShipmentResponse>(response);
      setData(shipmentData);
      toast.success("真实物流轨迹已更新。");
    } catch (syncError) {
      const message = syncError instanceof Error ? syncError.message : "查询真实物流失败。";
      setError(message);
      toast.error(message);
    } finally {
      setSyncing(false);
    }
  }

  const shipment = data.shipment;
  const configured = providerStatus?.configured === true;
  const legacyMismatch = Boolean(
    shipment
    && legacyTrackingNumber
    && shipment.trackingNumber.replace(/\s+/g, "").toUpperCase() !== legacyTrackingNumber.replace(/\s+/g, "").toUpperCase(),
  );

  return (
    <Card className="rounded-lg shadow-none" data-testid="real-logistics-card">
      <CardHeader>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Route className="size-4 text-muted-foreground" />
            <CardTitle className="text-base">真实物流查询</CardTitle>
          </div>
          <span className="text-xs text-muted-foreground">
            Provider：快递鸟 · {providerStatus?.mode === "production" ? "正式" : providerStatus?.mode === "sandbox" ? "沙箱" : "未启用"}
          </span>
        </div>
      </CardHeader>
      <CardContent className="space-y-5">
        {loading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />加载已保存物流信息...</div>
        ) : null}

        {!loading && !configured ? (
          <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800" data-testid="kdniao-not-configured">
            真实物流查询尚未配置，当前仍可手工维护物流状态。
          </div>
        ) : null}

        {!shipment && !loading ? (
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-[220px_1fr_auto] lg:items-end">
            <div className="space-y-2">
              <Label htmlFor="real-logistics-carrier">快递公司</Label>
              <select
                id="real-logistics-carrier"
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                value={carrierChoice}
                onChange={(event) => setCarrierChoice(event.target.value)}
                disabled={!configured || registering}
              >
                {COMMON_CARRIERS.map((carrier) => <option key={carrier.code} value={carrier.code}>{carrier.name}</option>)}
                <option value="OTHER">其他承运商代码</option>
              </select>
            </div>
            {carrierChoice === "OTHER" ? (
              <div className="space-y-2">
                <Label htmlFor="real-logistics-custom-carrier">承运商代码</Label>
                <Input id="real-logistics-custom-carrier" value={customCarrierCode} onChange={(event) => setCustomCarrierCode(event.target.value.toUpperCase())} maxLength={20} disabled={!configured || registering} />
              </div>
            ) : null}
            <div className="space-y-2">
              <Label htmlFor="real-logistics-tracking">快递单号</Label>
              <Input id="real-logistics-tracking" value={trackingNumber} onChange={(event) => setTrackingNumber(event.target.value)} maxLength={100} disabled={!configured || registering} />
            </div>
            <Button type="button" onClick={registerShipment} disabled={!configured || registering || syncing}>
              {registering ? <Loader2 className="animate-spin" /> : <Truck />}
              {registering ? "绑定中..." : "绑定真实物流"}
            </Button>
          </div>
        ) : null}

        {shipment ? (
          <>
            <div className="grid gap-3 text-sm sm:grid-cols-2 lg:grid-cols-3">
              <InfoField label="快递公司" value={shipment.carrierName || shipment.carrierCode} />
              <InfoField label="快递单号" value={shipment.trackingNumber} />
              <InfoField label="当前物流状态" value={STATUS_LABELS[shipment.currentStatus] ?? "未知状态"} />
              <InfoField label="最后查询时间" value={formatTime(shipment.lastSyncedAt)} />
              <InfoField label="最近轨迹时间" value={formatTime(shipment.lastEventAt)} />
              <InfoField label="签收时间" value={formatTime(shipment.deliveredAt)} />
            </div>
            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-xs text-muted-foreground">真实物流记录仅保存标准化状态和脱敏后的轨迹，不会反向覆盖采购订单的人工物流字段。</p>
              <Button type="button" onClick={syncShipment} disabled={!configured || syncing || registering}>
                {syncing ? <Loader2 className="animate-spin" /> : <RefreshCw />}
                {syncing ? "查询中..." : "查询物流"}
              </Button>
            </div>
            {legacyMismatch ? (
              <div className="rounded-md border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                真实物流绑定单号与采购订单人工维护的单号不一致，请人工核对；系统不会自动覆盖任一记录。
              </div>
            ) : null}
            {shipment.lastErrorCode ? (
              <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                <AlertTriangle className="mt-0.5 size-4 shrink-0" />
                同步错误：{SYNC_ERROR_LABELS[shipment.lastErrorCode] ?? "真实物流查询失败，请稍后重试。"}
              </div>
            ) : null}
            {shipment.currentStatus === "DELIVERED" ? (
              <div className="rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-900" data-testid="logistics-delivered-warning">
                物流服务商显示已签收，仍需人工确认商品数量、成色和附件，并完成验货后才能入库。
              </div>
            ) : null}
            <div className="space-y-3">
              <p className="text-sm font-medium">物流轨迹时间线</p>
              {data.events.length ? data.events.map((event) => (
                <div key={event.id} className="min-w-0 border-l-2 pl-3 text-sm" data-testid="real-logistics-event">
                  <p className="break-words leading-6">{event.description}</p>
                  <p className="mt-1 break-words text-xs text-muted-foreground">
                    {formatTime(event.eventTime)} · {STATUS_LABELS[event.status] ?? "未知状态"}
                  </p>
                </div>
              )) : <p className="text-sm text-muted-foreground">暂无真实物流轨迹，请手动点击“查询物流”。</p>}
            </div>
          </>
        ) : null}

        {error ? (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800" role="alert">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />
            <span className="break-words">{error}</span>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}

function InfoField({ label, value }: { label: string; value: string }) {
  return <div className="min-w-0"><p className="text-xs text-muted-foreground">{label}</p><p className="mt-1 break-words">{value}</p></div>;
}
