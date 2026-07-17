export const PLATFORM_RETURN_INSPECTION_RESULTS = [
  "RESTOCKED",
  "PROBLEM",
  "PENDING_DECISION",
] as const;

export type PlatformReturnInspectionResultValue = (typeof PLATFORM_RETURN_INSPECTION_RESULTS)[number];

export type PlatformReturnInspectionInput = {
  result: PlatformReturnInspectionResultValue;
  storageLocation?: string | null;
  problemReason?: string | null;
  note?: string | null;
  inspectedAt?: Date | string | null;
};

export type NormalizedPlatformReturnInspectionInput = {
  result: PlatformReturnInspectionResultValue;
  storageLocation: string | null;
  problemReason: string | null;
  note: string | null;
  inspectedAt?: Date;
  inspectedAtProvided: boolean;
};

type ComparableInspection = {
  result: string;
  storageLocation: string | null;
  problemReason: string | null;
  note: string | null;
  inspectedAt: Date | null;
};

function normalizeText(value: string | null | undefined) {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

export function normalizePlatformReturnInspectionInput(
  input: PlatformReturnInspectionInput,
): NormalizedPlatformReturnInspectionInput {
  const inspectedAtValue = input.inspectedAt;
  const inspectedAtProvided = inspectedAtValue !== undefined && inspectedAtValue !== null && inspectedAtValue !== "";
  const inspectedAt = !inspectedAtProvided
    ? undefined
    : inspectedAtValue instanceof Date
      ? new Date(inspectedAtValue.getTime())
      : new Date(inspectedAtValue!);

  return {
    result: input.result,
    storageLocation: normalizeText(input.storageLocation),
    problemReason: normalizeText(input.problemReason),
    note: normalizeText(input.note),
    ...(inspectedAt ? { inspectedAt } : {}),
    inspectedAtProvided,
  };
}

export function validatePlatformReturnInspectionInput(
  input: NormalizedPlatformReturnInspectionInput,
) {
  const fieldErrors: Record<string, string[]> = {};
  if (!PLATFORM_RETURN_INSPECTION_RESULTS.includes(input.result)) {
    fieldErrors.result = ["平台退回验货结论无效。"];
  }
  if (input.inspectedAtProvided && (!input.inspectedAt || Number.isNaN(input.inspectedAt.getTime()))) {
    fieldErrors.inspectedAt = ["验货时间无效。"];
  }
  if (input.result === "RESTOCKED" && !input.storageLocation) {
    fieldErrors.storageLocation = ["重新入库必须填写库位。"];
  }
  if (input.result === "PROBLEM" && !input.problemReason && !input.note) {
    fieldErrors.problemReason = ["问题件必须填写问题原因或备注。"];
  }
  return fieldErrors;
}

export function isFinalInspectionResult(result: string | null | undefined) {
  return result === "RESTOCKED" || result === "PROBLEM";
}

export function canCreateInspection(existing: { result: string } | null | undefined) {
  return !existing;
}

export function canReviseInspection(existing: { result: string } | null | undefined) {
  return existing?.result === "PENDING_DECISION";
}

export function getPlatformReturnAvailableActions(input: {
  shipmentLineStatus: string;
  inventoryItemStatus: string;
  ownershipStatus: string;
  inspectionResult?: string | null;
}) {
  const isReturnedAndOwned = input.shipmentLineStatus === "RETURNED"
    && input.inventoryItemStatus === "RETURNED"
    && input.ownershipStatus === "OWNED";
  const legacyDirectRestock = input.shipmentLineStatus === "RETURNED"
    && input.inventoryItemStatus === "STOCKED"
    && !input.inspectionResult;

  if (!isReturnedAndOwned) {
    return { actions: [] as string[], legacyDirectRestock };
  }
  if (!input.inspectionResult) {
    return { actions: ["inspectReturn"], legacyDirectRestock: false };
  }
  if (input.inspectionResult === "PENDING_DECISION") {
    return { actions: ["reviseInspection", "finalizeInspection"], legacyDirectRestock: false };
  }
  return { actions: [] as string[], legacyDirectRestock: false };
}

export function getInventoryTargetStatus(result: PlatformReturnInspectionResultValue) {
  if (result === "RESTOCKED") return "STOCKED" as const;
  if (result === "PROBLEM") return "PROBLEM" as const;
  return "RETURNED" as const;
}

export function isIdempotentInspectionRetry(
  existing: ComparableInspection,
  input: NormalizedPlatformReturnInspectionInput,
) {
  if (existing.result !== input.result) return false;
  if (existing.storageLocation !== input.storageLocation) return false;
  if (existing.problemReason !== input.problemReason) return false;
  if (existing.note !== input.note) return false;
  if (!input.inspectedAtProvided) return true;
  return existing.inspectedAt?.getTime() === input.inspectedAt?.getTime();
}
