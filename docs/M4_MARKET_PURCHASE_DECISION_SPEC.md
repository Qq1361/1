# M4-A5 行情采购决策规则与费用口径

> 阶段：设计冻结。M4-A5 不实现 Service、API、页面、数据模型或采购单写入。

## 1. 范围与边界

M4-A5 定义基于人工行情的采购试算口径：目标利润、附加成本、建议最高采购价和多平台对比。它只提供可解释的参考结果，不自动决定是否采购、出售平台或采购数量。

本阶段及后续 M4-A6 均不得修改采购单、库存、销售单、售后或 `SOLD` 状态；不得调用平台接口、猜测费率或自动创建采购单。M1-M3 保持 FROZEN。

## 2. 现有模型审计

### 2.1 行情对象

证据：[schema.prisma](../prisma/schema.prisma) 的 `MarketItem` 与 `MarketQuote`。

`MarketItem` 是独立的稳定行情对象，字段为：`id`、`ownerId`、`displayName`、`normalizedName`、`skuText`、`normalizedSku`、`versionText`、`conditionText`、`packageVariant`、`accessoryVariant`、`defaultTargetProfitAmount Decimal(12,2)`、`note`、`isActive`、时间戳。它没有 `Product`、`Sku`、库存或采购外键。

`MarketQuote` 字段为：`id`、`ownerId`、`marketItemId`、`platform`、`quoteType`、`amount Decimal(12,2)`、`recordedAt`、`expiresAt`、`sourceType`、`sourceReference`、`confirmedAt`、`invalidatedAt`、`invalidationReason`、`note`、时间戳。报价以历史记录保存，不覆盖旧报价。

真实枚举：

| 领域 | 值 | 中文含义 |
| --- | --- | --- |
| `MarketPlatform` | `DEWU` / `NINETY_FIVE` / `XIANYU` / `OTHER` | 得物 / 95分 / 闲鱼 / 其他 |
| `MarketQuoteType` | `EXPECTED_INCOME` | 用户确认的预计可到账收入 |
|  | `LISTING_PRICE` | 平台展示售价或挂牌观察价 |
|  | `MANUAL_REFERENCE` | 其他人工市场参考价 |
| `MarketQuoteSourceType` | `MANUAL` | 当前唯一的人工来源 |

“四个平台、三类报价”由 `MarketQuery` 中对全部 `MarketPlatform × MarketQuoteType` 的组合返回；当前有效报价按每个“行情商品 + 平台 + 报价类型”独立选择。

### 2.2 当前行情选择

证据：[market-rules.ts](../src/server/market/market-rules.ts) 的 `isQuoteCurrentlyEffective`、`selectCurrentQuote`，以及 [market-query.ts](../src/server/market/market-query.ts) 的 `currentQuotesByPlatform`。

当前有效 Quote 必须同时满足：已确认、未失效、`recordedAt <= asOf`、且 `expiresAt` 为空或晚于 `asOf`。同一分组按 `recordedAt desc`、`createdAt desc`、`id desc` 稳定选择。未确认、失效、过期和未来记录都不能进入采购试算。详情 DTO 能同时返回四个平台、三种报价和不可用原因。

### 2.3 现有费用事实不能充当未来费率

证据：[schema.prisma](../prisma/schema.prisma) 的 `SaleOrder`、`SaleFeeLine`、`PlatformShipmentBatch`，以及 [calculateSaleProfit.ts](../src/server/sales/calculateSaleProfit.ts)。

| 现有字段或模型 | 业务含义 | 能否作为未来费率规则 |
| --- | --- | --- |
| `SaleFeeLine.amount` / `feeType` | 某张已发生销售订单的佣金、鉴别、运费、包装或其他费用 | 否，绑定 `saleOrderId`，无生效时间、平台规则、类目或价格区间 |
| `SaleOrder.shippingCost` / `otherCost` | 已发生销售侧成本 | 否，订单事实 |
| `PlatformShipmentBatch.outboundShippingCost` / `packagingCost` / `otherShipmentCost` / `returnShippingCost` | 一次实际寄送或退回批次的成本 | 否，批次事实 |
| 采购订单总额、运费和退款 | 实际采购/售后事实 | 否，不能推导未来成本 |

