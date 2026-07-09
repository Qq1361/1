import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { LocalStorageAdapter } from "../src/server/adapters/storage/local-storage-adapter";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(
    directories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("LocalStorageAdapter", () => {
  it("writes, reads and deletes an image", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "resale-erp-"));
    directories.push(directory);
    const adapter = new LocalStorageAdapter(directory);
    const input = new Uint8Array([137, 80, 78, 71]);

    const { storageKey } = await adapter.put({
      data: input,
      fileName: "test.png",
      mimeType: "image/png",
    });
    const stored = await adapter.read(storageKey);

    expect(stored.mimeType).toBe("image/png");
    expect(Array.from(stored.data)).toEqual(Array.from(input));

    await adapter.delete(storageKey);
    await expect(adapter.read(storageKey)).rejects.toThrow();
  });

  it("rejects unsupported types and unsafe storage keys", async () => {
    const directory = await mkdtemp(path.join(tmpdir(), "resale-erp-"));
    directories.push(directory);
    const adapter = new LocalStorageAdapter(directory);

    await expect(
      adapter.put({
        data: new Uint8Array(),
        fileName: "test.gif",
        mimeType: "image/gif",
      }),
    ).rejects.toThrow("Unsupported image type");
    await expect(adapter.read("../secret.png")).rejects.toThrow(
      "Invalid storage key",
    );
  });
});
