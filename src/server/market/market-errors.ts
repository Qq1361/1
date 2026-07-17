import { ServiceError } from "@/server/errors";

export function marketValidationError(code: string, message: string) {
  return new ServiceError(code, message, 400);
}

export function marketNotFoundError(code: "MARKET_ITEM_NOT_FOUND" | "MARKET_QUOTE_NOT_FOUND") {
  return new ServiceError(code, code === "MARKET_ITEM_NOT_FOUND" ? "行情商品不存在或无权访问。" : "行情报价不存在或无权访问。", 404);
}

export function marketConflictError(code: string, message: string) {
  return new ServiceError(code, message, 409);
}
