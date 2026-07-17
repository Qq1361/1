import { DailyBusinessReportDeliveryChannel, DailyBusinessReportDeliveryStatus } from "@/generated/prisma/enums";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { resolveDailyReportPeriod } from "@/server/reports/daily-business-report-period";
import { sendDailyBusinessReportToFeishu } from "./daily-business-report-delivery-service";

export const DAILY_REPORT_DELIVERY_CHANNEL = DailyBusinessReportDeliveryChannel.FEISHU;
export const DAILY_REPORT_SENDING_STALE_MS = 15 * 60 * 1000;
export const DAILY_REPORT_MAX_ATTEMPTS = 3;

const RETRYABLE_ERROR_CODES = new Set([
  "FEISHU_TIMEOUT",
  "FEISHU_NETWORK_ERROR",
  "FEISHU_5XX",
]);

type DeliveryRecord = Awaited<ReturnType<typeof db.dailyBusinessReportDelivery.findUniqueOrThrow>>;

export type DailyBusinessReportDeliveryDto = {
  status: "NOT_SENT" | "PENDING" | "SENDING" | "SENT" | "FAILED";
  attemptCount: number;
  requestedAt: string | null;
  startedAt: string | null;
  sentAt: string | null;
  failedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  retryable: boolean;
  nextAction: "SEND" | "RETRY" | "NONE";
};

type ClaimResult =
  | { kind: "CLAIMED"; delivery: DeliveryRecord }
  | { kind: "ALREADY_SENT"; delivery: DeliveryRecord }
  | { kind: "IN_PROGRESS"; delivery: DeliveryRecord }
  | { kind: "NOT_RETRYABLE"; delivery: DeliveryRecord };

function reportDateToDatabaseDate(reportDate: string) {
  return new Date(`${reportDate}T00:00:00.000Z`);
}

function idempotencyKey(ownerId: string, reportDate: string) {
  return `daily-business-report:${ownerId}:Asia/Shanghai:${reportDate}:FEISHU`;
}

function safeError(error: unknown) {
  if (error instanceof ServiceError) {
    return { code: error.code, message: error.message };
  }
  return { code: "DAILY_REPORT_DELIVERY_FAILED", message: "日报发送失败，请检查配置、数据库或网络后重试。" };
}

export function isDailyBusinessReportDeliveryRetryable(errorCode: string | null | undefined) {
  return Boolean(errorCode && RETRYABLE_ERROR_CODES.has(errorCode));
}

function canRetryDelivery(delivery: DeliveryRecord) {
  return delivery.status === DailyBusinessReportDeliveryStatus.FAILED
    && delivery.attemptCount < DAILY_REPORT_MAX_ATTEMPTS
    && isDailyBusinessReportDeliveryRetryable(delivery.lastErrorCode);
}

function toDto(delivery: DeliveryRecord | null): DailyBusinessReportDeliveryDto {
  if (!delivery) {
    return {
      status: "NOT_SENT",
      attemptCount: 0,
      requestedAt: null,
      startedAt: null,
      sentAt: null,
      failedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
      retryable: false,
      nextAction: "SEND",
    };
  }
  const retryable = canRetryDelivery(delivery);
  return {
    status: delivery.status,
    attemptCount: delivery.attemptCount,
    requestedAt: delivery.requestedAt.toISOString(),
    startedAt: delivery.startedAt?.toISOString() ?? null,
    sentAt: delivery.sentAt?.toISOString() ?? null,
    failedAt: delivery.failedAt?.toISOString() ?? null,
    lastErrorCode: delivery.lastErrorCode,
    lastErrorMessage: delivery.lastErrorMessage,
    retryable,
    nextAction: delivery.status === DailyBusinessReportDeliveryStatus.FAILED
      ? retryable ? "RETRY" : "NONE"
      : delivery.status === DailyBusinessReportDeliveryStatus.SENT || delivery.status === DailyBusinessReportDeliveryStatus.SENDING
        ? "NONE"
        : "SEND",
  };
}

async function assertOwnerExists(ownerId: string) {
  const owner = await db.user.findUnique({ where: { id: ownerId }, select: { id: true } });
  if (!owner) throw new ServiceError("DAILY_REPORT_OWNER_NOT_FOUND", "日报发送所属用户不存在。", 404);
}

