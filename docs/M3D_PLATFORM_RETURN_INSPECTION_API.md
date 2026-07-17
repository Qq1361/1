# M3-D3-3 Platform Return Inspection API

M3-D3-3 adds API and read DTO coverage for platform-return inspection. M3-D3 remains in progress; no dedicated UI workbench is included in this slice.

## Stable routes

- `GET /api/platform-returns`: platform-return history, filtered by `platform`, `shipmentBatchId`, `shipmentLineId`, `inventoryItemId`, `inventoryStatus`, `inspectionResult`, `pendingOnly`, `keyword`, `page`, and `pageSize`.
- `GET /api/platform-returns/pending`: pending work filtered by `category`, `platform`, `batchId`, `keyword`, `page`, and `pageSize`.
- `GET /api/platform-returns/summary`: owner-scoped, read-only return-cycle counts and current owned-asset buckets. Money is returned as decimal strings. Current assets are deduplicated by inventory ID; historical cycles are counted by shipment-line ID.
- `GET /api/platform-returns/[shipmentLineId]`: shipment-line history, current inventory facts, inspection, action logs, and server-derived actions.
- `POST /api/platform-returns/[shipmentLineId]/inspection`: create, revise, finalize, or idempotently retry an inspection.

The write payload is strict and accepts only `result`, `storageLocation`, `problemReason`, `note`, and `inspectedAt`. It rejects owner, inventory, status snapshot, action-log, and unknown fields. Dates are ISO strings or `null`; future UI code owns Chinese display labels while APIs retain internal enum values.

## Write behavior and isolation

All write routes delegate to `PlatformReturnInspectionService`; routes do not directly write inventory, shipment lines, inspections, or action logs. The default authenticated owner is applied as a Prisma condition, and cross-owner details and writes return the same `404 PLATFORM_RETURN_NOT_FOUND` response.

`PENDING_DECISION` may be revised. `RESTOCKED` and `PROBLEM` are final, with identical final retries treated as idempotent and incompatible final retries returning `409`. Shipment-line history stays `RETURNED`; only the linked inventory changes to `STOCKED` or `PROBLEM` through the service.

The pending API returns three categories: `RETURNING`, `PENDING_INSPECTION`, and `PENDING_DECISION`. It is read-only and deduplicates by inventory item.

## Error contract

- `400 VALIDATION_ERROR`: malformed JSON, malformed identifiers, unknown fields, invalid enum/date, or missing final-decision fields.
- `404 PLATFORM_RETURN_NOT_FOUND`: missing or cross-owner shipment line.
- `409 PLATFORM_RETURN_STATE_CONFLICT`, `PLATFORM_RETURN_FINALIZED`, or `PLATFORM_RETURN_CONCURRENT_CONFLICT`: invalid lifecycle state, changed final conclusion, or concurrent result conflict.
- `500 INTERNAL_ERROR`: unexpected server failure without database or stack details.

## Legacy endpoint

`POST /api/shipments/lines/[lineId]/confirm-restocked` remains temporarily compatible for existing callers. It requires `storageLocation`, delegates to `ShipmentService.confirmRestocked`, returns a `Deprecation: true` header, and cannot bypass creation of a `RESTOCKED` inspection and action log. New UI work in M3-D3-4 must use the platform-return inspection API.

## M3-D3-4 UI consumption

`/platform-returns` and `/platform-returns/[shipmentLineId]` consume these APIs without extending the write contract. The UI displays internal enums only through Chinese mappings, uses `availableActions` solely to decide which inspection entry points to render, and reloads complete detail from the API after a successful write. The deprecated confirm-restocked endpoint has no page entry point.

## M3-D3-5 summary contract

`GET /api/platform-returns/summary` is read-only and never updates inventory, shipment lines, inspections or action logs. It returns:

- `counts.returning`, `pendingInspection`, `pendingDecision`, `restocked`, `problem`, `legacyDirectRestock`, and `totalReturnCycles`.
- `assetCosts.returning`, `returnedPending`, `pendingDecision`, and `problem` as decimal strings.
- `currentAssets` buckets for normal local stock, return transit, first pending inspection, pending decision, all returned pending, platform-return problems, other owned unsold assets and total owned unsold assets.

`pendingDecision` is a subset of `returnedPending`, not an extra asset total. The source cost is always `InventoryItem.unitCost`; sales, refunds, shipping fees, platform fees and profit do not participate in this endpoint.
