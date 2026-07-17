import { describe, expect, it } from "vitest";
import { normalizeSku } from "../src/lib/normalize-sku";

describe("normalizeSku", () => {
  it("normalizes empty, whitespace, and letter case without altering internal characters", () => {
    expect(normalizeSku(null)).toBeNull();
    expect(normalizeSku(undefined)).toBeNull();
    expect(normalizeSku(" ")).toBeNull();
    expect(normalizeSku(" 2c0 ")).toBe("2C0");
    expect(normalizeSku("1w1")).toBe("1W1");
    expect(normalizeSku(" AB-12 / C ")).toBe("AB-12 / C");
  });
});
