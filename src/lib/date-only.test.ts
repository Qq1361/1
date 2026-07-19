import { describe, expect, it } from "vitest";
import { addCalendarMonthsClamped, formatDateOnly, parseDateOnly } from "./date-only";

describe("date-only shelf-life rules", () => {
  it("accepts valid YYYY-MM-DD values without timezone conversion", () => {
    expect(formatDateOnly(parseDateOnly("2026-07-19"))).toBe("2026-07-19");
  });

  it("rejects impossible or timestamp date inputs", () => {
    expect(() => parseDateOnly("2026-02-30")).toThrow();
    expect(() => parseDateOnly("2026-07-19T00:00:00Z")).toThrow();
  });

  it("clamps calendar month calculations at month end", () => {
    expect(formatDateOnly(addCalendarMonthsClamped(parseDateOnly("2025-01-31"), 1))).toBe("2025-02-28");
    expect(formatDateOnly(addCalendarMonthsClamped(parseDateOnly("2024-01-31"), 1))).toBe("2024-02-29");
    expect(formatDateOnly(addCalendarMonthsClamped(parseDateOnly("2024-02-29"), 12))).toBe("2025-02-28");
  });
});
