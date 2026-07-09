import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";
import { LocalStorageAdapter } from "@/server/adapters/storage/local-storage-adapter";

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const storage = new LocalStorageAdapter();

type EntityType = "PURCHASE_ORDER" | "PURCHASE_ORDER_ITEM";

function detectImageMime(data: Uint8Array): string | null {
  if (
    data.length >= 8 &&
    [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, index) => data[index] === byte,
    )
  ) {
    return "image/png";
  }
  if (
    data.length >= 3 &&
    data[0] === 0xff &&
    data[1] === 0xd8 &&
    data[2] === 0xff
  ) {
    return "image/jpeg";
  }
  if (
    data.length >= 12 &&
    String.fromCharCode(...data.slice(0, 4)) === "RIFF" &&
    String.fromCharCode(...data.slice(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

export function validateAttachmentFile(input: {
  data: Uint8Array;
  declaredMimeType: string;
  size: number;
}) {
  if (input.size <= 0 || input.size > MAX_FILE_SIZE) {
    throw new ServiceError(
      "INVALID_FILE_SIZE",
      "图片大小必须在 10 MB 以内。",
      422,
    );
  }
  const detectedMimeType = detectImageMime(input.data);
  if (!detectedMimeType || detectedMimeType !== input.declaredMimeType) {
    throw new ServiceError(
      "INVALID_FILE_TYPE",
      "仅支持真实的 JPEG、PNG 或 WebP 图片。",
      422,
    );
  }
  return detectedMimeType;
}

export class AttachmentService {
  private async assertEntity(
    ownerId: string,
    entityType: EntityType,
    entityId: string,
  ) {
    if (entityType === "PURCHASE_ORDER") {
      const order = await db.purchaseOrder.findFirst({
        where: { id: entityId, ownerId },
        select: { id: true },
      });
      if (!order) {
        throw new ServiceError("ENTITY_NOT_FOUND", "采购订单不存在。", 404);
      }
      return;
    }
    const item = await db.purchaseOrderItem.findFirst({
      where: { id: entityId, purchaseOrder: { ownerId } },
      select: { id: true },
    });
    if (!item) {
      throw new ServiceError("ENTITY_NOT_FOUND", "商品明细不存在。", 404);
    }
  }

  async list(ownerId: string, entityType: EntityType, entityId: string) {
    await this.assertEntity(ownerId, entityType, entityId);
    return db.attachment.findMany({
      where: { ownerId, entityType, entityId },
      orderBy: { createdAt: "desc" },
    });
  }

  async upload(
    ownerId: string,
    entityType: EntityType,
    entityId: string,
    file: File,
  ) {
    await this.assertEntity(ownerId, entityType, entityId);
    const data = new Uint8Array(await file.arrayBuffer());
    const mimeType = validateAttachmentFile({
      data,
      declaredMimeType: file.type,
      size: file.size,
    });
    const stored = await storage.put({
      data,
      fileName: file.name,
      mimeType,
    });
    try {
      return await db.attachment.create({
        data: {
          ownerId,
          entityType,
          entityId,
          fileName: file.name.slice(0, 255),
          mimeType,
          size: file.size,
          storageKey: stored.storageKey,
        },
      });
    } catch (error) {
      await storage.delete(stored.storageKey);
      throw error;
    }
  }

  async get(ownerId: string, attachmentId: string) {
    const attachment = await db.attachment.findFirst({
      where: { id: attachmentId, ownerId },
    });
    if (!attachment) {
      throw new ServiceError("ATTACHMENT_NOT_FOUND", "附件不存在。", 404);
    }
    return attachment;
  }

  async read(ownerId: string, attachmentId: string) {
    const attachment = await this.get(ownerId, attachmentId);
    return {
      attachment,
      object: await storage.read(attachment.storageKey),
    };
  }

  async delete(ownerId: string, attachmentId: string) {
    const attachment = await this.get(ownerId, attachmentId);
    await db.attachment.delete({ where: { id: attachment.id } });
    await storage.delete(attachment.storageKey);
  }
}

export const attachmentService = new AttachmentService();
