# M3-B V1 销售报表 / 利润看板设计冻结

> 版本：V1 设计冻结  
> 状态：仅设计，不实现  
> 最后更新：2026-07-12

## 一、M3-B V1 目标

M3-B V1 只做基于手动录入销售数据的销售分析和利润看板。报表只读取 M3-A 已落地的 `SaleOrder`、`SaleLine`、`SaleFeeLine`、`InventoryItem`、`PurchaseOrder` 等数据，不新增业务状态写入。

### 包含

1. 销售额统计。
2. 实际到账统计。
3. 利润统计。
4. 成本统计。
5. 平台维度统计。
6. 商品维度统计。
7. 采购订单维度回看。
8. 未到账销售提醒。
9. 已售未到账金额。
10. 毛利率展示。

### 不包含

1. 真实得物 / 95 分接口。
2. 自动同步平台账单。
3. OCR。
4. 自动退款退货。
5. 自动推荐进货。
6. 复杂财务系统。
7. 税务报表。
8. 多币种。
9. 自动分摊平台寄送批次成本。

## 二、统计口径冻结

1. 只统计 `SaleOrder.status = CONFIRMED / SETTLED`。
2. `DRAFT` 不统计。
3. `CANCELLED` 不统计。
4. `SETTLED` 算已到账。
5. `CONFIRMED` 算已售未到账。
6. `PLATFORM_LISTED` 不算销售。
7. `SOLD` 只是库存状态，报表以 `SaleOrder` 为准。
8. 利润优先使用已保存利润字段，不在报表页重新创造新规则。
9. `actualReceivedAmount` 有值时，实际到账以 `actualReceivedAmount` 为准。
10. `actualReceivedAmount` 为空时，未到账金额可参考 `expectedIncome`。
11. `grossAmount` 是成交价，不等于到账。
12. `expectedIncome` 是预计收入，不等于实际到账。

### 权威数据来源

| 指标 | 权威来源 |
|------|----------|
| 销售单状态 | `SaleOrder.status` |
| 成交价 | `SaleOrder.grossAmount` |
| 预计收入 | `SaleOrder.expectedIncome` |
| 实际到账 | `SaleOrder.actualReceivedAmount` |
| 销售侧运费 | `SaleOrder.shippingCost` |
| 其他成本 | `SaleOrder.otherCost` |
| 平台费用 | `SaleFeeLine.amount` |
| 库存成本 | `SaleLine.costAmount` / `SaleLine.unitCostSnapshot` |
| 利润 | 已保存的 `SaleLine.profitAmount` 汇总，或后续 SaleOrder 级保存字段 |
| 已售件数 | 有效销售单下的 `SaleLine` 数量 |

## 三、核心指标设计

`/reports/sales` 顶部指标卡片建议展示：

1. 总销售单数：有效销售单数量，即 `CONFIRMED + SETTLED`。
2. 已售件数：有效销售单下 `SaleLine` 数量。
3. 成交价合计：`sum(SaleOrder.grossAmount)`。
4. 预计收入合计：`sum(SaleOrder.expectedIncome)`，空值按 0 汇总，但文案必须标明是预计收入。
5. 实际到账合计：只汇总 `SETTLED` 且 `actualReceivedAmount` 有值的金额。
6. 已售未到账金额：`CONFIRMED` 订单中可参考 `expectedIncome`，没有预计收入时可展示为“未填写预计收入”。
7. 库存成本合计：有效销售单下 `sum(SaleLine.costAmount)`。
8. 费用合计：有效销售单下 `sum(SaleFeeLine.amount)`。
9. 销售侧运费合计：有效销售单 `sum(SaleOrder.shippingCost)`。
10. 其他成本合计：有效销售单 `sum(SaleOrder.otherCost)`。
11. 利润合计：有效销售单已保存利润合计。
12. 毛利率：`利润合计 / 收入口径金额`，收入口径按利润路径展示，不混用。
13. 平均单件利润：`利润合计 / 已售件数`。
14. 未到账订单数：`status = CONFIRMED` 且 `actualReceivedAmount` 为空。
15. 未到账超期订单数：未到账订单中 `soldAt` 或 `confirmedAt` 超过默认 7 天。

### 毛利率口径

毛利率必须明确收入口径：

| 场景 | 收入口径 |
|------|----------|
| 已到账订单 | `actualReceivedAmount` |
| 未到账但有预计收入 | `expectedIncome` |
| 仅有成交价和费用 | `grossAmount - feeLines` |

