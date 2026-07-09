export type StoredObject = {
  data: Uint8Array;
  mimeType: string;
};

export type PutObjectInput = StoredObject & {
  fileName: string;
};

export interface StorageAdapter {
  put(input: PutObjectInput): Promise<{ storageKey: string }>;
  read(storageKey: string): Promise<StoredObject>;
  delete(storageKey: string): Promise<void>;
}
