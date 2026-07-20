import { describe, expect, it } from "vitest";
import {
  calculateAllocationSummary,
  calculateEqualPurchaseCostAllocation,
} from "../src/server/services/cost-allocation-service";

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

  it("allocates equal unit costs by total quantity rather than item rows", () => {
    const result = calculateEqualPurchaseCostAllocation("100.00", "0.00", [
      { id: "item-a", quantity: 2, createdAt: new Date("2026-07-01T00:00:00.000Z") },
      { id: "item-b", quantity: 1, createdAt: new Date("2026-07-02T00:00:00.000Z") },
    ]);

    expect(result.totalQuantity).toBe(3);
    expect(result.perUnitAverage).toBe("33.33");
    expect(result.allocations).toEqual([
      { itemId: "item-a", quantity: 2, allocatedTotalCost: "66.67" },
      { itemId: "item-b", quantity: 1, allocatedTotalCost: "33.33" },
    ]);
    expect(
      calculateAllocationSummary("100.00", "0.00", result.allocations).isBalanced,
    ).toBe(true);
  });

  it("assigns fractional cents in a stable created-at then id order", () => {
    const items = [
      { id: "later", quantity: 1, createdAt: new Date("2026-07-02T00:00:00.000Z") },
      { id: "a-first", quantity: 1, createdAt: new Date("2026-07-01T00:00:00.000Z") },
      { id: "b-first", quantity: 1, createdAt: new Date("2026-07-01T00:00:00.000Z") },
    ];

    const first = calculateEqualPurchaseCostAllocation("0.01", "0.00", items);
    const second = calculateEqualPurchaseCostAllocation("0.01", "0.00", items);

    expect(first).toEqual(second);
    expect(first.allocations).toEqual([
      { itemId: "a-first", quantity: 1, allocatedTotalCost: "0.01" },
      { itemId: "b-first", quantity: 1, allocatedTotalCost: "0.00" },
      { itemId: "later", quantity: 1, allocatedTotalCost: "0.00" },
    ]);
  });
});
