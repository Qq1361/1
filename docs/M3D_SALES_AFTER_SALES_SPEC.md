# M3-D2 销售售后规格冻结

## 1. 业务边界

销售售后描述用户把商品卖给闲鱼买家后，用户向买家退款。它只关联 `SaleOrder`、`SaleLine` 与精确的 `InventoryItem`，不能关联采购售后主表或 `PurchaseRefundRecord`。

支持类型：

- `SALE_REFUND_ONLY`：用户退款，买家不退商品。
- `SALE_RETURN_AND_REFUND`：买家退回商品，用户验货后完成退款与库存处理。

支持整单或部分商品、多次售后、一次选择一条或多条 `SaleLine`，以及每行独立填写申请、批准和实际退款。V1 不支持平台自动退款、自动同步闲鱼售后、自动分摊订单到账、换货、无退款纯退货或自动支付渠道退款。

## 2. 现状审计

`SaleOrder` 有原销售事实：`grossAmount`、`expectedIncome`、`actualReceivedAmount`、`shippingCost`、`otherCost`、`soldAt`、`confirmedAt`、`settledAt`、`note`；状态仅为 `DRAFT`、`CONFIRMED`、`SETTLED`、`CANCELLED`。

`SaleLine` 一对一指向库存，并保存销售前库存快照、库存成本快照、可选 `saleAmount`、`costAmount` 和持久化的 `profitAmount`。`saleAmount` 在创建草稿时允许为空并会保存为 `0`，只有大于 0 的已保存值才可作为可靠行级成交金额。

`SalesService.cancel` 只用于取消草稿/已确认销售；`SETTLED` 一律返回 409，不能复用为售后。M3-B 报表以订单实际到账和已保存 `SaleLine.profitAmount` 为原口径；M3-D 将新增净口径，不覆盖原值。

当前没有销售退款、买家退货、售后验货或退款流水模型、服务、API 或页面。

## 3. 发起条件与独立模型

只有 `SETTLED` 销售可发起 M3-D2 售后。`DRAFT` 与 `CANCELLED` 被拒绝；`CONFIRMED` 尚未形成到账销售事实，也不进入本轮退款流程。

未来建议独立模型如下，不在本轮创建。

### 3.1 `SaleAfterSaleCase`

- `id`、`ownerId`、`caseNo`、`saleOrderId`
- `type`：`SALE_REFUND_ONLY | SALE_RETURN_AND_REFUND`
- `status`、`reason`、`requestedAt`、`approvedAt`
- 买家退货物流、收货时间、完成/取消时间、备注、审计字段

### 3.2 `SaleAfterSaleLine`

- `saleAfterSaleCaseId`、`saleLineId`、`inventoryItemId`
- `requestedRefundAmount`、`approvedRefundAmount`、`actualRefundAmount`
- `returnRequired`、`returnReceived`
- `inspectionResult`、`restockResult`、`note`
- 商品、SKU、库存代码、成本和销售金额快照

同一售后单内 `saleLineId` 唯一。同一库存不能同时出现在两个进行中的退货售后；已完成恢复库存的售后行不能再次恢复。

### 3.3 `SaleRefundRecord`

它表达**用户实际退款给买家**，不得与采购侧 `PurchaseRefundRecord` 共用。建议保存售后单、销售单、退款金额、时间、渠道流水号、唯一幂等键和备注。

### 3.4 `SaleAfterSaleInspection` 与 `SaleAfterSaleActionLog`

买家退货必须有独立售后验货记录，不能复用采购 `Inspection`：原采购验货一件仅有一个序号记录，而同一库存未来可能多次发生买家退货。日志记录申请、收货、验货、退款、恢复库存、完成及取消。

## 4. 状态与库存规则

`SaleOrder.status` 始终表达原销售事实，售后不增加 `REFUNDED`：

- 销售已到账后仍保持 `SETTLED`；
- 原 `grossAmount`、`expectedIncome`、`actualReceivedAmount`、`SaleLine.profitAmount` 永久保留；
- 页面可由售后记录派生“部分退款”“全额退款”“退货中”“售后已完成”。

### 4.1 仅退款

