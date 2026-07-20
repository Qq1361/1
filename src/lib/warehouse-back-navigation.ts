export const WAREHOUSE_PAGE_PATH = "/inventory/warehouses";
export const WAREHOUSE_RETURN_STORAGE_KEY = "resale-erp:warehouse-return";

export type WarehouseReturnTarget = {
  path: string;
  source: "history" | "referrer";
};

export function isSafeWarehouseReturnPath(value: string | null | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return false;
  const pathname = value.split(/[?#]/, 1)[0];
  return pathname !== "/access" && pathname !== WAREHOUSE_PAGE_PATH;
}

export function parseWarehouseReturnTarget(value: string | null): WarehouseReturnTarget | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value) as WarehouseReturnTarget;
    return (parsed.source === "history" || parsed.source === "referrer") && isSafeWarehouseReturnPath(parsed.path)
      ? parsed
      : null;
  } catch {
    return null;
  }
}