当前不存在独立、可配置、带平台/生效时间/价格区间/类目条件的费率模型。因此不得用 `LISTING_PRICE` 自动反推预计收入，也不得将历史 `SaleFeeLine` 当作未来收费规则。

## 3. 金额概念冻结

| 名称 | 权威来源 | 是否可直接用于采购试算 |
| --- | --- | --- |
| 平台售价 | `MarketQuote.quoteType = LISTING_PRICE` | 否；缺少可验证费率规则时不可换算 |
| 预计收入 | 当前有效且已确认的 `EXPECTED_INCOME` Quote | 是 |
| 实际到账 | `SaleOrder.actualReceivedAmount` | 否；它是已发生销售事实 |

`MANUAL_REFERENCE` 只是人工观察参考，不能替代预计收入。行情预计收入永远不能覆盖销售订单的实际到账；平台售价、预计收入和实际到账在页面、DTO 和公式中必须使用这三个明确名称，不能统称“价格”。

## 4. M4-A6 采购试算口径

### 4.1 V1 目标利润

V1 **只支持固定目标利润额**。默认值可在 UI 中预填 80 元，但不是数据库全局默认，也不自动写入 `MarketItem.defaultTargetProfitAmount`。收入利润率和成本加价率暂不实现，避免混淆不同利润率定义。

### 4.2 可用成本与公式

V1 输入：

- `proposedPurchasePrice`：拟采购价；
- `targetProfitAmount`：固定目标利润；
- `additionalCostAmount`：用户明确填写的固定附加成本，默认可为 0；
- `platform`：可选。缺省时返回全部平台的独立比较结果。

V1 不自动推断佣金、鉴别费、运费、税费、提现费、人工成本、汇率、退货风险或阶梯费率。用户若希望扣除这些成本，应将可确定的金额合并到 `additionalCostAmount`。

仅当使用当前有效 `EXPECTED_INCOME` 时：

```text
预计利润 = 预计收入 - 拟采购价 - 附加成本
目标利润差额 = 预计利润 - 目标利润
建议最高采购价 = 预计收入 - 附加成本 - 目标利润
达到目标 = 拟采购价 <= 建议最高采购价
```

所有计算使用 `Prisma.Decimal` 或等价 Decimal 规则；API 金额输出固定两位小数字符串。最高采购价允许为负数，必须显示为“不满足目标利润条件”，不得截断为 0。

`EXPECTED_INCOME` 已表示预计可到账收入，采购试算绝不能再次扣除平台费用或历史 `SaleFeeLine`，否则会重复扣费。

## 5. 数据缺失、状态与风险提示

M4-A6 统一返回稳定状态，不能用 `0`、`NaN` 或旧报价伪造结果：

| 状态 | 含义 |
| --- | --- |
| `READY` | 已取得可用预计收入并完成计算 |
| `NO_CURRENT_QUOTE` | 无当前有效报价 |
| `NO_EXPECTED_INCOME` | 有行情记录，但无可用 `EXPECTED_INCOME` |
| `MISSING_FEE_RULE` | 仅有平台售价且没有未来费率规则，不能换算 |
| `INVALID_TARGET_PROFIT` / `INVALID_PURCHASE_PRICE` / `INVALID_ADDITIONAL_COST` | 输入金额无效 |

结果还应返回 Quote ID、平台、类型、记录/过期时间、来源、Quote age、freshness 状态和 warnings。过期、未确认、失效或未来 Quote 不作为当前收入；如需说明，作为信息提示，而不是静默兜底。

## 6. 多平台比较与文案

