import { describe, expect, it } from "vitest";
import { calculateInventoryTodos } from "../src/server/services/todo-service";

const now = new Date("2026-07-09T12:00:00.000Z");
const base = {
  id: "inventory-1",
  inventoryCode: "INV-1",
  expiryDate: null,
  stockedAt: new Date("2026-07-09T11:00:00.000Z"),
  itemStatus: "STOCKED",
  purchaseOrderItem: {
    purchaseOrder: { id: "order-1", orderNo: "XY-1" },
  },
};

describe("calculateInventoryTodos", () => {
  it("separates 366-394 days and no more than 365 days", () => {
    const warning = calculateInventoryTodos(
      [{ ...base, expiryDate: new Date("2027-07-20T12:00:00.000Z") }],
      now,
    );
    const critical = calculateInventoryTodos(
      [{ ...base, expiryDate: new Date("2027-07-09T12:00:00.000Z") }],
      now,
    );
    expect(warning.map((todo) => todo.type)).toEqual(["EXPIRY_BELOW_395"]);
    expect(critical.map((todo) => todo.type)).toEqual(["EXPIRY_BELOW_365"]);
  });

  it("adds the overstock reminder at 72 hours", () => {
    const todos = calculateInventoryTodos(
      [{ ...base, stockedAt: new Date("2026-07-06T12:00:00.000Z") }],
      now,
    );
    expect(todos.map((todo) => todo.type)).toContain("OVERSTOCKED");
  });

  it("does not remind for problem inventory", () => {
    const todos = calculateInventoryTodos(
      [
        {
          ...base,
          itemStatus: "PROBLEM",
          expiryDate: new Date("2026-08-01T12:00:00.000Z"),
          stockedAt: new Date("2026-07-01T12:00:00.000Z"),
        },
      ],
      now,
    );
    expect(todos).toEqual([]);
  });
});
