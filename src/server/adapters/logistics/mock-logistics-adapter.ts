import type {
  LogisticsAdapter,
  LogisticsSnapshot,
} from "./logistics-adapter";

export class MockLogisticsAdapter implements LogisticsAdapter {
  async queryTracking(input: {
    carrierCode: string;
    trackingNo: string;
  }): Promise<LogisticsSnapshot> {
    const normalized = input.trackingNo.toUpperCase();
    const eventTime = new Date();
    const base = {
      eventTime,
      location: "Mock 中转中心",
      rawData: {
        provider: "mock",
        carrierCode: input.carrierCode,
        trackingNo: input.trackingNo,
      },
    };

    if (normalized.includes("DELIVERED") || normalized.endsWith("1")) {
      return {
        ...base,
        status: "DELIVERED",
        eventText: "快件已签收。",
        location: "收货地址",
      };
    }
    if (normalized.includes("EXCEPTION") || normalized.endsWith("2")) {
      return {
        ...base,
        status: "EXCEPTION",
        eventText: "运输过程中出现异常，请关注后续处理。",
        exceptionType: "TRANSPORT_EXCEPTION",
        exceptionMessage: "Mock 物流异常",
      };
    }
    if (normalized.includes("STALLED") || normalized.endsWith("3")) {
      return {
        ...base,
        status: "STALLED",
        eventText: "物流轨迹长时间未更新。",
        exceptionType: "STALLED",
        exceptionMessage: "Mock 物流停滞",
      };
    }
    return {
      ...base,
      status: "IN_TRANSIT",
      eventText: "快件正在运输途中。",
    };
  }
}
