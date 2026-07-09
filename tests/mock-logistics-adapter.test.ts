import { describe, expect, it } from "vitest";
import { MockLogisticsAdapter } from "../src/server/adapters/logistics/mock-logistics-adapter";

describe("MockLogisticsAdapter", () => {
  const adapter = new MockLogisticsAdapter();

  it.each([
    ["ABCDELIVERED", "DELIVERED"],
    ["ABC1", "DELIVERED"],
    ["ABCEXCEPTION", "EXCEPTION"],
    ["ABC2", "EXCEPTION"],
    ["ABCSTALLED", "STALLED"],
    ["ABC3", "STALLED"],
    ["ABC0", "IN_TRANSIT"],
  ])("maps %s to %s", async (trackingNo, expected) => {
    const result = await adapter.queryTracking({
      carrierCode: "MOCK",
      trackingNo,
    });
    expect(result.status).toBe(expected);
  });

  it("uses keyword precedence before suffix rules", async () => {
    const result = await adapter.queryTracking({
      carrierCode: "MOCK",
      trackingNo: "DELIVERED2",
    });
    expect(result.status).toBe("DELIVERED");
  });
});
