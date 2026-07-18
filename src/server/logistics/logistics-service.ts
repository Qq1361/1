import { Prisma, type LogisticsBusinessType } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import {
  logisticsConflictError,
  logisticsNotFoundError,
  logisticsProviderServiceError,
  logisticsValidationError,
} from "./logistics-errors";
import type { LogisticsProviderRegistry } from "./logistics-provider-registry";
import { logisticsProviderRegistry } from "./logistics-provider-registry";
import {
  firstDeliveredEventTime,
  newestEventTime,
  nextSyncAtForStatus,
  normalizeBusinessId,
  normalizeCarrierCode,
  normalizeOptionalText,
  normalizeProviderCode,
  normalizeProviderResult,
  normalizeTrackingNumber,
} from "./logistics-rules";
import { LogisticsProviderError } from "./logistics-types";

const BUSINESS_TYPES = new Set<LogisticsBusinessType>([
  "PURCHASE_INBOUND",
  "PLATFORM_OUTBOUND",
  "PLATFORM_RETURN",
  "PURCHASE_AFTER_SALE_RETURN",
  "SALE_AFTER_SALE_RETURN",
]);

type RegisterShipmentInput = {
  businessType: LogisticsBusinessType | string;
  businessId: string;
  provider: string;
  carrierCode: string;
  carrierName?: string | null;
  trackingNumber: string;
};

function parseBusinessType(value: unknown): LogisticsBusinessType {
  if (typeof value !== "string" || !BUSINESS_TYPES.has(value as LogisticsBusinessType)) {
    throw logisticsValidationError("LOGISTICS_INVALID_BUSINESS_TYPE", "物流业务类型无效。");
  }
  return value as LogisticsBusinessType;
}

async function assertOwnedBusinessObject(
  tx: Prisma.TransactionClient,
  ownerId: string,
  businessType: LogisticsBusinessType,
  businessId: string,
) {
  const ownerExists = await tx.user.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!ownerExists) throw logisticsNotFoundError("LOGISTICS_BUSINESS_OBJECT_NOT_FOUND");

  let object: { id: string } | null = null;
  switch (businessType) {
    case "PURCHASE_INBOUND":
      object = await tx.purchaseOrder.findFirst({ where: { id: businessId, ownerId }, select: { id: true } });
      break;
    case "PLATFORM_OUTBOUND":
      object = await tx.platformShipmentBatch.findFirst({ where: { id: businessId, ownerId }, select: { id: true } });
      break;
    case "PLATFORM_RETURN":
      object = await tx.platformShipmentLine.findFirst({ where: { id: businessId, ownerId }, select: { id: true } });
      break;
    case "PURCHASE_AFTER_SALE_RETURN":
      object = await tx.purchaseAfterSaleCase.findFirst({ where: { id: businessId, ownerId }, select: { id: true } });
      break;
    case "SALE_AFTER_SALE_RETURN":
      object = await tx.saleAfterSaleCase.findFirst({ where: { id: businessId, ownerId }, select: { id: true } });
      break;
  }
  if (!object) throw logisticsNotFoundError("LOGISTICS_BUSINESS_OBJECT_NOT_FOUND");
  return object;
}

function providerFailure(error: unknown) {
  if (error instanceof LogisticsProviderError) {
    return { code: error.code || "LOGISTICS_PROVIDER_QUERY_FAILED", retryable: error.retryable };
  }
  if (error instanceof ServiceError) {
    return { code: "LOGISTICS_PROVIDER_INVALID_RESPONSE", retryable: false };
  }
  return { code: "LOGISTICS_PROVIDER_QUERY_FAILED", retryable: true };
}

function providerFailureMessage(code: string) {
  const messages: Record<string, string> = {
    LOGISTICS_PROVIDER_AUTH_FAILED: "真实物流 Provider 认证失败，请检查服务端配置。",
    LOGISTICS_PROVIDER_RATE_LIMITED: "真实物流 Provider 查询次数已受限，请稍后重试。",
    LOGISTICS_PROVIDER_TIMEOUT: "真实物流 Provider 查询超时，请稍后重试。",
    LOGISTICS_PROVIDER_NETWORK_ERROR: "暂时无法连接真实物流 Provider，请稍后重试。",
    LOGISTICS_PROVIDER_INVALID_RESPONSE: "真实物流 Provider 返回数据无效。",
    LOGISTICS_PROVIDER_REJECTED: "真实物流 Provider 拒绝了本次查询。",
  };
  return messages[code] ?? "真实物流 Provider 查询失败，请稍后重试。";
}

