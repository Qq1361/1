export type MarketApiErrorShape = {
  status: number;
  code: string;
  message: string;
  fieldErrors: Record<string, string[]>;
};

export class MarketApiError extends Error implements MarketApiErrorShape {
  status: number;
  code: string;
  fieldErrors: Record<string, string[]>;

  constructor(input: MarketApiErrorShape) {
    super(input.message);
    this.status = input.status;
    this.code = input.code;
    this.fieldErrors = input.fieldErrors;
  }
}

export async function marketRequest<T>(url: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    throw new MarketApiError({ status: 0, code: "NETWORK_ERROR", message: "网络连接失败，请检查后重试。", fieldErrors: {} });
  }
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    const error = body?.error;
    throw new MarketApiError({
      status: response.status,
      code: error?.code ?? "REQUEST_FAILED",
      message: error?.message ?? "请求失败，请稍后重试。",
      fieldErrors: error?.fieldErrors ?? {},
    });
  }
  return body as T;
}

export function marketJson<T>(url: string, method: "POST" | "PATCH", payload?: Record<string, unknown>) {
  return marketRequest<T>(url, {
    method,
    headers: { "content-type": "application/json" },
    ...(payload === undefined ? {} : { body: JSON.stringify(payload) }),
  });
}

export function marketErrorMessage(error: unknown) {
  if (error instanceof MarketApiError) return error.message;
  return "请求失败，请稍后重试。";
}

export function fieldError(error: unknown, field: string) {
  return error instanceof MarketApiError ? error.fieldErrors[field]?.[0] ?? null : null;
}
