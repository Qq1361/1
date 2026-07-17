import { z } from "zod";

export const inventoryUpdateSchema = z
  .object({
    saleMode: z.enum(["NONE", "DEWU_LIGHTNING", "DEWU_STANDARD", "NINETY_FIVE", "XIANYU", "OTHER"]).optional(),
    storageLocation: z.string().trim().max(100).nullable().optional(),
  })
  .strict()
  .refine((input) => input.saleMode !== undefined || input.storageLocation !== undefined, {
    message: "至少提供一个允许更新字段。",
  });
