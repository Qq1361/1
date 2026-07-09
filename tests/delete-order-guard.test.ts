import { describe, expect, it } from "vitest";
import { canDeleteOrder } from "../src/server/services/purchase-order-service";

describe("delete order guard", () => {
  it("allows only orders that have not entered later flow", () => {
    expect(
      canDeleteOrder({
        status: "PAID",
        shippedAt: null,
        deliveredAt: null,
      }),
    ).toBe(true);
    expect(
      canDeleteOrder({
        status: "IN_TRANSIT",
        shippedAt: new Date(),
        deliveredAt: null,
      }),
    ).toBe(false);
  });
});
