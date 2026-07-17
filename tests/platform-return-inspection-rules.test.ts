import { describe, expect, it } from "vitest";
import {
  canCreateInspection,
  canReviseInspection,
  getInventoryTargetStatus,
  isFinalInspectionResult,
  isIdempotentInspectionRetry,
  normalizePlatformReturnInspectionInput,
  validatePlatformReturnInspectionInput,
} from "../src/server/platform-return-inspection/platform-return-inspection-rules";

describe("platform return inspection rules", () => {
  it("normalizes blank strings and validates each result", () => {
    const restocked = normalizePlatformReturnInspectionInput({ result: "RESTOCKED", storageLocation: "  A-01  ", note: "  " });
    expect(restocked.storageLocation).toBe("A-01");
    expect(restocked.note).toBeNull();
    expect(validatePlatformReturnInspectionInput(restocked)).toEqual({});
    expect(validatePlatformReturnInspectionInput(normalizePlatformReturnInspectionInput({ result: "RESTOCKED" }))).toHaveProperty("storageLocation");
    expect(validatePlatformReturnInspectionInput(normalizePlatformReturnInspectionInput({ result: "PROBLEM", problemReason: "  ", note: " " }))).toHaveProperty("problemReason");
    expect(validatePlatformReturnInspectionInput(normalizePlatformReturnInspectionInput({ result: "PENDING_DECISION" }))).toEqual({});
  });

  it("recognizes pending revisions and terminal results", () => {
    expect(canCreateInspection(null)).toBe(true);
    expect(canCreateInspection({ result: "PENDING_DECISION" })).toBe(false);
    expect(canReviseInspection({ result: "PENDING_DECISION" })).toBe(true);
    expect(canReviseInspection({ result: "RESTOCKED" })).toBe(false);
    expect(isFinalInspectionResult("RESTOCKED")).toBe(true);
    expect(isFinalInspectionResult("PROBLEM")).toBe(true);
    expect(isFinalInspectionResult("PENDING_DECISION")).toBe(false);
    expect(getInventoryTargetStatus("PENDING_DECISION")).toBe("RETURNED");
    expect(getInventoryTargetStatus("RESTOCKED")).toBe("STOCKED");
    expect(getInventoryTargetStatus("PROBLEM")).toBe("PROBLEM");
  });

  it("makes identical terminal payloads idempotent and rejects changed payloads", () => {
    const existing = {
      result: "RESTOCKED",
      storageLocation: "A-01",
      problemReason: null,
      note: null,
      inspectedAt: new Date("2026-07-16T00:00:00.000Z"),
    };
    expect(isIdempotentInspectionRetry(existing, normalizePlatformReturnInspectionInput({ result: "RESTOCKED", storageLocation: " A-01 " }))).toBe(true);
    expect(isIdempotentInspectionRetry(existing, normalizePlatformReturnInspectionInput({ result: "RESTOCKED", storageLocation: "A-02" }))).toBe(false);
    expect(isIdempotentInspectionRetry(existing, normalizePlatformReturnInspectionInput({ result: "PROBLEM", problemReason: "破损" }))).toBe(false);
  });
});
