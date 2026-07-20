import { z } from "zod";

const inventoryCondition = z.enum(["NEW", "LIKE_NEW", "LIGHTLY_USED", "USED", "FLAWED"]);
const saleMode = z.enum(["NONE", "DEWU_LIGHTNING", "DEWU_STANDARD", "NINETY_FIVE", "XIANYU", "OTHER"]);
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期必须是 YYYY-MM-DD 格式。");
const itemIds = z.array(z.string().cuid()).min(1).max(200);
const common = {
  inventoryItemIds: itemIds,
  reason: z.string().trim().max(500).nullable().optional(),
  confirmMixedProducts: z.boolean().default(false),
  selectionFingerprint: z.string().min(16).max(200).optional(),
};

const dateMode = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("KEEP") }).strict(),
  z.object({ mode: z.literal("CLEAR") }).strict(),
  z.object({ mode: z.literal("SET"), value: dateOnly }).strict(),
]);

const shelfLifeMonthMode = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("KEEP") }).strict(),
  z.object({ mode: z.literal("CLEAR") }).strict(),
  z.object({ mode: z.literal("SET"), value: z.number().int().min(1).max(600) }).strict(),
]);

const expiryDateMode = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("KEEP") }).strict(),
  z.object({ mode: z.literal("CLEAR") }).strict(),
  z.object({ mode: z.literal("SET"), value: dateOnly }).strict(),
  z.object({ mode: z.literal("AUTO") }).strict(),
]);

export const inventoryBulkOperationSchema = z.discriminatedUnion("operation", [
  z.object({
    ...common,
    operation: z.literal("MOVE_LOCATION"),
    payload: z.object({ warehouseId: z.string().cuid(), storageLocationId: z.string().cuid() }).strict(),
  }).strict(),
  z.object({
    ...common,
    operation: z.literal("SET_CONDITION"),
    payload: z.object({ condition: inventoryCondition }).strict(),
  }).strict(),
  z.object({
    ...common,
    operation: z.literal("SET_SALE_MODE"),
    payload: z.object({ saleMode }).strict(),
  }).strict(),
  z.object({
    ...common,
    operation: z.literal("SET_SHELF_LIFE"),
    payload: z.object({ productionDate: dateMode, shelfLifeMonths: shelfLifeMonthMode, expiryDate: expiryDateMode }).strict(),
  }).strict(),
]);

export type InventoryBulkOperationInput = z.infer<typeof inventoryBulkOperationSchema>;

export const inventoryUpdateSchema = z
  .object({
    saleMode: z.enum(["NONE", "DEWU_LIGHTNING", "DEWU_STANDARD", "NINETY_FIVE", "XIANYU", "OTHER"]).optional(),
    storageLocation: z.string().trim().max(100).nullable().optional(),
  })
  .strict()
  .refine((input) => input.saleMode !== undefined || input.storageLocation !== undefined, {
    message: "至少提供一个允许更新字段。",
  });
