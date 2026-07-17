# M5-A1 采购订单商品明细维护

## 范围

M5-A1 允许在采购订单创建后维护商品明细：添加、编辑和删除。删除最后一条明细始终被拒绝。已付款本身不锁定维护；进入成本分摊、生成库存、验货、采购售后或采购退款等下游流程后，由服务端统一锁定。

## 参考成交总额

`PurchaseOrderItem.referenceAmount` 是当前采购明细整条商品的参考成交总额，不是单件价格、订单实付、运费、成本分摊结果、库存单件成本或采购退款净实付。

- 字段可空，历史数据不回填。
- 仅接受非负、最多两位小数的 Decimal 字符串。
- 未填写时页面显示“未填写”。
- 不参与订单总额、成本分摊、库存成本、采购退款或日报计算。
- 数量变化不会自动改变该字段。
- 页面文案为“商品参考成交总额（可选）”；说明为“仅作采购明细参考，订单实付和最终库存成本不会因此自动变化。”

迁移 `20260717090000_add_purchase_item_reference_amount` 只新增该可空字段及非负 CHECK，不回填、不删除数据。

## API 与安全边界

- `POST /api/purchases/[purchaseOrderId]/items`
- `PATCH /api/purchases/[purchaseOrderId]/items/[purchaseItemId]`
- `DELETE /api/purchases/[purchaseOrderId]/items/[purchaseItemId]`

创建页面和订单详情维护入口复用同一套严格校验。所有写操作都经过 `PurchaseOrderService` 的 owner 校验和下游锁定守卫；页面不直接访问 Prisma，不修改库存、销售、退款、分摊结果或 `SOLD`。

## 验收状态

`pnpm verify:m5-purchase-items` 已覆盖 38 项检查，包括添加、编辑、删除、最后明细保护、金额格式、未知字段、分摊/库存/验货/售后锁定、订单总额不变和精确清理。
