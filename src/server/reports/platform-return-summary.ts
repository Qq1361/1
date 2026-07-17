import { Prisma } from "@/generated/prisma/client";
import { db } from "@/server/db";

type AssetBucket = { count: number; assetCost: string };

function decimal(value: Prisma.Decimal) {
  return value.toDecimalPlaces(2).toFixed(2);
}

function createBucket() {
  return { count: 0, total: new Prisma.Decimal(0) };
}

function add(bucket: ReturnType<typeof createBucket>, unitCost: Prisma.Decimal) {
  bucket.count += 1;
  bucket.total = bucket.total.plus(unitCost);
}

function jsonBucket(bucket: ReturnType<typeof createBucket>): AssetBucket {
  return { count: bucket.count, assetCost: decimal(bucket.total) };
}

/**
 * Read-only platform-return asset aggregation.
 *
 * Current assets are deduplicated by InventoryItem.id. Return-cycle history is
 * counted by PlatformShipmentLine.id, so a later return cycle never replaces
 * the evidence of an earlier one.
 */
export async function getPlatformReturnSummary(ownerId: string) {
  const [ownedItems, returnLines] = await Promise.all([
    db.inventoryItem.findMany({
      where: { ownerId, ownershipStatus: "OWNED" },
      select: { id: true, itemStatus: true, unitCost: true },
    }),
    db.platformShipmentLine.findMany({
      where: { ownerId, lineStatus: { in: ["RETURNING", "RETURNED"] } },
      select: {
        id: true,
        inventoryItemId: true,
        lineStatus: true,
        createdAt: true,
        returnInspection: { select: { result: true } },
      },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    }),
  ]);

  const itemById = new Map(ownedItems.map((item) => [item.id, item]));
  const returningIds = new Set<string>();
  const uninspectedIds = new Set<string>();
  const pendingDecisionIds = new Set<string>();
  const platformReturnProblemIds = new Set<string>();
  const latestReturnedLines = new Map<string, (typeof returnLines)[number]>();
  let restockedHistory = 0;
  let problemHistory = 0;
  let legacyDirectRestock = 0;

  for (const line of returnLines) {
    const item = itemById.get(line.inventoryItemId);
    if (!item) continue;

    if (line.lineStatus === "RETURNING" && item.itemStatus === "RETURNING") {
      returningIds.add(item.id);
    }

    if (line.lineStatus === "RETURNED") {
      const current = latestReturnedLines.get(item.id);
      if (!current || line.createdAt > current.createdAt || (line.createdAt.getTime() === current.createdAt.getTime() && line.id > current.id)) {
        latestReturnedLines.set(item.id, line);
      }
    }

    if (line.returnInspection?.result === "RESTOCKED") restockedHistory += 1;
    if (line.returnInspection?.result === "PROBLEM") {
      problemHistory += 1;
      if (item.itemStatus === "PROBLEM") platformReturnProblemIds.add(item.id);
    }
    if (line.lineStatus === "RETURNED" && !line.returnInspection && item.itemStatus === "STOCKED") {
      legacyDirectRestock += 1;
    }
  }

  // A current RETURNED inventory item can have several historical return lines.
  // Its pending category follows the latest return cycle, matching TodoService.
  for (const [inventoryItemId, line] of latestReturnedLines) {
    const item = itemById.get(inventoryItemId);
    if (!item || item.itemStatus !== "RETURNED") continue;
    if (!line.returnInspection) uninspectedIds.add(item.id);
    if (line.returnInspection?.result === "PENDING_DECISION") pendingDecisionIds.add(item.id);
  }

  const normalLocal = createBucket();
  const platformReturning = createBucket();
  const platformPendingInspection = createBucket();
  const platformPendingDecision = createBucket();
  const platformReturnedPending = createBucket();
  const platformReturnProblem = createBucket();
  const otherOwnedUnsold = createBucket();
  const totalUnsold = createBucket();

  const returnedPendingIds = new Set([...uninspectedIds, ...pendingDecisionIds]);
  for (const item of ownedItems) {
    if (item.itemStatus !== "SOLD") add(totalUnsold, item.unitCost);
    if (item.itemStatus === "STOCKED") {
      add(normalLocal, item.unitCost);
      continue;
    }
    if (returningIds.has(item.id)) {
      add(platformReturning, item.unitCost);
      continue;
    }
    if (uninspectedIds.has(item.id)) add(platformPendingInspection, item.unitCost);
    if (pendingDecisionIds.has(item.id)) add(platformPendingDecision, item.unitCost);
    if (returnedPendingIds.has(item.id)) {
      add(platformReturnedPending, item.unitCost);
      continue;
    }
    if (platformReturnProblemIds.has(item.id)) {
      add(platformReturnProblem, item.unitCost);
      continue;
    }
    if (item.itemStatus !== "SOLD") add(otherOwnedUnsold, item.unitCost);
  }

  return {
    counts: {
      returning: returningIds.size,
      pendingInspection: uninspectedIds.size,
      pendingDecision: pendingDecisionIds.size,
      restocked: restockedHistory,
      problem: problemHistory,
      legacyDirectRestock,
      totalReturnCycles: returnLines.length,
    },
    assetCosts: {
      returning: decimal(platformReturning.total),
      returnedPending: decimal(platformReturnedPending.total),
      pendingDecision: decimal(platformPendingDecision.total),
      problem: decimal(platformReturnProblem.total),
    },
    currentAssets: {
      normalLocal: jsonBucket(normalLocal),
      platformReturning: jsonBucket(platformReturning),
      platformPendingInspection: jsonBucket(platformPendingInspection),
      platformPendingDecision: jsonBucket(platformPendingDecision),
      platformReturnedPending: jsonBucket(platformReturnedPending),
      platformReturnProblem: jsonBucket(platformReturnProblem),
      otherOwnedUnsold: jsonBucket(otherOwnedUnsold),
      totalUnsold: jsonBucket(totalUnsold),
    },
  };
}
