import { describe, expect, it } from "vitest";
import { splitUnitCosts } from "../src/server/services/inspection-service";

describe("splitUnitCosts", () => {
  it("assigns the cent remainder to the last sequence", () => {
    expect(splitUnitCosts("100.00", 3)).toEqual(["33.33", "33.33", "33.34"]);
  });

  it("preserves the exact total", () => {
    const values = splitUnitCosts("85.00", 7);
    expect(values.reduce((sum, value) => sum + Math.round(Number(value) * 100), 0)).toBe(
      8500,
    );
  });
});
