export function calculateShelfLifeExpiryDate(
  productionDate: string,
  shelfLifeMonths: string,
): string | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(productionDate) || !/^\d+$/.test(shelfLifeMonths)) {
    return null;
  }
  const [year, month, day] = productionDate.split("-").map(Number);
  const months = Number(shelfLifeMonths);
  if (!Number.isInteger(months) || months < 1 || months > 600) return null;
  const source = new Date(Date.UTC(year, month - 1, day));
  if (source.getUTCFullYear() !== year || source.getUTCMonth() !== month - 1 || source.getUTCDate() !== day) {
    return null;
  }
  const targetMonth = source.getUTCMonth() + months;
  const targetYear = source.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const expiry = new Date(Date.UTC(targetYear, normalizedMonth, Math.min(source.getUTCDate(), lastDay)));
  return `${expiry.getUTCFullYear()}-${String(expiry.getUTCMonth() + 1).padStart(2, "0")}-${String(expiry.getUTCDate()).padStart(2, "0")}`;
}

export function isDateOnlyBefore(left: string, right: string): boolean {
  return Boolean(left && right && left < right);
}
