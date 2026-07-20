import { z } from "zod";

const name = z.string().trim().min(1, "名称不能为空。").max(100, "名称不能超过 100 个字符。");

export const warehouseCreateSchema = z.object({ name }).strict();
export const warehouseUpdateSchema = z.object({ name: name.optional(), isActive: z.boolean().optional() }).strict().refine((value) => value.name !== undefined || value.isActive !== undefined, "请提供需要更新的字段。");
export const warehouseLocationCreateSchema = z.object({ name }).strict();
export const warehouseLocationUpdateSchema = z.object({ name: name.optional(), isActive: z.boolean().optional() }).strict().refine((value) => value.name !== undefined || value.isActive !== undefined, "请提供需要更新的字段。");
