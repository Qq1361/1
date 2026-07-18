import type { LogisticsTrackingStatus } from "@/generated/prisma/client";

export type LogisticsProviderQueryInput = {
  carrierCode: string;
  trackingNumber: string;
};

export type LogisticsProviderEvent = {
  providerEventId?: string | null;
  eventTime: Date;
  status: LogisticsTrackingStatus;
  location?: string | null;
  description: string;
  rawStatusCode?: string | null;
};

export type LogisticsProviderResult = {
  provider: string;
  carrierCode: string;
  trackingNumber: string;
  currentStatus: LogisticsTrackingStatus;
  rawStatusCode?: string | null;
  events: LogisticsProviderEvent[];
  queriedAt: Date;
  providerRequestId?: string | null;
  suggestedNextSyncAt?: Date | null;
};

export type NormalizedLogisticsEvent = LogisticsProviderEvent & {
  providerEventId: string | null;
  location: string | null;
  rawStatusCode: string | null;
  dedupeKey: string;
};

export type NormalizedLogisticsProviderResult = Omit<LogisticsProviderResult, "events" | "rawStatusCode" | "providerRequestId" | "suggestedNextSyncAt"> & {
  rawStatusCode: string | null;
  providerRequestId: string | null;
  suggestedNextSyncAt: Date | null;
  events: NormalizedLogisticsEvent[];
};

export class LogisticsProviderError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}
