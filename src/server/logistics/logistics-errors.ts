import { ServiceError } from "@/server/errors";

export function logisticsValidationError(code: string, message: string) {
  return new ServiceError(code, message, 400);
}

export function logisticsNotFoundError(code: "LOGISTICS_SHIPMENT_NOT_FOUND" | "LOGISTICS_BUSINESS_OBJECT_NOT_FOUND") {
  return new ServiceError(
    code,
    code === "LOGISTICS_SHIPMENT_NOT_FOUND"
      ? "物流记录不存在或无权访问。"
      : "物流业务对象不存在或无权访问。",
    404,
  );
}

export function logisticsConflictError(code: string, message: string) {
  return new ServiceError(code, message, 409);
}

export function logisticsProviderServiceError(code: string, message: string, retryable: boolean) {
  const status = code === "LOGISTICS_PROVIDER_RATE_LIMITED"
    ? 429
    : code === "LOGISTICS_PROVIDER_TIMEOUT"
      ? 504
      : code === "LOGISTICS_PROVIDER_INVALID_RESPONSE" || code === "LOGISTICS_PROVIDER_REJECTED"
        ? 502
        : code === "LOGISTICS_PROVIDER_NOT_CONFIGURED"
          || code === "LOGISTICS_PROVIDER_AUTH_FAILED"
          || code === "LOGISTICS_PROVIDER_NETWORK_ERROR"
          || code === "LOGISTICS_PROVIDER_CONFIGURATION_INVALID"
          ? 503
          : retryable
            ? 503
            : 400;
  return new ServiceError(code, message, status);
}
