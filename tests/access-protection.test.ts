import { describe, expect, it } from "vitest";
import {
  constantTimeEqual,
  createAccessToken,
} from "../src/lib/access-protection";

describe("access protection", () => {
  it("creates stable tokens without exposing the password", async () => {
    const token = await createAccessToken("test-password");

    expect(token).toHaveLength(64);
    expect(token).toBe(await createAccessToken("test-password"));
    expect(token).not.toContain("test-password");
  });

  it("compares tokens correctly", () => {
    expect(constantTimeEqual("abc", "abc")).toBe(true);
    expect(constantTimeEqual("abc", "abd")).toBe(false);
    expect(constantTimeEqual("abc", "ab")).toBe(false);
  });
});
