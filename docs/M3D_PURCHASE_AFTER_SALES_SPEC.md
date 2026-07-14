# M3-D1 采购售后规格冻结

## 1. 业务边界

采购售后描述用户从闲鱼上游卖家购入商品后的纠纷与退款：上游卖家向用户退款。它只关联采购对象，不关联 `SaleOrder`、`SaleLine` 或销售退款流水。

支持类型：

- `PURCHASE_REFUND_ONLY`：上游卖家退款，用户保留商品。
- `PURCHASE_RETURN_AND_REFUND`：用户将商品退回上游卖家，卖家退款。

支持整单或部分 `PurchaseOrderItem`、一张采购单多次售后、每行独立申请/批准/实际退款、卖家同意或拒绝、退回物流、卖家签收和实际退款。

V1 不支持平台自动退款、聊天记录读取、自动判责、自动按订单金额或成本比例分摊、自动删除采购订单、覆盖原实付金额、换货。

## 2. 现状审计

### 2.1 采购和验货数据

`PurchaseOrder` 具有订单号、卖家昵称、付款时间、商品金额、运费、物流字段、分摊状态及备注。实付口径为：

```text
paidTotal = totalAmount + shippingAmount
```

当前没有退款金额、实际采购成本、退回物流或上游卖家售后字段。`PurchaseOrderItem` 具有名称、`skuText`、数量、`allocatedTotalCost` 和备注；一个明细可对应多个按件创建的 `Inspection` 与 `InventoryItem`。

`Inspection` 有 `PENDING / IN_PROGRESS / PASSED / PROBLEM` 状态、`PASS / PROBLEM` 结果、外观/效期/备注字段，且通过 `[purchaseOrderItemId, sequence]` 保证每件唯一。

### 2.2 验货失败是否生成库存

当前实现会生成。`InspectionService.complete` 在 `PASS` 和 `PROBLEM` 时均创建 `InventoryItem`：

- `PASS` 创建 `itemStatus=STOCKED`；
- `PROBLEM` 创建 `itemStatus=PROBLEM`，同时保存问题原因；
- 已完成验货随后被改为 `PROBLEM` 时，服务会同步关联库存为 `PROBLEM`。

因此，新数据通常已有问题件库存。`PurchaseAfterSaleLine.inventoryItemId` 仍必须可空：历史数据、未来调整的验货流程或创建库存前的失败流程都不应被强制补建库存。

## 3. 独立数据模型建议

以下为未来 M3-D1 的设计，不在本轮创建 schema 或 migration。

### 3.1 `PurchaseAfterSaleCase`

建议字段：

- `id`、`ownerId`、`caseNo`、`purchaseOrderId`
- `type`：`PURCHASE_REFUND_ONLY | PURCHASE_RETURN_AND_REFUND`
- `status`、`reason`、`requestedAt`、`approvedAt`
- `returnCarrierCode`、`returnTrackingNo`、`returnShippedAt`、`sellerReceivedAt`
- `completedAt`、`cancelledAt`、`note`、`createdAt`、`updatedAt`

### 3.2 `PurchaseAfterSaleLine`

建议字段：

- `purchaseAfterSaleCaseId`、`purchaseOrderItemId`
- `inspectionId?`、`inventoryItemId?`
- `requestedRefundAmount`、`approvedRefundAmount`
- `returnRequired`、`returnedToSeller`
- `productNameSnapshot`、`skuSnapshot`、`costSnapshot`、`note`

同一售后单内同一采购明细只能出现一次。`inventoryItemId` 和 `inspectionId` 可空；不得为了关联强制创建库存。

### 3.3 `PurchaseRefundRecord`

它表达**上游卖家实际退款给用户**，不可复用销售侧退款流水。建议字段：

- `purchaseAfterSaleCaseId`、`purchaseOrderId`
- `refundAmount`、`refundedAt`、`refundMethod`、`externalRefundNo`
- `idempotencyKey`、`note`、`createdAt`

退款流水是实际收款事实，不覆盖 `PurchaseOrder.paidTotal`、原分摊成本或原验货记录。

### 3.4 `PurchaseAfterSaleActionLog`

记录申请、卖家同意/拒绝、寄回、卖家签收、收到退款、完成、取消。日志必须按售后域隔离，不能写入 `SaleActionLog`。

## 4. 状态机

建议采用独立采购售后状态：

```text
DRAFT -> REQUESTED -> SELLER_APPROVED -> REFUND_PENDING
                                      -> PARTIALLY_REFUNDED / REFUNDED -> COMPLETED

DRAFT -> REQUESTED -> SELLER_APPROVED -> RETURN_PENDING
                                      -> RETURNING_TO_SELLER
                                      -> SELLER_RECEIVED
                                      -> REFUND_PENDING
                                      -> PARTIALLY_REFUNDED / REFUNDED -> COMPLETED

REQUESTED -> SELLER_REJECTED
```