库存持续为 `SOLD`，不恢复库存、不改销售快照。退款是单独流水，不覆盖 `actualReceivedAmount`。

### 4.2 买家退货退款

1. 买家寄回途中：选中库存仍为 `SOLD`。
2. 用户收到但尚未验货：仍为 `SOLD`。
3. 售后验货合格：仅被退回并选中的库存恢复 `STOCKED`，可要求填写库位。
4. 售后验货不合格：仅被退回并选中的库存转 `PROBLEM`。
5. 暂无法判断：保持 `SOLD`，售后不得完成。
6. 未选中的销售行继续 `SOLD`。

不得使用 M3-0 的 `RETURNING / RETURNED`，不得调用 `SalesService.cancel`。库存恢复必须由未来独立售后服务在 transaction 中进行并带重复恢复保护。

## 5. 退款上限与组合销售

每次售后必须明确选择具体 `SaleLine`，并由用户手工填写每行退款金额：

```text
本次退款总额 = 本次所有售后行批准退款金额之和
```

禁止将订单退款重复复制到每一行、自动平均分摊或按成本比例分摊。

订单可退款余额：

```text
originalActualReceivedAmount
- 已完成 SaleRefundRecord 合计
- 其他处理中且已锁定的退款金额
```

服务端必须在 transaction 内重新计算；超额退款返回 409，重试必须通过幂等键避免生成重复流水。只有真实完成的退款流水计入累计退款，草稿/取消售后不计入。

若行 `saleAmount > 0`，行累计退款不得超过该金额减已完成行退款。若行级成交金额不可靠或为 0，不自动推断上限：仍要求人工填写各行分配，只做订单级上限校验，并明确提示不能以预计收入、订单到账均值或库存成本替代。

## 6. 净到账与净利润

保留原值，新增派生口径：

```text
totalSalesRefundedAmount = 已完成 SaleRefundRecord.refundAmount 合计
netReceivedAmount = actualReceivedAmount - totalSalesRefundedAmount
netProfit = 原销售利润 - 累计退款 - 退货运费 - 其他售后成本 + 已冻结的成本冲回
```

规则：

- 仅退款不冲回商品成本；净利润扣退款及售后成本。
- 退货并重新入库时，才可按冻结规则冲回对应 `SaleLine` 成本；规则在实现前单独确认。
- 退货转 `PROBLEM` 不按正常重新入库处理，V1 不得静默冲回成本。
- 报表未来同时显示原实际到账/原利润与退款、净到账、净利润；不得覆盖 M3-B 原口径或把订单级退款按多行重复累计。

## 7. 未来 API、页面与验证

未来 API 按销售售后域命名，例如发起售后、接收退货、保存售后验货、登记退款、完成/取消。服务端验证销售状态、行/库存归属、状态机、Decimal 金额、退款额度、幂等与库存恢复互斥。

页面从销售详情发起，独立展示售后单、退款流水、买家退货物流和验货结果；不可直接修改库存或销售状态。

`pnpm verify:m3d-sales` 至少覆盖：

1. `SETTLED` 可发起，`DRAFT / CONFIRMED / CANCELLED` 被拒绝。
2. 仅退款不恢复库存，原销售仍 `SETTLED`。
3. 买家退货途中/待验货保持 `SOLD`；合格仅恢复选中库存，失败仅转选中库存为 `PROBLEM`。
4. 未退商品继续 `SOLD`；同一库存不能并发退货或重复恢复。
5. 多次部分退款、订单/行级上限、并发额度与幂等正确。
6. 原 `actualReceivedAmount`、销售行快照不被覆盖，组合销售不重复累计退款。
7. transaction 失败时不出现退款成功但库存部分恢复；测试数据精确清理。

## 8. 实施分刀

1. M3-D2-1：销售售后 schema、独立 migration、verify 骨架。
2. M3-D2-2：状态机、退款额度与幂等服务。
3. M3-D2-3：销售售后 API。
4. M3-D2-4：销售详情发起与售后详情页面。
5. M3-D2-5：买家退货验货与精确库存恢复。
6. M3-D2-6：净到账、净利润及报表扩展。
