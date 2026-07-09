import type { LogisticsStatus } from "@/generated/prisma/enums";

export type LogisticsSnapshot = {
  status: LogisticsStatus;
  eventTime: Date;
  eventText: string;
  location?: string;
  exceptionType?: string;
  exceptionMessage?: string;
  rawData?: Record<string, string>;
};

export interface LogisticsAdapter {
  queryTracking(input: {
    carrierCode: string;
    trackingNo: string;
  }): Promise<LogisticsSnapshot>;
}
