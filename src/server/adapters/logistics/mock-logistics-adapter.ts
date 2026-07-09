import type {
  LogisticsAdapter,
  LogisticsSnapshot,
} from "./logistics-adapter";

export class MockLogisticsAdapter implements LogisticsAdapter {
  async query(): Promise<LogisticsSnapshot> {
    return {
      state: "IN_TRANSIT",
      message: "Mock logistics: package is in transit.",
      occurredAt: new Date(),
    };
  }
}
