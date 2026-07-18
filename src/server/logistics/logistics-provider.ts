import type { LogisticsProviderQueryInput, LogisticsProviderResult } from "./logistics-types";

export interface LogisticsProviderAdapter {
  readonly code: string;
  isConfigured?(): boolean;
  supportsCarrier?(carrierCode: string): boolean;
  queryTracking(input: LogisticsProviderQueryInput): Promise<LogisticsProviderResult>;
}
