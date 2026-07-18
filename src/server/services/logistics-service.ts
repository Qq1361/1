import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { MockLogisticsAdapter } from "@/server/adapters/logistics/mock-logistics-adapter";
import { ensurePendingInspectionsTx } from "@/server/services/inspection-service";

const adapter = new MockLogisticsAdapter();

export function resolvePurchaseStatus(
  currentStatus: string,
  logisticsStatus: string,
) {
  if (logisticsStatus === "DELIVERED") return "PENDING_INSPECTION" as const;
  if (currentStatus === "PENDING_INSPECTION")
    return "PENDING_INSPECTION" as const;
  return "IN_TRANSIT" as const;
}

export class LogisticsService {
  async getSummary(ownerId: string, orderId: string) {
    const order = await db.purchaseOrder.findFirst({
      where: { id: orderId, ownerId },
    });
    if (!order) {
      throw new ServiceError("ORDER_NOT_FOUND", "采购订单不存在。", 404);
    }
    const events =
      order.carrierCode && order.trackingNo
        ? await db.logisticsEvent.findMany({
            where: {
              ownerId,
              purchaseOrderId: orderId,
              carrierCode: order.carrierCode,
              trackingNo: order.trackingNo,
            },
            orderBy: { eventTime: "desc" },
            take: 20,
          })
        : [];
    return { order, events };
  }

  async saveTracking(
    ownerId: string,
    orderId: string,
    input: {
      carrierCode: string;
      trackingNo: string;
      shippedAt?: Date;
    },
  ) {
    const { order } = await this.getSummary(ownerId, orderId);
    if (order.status === "CANCELLED") {
      throw new ServiceError(
        "ORDER_CANCELLED",
        "已取消订单不能填写物流信息。",
        409,
      );
    }
    const isNewTrackingNo = order.trackingNo !== input.trackingNo;
    const shouldRestartTransit = isNewTrackingNo && !order.manuallyReceivedAt;
    const firstTrackingNumberRecorded = !order.trackingNo?.trim() && Boolean(input.trackingNo.trim());
    const now = new Date();
    const updated = await db.purchaseOrder.update({
      where: { id: orderId },
      data: {
        carrierCode: input.carrierCode,
        trackingNo: input.trackingNo,
        shippedAt: input.shippedAt ?? order.shippedAt ?? now,
        ...(firstTrackingNumberRecorded && !order.trackingNumberRecordedAt
          ? { trackingNumberRecordedAt: now }
          : {}),
        ...(shouldRestartTransit
          ? {
              status: "IN_TRANSIT",
              logisticsStatus: "IN_TRANSIT",
              deliveredAt: null,
              logisticsLastCheckedAt: null,
              logisticsLastEventAt: null,
              logisticsLastEventText: null,
              logisticsExceptionType: null,
              logisticsExceptionMessage: null,
              manuallyReceivedAt: null,
            }
          : {}),
      },
    });
    return {
      order: updated,
      events: isNewTrackingNo ? [] : (await this.getSummary(ownerId, orderId)).events,
    };
  }

  async manualDeliver(ownerId: string, orderId: string) {
    const { order } = await this.getSummary(ownerId, orderId);
    if (!order.carrierCode || !order.trackingNo) {
      throw new ServiceError(
        "TRACKING_REQUIRED",
        "请先填写快递公司和快递单号。",
        422,
      );
    }
    if (order.manuallyReceivedAt) {
      throw new ServiceError(
        "ALREADY_DELIVERED",
        "物流状态已经是已签收。",
        409,
      );
    }
    const now = new Date();
    await db.$transaction(async (tx) => {
      await tx.logisticsEvent.create({
        data: {
          ownerId,
          purchaseOrderId: orderId,
          carrierCode: order.carrierCode!,
          trackingNo: order.trackingNo!,
          eventTime: now,
          eventText: "用户手动标记已签收",
          status: "DELIVERED",
        },
      });
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: "PENDING_INSPECTION",
          logisticsStatus: "DELIVERED",
          deliveredAt: now,
          manuallyReceivedAt: now,
          logisticsLastCheckedAt: now,
          logisticsLastEventAt: now,
          logisticsLastEventText: "用户手动标记已签收",
          logisticsExceptionType: null,
          logisticsExceptionMessage: null,
        },
      });
      await ensurePendingInspectionsTx(tx, ownerId, orderId);
    });
    return this.getSummary(ownerId, orderId);
  }

  async refresh(ownerId: string, orderId: string) {
    const { order } = await this.getSummary(ownerId, orderId);
    if (!order.carrierCode || !order.trackingNo) {
      throw new ServiceError(
        "TRACKING_REQUIRED",
        "请先填写快递公司和快递单号。",
        422,
      );
    }
    const snapshot = await adapter.queryTracking({
      carrierCode: order.carrierCode,
      trackingNo: order.trackingNo,
    });
    const nextOrderStatus = resolvePurchaseStatus(
      order.status,
      snapshot.status,
    );

    await db.$transaction(async (tx) => {
      await tx.logisticsEvent.create({
        data: {
          ownerId,
          purchaseOrderId: orderId,
          carrierCode: order.carrierCode!,
          trackingNo: order.trackingNo!,
          eventTime: snapshot.eventTime,
          eventText: snapshot.eventText,
          location: snapshot.location ?? null,
          status: snapshot.status,
          rawData: snapshot.rawData,
        },
      });
      await tx.purchaseOrder.update({
        where: { id: orderId },
        data: {
          status: nextOrderStatus,
          logisticsStatus: snapshot.status,
          logisticsLastCheckedAt: new Date(),
          logisticsLastEventAt: snapshot.eventTime,
          logisticsLastEventText: snapshot.eventText,
          logisticsExceptionType: snapshot.exceptionType ?? null,
          logisticsExceptionMessage: snapshot.exceptionMessage ?? null,
          deliveredAt:
            snapshot.status === "DELIVERED"
              ? snapshot.eventTime
              : order.deliveredAt,
        },
      });
      if (nextOrderStatus === "PENDING_INSPECTION") {
        await ensurePendingInspectionsTx(tx, ownerId, orderId);
      }
    });
    return this.getSummary(ownerId, orderId);
  }
}

export const logisticsService = new LogisticsService();
