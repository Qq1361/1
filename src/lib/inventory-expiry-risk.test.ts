import { describe, expect, it } from "vitest";
import {
  classifyInventoryExpiryRisk,
  getShanghaiBusinessDate,
  summarizeInventoryExpiryRisk,
} from "./inventory-expiry-risk";

const asOf = new Date("2026-07-21T12:00:00.000Z");
const day = (offset: number) => new Date(Date.UTC(2026, 6, 21 + offset));

describe("inventory expiry risk rules", () => {
  it("keeps four risk ranges mutually exclusive at every boundary", () => {
    expect(classifyInventoryExpiryRisk(day(-1), asOf)).toBe("EXPIRED");
    expect(classifyInventoryExpiryRisk(day(0), asOf)).toBe("WITHIN_30_DAYS");
    expect(classifyInventoryExpiryRisk(day(30), asOf)).toBe("WITHIN_30_DAYS");
    expect(classifyInventoryExpiryRisk(day(31), asOf)).toBe("WITHIN_90_DAYS");
    expect(classifyInventoryExpiryRisk(day(90), asOf)).toBe("WITHIN_90_DAYS");
    expect(classifyInventoryExpiryRisk(day(91), asOf)).toBe("WITHIN_180_DAYS");
    expect(classifyInventoryExpiryRisk(day(180), asOf)).toBe("WITHIN_180_DAYS");
    expect(classifyInventoryExpiryRisk(day(181), asOf)).toBeNull();
    expect(classifyInventoryExpiryRisk(null, asOf)).toBeNull();
  });

  it("uses Shanghai date-only boundaries regardless of the instant timezone", () => {
    const utcBoundary = new Date("2026-07-20T16:30:00.000Z");
    const shanghaiBoundary = new Date("2026-07-21T00:30:00+08:00");
    expect(getShanghaiBusinessDate(utcBoundary).toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(getShanghaiBusinessDate(shanghaiBoundary).toISOString()).toBe("2026-07-21T00:00:00.000Z");
    expect(classifyInventoryExpiryRisk(day(0), utcBoundary)).toBe("WITHIN_30_DAYS");
  });

  it("excludes sold and non-owned history while grouping owned inventory once", () => {
    const groups = summarizeInventoryExpiryRisk([
      { id: "a", expiryDate: day(20), itemStatus: "STOCKED", ownershipStatus: "OWNED" },
      { id: "b", expiryDate: day(60), itemStatus: "PLATFORM_LISTED", ownershipStatus: "OWNED" },
      { id: "c", expiryDate: day(120), itemStatus: "RETURNING", ownershipStatus: "OWNED" },
      { id: "sold", expiryDate: day(20), itemStatus: "SOLD", ownershipStatus: "OWNED" },
      { id: "returned", expiryDate: day(20), itemStatus: "STOCKED", ownershipStatus: "RETURNED_TO_UPSTREAM_SELLER" },
    ], asOf);
    expect(groups.WITHIN_30_DAYS.map((item) => item.id)).toEqual(["a"]);
    expect(groups.WITHIN_90_DAYS.map((item) => item.id)).toEqual(["b"]);
    expect(groups.WITHIN_180_DAYS.map((item) => item.id)).toEqual(["c"]);
  });
});