function sameShipmentBinding(
  shipment: { provider: string; carrierCode: string; normalizedTrackingNumber: string },
  expected: { provider: string; carrierCode: string; normalizedTrackingNumber: string },
) {
  return shipment.provider === expected.provider
    && shipment.carrierCode === expected.carrierCode
    && shipment.normalizedTrackingNumber === expected.normalizedTrackingNumber;
}

export class GenericLogisticsService {
  constructor(
    private readonly registry: LogisticsProviderRegistry = logisticsProviderRegistry,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  async registerShipment(ownerId: string, input: RegisterShipmentInput) {
    const businessType = parseBusinessType(input.businessType);
    const businessId = normalizeBusinessId(input.businessId);
    const providerCode = normalizeProviderCode(input.provider);
    const carrierCode = normalizeCarrierCode(input.carrierCode);
    const carrierName = normalizeOptionalText(input.carrierName, 100);
    const tracking = normalizeTrackingNumber(input.trackingNumber);
    const expectedBinding = {
      provider: providerCode,
      carrierCode,
      normalizedTrackingNumber: tracking.normalizedTrackingNumber,
    };

    try {
      return await db.$transaction(async (tx) => {
        await assertOwnedBusinessObject(tx, ownerId, businessType, businessId);
        const provider = this.registry.get(providerCode);
        if (provider.supportsCarrier && !provider.supportsCarrier(carrierCode)) {
          throw logisticsValidationError("LOGISTICS_INVALID_CARRIER", "当前 Provider 不支持该快递公司。");
        }
        const existing = await tx.logisticsShipment.findUnique({
          where: { ownerId_businessType_businessId: { ownerId, businessType, businessId } },
        });
        if (existing) {
          if (sameShipmentBinding(existing, expectedBinding)) return { ...existing, wasCreated: false };
          throw logisticsConflictError(
            "LOGISTICS_SHIPMENT_BINDING_CONFLICT",
            "该业务对象已绑定其他真实物流单号，不能直接覆盖历史绑定。",
          );
        }
        const shipment = await tx.logisticsShipment.create({
          data: {
            ownerId,
            businessType,
            businessId,
            provider: providerCode,
            carrierCode,
            carrierName,
            trackingNumber: tracking.trackingNumber,
            normalizedTrackingNumber: tracking.normalizedTrackingNumber,
          },
        });
        return { ...shipment, wasCreated: true };
      });
    } catch (error) {
      if (error instanceof ServiceError) throw error;
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        const existing = await db.logisticsShipment.findUnique({
          where: { ownerId_businessType_businessId: { ownerId, businessType, businessId } },
        });
        if (existing && sameShipmentBinding(existing, expectedBinding)) return { ...existing, wasCreated: false };
        throw logisticsConflictError(
          "LOGISTICS_SHIPMENT_BINDING_CONFLICT",
          "该业务对象已绑定其他真实物流单号，不能直接覆盖历史绑定。",
        );
      }
      throw error;
    }
  }