`CANCELLED` 只允许从未完成状态进入。卖家拒绝后是否可再次申请：允许新建另一售后单，但原单保持 `SELLER_REJECTED`，不得原地重置日志。

未来服务端必须在 transaction 内校验合法转移，页面隐藏按钮不是状态机保护。

## 5. 库存与资产归属

### 5.1 仅退款，商品保留

退款不自动决定商品质量：

- 商品仍可售时，可保持或经明确人工判断恢复为 `STOCKED`；
- 仍有问题时保持 `PROBLEM`；
- 不得因为收到采购退款自动把问题件变为正常库存。

### 5.2 退回上游卖家

已有库存的商品先通过合法问题件路径成为 `PROBLEM`，在寄回和卖家签收期间不得销售、不得进入平台寄送批次。不得复用 M3-0 平台寄送的 `RETURNING / RETURNED`。

对“商品已退回上游，不再属于用户资产”的表达比较：

| 方案 | 优点 | 风险 |
| --- | --- | --- |
| A. 新增 `ItemStatus.RETURNED_TO_SELLER` | 列表语义直观 | 扩大状态机、筛选、提醒、SKU 汇总、销售/寄送限制及 migration 影响面 |
| B. 保持 `PROBLEM`，只靠已完成售后行判断 | 不改枚举 | 库存仍像一件存在资产，容易被库存统计和 SKU 汇总误算 |
| C. 新增明确资产归属字段 | 状态保留“商品状况”，归属单独表达；不引入模糊状态 | 未来需统一在资产、提醒、可售和汇总查询中排除 |

**推荐 C。** 未来新增独立字段，例如 `assetDisposition`，取值至少为 `OWNED` 与 `RETURNED_TO_UPSTREAM_SELLER`。商品状况仍保留 `PROBLEM`，资产归属则明确为已退回上游。所有可售、寄送、提醒、SKU 汇总和资产统计必须以 `assetDisposition=OWNED` 为前提。

不建议新增 `ItemStatus.RETURNED_TO_SELLER`，更不允许重新引入含义模糊的 `REMOVED`。本轮不实施上述字段或任何库存状态变更。

## 6. 采购退款和净采购成本

原始事实永久保留：`paidTotal`、`allocatedTotalCost`、验货记录与库存成本快照。

新增派生口径：

```text
totalPurchaseRefundedAmount = 已完成 PurchaseRefundRecord.refundAmount 合计
netPurchasePaidAmount = paidTotal - totalPurchaseRefundedAmount
```

组合采购必须由用户手工填写每个 `PurchaseAfterSaleLine` 的退款分配：行级批准/实际退款合计必须等于本次退款总额；不得自动平均或按成本比例分摊。累计完成退款不得超过原 `paidTotal`，并发提交时必须在 serializable transaction 内重新计算，超额返回 409。

未来报表同时展示原采购成本、采购退款和净采购成本。不同资产结果不得用同一成本公式掩盖：退回上游、仅退款但可售、仅退款仍问题件、部分补偿均分别呈现，不覆盖原快照。

## 7. 未来 API、页面与验证

未来 API 按采购域命名，例如创建售后、卖家同意/拒绝、登记寄回物流、卖家签收、登记退款、完成/取消；每一步验证订单/明细归属、状态机、Decimal 金额、幂等键及累计退款上限。

页面应从采购订单、验货问题件或库存详情进入；显示独立售后历史、退款流水和资产归属，不暴露销售侧入口。

`pnpm verify:m3d-purchase` 至少覆盖：

1. 未生成库存的验货问题可发起售后，行库存关联为空。
2. 整单和部分采购明细售后；未选择明细不受影响。
3. 仅退款与退货退款的状态机、物流和卖家签收。
4. 真实退款流水、退款上限、并发上限和幂等。
5. 原 `paidTotal`、原分摊和销售实际到账不被覆盖。
6. 退回上游后不计入可售库存；仅退款不自动将问题件变正常。
7. 测试数据精确清理。

## 8. 实施分刀

1. M3-D1-1：采购售后 schema、migration、独立 verify 骨架。
2. M3-D1-2：状态机和退款额度保护。
3. M3-D1-3：采购售后 API。
4. M3-D1-4：采购订单/验货问题件发起与详情页面。
5. M3-D1-5：退回物流、卖家签收、实际退款。
6. M3-D1-6：采购成本与报表派生口径。
