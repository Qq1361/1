import { describe, expect, it } from "vitest";
import { calculateAllocationSummary } from "../src/server/services/cost-allocation-service";

describe("cost allocation", () => {
  it("uses paid total including shipping", () => {
    const result = calculateAllocationSummary("100.10", "5.20", [
      { itemId: "one", allocatedTotalCost: "60.00" },
      { itemId: "two", allocatedTotalCost: "45.30" },
    ]);

    expect(result.paidTotal).toBe("105.30");
    expect(result.difference).toBe("0.00");
    expect(result.isBalanced).toBe(true);
  });

  it("does not confirm partial or unbalanced allocations", () => {
    expect(
      calculateAllocationSummary("100.00", "0.01", [
        { itemId: "one", allocatedTotalCost: "100.00" },
      ]).isBalanced,
    ).toBe(false);
    expect(
      calculateAllocationSummary("100.00", "0.00", [
        { itemId: "one", allocatedTotalCost: null },
      ]).isBalanced,
    ).toBe(false);
  });
});
