import { describe, expect, it } from "vitest";
import { validateAttachmentFile } from "../src/server/services/attachment-service";

describe("attachment validation", () => {
  it("accepts matching PNG signatures", () => {
    expect(
      validateAttachmentFile({
        data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        declaredMimeType: "image/png",
        size: 8,
      }),
    ).toBe("image/png");
  });

  it("rejects mismatched or oversized files", () => {
    expect(() =>
      validateAttachmentFile({
        data: new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]),
        declaredMimeType: "image/jpeg",
        size: 8,
      }),
    ).toThrow("仅支持真实的");
    expect(() =>
      validateAttachmentFile({
        data: new Uint8Array([0xff, 0xd8, 0xff]),
        declaredMimeType: "image/jpeg",
        size: 10 * 1024 * 1024 + 1,
      }),
    ).toThrow("10 MB");
  });
});