对每个平台分别选择当前有效 `EXPECTED_INCOME` 并计算。可计算结果按建议最高采购价降序、预计利润降序、稳定平台枚举顺序排列；不可计算的平台仍展示并说明原因。

V1 输出“平台对比”和“按当前已录入行情测算，最高采购价较高的平台”，不输出自动出售推荐、确定性收益承诺或自动采购建议。

## 7. 即时试算与关联边界

M4-A6 采用**即时试算、不持久化**：不新增决策表，不保存决策快照，不修改 Quote，不创建采购单。Quote 后续变化会影响下一次实时请求，但不会修改任何历史 Quote。

MarketItem 可在采购和库存之前独立存在；不强制关联现有 Product、SKU 或库存。SKU 只用于精确提示/查询，不以商品名或 SKU 自动合并。停用的 MarketItem 保留历史，但 M4-A6 推荐返回不可试算的明确状态，避免为已经停用的行情对象生成新的采购参考。

## 8. 后续契约

### M4-A6

新增纯规则层 `src/server/market/market-decision-rules.ts` 与只读 `MarketDecisionService.calculatePurchaseDecision`。规则层只接收已解析 Decimal 与领域值，不访问 Prisma、环境变量或 `Date.now`；Service 负责 owner 隔离、复用 `MarketQuery` 的当前 Quote 选择，并且不写数据库。

唯一建议 API：

```text
POST /api/market/items/[marketItemId]/purchase-decision
```

严格请求字段：`proposedPurchasePrice`、`targetProfitAmount`、`additionalCostAmount`、可选 `platform`。拒绝客户端 `ownerId`、`expectedIncome`、`quoteId`、`quoteAmount`、`maxPurchasePrice`、`expectedProfit`、状态和计算时间。响应返回单个平台或多平台的试算依据与结果，金额为字符串。

### M4-A6 验收冻结

M4-A6 已完成并冻结为只读即时试算：仅当前有效、已确认的 `EXPECTED_INCOME` 可直接参与计算；`LISTING_PRICE` 在缺少平台费率规则时返回 `MISSING_FEE_RULE`，`MANUAL_REFERENCE` 返回无可用预计收入。试算不保存决策、不创建采购订单，也不修改 MarketItem、MarketQuote、库存、销售或售后数据。M4-A7 页面尚未开始。

### M4-A7

仅在行情详情添加“采购试算”工作区：输入拟采购价、目标利润和附加成本；服务端返回多平台对比、最高采购价、预计利润、差额、状态和风险提示。页面不能自行计算，也不能创建采购单或把试算保存为采购成本。

### M4-A8 以后

默认目标利润、批量试算、库存行情对比和低于目标利润清单在用户验证 M4-A6/A7 字段后再设计。M4-A7 与 M4-A8 当前暂停；通知进入 M4-B，外部采集进入 M4-C。

## 9. 验证矩阵

M4-A6 的测试应覆盖 Decimal 固定利润计算、零/正附加成本、边界采购价、负数和精度、稳定多平台排序、仅展示价时不可计算、预计收入不重复扣费、owner 隔离、未确认/失效/过期/未来 Quote 排除、停用商品不可试算、严格 DTO、无数据库写入和无采购/库存/销售/SOLD 变化。

## 10. 风险分级

| 优先级 | 冻结风险 |
| --- | --- |
| P0 | 将 `LISTING_PRICE` 当预计收入、重复扣除平台费用、跨 owner 读取行情 |
| P1 | 试算重写当前 Quote 选择、过期 Quote 参与计算、前端自行计算造成精度差异 |
| P2 | 缺少默认目标利润、批量试算、采购快照或采购单快捷入口 |
| P3 | 文案、图表、导出和更多利润率模式 |

本轮审计未发现已落地的 P0/P1 代码缺陷；上述 P0/P1 是 M4-A6 实施时必须由规则、Service 和测试防止的设计风险。
