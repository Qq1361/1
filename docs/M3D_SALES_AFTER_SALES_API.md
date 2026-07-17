# M3-D2-3 Sales After-Sales API

## Scope

This API-only slice adds no sales after-sales UI and does not change the M3-B report formula, M3-0 shipment state machine, Prisma schema, or migrations.

## Endpoints

- `GET /api/sales-after-sales`: owner-scoped paged cases with `page`, `pageSize`, `status`, `type`, `saleOrderId`, and `keyword` filters.
- `GET /api/sales-after-sales/[id]`: complete case DTO; missing and cross-owner records return 404.
- `GET /api/sales-after-sales/eligible-lines`: requires `saleOrderId` and returns eligible owner-scoped sales lines only.
- Write endpoints create, update, submit, approve, reject, prepare and track return, inspect, mark refund pending, record refund, complete, and cancel.

Money is serialized as Decimal strings. Dates are ISO strings or `null`. Invalid request shape, enum, Decimal, date, duplicate, and allocation input returns 400. Business conflicts return 409.

## Safety boundaries

- The server supplies the owner; client `ownerId` and authoritative state fields are rejected.
- Write routes do not directly update inventory, sale orders, sale lines, ownership, snapshots, or profit.
- No route calls `SalesService.confirm`, `SalesService.cancel`, or the M3-0 shipment state machine.
- Buyer returns remain `SOLD` until the existing service's final inspection and completion transaction.

## M3-D2-4 UI consumers

`/sales-after-sales`、`/sales-after-sales/new` 与 `/sales-after-sales/[id]` 只消费上述查询与写入 API。页面从 `availableActions` 取得可操作动作，并在每次成功写入后重新读取详情。页面不提交 owner、状态、库存状态、资产归属、原销售事实或历史销售快照。

## M3-D2-5 Read-only financial DTOs

Sales detail, sales-after-sales detail, and sales report DTOs expose server-derived original profit, refunded amount, net receipt, restocked cost reversal, and after-sales net profit as Decimal strings. The report API additionally exposes trend, platform, after-sales status, and return inspection breakdowns. These reads do not create refunds, after-sales cases, inventory actions, or SOLD writes.
