# Resale ERP Roadmap

第一阶段迁移只包含 `User`、`PurchaseOrder`、`PurchaseOrderItem` 和
`Attachment`。以下模型和枚举仅作为后续设计约束，不进入 M0 数据库迁移。

## M1：采购订单与成本分摊

- 实现采购订单 CRUD、一单多货和附件 API。
- 附件列表接口：
  `GET /api/attachments?entityType=xxx&entityId=xxx`。
- `paidTotal = totalAmount + shippingAmount`。
- 所有 `allocatedTotalCost` 合计必须等于 `paidTotal` 才能将
  `allocationStatus` 更新为 `CONFIRMED`。
- 删除方法统一为 `deleteOrder(orderId)`，仅允许删除未进入后续流程的订单。

## 后续模型

- `InventoryItem`：单件库存。分别使用 `locationStatus`、`saleMode` 和
  `itemStatus`，不使用单一 stage 字段。
- `Inspection`：手机端逐件验货向导和验货结果。
- `WarehouseBatch`、`WarehouseBatchItem`：得物批次共享快递单号，每件记录
  独立得物入仓单号。
- `SalesOrder`、`SalesOrderItem`：出售、待结算、费用和单件利润。
- `LogisticsEvent`：标准化物流轨迹和异常快照。

## 库存状态

```text
LocationStatus:
LOCAL | DEWU_WAREHOUSE | RETURNING | SOLD

SaleMode:
NONE | DEWU_LIGHTNING | DEWU_STANDARD |
NINETY_FIVE | XIANYU | OTHER

ItemStatus:
PENDING_INSPECTION | STOCKED | PLATFORM_SHIPPED |
PLATFORM_RECEIVED | PLATFORM_IN_WAREHOUSE | PLATFORM_LISTED |
PLATFORM_REJECTED | RETURNING | RETURNED | SOLD | PROBLEM
```

同一采购明细数量大于一时，后续生成对应数量的 `InventoryItem`。
`allocatedTotalCost` 按数量拆成 `unitCost`，除不尽的分差计入最后一件。

## Adapter

- `MockLogisticsAdapter` 首先实现标准物流接口；快递100和快递鸟只新增 adapter，
  不改变业务 service。
- `LocalStorageAdapter` 是首个可用存储实现；后续云存储 adapter 保持相同接口。
