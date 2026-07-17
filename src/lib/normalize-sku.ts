export function normalizeSku(value: string | null | undefined): string | null {
  if (value == null) return null;
  const normalized = value.trim().toUpperCase();
  return normalized || null;
}