同一订单只能选择一条收入路径，避免重复扣费或重复计算收入。

## 四、筛选条件设计

报表 V1 支持以下筛选：

1. 时间范围：
   - 今日
   - 昨日
   - 本周
   - 本月
   - 自定义
2. 平台：
   - 得物
   - 95 分
   - 闲鱼
   - 其他
3. 销售状态：
   - 已确认销售
   - 已到账
4. 是否到账：
   - 全部
   - 已到账
   - 未到账
5. 商品关键词：匹配 `SaleLine.productNameSnapshot`、`SaleLine.skuSnapshot`。
6. 采购订单号：通过 `SaleLine.sourcePurchaseOrderId` 关联 `PurchaseOrder.orderNo`。
7. 卖家昵称：通过采购订单 `sellerNickname`。
8. 库位：通过当前库存或销售前快照关联展示。
9. `saleMode` / 出售方式：通过 `InventoryItem.saleMode` 或销售快照口径展示。

时间筛选默认使用 `SaleOrder.soldAt`。未到账超期判断优先使用 `confirmedAt`，没有 `confirmedAt` 时回退到 `soldAt`。

## 五、页面设计

本轮只冻结页面设计，不实现页面。

### 1. `/reports/sales` 销售报表总览

包含：

1. 顶部指标卡片：总销售单数、已售件数、成交价、预计收入、实际到账、未到账金额、成本、费用、利润、毛利率。
2. 销售趋势：按日 / 周聚合成交价、实际到账、利润。
3. 平台利润排行：按平台汇总销售单数、已售件数、成交价、实际到账、利润、毛利率。
4. 商品利润排行：按商品名 + SKU 汇总件数、平均成本、平均成交价、平均到账、总利润。
5. 未到账订单列表：展示 CONFIRMED 且未填写 `actualReceivedAmount` 的订单。
6. 低利润订单列表：展示利润低于阈值或毛利率低于阈值的有效销售单。

### 2. `/reports/sales/orders` 销售明细表

包含字段：

1. 销售单号。
2. 平台。
3. 状态。
4. 销售时间。
5. 成交价。
6. 预计收入。
7. 实际到账。
8. 成本。
9. 利润。
10. 毛利率。
11. 查看销售订单按钮，跳转 `/sales/[id]`。

限制：

1. 不提供确认销售、到账、取消销售按钮。
2. 不提供库存状态修改。
3. 不重新计算权威利润，只展示已保存结果或服务端统一聚合结果。

### 3. `/reports/sales/products` 商品利润分析

包含字段：

1. 商品名。
2. SKU。
3. 已售件数。
4. 平均成本。
5. 平均成交价。
6. 平均到账。
7. 总利润。
8. 平均利润。

聚合维度优先使用 `SaleLine.productNameSnapshot + skuSnapshot`，保证历史销售不受后续库存字段修改影响。

#### 已落地的 SKU 口径

1. 页面和 `GET /api/reports/sales/products` 仅查询 `CONFIRMED`、`SETTLED` 销售订单。
2. 聚合键为 `productNameSnapshot + normalizeSku(skuSnapshot)`；空 SKU 单独显示为“未填写”。
3. 销售单数按不同 `SaleOrder.id` 计数，已售件数按 `SaleLine` 计数；同一张组合销售单的两件同 SKU 商品只算一张销售单、两件已售。
4. 成本、利润均读取销售时保存的 `SaleLine.costAmount`、`unitCostSnapshot`、`profitAmount`，不读取当前库存成本，也不重算费用或利润。
5. 只有组内每一条 `SaleLine.saleAmount` 都大于零时，才展示 SKU 行级成交价、平均单件成交价和毛利率；任一行缺失可靠行级成交价时，上述字段显示“暂无可靠行级成交金额”。
6. `actualReceivedAmount` 是订单级金额。组合销售尚无可靠 SKU 分摊口径，因此 SKU 分析页不展示 SKU 实际到账，也不以任何比例自行分摊。
7. 每行可精确跳转销售明细（商品快照 + 标准化 SKU）及当前库存筛选；销售快照不因后续库存 SKU 修正而回写。
8. 页面与 API 均为只读，不写入 `InventoryItem`、不写入 `SOLD`，不调用销售或寄送状态机。

## 六、未到账提醒规则

M3-B V1 只设计，不实现提醒。

1. `CONFIRMED` 且 `actualReceivedAmount` 为空 = 未到账。
2. `soldAt` 或 `confirmedAt` 超过 N 天仍未到账 = 未到账超期。
3. N 天 V1 默认 7 天。
4. `SETTLED` 不进入未到账提醒。
5. `CANCELLED` 不进入未到账提醒。
6. `DRAFT` 不进入未到账提醒。

