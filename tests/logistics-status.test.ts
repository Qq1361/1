import { describe, expect, it } from "vitest";
import { resolvePurchaseStatus } from "../src/server/services/logistics-service";

describe("resolvePurchaseStatus", () => {
  it("moves delivered orders to pending inspection", () => {
    expect(resolvePurchaseStatus("IN_TRANSIT", "DELIVERED")).toBe(
      "PENDING_INSPECTION",
    );
  });

  it("does not move pending inspection back for the same tracking number", () => {
    expect(resolvePurchaseStatus("PENDING_INSPECTION", "IN_TRANSIT")).toBe(
      "PENDING_INSPECTION",
    );
    expect(resolvePurchaseStatus("PENDING_INSPECTION", "EXCEPTION")).toBe(
      "PENDING_INSPECTION",
    );
  });
});
