import { describe, expect, it } from "vitest";
import { calculateTodos } from "../src/server/services/todo-service";

const now = new Date("2026-07-09T12:00:00.000Z");
const base = {
  id: "order-1",
  orderNo: "XY-1",
  paidAt: new Date("2026-07-06T12:00:00.000Z"),
  trackingNo: null,
  status: "PAID" as const,
  logisticsStatus: "NOT_SHIPPED" as const,
  logisticsLastEventAt: null,
  logisticsExceptionMessage: null,
};

describe("calculateTodos", () => {
  it("adds missing tracking after 48 hours", () => {
    expect(calculateTodos([base], [], now).map((todo) => todo.type)).toEqual([
      "MISSING_TRACKING",
    ]);
  });

  it("excludes recent, tracked and cancelled orders", () => {
    expect(
      calculateTodos(
        [
          { ...base, paidAt: new Date("2026-07-08T13:00:00.000Z") },
          { ...base, id: "tracked", trackingNo: "ABC" },
          { ...base, id: "cancelled", status: "CANCELLED" },
        ],
        [],
        now,
      ),
    ).toEqual([]);
  });

  it.each([
    ["EXCEPTION", "LOGISTICS_EXCEPTION"],
    ["STALLED", "LOGISTICS_STALLED"],
  ] as const)("maps %s to %s", (logisticsStatus, expected) => {
    const todos = calculateTodos(
      [{ ...base, trackingNo: "ABC", logisticsStatus }],
      [],
      now,
    );
    expect(todos[0].type).toBe(expected);
  });

  it("adds pending inspection todo from inspection data", () => {
    const todos = calculateTodos(
      [],
      [
        {
          id: "insp-1",
          sequence: 1,
          purchaseOrderItem: {
            name: "测试商品",
            skuText: null,
            quantity: 2,
            purchaseOrder: { id: "order-1", orderNo: "XY-1" },
          },
        },
      ],
      now,
    );
    expect(todos[0].type).toBe("PENDING_INSPECTION");
    expect(todos[0].primaryAction.label).toBe("开始验货");
    expect(todos[0].primaryAction.href).toBe("/inspections/insp-1");
    expect(todos[0].secondaryActions?.[0].label).toBe("查看订单");
    expect(todos[0].secondaryActions?.[0].href).toBe("/purchases/order-1");
  });
});
