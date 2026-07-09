export type LogisticsState =
  | "UNKNOWN"
  | "IN_TRANSIT"
  | "EXCEPTION"
  | "DELIVERED";

export type LogisticsSnapshot = {
  state: LogisticsState;
  message: string;
  occurredAt: Date;
};

export interface LogisticsAdapter {
  query(input: {
    carrierCode: string;
    trackingNo: string;
  }): Promise<LogisticsSnapshot>;
}
