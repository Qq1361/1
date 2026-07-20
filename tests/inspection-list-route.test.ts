import { describe, expect, it } from "vitest";
import { GET } from "@/app/api/inspections/route";

describe("GET /api/inspections query validation", () => {
  it("returns a stable 400 response for invalid keywords before querying data", async () => {
    const response = await GET(new Request("http://localhost/api/inspections?query=%0A"));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ code: "INVALID_KEYWORD" });
  });

  it("returns stable 400 responses for invalid pagination", async () => {
    const invalidPage = await GET(new Request("http://localhost/api/inspections?page=0"));
    const invalidPageSize = await GET(new Request("http://localhost/api/inspections?pageSize=51"));

    expect(invalidPage.status).toBe(400);
    await expect(invalidPage.json()).resolves.toMatchObject({ code: "INVALID_PAGE" });
    expect(invalidPageSize.status).toBe(400);
    await expect(invalidPageSize.json()).resolves.toMatchObject({ code: "INVALID_PAGE_SIZE" });
  });
});
