import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";
import { ServiceError } from "@/server/errors";

function isDuplicateError(error: unknown) {
  return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
}

export class WarehouseService {
  async list(ownerId: string, activeOnly = false) {
    return db.warehouse.findMany({
      where: { ownerId, ...(activeOnly ? { isActive: true } : {}) },
      include: {
        locations: {
          ...(activeOnly ? { where: { isActive: true } } : {}),
          orderBy: { name: "asc" },
        },
        _count: { select: { inventoryItems: true } },
      },
      orderBy: { name: "asc" },
    });
  }

  async create(ownerId: string, name: string) {
    try { return await db.warehouse.create({ data: { ownerId, name } }); }
    catch (error) {
      if (isDuplicateError(error)) throw new ServiceError("WAREHOUSE_NAME_DUPLICATE", "该仓库名称已存在。", 409);
      throw error;
    }
  }

  async update(ownerId: string, id: string, data: { name?: string; isActive?: boolean }) {
    const warehouse = await db.warehouse.findFirst({ where: { id, ownerId } });
    if (!warehouse) throw new ServiceError("WAREHOUSE_NOT_FOUND", "仓库不存在。", 404);
    try { return await db.warehouse.update({ where: { id }, data }); }
    catch (error) {
      if (isDuplicateError(error)) throw new ServiceError("WAREHOUSE_NAME_DUPLICATE", "该仓库名称已存在。", 409);
      throw error;
    }
  }

  async createLocation(ownerId: string, warehouseId: string, name: string) {
    const warehouse = await db.warehouse.findFirst({ where: { id: warehouseId, ownerId } });
    if (!warehouse) throw new ServiceError("WAREHOUSE_NOT_FOUND", "仓库不存在。", 404);
    if (!warehouse.isActive) throw new ServiceError("WAREHOUSE_INACTIVE", "已停用仓库不能新增库位。", 409);
    try { return await db.warehouseLocation.create({ data: { ownerId, warehouseId, name } }); }
    catch (error) {
      if (isDuplicateError(error)) throw new ServiceError("WAREHOUSE_LOCATION_NAME_DUPLICATE", "该仓库下的库位名称已存在。", 409);
      throw error;
    }
  }

  async updateLocation(ownerId: string, id: string, data: { name?: string; isActive?: boolean }) {
    const location = await db.warehouseLocation.findFirst({ where: { id, ownerId } });
    if (!location) throw new ServiceError("WAREHOUSE_LOCATION_NOT_FOUND", "库位不存在。", 404);
    try { return await db.warehouseLocation.update({ where: { id }, data }); }
    catch (error) {
      if (isDuplicateError(error)) throw new ServiceError("WAREHOUSE_LOCATION_NAME_DUPLICATE", "该仓库下的库位名称已存在。", 409);
      throw error;
    }
  }
}

export const warehouseService = new WarehouseService();