async function claimDelivery(input: { ownerId: string; reportDate: string; requestedAt: Date }): Promise<ClaimResult> {
  const reportDate = reportDateToDatabaseDate(input.reportDate);
  const staleBefore = new Date(input.requestedAt.getTime() - DAILY_REPORT_SENDING_STALE_MS);
  const key = idempotencyKey(input.ownerId, input.reportDate);

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      const result = await db.$transaction(async (tx) => {
        const owner = await tx.user.findUnique({ where: { id: input.ownerId }, select: { id: true } });
        if (!owner) throw new ServiceError("DAILY_REPORT_OWNER_NOT_FOUND", "日报发送所属用户不存在。", 404);
        const current = await tx.dailyBusinessReportDelivery.findUnique({
          where: { ownerId_reportDate_channel: { ownerId: input.ownerId, reportDate, channel: DAILY_REPORT_DELIVERY_CHANNEL } },
        });
        if (!current) {
          return {
            kind: "CLAIMED" as const,
            delivery: await tx.dailyBusinessReportDelivery.create({
              data: {
                ownerId: input.ownerId,
                reportDate,
                timezone: "Asia/Shanghai",
                channel: DAILY_REPORT_DELIVERY_CHANNEL,
                status: DailyBusinessReportDeliveryStatus.SENDING,
                idempotencyKey: key,
                attemptCount: 1,
                requestedAt: input.requestedAt,
                startedAt: input.requestedAt,
              },
            }),
          };
        }
        if (current.status === DailyBusinessReportDeliveryStatus.SENT) return { kind: "ALREADY_SENT" as const, delivery: current };
        if (current.status === DailyBusinessReportDeliveryStatus.SENDING && current.startedAt && current.startedAt > staleBefore) {
          return { kind: "IN_PROGRESS" as const, delivery: current };
        }
        if (current.status === DailyBusinessReportDeliveryStatus.FAILED && !canRetryDelivery(current)) {
          return { kind: "NOT_RETRYABLE" as const, delivery: current };
        }
        const claimed = await tx.dailyBusinessReportDelivery.updateMany({
          where: {
            id: current.id,
            status: current.status,
            attemptCount: current.attemptCount,
            ...(current.status === DailyBusinessReportDeliveryStatus.SENDING ? { startedAt: current.startedAt } : {}),
          },
          data: {
            status: DailyBusinessReportDeliveryStatus.SENDING,
            attemptCount: { increment: 1 },
            requestedAt: input.requestedAt,
            startedAt: input.requestedAt,
            sentAt: null,
            failedAt: null,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
        if (claimed.count !== 1) return { kind: "IN_PROGRESS" as const, delivery: current };
        const delivery = await tx.dailyBusinessReportDelivery.findUniqueOrThrow({ where: { id: current.id } });
        return { kind: "CLAIMED" as const, delivery };
      });
      return result;
    } catch (error) {
      if (!(error instanceof Error) || !("code" in error) || (error as { code?: string }).code !== "P2002") throw error;
    }
  }
  throw new ServiceError("DELIVERY_IN_PROGRESS", "日报发送正在由另一个任务处理。", 409);
}

async function completeDelivery(delivery: DeliveryRecord, now: Date) {
  const updated = await db.dailyBusinessReportDelivery.updateMany({
    where: { id: delivery.id, status: DailyBusinessReportDeliveryStatus.SENDING, attemptCount: delivery.attemptCount, startedAt: delivery.startedAt },
    data: { status: DailyBusinessReportDeliveryStatus.SENT, sentAt: now, failedAt: null, lastErrorCode: null, lastErrorMessage: null },
  });
  if (updated.count !== 1) throw new ServiceError("DELIVERY_STATE_LOST", "日报已发送，但本地发送状态无法确认，请检查发送记录。", 409);
  return db.dailyBusinessReportDelivery.findUniqueOrThrow({ where: { id: delivery.id } });
}

async function failDelivery(delivery: DeliveryRecord, error: unknown, now: Date) {
  const safe = safeError(error);
  await db.dailyBusinessReportDelivery.updateMany({
    where: { id: delivery.id, status: DailyBusinessReportDeliveryStatus.SENDING, attemptCount: delivery.attemptCount, startedAt: delivery.startedAt },
    data: { status: DailyBusinessReportDeliveryStatus.FAILED, failedAt: now, lastErrorCode: safe.code, lastErrorMessage: safe.message },
  });
}

export async function getDailyBusinessReportDeliveryStatus(input: { ownerId: string; date?: string; timezone?: string; requestedAt: Date }) {
  const period = resolveDailyReportPeriod({ date: input.date, timezone: input.timezone, generatedAt: input.requestedAt });
  await assertOwnerExists(input.ownerId);
  const delivery = await db.dailyBusinessReportDelivery.findUnique({
    where: { ownerId_reportDate_channel: { ownerId: input.ownerId, reportDate: reportDateToDatabaseDate(period.reportDate), channel: DAILY_REPORT_DELIVERY_CHANNEL } },
  });
  return { reportDate: period.reportDate, timezone: period.timezone, delivery: toDto(delivery) };
}

export async function deliverDailyBusinessReport(input: { ownerId: string; date?: string; timezone?: string; requestedAt: Date }) {
  const period = resolveDailyReportPeriod({ date: input.date, timezone: input.timezone, generatedAt: input.requestedAt });
  const claimed = await claimDelivery({ ownerId: input.ownerId, reportDate: period.reportDate, requestedAt: input.requestedAt });
  if (claimed.kind !== "CLAIMED") {
    return { outcome: claimed.kind, reportDate: period.reportDate, delivery: toDto(claimed.delivery) };
  }
  try {
    const sent = await sendDailyBusinessReportToFeishu({ ownerId: input.ownerId, date: period.reportDate, timezone: period.timezone, requestedAt: input.requestedAt });
    const delivery = await completeDelivery(claimed.delivery, new Date());
    return { outcome: "SENT" as const, reportDate: period.reportDate, delivery: toDto(delivery), sent };
  } catch (error) {
    await failDelivery(claimed.delivery, error, new Date());
    throw error;
  }
}