  async getShipmentForBusiness(ownerId: string, businessTypeInput: LogisticsBusinessType | string, businessIdInput: string) {
    const businessType = parseBusinessType(businessTypeInput);
    const businessId = normalizeBusinessId(businessIdInput);
    return db.$transaction(async (tx) => {
      await assertOwnedBusinessObject(tx, ownerId, businessType, businessId);
      const shipment = await tx.logisticsShipment.findUnique({
        where: { ownerId_businessType_businessId: { ownerId, businessType, businessId } },
      });
      if (!shipment) return { shipment: null, events: [] };
      const events = await tx.logisticsTrackingEvent.findMany({
        where: { ownerId, logisticsShipmentId: shipment.id },
        orderBy: [{ eventTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
      });
      return { shipment, events };
    });
  }

  async getShipment(ownerId: string, shipmentId: string) {
    const shipment = await db.logisticsShipment.findFirst({ where: { id: shipmentId, ownerId } });
    if (!shipment) throw logisticsNotFoundError("LOGISTICS_SHIPMENT_NOT_FOUND");
    return shipment;
  }

  async listTrackingEvents(ownerId: string, shipmentId: string) {
    await this.getShipment(ownerId, shipmentId);
    return db.logisticsTrackingEvent.findMany({
      where: { ownerId, logisticsShipmentId: shipmentId },
      orderBy: [{ eventTime: "asc" }, { createdAt: "asc" }, { id: "asc" }],
    });
  }

  async syncShipmentWithProvider(ownerId: string, shipmentId: string) {
    const shipment = await this.getShipment(ownerId, shipmentId);
    const provider = this.registry.get(shipment.provider);
    if (provider.supportsCarrier && !provider.supportsCarrier(shipment.carrierCode)) {
      throw logisticsValidationError("LOGISTICS_INVALID_CARRIER", "当前 Provider 不支持该快递公司。");
    }

    let normalizedResult;
    try {
      const result = await provider.queryTracking({
        carrierCode: shipment.carrierCode,
        trackingNumber: shipment.trackingNumber,
      });
      normalizedResult = normalizeProviderResult(
        shipment.provider,
        shipment.carrierCode,
        shipment.trackingNumber,
        result,
      );
    } catch (error) {
      const failure = providerFailure(error);
      const now = this.clock();
      await db.logisticsShipment.updateMany({
        where: { id: shipmentId, ownerId },
        data: {
          syncStatus: failure.retryable ? "RETRYABLE_ERROR" : "TERMINAL_ERROR",
          failureCount: { increment: 1 },
          lastErrorCode: failure.code,
          nextSyncAt: failure.retryable ? new Date(now.getTime() + 60 * 60 * 1000) : null,
        },
      });
      throw logisticsProviderServiceError(failure.code, providerFailureMessage(failure.code), failure.retryable);
    }

    return db.$transaction(async (tx) => {
      const rows = await tx.$queryRaw<Array<{
        id: string;
        currentStatus: string;
        rawStatusCode: string | null;
        lastEventAt: Date | null;
        deliveredAt: Date | null;
      }>>(Prisma.sql`
        SELECT "id", "currentStatus", "rawStatusCode", "lastEventAt", "deliveredAt"
        FROM "logistics_shipments"
        WHERE "id" = ${shipmentId} AND "ownerId" = ${ownerId}
        FOR UPDATE
      `);
      const locked = rows[0];
      if (!locked) throw logisticsNotFoundError("LOGISTICS_SHIPMENT_NOT_FOUND");

      const createResult = await tx.logisticsTrackingEvent.createMany({
        data: normalizedResult.events.map((event) => ({
          ownerId,
          logisticsShipmentId: shipmentId,
          providerEventId: event.providerEventId,
          dedupeKey: event.dedupeKey,
          eventTime: event.eventTime,
          status: event.status,
          location: event.location,
          description: event.description,
          rawStatusCode: event.rawStatusCode,
        })),
        skipDuplicates: true,
      });

      const resultLastEventAt = newestEventTime(normalizedResult.events);
      const hasOlderResult = Boolean(locked.lastEventAt && resultLastEventAt && resultLastEventAt < locked.lastEventAt);
      const lastEventAt = !locked.lastEventAt || (resultLastEventAt && resultLastEventAt > locked.lastEventAt)
        ? resultLastEventAt
        : locked.lastEventAt;
      const deliveredAt = locked.deliveredAt
        ?? firstDeliveredEventTime(normalizedResult.events)
        ?? (normalizedResult.currentStatus === "DELIVERED" ? normalizedResult.queriedAt : null);
      const currentStatus = hasOlderResult ? locked.currentStatus as typeof normalizedResult.currentStatus : normalizedResult.currentStatus;
      const rawStatusCode = hasOlderResult ? locked.rawStatusCode : normalizedResult.rawStatusCode;
      const nextSyncAt = normalizedResult.suggestedNextSyncAt
        ?? nextSyncAtForStatus(currentStatus, normalizedResult.queriedAt);

      const updated = await tx.logisticsShipment.update({
        where: { id: shipmentId },
        data: {
          currentStatus,
          rawStatusCode,
          lastEventAt,
          lastSyncedAt: normalizedResult.queriedAt,
          nextSyncAt,
          syncStatus: "SYNCED",
          failureCount: 0,
          lastErrorCode: null,
          deliveredAt,
        },
      });
      return { shipment: updated, insertedEventCount: createResult.count };
    });
  }
}

export const genericLogisticsService = new GenericLogisticsService();
