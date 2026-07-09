import { describe, expect, it } from "vitest";
import { calculateInventoryTodos } from "../src/server/services/todo-service";

const now = new Date("2026-07-09T12:00:00.000Z");
const base = {
  id: "inv-1",
  inventoryCode: "INV-1",
  name: "测试商品",
  skuText: null as string | null,
  expiryDate: null as Date | null,
  stockedAt: new Date("2026-07-09T11:00:00.000Z"),
  itemStatus: "STOCKED",
  saleMode: "NONE",
  storageLocation: null as string | null,
  purchaseOrderItem: {
    purchaseOrder: { id: "order-1", orderNo: "XY-1" },
  },
};

function expiryTypes(items: typeof base[], nowOverride?: Date) {
  return calculateInventoryTodos(items, nowOverride ?? now)
    .map((t) => t.type)
    .filter((t) => t !== "OVERSTOCKED");
}

// Helper: date offset from now
function d(offsetDays: number) {
  return new Date(now.getTime() + offsetDays * 86_400_000);
}

describe("calculateInventoryTodos — definitive rules", () => {
  // === Standard rules (saleMode != NINETY_FIVE) ===

  it(">402 days: no reminder", () => {
    expect(expiryTypes([{ ...base, expiryDate: d(405) }])).toEqual([]);
  });

  it("400 days (396-402): DISTANCE_TO_395_WITHIN_7_DAYS", () => {
    expect(expiryTypes([{ ...base, expiryDate: d(400) }])).toEqual([
      "DISTANCE_TO_395_WITHIN_7_DAYS",
    ]);
  });

  it("390 days (366-395): EXPIRY_UNDER_395", () => {
    expect(expiryTypes([{ ...base, expiryDate: d(390) }])).toEqual([
      "EXPIRY_UNDER_395",
    ]);
  });

  it("293 days (<=365): EXPIRY_UNDER_365", () => {
    expect(expiryTypes([{ ...base, expiryDate: d(293) }])).toEqual([
      "EXPIRY_UNDER_365",
    ]);
  });

  // === DEWU_LIGHTNING / DEWU_STANDARD ===
  it("DEWU_LIGHTNING 400 days: DISTANCE_TO_395_WITHIN_7_DAYS", () => {
    expect(expiryTypes([{ ...base, saleMode: "DEWU_LIGHTNING", expiryDate: d(400) }])).toEqual([
      "DISTANCE_TO_395_WITHIN_7_DAYS",
    ]);
  });

  it("DEWU_STANDARD 390 days: EXPIRY_UNDER_395", () => {
    expect(expiryTypes([{ ...base, saleMode: "DEWU_STANDARD", expiryDate: d(390) }])).toEqual([
      "EXPIRY_UNDER_395",
    ]);
  });

  // === Single highest priority ===
  it("<=365 days: only EXPIRY_UNDER_365, not 395", () => {
    const types = expiryTypes([{ ...base, expiryDate: d(293) }]);
    expect(types).toEqual(["EXPIRY_UNDER_365"]);
    expect(types).not.toContain("EXPIRY_UNDER_395");
    expect(types).not.toContain("DISTANCE_TO_395_WITHIN_7_DAYS");
  });

  // === NINETY_FIVE rules ===
  it("NINETY_FIVE 400 days: no 395 reminder", () => {
    expect(expiryTypes([{ ...base, saleMode: "NINETY_FIVE", expiryDate: d(400) }])).toEqual([]);
  });

  it("NINETY_FIVE 85 days: NINETY_FIVE_EXPIRY_UNDER_90", () => {
    expect(expiryTypes([{ ...base, saleMode: "NINETY_FIVE", expiryDate: d(85) }])).toEqual([
      "NINETY_FIVE_EXPIRY_UNDER_90",
    ]);
  });

  it("NINETY_FIVE 58 days: only NINETY_FIVE_EXPIRY_UNDER_60", () => {
    const types = expiryTypes([{ ...base, saleMode: "NINETY_FIVE", expiryDate: d(58) }]);
    expect(types).toEqual(["NINETY_FIVE_EXPIRY_UNDER_60"]);
    expect(types).not.toContain("NINETY_FIVE_EXPIRY_UNDER_90");
    expect(types).not.toContain("EXPIRY_UNDER_395");
    expect(types).not.toContain("EXPIRY_UNDER_365");
  });

  // === Overstock ===
  it("adds overstock after 72 hours", () => {
    const todos = calculateInventoryTodos([
      { ...base, stockedAt: new Date("2026-07-06T12:00:00.000Z") },
    ], now);
    expect(todos.map((t) => t.type)).toContain("OVERSTOCKED");
  });

  it("skips problem items", () => {
    expect(calculateInventoryTodos([
      { ...base, itemStatus: "PROBLEM", expiryDate: d(100), stockedAt: new Date("2026-07-01T12:00:00.000Z") },
    ], now)).toEqual([]);
  });
});
