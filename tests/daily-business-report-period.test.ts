import { describe, expect, it } from "vitest";
import { parseReportDate, resolveDailyReportPeriod, validateReportTimezone } from "@/server/reports/daily-business-report-period";

describe("daily business report period", () => {
  it("uses the previous Shanghai calendar day by default", () => {
    const result = resolveDailyReportPeriod({ generatedAt: new Date("2026-01-01T01:00:00.000Z") });
    expect(result.reportDate).toBe("2025-12-31");
    expect(result.periodStart.toISOString()).toBe("2025-12-30T16:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2025-12-31T16:00:00.000Z");
  });

  it("supports explicit leap-day reports with a half-open UTC interval", () => {
    const result = resolveDailyReportPeriod({ date: "2024-02-29", timezone: "Asia/Shanghai", generatedAt: new Date("2024-03-01T00:00:00.000Z") });
    expect(result.periodStart.toISOString()).toBe("2024-02-28T16:00:00.000Z");
    expect(result.periodEnd.toISOString()).toBe("2024-02-29T16:00:00.000Z");
  });

  it("rejects impossible dates and unsupported timezones", () => {
    expect(() => parseReportDate("2026-02-30")).toThrow();
    expect(() => validateReportTimezone("UTC")).toThrow();
  });
});
