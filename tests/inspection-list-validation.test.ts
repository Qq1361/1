import { describe, expect, it } from "vitest";
import { inspectionListSchema } from "../src/server/validation/inspection";

describe("inspection list validation", () => {
  it("trims valid keywords and applies safe pagination defaults", () => {
    expect(inspectionListSchema.parse({ query: "  seller  " })).toEqual({
      query: "seller",
      page: 1,
      pageSize: 20,
    });
  });

  it("rejects overly long keywords and control characters", () => {
    expect(() => inspectionListSchema.parse({ query: "a".repeat(101) })).toThrow();
    expect(() => inspectionListSchema.parse({ query: "seller\nname" })).toThrow();
  });

  it("rejects invalid pagination values", () => {
    expect(() => inspectionListSchema.parse({ page: "0" })).toThrow();
    expect(() => inspectionListSchema.parse({ pageSize: "51" })).toThrow();
  });
});
