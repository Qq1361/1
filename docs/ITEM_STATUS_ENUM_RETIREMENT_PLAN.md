# InventoryItem Legacy Enum Retirement Plan

## Scope and decision

Candidate values for future retirement from Prisma `ItemStatus`:

```
LISTED
IN_BATCH
SHIPPED_TO_WAREHOUSE
WAREHOUSE_RECEIVED
INBOUND_SUCCESS
INBOUND_FAILED
PENDING_SETTLEMENT
SETTLED
```

`PENDING_INSPECTION` is **pending a separate lifecycle decision**. It is currently a formal contract value but has no `InventoryItem` writer: logistics writes `PurchaseOrder.status=PENDING_INSPECTION`, inspections are created, and `InventoryItem` is created only when an inspection completes as `STOCKED` or `PROBLEM`. The current recommendation is to retain it until a dedicated inventory-lifecycle review decides whether it remains a future placeholder or should be retired with a separate migration.

This document designs the migration only. It does not authorize a schema change, migration, data rewrite, or enum deletion.

## Mandatory preflight

Every environment must run:

```bash
pnpm audit:item-status
```

The command is read-only and fails with a non-zero exit code if any of the following are non-zero:

- `InventoryItem.itemStatus` legacy values.
- `SaleLine.preSaleItemStatus` legacy snapshots.
- confirmed or settled sales that reference legacy inventory or a legacy pre-sale snapshot.
- draft sales that reference legacy inventory.
- non-cancelled shipment lines or unfinished shipment batches that reference legacy inventory.

Enum removal is blocked until all environments are clean. Do not repair, map, delete, or reset data automatically from the audit command.

## Database dependency analysis

The current Prisma schema binds `ItemStatus` directly only to:

| Database column | Type | Migration impact |
| --- | --- | --- |
| `inventory_items.itemStatus` | PostgreSQL `ItemStatus` enum | Must be converted to the replacement enum type. |

The following are text snapshots/logs, not `ItemStatus` columns, but must be audited because they can preserve historical meanings:

- `sale_lines.preSaleItemStatus`
- `inventory_action_logs.oldItemStatus` / `newItemStatus`
- `platform_shipment_action_logs.oldItemStatus` / `newItemStatus`

`SaleOrder.status=SETTLED` and `PlatformShipmentLine.lineStatus=LISTED` are separate enums and must not be changed. Historical migration files must not be edited.

## Suggested manual mapping review

There is no safe universal automatic mapping. If the preflight finds history, resolve every record through an approved, auditable data migration plan:

| Legacy value | Possible modern equivalent | Manual decision required |
| --- | --- | --- |
| `LISTED` | `PLATFORM_LISTED` | Confirm platform shipment evidence first. |
| `IN_BATCH` | `STOCKED` or active shipment status | Determine whether only draft selection or shipment progress existed. |
| `SHIPPED_TO_WAREHOUSE` | `PLATFORM_SHIPPED` | Confirm the shipment was dispatched. |
| `WAREHOUSE_RECEIVED` | `PLATFORM_RECEIVED` | Confirm platform receipt. |
| `INBOUND_SUCCESS` | `PLATFORM_IN_WAREHOUSE` | Confirm inbound/authentication outcome. |
| `INBOUND_FAILED` | `PLATFORM_REJECTED` or `PROBLEM` | Preserve the actual rejection/problem evidence. |
| `PENDING_SETTLEMENT` | usually `PLATFORM_IN_WAREHOUSE` | Do not confuse with a sale or `SOLD`. |
| `SETTLED` | no default | Never map automatically to `SOLD`; distinguish old inventory meaning from `SaleOrder.SETTLED`. |

## Future migration design

PostgreSQL enum value removal should use replacement-type migration rather than editing migration history or relying on reset:

1. Verify preflight passes in every environment and take a database backup.
2. Create a replacement enum with only approved retained values.
3. In one transactional migration, alter `inventory_items.itemStatus` using `itemStatus::text::new_enum`.
4. Rename the old and new enum types, then drop the old type only after the column conversion succeeds.
5. Run `prisma generate`, deployment checks, and all verifies.

The migration must inspect all database dependencies before renaming types, including indexes, defaults, views, functions, and any non-Prisma SQL usage. A failure inside the transaction rolls back the replacement-type conversion. After a committed migration, rollback requires a new, tested migration that recreates an enum containing the removed values; the database backup remains the recovery baseline.

Never run `prisma migrate dev` against shared or production databases. Use the deployment migration process. Never use `prisma migrate reset` to handle enum migration failure.

## Observation period

Keep the write-closure code deployed through at least:

1. One purchase -> logistics sign-off -> inspection -> inventory flow.
2. One complete platform shipment flow, including return/restock where applicable.
3. One sales confirm, settlement, and confirmed-sale cancellation flow.
4. A full successful run of all automated verify commands.

During the observation period, periodically run `pnpm audit:item-status` in every environment. Confirm legacy counts remain zero, generic PATCH rejection has no legitimate callers, no page depends on legacy filters, sales cancellation has no legacy snapshot, and historical read compatibility remains stable.

## Future acceptance checklist

- [ ] Every environment passes `pnpm audit:item-status`.
- [ ] Database backup exists and restore is rehearsed.
- [ ] Only approved InventoryItem enum values are removed; `PENDING_INSPECTION` has an explicit separate decision.
- [ ] `SaleOrder.SETTLED` and `PlatformShipmentLine.LISTED` are unchanged.
- [ ] Historical migration files remain unchanged.
- [ ] Replacement-type migration and rollback are tested on a temporary database.
- [ ] `prisma generate`, lint, test, build, all verify scripts, and API status filtering pass.
- [ ] Historical compatibility code is removed only after the enum cleanup deployment is complete.
- [ ] No implicit inventory status conversion or new `SOLD` writer is introduced.
