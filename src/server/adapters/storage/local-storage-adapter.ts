import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type {
  PutObjectInput,
  StorageAdapter,
  StoredObject,
} from "./storage-adapter";

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg",
  "image/png": ".png",
  "image/webp": ".webp",
};

export class LocalStorageAdapter implements StorageAdapter {
  constructor(
    private readonly rootDirectory = path.resolve(
      /* turbopackIgnore: true */
      process.env.STORAGE_LOCAL_DIR ?? ".data/uploads",
    ),
  ) {}

  async put(input: PutObjectInput): Promise<{ storageKey: string }> {
    const extension = MIME_EXTENSIONS[input.mimeType];
    if (!extension) {
      throw new Error(`Unsupported image type: ${input.mimeType}`);
    }

    await mkdir(this.rootDirectory, { recursive: true });
    const storageKey = `${randomUUID()}${extension}`;
    await writeFile(this.resolveStorageKey(storageKey), input.data, {
      flag: "wx",
    });
    await writeFile(
      this.resolveStorageKey(`${storageKey}.json`),
      JSON.stringify({ mimeType: input.mimeType }),
      { flag: "wx" },
    );

    return { storageKey };
  }

  async read(storageKey: string): Promise<StoredObject> {
    const safePath = this.resolveStorageKey(storageKey);
    const [data, metadata] = await Promise.all([
      readFile(safePath),
      readFile(`${safePath}.json`, "utf8"),
    ]);
    const parsed = JSON.parse(metadata) as { mimeType: string };

    return { data, mimeType: parsed.mimeType };
  }

  async delete(storageKey: string): Promise<void> {
    const safePath = this.resolveStorageKey(storageKey);
    await Promise.all([
      rm(safePath, { force: true }),
      rm(`${safePath}.json`, { force: true }),
    ]);
  }

  private resolveStorageKey(storageKey: string): string {
    if (!/^[0-9a-f-]{36}\.(jpg|png|webp)(\.json)?$/i.test(storageKey)) {
      throw new Error("Invalid storage key.");
    }

    const resolvedPath = path.resolve(this.rootDirectory, storageKey);
    if (path.dirname(resolvedPath) !== this.rootDirectory) {
      throw new Error("Storage key escapes the configured directory.");
    }
    return resolvedPath;
  }
}