### 未到账金额展示

| 情况 | 展示 |
|------|------|
| `expectedIncome` 有值 | 作为“预计未到账金额” |
| `expectedIncome` 为空，`grossAmount` 有值 | 显示成交价参考，但不能标为预计到账 |
| `actualReceivedAmount` 有值 | 不属于未到账 |

## 七、边界情况

1. `actualReceivedAmount` 为空时，不能显示为真实到账。
2. `expectedIncome` 只能叫预计收入。
3. `grossAmount` 只能叫成交价。
4. 多件组合销售时，订单利润是权威，行利润只是展示。
5. 取消销售不能计入历史利润。
6. 同一库存多次取消销售历史不能重复统计。
7. 退款退货 V1 暂不处理，后续 M3-C 再设计。
8. `SOLD` 库存如果没有有效销售记录，应在追溯页提示数据异常，但报表不能凭 `SOLD` 自行计入销售。
9. `PLATFORM_LISTED`、`PLATFORM_IN_WAREHOUSE`、`PLATFORM_RECEIVED` 都不是销售收入事件。
10. 平台寄送批次成本 V1 先记录和展示参考，不自动计入利润，避免分摊复杂导致误算。

## 八、verify:m3b 设计

未来 `verify:m3b` 应覆盖：

1. `DRAFT` 不计入报表。
2. `CANCELLED` 不计入报表。
3. `CONFIRMED` 计入销售额，但计入未到账。
4. `SETTLED` 计入销售额和实际到账。
5. `PLATFORM_LISTED` 不计入销售。
6. `expectedIncome` 不等于 `actualReceivedAmount`。
7. `actualReceivedAmount` 为空时不算已到账。
8. 多平台统计正确。
9. 利润合计不重复扣费用。
10. 多件销售成本合计正确。
11. 未到账超期规则正确。
12. 报表不新增 SOLD 写入。
13. 报表 API 只读，不修改 `SaleOrder`、`SaleLine`、`InventoryItem`。
14. `DRAFT / CANCELLED` 销售历史不影响商品利润排行。
15. 同一库存多次取消销售历史不重复统计。
16. 平台寄送状态 `PLATFORM_LISTED` 不会被报表当成已售。
17. 商品 / SKU 分析按标准化 SKU 合并，并且不把订单级实际到账自动分摊到 SKU。
18. 缺失可靠 `SaleLine.saleAmount` 的商品组不展示伪造的 SKU 成交价或毛利率。

## 九、实现边界

M3-B V1 实现时应遵守：

1. 不修改 Prisma schema，除非后续单独冻结 schema 变更。
2. 不改变 `SalesService.confirm / settle / cancel` 核心规则。
3. 不改变 M3-0 状态机。
4. 不新增任何 SOLD 写入入口。
5. 报表 API 必须只读。
6. 金额计算使用 Decimal。
7. 报表聚合逻辑应集中在一个 service，页面不自行拼规则。
8. 所有页面继续受 `APP_PASSWORD` 保护。

## 十、建议实现顺序

1. 新增只读 `SalesReportService`，集中封装统计口径。
2. 新增只读 API：
   - `GET /api/reports/sales/summary`
   - `GET /api/reports/sales/orders`
   - `GET /api/reports/sales/products`
3. 新增 `verify:m3b`，先覆盖统计口径和只读性。
4. 实现 `/reports/sales` 总览页。
5. 实现 `/reports/sales/orders` 明细页。
6. 实现 `/reports/sales/products` 商品利润分析页。
7. 回归 `verify:m1 / verify:m2a / verify:m2b / verify:m30 / verify:m3a / verify:m3b`。

## 十一、M3-D2-5 售后净口径与可视化（已完成）

- 总览新增原实际到账、累计销售退款、净到账、原利润、恢复库存成本与售后净利润；原口径与净口径并列展示。
- 销售事实使用既有报表日期，退款趋势按 `refundedAt` 归属，不回填销售日期。
- 平台金额按 `SaleOrder.id` 去重，退款按 `SaleRefundRecord.id` 去重；SKU 退款只读显式 `SaleRefundAllocation`，不分摊订单实际到账。
- `/reports/sales` 使用 Recharts 展示趋势、平台、SKU Top 10、售后单状态与退货验货结果。图表复用只读 API 聚合并与 URL 筛选同步。
