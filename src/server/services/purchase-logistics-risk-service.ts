import { db } from "@/server/db";

export const PURCHASE_LOGISTICS_RISK_TYPES = {
  MISSING_TRACKING_NUMBER: "MISSING_TRACKING_NUMBER",
  TRACKING_NOT_RECEIVED_OVERDUE: "TRACKING_NOT_RECEIVED_OVERDUE",
} as const;

export type PurchaseLogisticsRiskType =
  (typeof PURCHASE_LOGISTICS_RISK_TYPES)[keyof typeof PURCHASE_LOGISTICS_RISK_TYPES];

export type PurchaseLogisticsRisk = {
  type: PurchaseLogisticsRiskType;
  purchaseOrderId: string;
  orderNumber: string;
  productSummary: string;
  carrier: string | null;
  maskedTrackingNumber: string | null;
  referenceAt: Date;
  elapsedHours: number;
  elapsedDays: number;
  severity: "warning" | "critical";
  detailPath: string;
};

type RiskOrder = {
  id: string;
  orderNo: string;
  status: string;
  paidAt: Date;
  carrierCode: string | null;
  trackingNo: string | null;
  trackingNumberRecordedAt: Date | null;
  manuallyReceivedAt: Date | null;
  items: Array<{ name: string; quantity: number }>;
};

const HOUR_MS = 60 * 60 * 1000;
const MISSING_TRACKING_HOURS = 48;
const TRACKING_RECEIPT_HOURS = 120;

export function maskTrackingNumber(value: string | null) {
  const trackingNo = value?.trim() ?? "";
  if (!trackingNo) return null;
  if (trackingNo.length <= 4) return "****";
  if (trackingNo.length <= 8) return `${trackingNo.slice(0, 2)}****${trackingNo.slice(-2)}`;
  return `${trackingNo.slice(0, 4)}****${trackingNo.slice(-4)}`;
}

function productSummary(items: RiskOrder["items"]) {
  const summary = items.map((item) => `${item.name} x${item.quantity}`).join("、");
  return summary || "未填写商品明细";
}

function elapsed(referenceAt: Date, now: Date) {
  const hours = Math.max(0, Math.floor((now.getTime() - referenceAt.getTime()) / HOUR_MS));
  return { elapsedHours: hours, elapsedDays: Math.floor(hours / 24) };
}

function isFinished(order: RiskOrder) {
  return order.status === "CANCELLED" || order.status === "STOCKED" || order.status === "PARTIALLY_STOCKED";
}

export function calculatePurchaseLogisticsRisks(orders: RiskOrder[], now = new Date()): PurchaseLogisticsRisk[] {
  const risks: PurchaseLogisticsRisk[] = [];
  for (const order of orders) {
    if (isFinished(order)) continue;
    const trackingNo = order.trackingNo?.trim() ?? "";
    const base = {
      purchaseOrderId: order.id,
      orderNumber: order.orderNo,
      productSummary: productSummary(order.items),
      carrier: order.carrierCode,
      detailPath: `/purchases/${order.id}`,
    };

    if (!trackingNo) {
      // Preserve the pre-existing M2-A reminder scope: only orders still
      // waiting for shipment need a missing-tracking-number reminder.
      if (order.status !== "PAID" && order.status !== "WAITING_SHIPMENT") {
        continue;
      }
      const duration = elapsed(order.paidAt, now);
      if (duration.elapsedHours >= MISSING_TRACKING_HOURS) {
        risks.push({
          ...base,
          type: PURCHASE_LOGISTICS_RISK_TYPES.MISSING_TRACKING_NUMBER,
          maskedTrackingNumber: null,
          referenceAt: order.paidAt,
          ...duration,
          severity: "warning",
        });
      }
      continue;
    }

    if (!order.trackingNumberRecordedAt || order.manuallyReceivedAt) continue;
    const duration = elapsed(order.trackingNumberRecordedAt, now);
    if (duration.elapsedHours >= TRACKING_RECEIPT_HOURS) {
      risks.push({
        ...base,
        type: PURCHASE_LOGISTICS_RISK_TYPES.TRACKING_NOT_RECEIVED_OVERDUE,
        maskedTrackingNumber: maskTrackingNumber(trackingNo),
        referenceAt: order.trackingNumberRecordedAt,
        ...duration,
        severity: "critical",
      });
    }
  }
  return risks.sort((a, b) => a.referenceAt.getTime() - b.referenceAt.getTime() || a.orderNumber.localeCompare(b.orderNumber));
}

export class PurchaseLogisticsRiskService {
  async list(ownerId: string, now = new Date()) {
    const orders = await db.purchaseOrder.findMany({
      where: { ownerId, status: { not: "CANCELLED" } },
      select: {
        id: true,
        orderNo: true,
        status: true,
        paidAt: true,
        carrierCode: true,
        trackingNo: true,
        trackingNumberRecordedAt: true,
        manuallyReceivedAt: true,
        items: { select: { name: true, quantity: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] },
      },
    });
    return calculatePurchaseLogisticsRisks(orders, now);
  }
}

export const purchaseLogisticsRiskService = new PurchaseLogisticsRiskService();
