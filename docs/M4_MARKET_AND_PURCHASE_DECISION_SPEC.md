# M4-A 市场行情与采购决策参考规格

> 阶段：M4-A0 只读审计与设计冻结完成，尚未开始 M4-A1 实施。
>
> 最后更新：2026-07-16

## 1. 目标与非目标

M4-A V1 为闲鱼采购、得物/95 分/闲鱼转售建立**人工行情记录和透明采购参考**。系统只记录事实、比较已录入数据、计算参考值并提示风险；最终是否采购、在哪个平台出售仍由用户决定。

本阶段要支持：

- 保存商品 / SKU 的人工平台行情与历史；
- 区分平台展示价格、平台预计收入和真实销售事实；
- 以用户确认的预计收入、候选采购价、额外成本和目标利润计算预估利润、差额与最高采购价；
- 多平台并列展示当前已录入行情及数据可靠性；
- 为后续趋势、提醒和合规数据适配器保留统一 Quote DTO。

本阶段不支持：自动决定是否采购、自动推荐或执行出售平台、自动创建采购单、自动改库存/采购成本/销售/售后、真实平台采集、爬虫、保存平台账号凭证、自动按历史费率推导预计收入或通知基础设施。

## 2. 当前商品与 SKU 审计

### 2.1 真实模型与字段

当前 Prisma schema **没有** `Product`、`Sku`、`productId` 或 `skuId` 模型/字段。商品身份分散在业务事实中：

| 事实位置 | 真实字段 | 含义 |
|---|---|---|
| `PurchaseOrderItem` | `name`、`skuText` | 采购录入的商品名称与 SKU/色号文本；无产品外键。|
| `Inspection` | `isNew`、`hasBox`、`capCondition`、`paintCondition`、`leakageCondition`、`batchCode`、`expiryDate`、`appearanceNotes` | 单件验货事实；没有版本、配件组合或包装变体主数据。|
| `InventoryItem` | `name`、`skuText`、`unitCost`、`expiryDate`、`storageLocation`、`saleMode`、`itemStatus` | 单件库存事实；名称与 SKU 是字符串。|
| `SaleLine` | `productNameSnapshot`、`skuSnapshot`、`unitCostSnapshot`、`saleAmount`、`costAmount`、`profitAmount` | 销售时冻结的历史快照，后续改库存 SKU 不会回写已确认/已到账销售。|

代码证据：`prisma/schema.prisma` 的 `PurchaseOrderItem`、`Inspection`、`InventoryItem`、`SaleLine`；采购写入在 `src/server/services/purchase-order-service.ts`，销售确认快照在 `src/server/sales/sales-service.ts`。

### 2.2 SKU 标准化与当前聚合

唯一通用标准化函数是 `src/lib/normalize-sku.ts`：去首尾空格、英文字母转大写、空值变 `null`，但保留内部空格、连字符和斜杠。采购创建/编辑、验货入库、库存 SKU 修正和销售确认快照均调用该函数。

库存 SKU 汇总在 `InventoryService.skuSummary` 以：

```text
InventoryItem.name + "\0" + normalizeSku(InventoryItem.skuText)
```

聚合；销售商品 / SKU 报表以：

```text
SaleLine.productNameSnapshot + "\0" + normalizeSku(SaleLine.skuSnapshot)
```

聚合。这是**显示和统计归并键**，不是稳定商品主键。`/inventory` 已提供精确 `productNameExact`、`skuExact`、`skuEmpty` 筛选；销售草稿页可复用库存选择器 `GET /api/inventory/selectable-for-sale`，但没有通用商品主数据选择器。

### 2.3 当前结构的边界

相同商品名称可能存在不同色号、版本、包装、泵头/配件组合和成色。现有系统仅能稳定区分名称和 SKU；`hasBox`、`isNew`、外观字段是单件验货事实，版本、配件和包装组合没有可复用的结构化字段。因此：

- 不能将商品名称字符串当作行情永久唯一键；
- 相同名称 + SKU 但版本/配件/成色不同的库存，不能无提示共享同一行情；
- 商品改名不会改变既有 `SaleLine` 快照，但会改变基于当前 `InventoryItem.name` 的统计归并结果；
- 当前没有 SKU 合并、商品改名、停用或别名的领域能力。

结论：现有结构不足以可靠承载长期跨平台行情关联；M4-A 不应直接把行情写到每件库存，也不应为此重构全部采购/库存/销售商品体系。

## 3. 推荐的最小稳定键：独立 MarketItem

### 3.1 方案选择

| 方案 | 结论 | 原因 |
|---|---|---|
| A. 商品名称 + 标准化 SKU 直接关联 Quote | 不采用 | 实施快，但没有外键；同名不同版本、配件、包装、成色会混淆。|
| B. 新增独立 `MarketItem` / `MarketQuote` | **推荐** | 以稳定内部 ID 承载行情对象，最小化影响既有商品生命周期；可表达会改变价格的版本/配件/成色。|
| C. 关联现有 Product / SKU 主数据 | 不可采用 | 当前不存在此模型与稳定 ID。|

`MarketItem` 是行情领域的内部参考对象，不是替换 `PurchaseOrderItem`、`InventoryItem` 或 `SaleLine` 的第二套全量商品主数据。仅当用户要记录/比较行情时才创建。

### 3.2 推荐字段（M4-A1 设计，尚未实施）

```text
MarketItem
- id
- ownerId
- displayName                 // 用户显示名称
- normalizedProductName       // 仅用于检索/去重，不作为跨系统永久 ID
- skuText                     // 原始显示 SKU，可空
- normalizedSku               // 使用 normalizeSku 的结果，可空
- version                     // 可空，例如第一代
- conditionDescriptor         // 可空，例如全新/轻微使用
- packageVariant              // 可空，例如有盒/无盒
- accessoryVariant            // 可空，例如含泵头/不含泵头
- identityKey                 // 服务端生成的明确人工身份键
- defaultTargetProfitAmount   // 可空 Decimal，商品级默认目标
- note, active, createdAt, updatedAt
```

推荐约束：`@@unique([ownerId, identityKey])`。`identityKey` 由服务端按明确字段生成；空字段也参与结构化编码，避免 `2C0 + 有盒` 与 `2C0 + 无盒` 被误合并。商品名不做不可解释的自动同义词/别名合并。

一个 `MarketItem` 可被多条报价、多件库存和多条历史销售通过**显式匹配或只读精确匹配**关联。M4-A1 不在 `InventoryItem`、`PurchaseOrderItem` 或 `SaleLine` 新增强制外键；M4-A4 再评估是否需要用户确认的可选映射。

## 4. 行情概念字典与可靠性

| 概念 | 含义 | 是否可作为采购试算收入 |
|---|---|---|
| 平台展示价格 | 挂牌、求购或页面展示金额；未必是最终到账。 | 否 |
| 平台预计收入 | 用户确认的预计可到账金额。 | **是** |
| 市场成交参考 | 近期成交或人工观察，仅供对比。 | 否，除非用户另录预计收入 |
| 真实销售金额 | `SaleOrder.grossAmount`，已发生销售事实。 | 不覆盖行情 |
| 真实实际到账 | `SaleOrder.actualReceivedAmount`，已发生到账事实。 | 不覆盖行情 |

所有金额必须有明确类型，禁止把它们都称为“价格”。历史行情永远不覆盖 `SaleOrder`、`SaleLine`、`InventoryItem.unitCost` 或任何售后金额。

### 4.1 来源与状态

建议 `sourceType` 预留 `MANUAL | IMPORT | AUTOMATED | SYSTEM_DERIVED`，但 M4-A V1 只允许 `MANUAL`。未来导入和自动适配器必须转换为相同 Quote DTO，不得静默覆盖人工确认记录。

可靠性推荐使用持久化状态：

```text
UNVERIFIED | CONFIRMED | INVALID
```

`STALE` 不建议持久化：它应由 `expiresAt` 与当前时间派生，避免定时任务和状态不同步。`INVALID` 永远不参与“当前行情”；`UNVERIFIED` 可以展示但不得被决策计算器默认选中；`CONFIRMED` 才可作为默认候选。

## 5. MarketQuote 最小模型与当前行情选择

### 5.1 推荐字段（设计）

```text
MarketQuote
- id, ownerId, marketItemId
- platform                    // 当前使用稳定平台代码：DEWU/NINETY_FIVE/XIANYU/OTHER
- quoteType                   // 见下表
- amount Decimal(12,2)        // 非负；含义由 quoteType 决定
- recordedAt                  // 人工观察/确认的业务时间
- expiresAt?                  // 明确有效期；为空即“未设置过期规则”
- sourceType                  // M4-A V1 仅 MANUAL
- sourceReference?            // 页面链接或人工来源说明，不可保存凭证
- externalQuoteId?            // 未来适配器预留
- rawCapturedAt?              // 未来适配器预留
- reliabilityStatus
- confirmedAt?, invalidatedAt?, invalidReason?
- note?, createdAt, updatedAt
```

金额使用 `Decimal`、数据库 `CHECK (amount >= 0)`；API 将金额序列化为字符串，时间为 ISO 字符串或 `null`。

推荐 M4-A V1 支持的类型：

| quoteType | 是否进入试算 | 说明 |
|---|---|---|
| `EXPECTED_INCOME` | 是 | 用户确认的预计到账；M4-A 的唯一收入试算输入。|
| `LISTING_PRICE` | 否 | 平台页面展示价格，仅作参考。|
| `MANUAL_REFERENCE` | 否 | 不足以归入上述两类的人工市场参考。|

`BID_PRICE`、`RECENT_TRANSACTION` 留到确有可靠来源和业务定义时再增加，避免当前把不同金额语义混用。

### 5.2 历史优先、当前派生

只保存历史 `MarketQuote`，不在 `MarketItem` 冗余保存 `currentQuote`。当前有效报价的查询规则为：

1. 同一 `ownerId + marketItemId + platform + quoteType`；
2. `reliabilityStatus = CONFIRMED`；
3. `invalidatedAt IS NULL`；
4. `expiresAt IS NULL OR expiresAt > now`；
5. 按 `recordedAt DESC`、`createdAt DESC`、`id DESC` 稳定排序。

补录历史时间允许存在，但如果不是最新有效时间，就不会成为当前报价。录错的已使用报价应标记 `INVALID` 或新增修正记录，不硬删除；被采购决策快照引用后更不得硬删除。

决策计算不允许仅提交平台并由服务悄悄选一条旧报价。M4-A V1 计算 DTO 应要求用户明确选择 `marketQuoteId`，结果回显该 Quote ID、类型、来源、记录时间和过期状态。

## 6. 平台范围

当前 `SaleOrder.platform` 是字符串字段，现有销售 API、页面和报表已稳定使用 `DEWU`、`NINETY_FIVE`、`XIANYU`、`OTHER`；平台寄送另有只含 `DEWU`、`NINETY_FIVE`、`OTHER` 的 `ShipmentPlatform` enum。

M4-A V1 行情使用销售侧的四个稳定代码并显示中文：得物、95 分、闲鱼、其他。不要把平台寄送 enum 当作行情平台全集，也不要凭空加入 `POIZON_USED` 等当前不存在的代码。后续 M4-A1 应将这四值提取为共享校验常量，避免行情、销售和报表各自扩散字符串字面量。

## 7. 预计收入、成本与目标利润

### 7.1 输入边界

M4-A V1 的权威输入仅为：

- 已明确选择的 `EXPECTED_INCOME` Quote；
- `candidatePurchasePrice`（候选采购价）；
- `expectedPurchaseExtraCost`（用户明确填写的预计运费、检查成本或其他额外采购成本）；
- `targetProfitAmount`（本次试算目标利润）。

当前没有完整、已冻结的平台费率规则。因此不能从挂牌价、历史 `SaleFeeLine` 或历史实际到账自动推导未来预计收入；如用户只知道挂牌价，应另录 `LISTING_PRICE`，并手工填写/确认预计收入后再计算。

### 7.2 公式

```text
estimatedTotalCost = candidatePurchasePrice + expectedPurchaseExtraCost
estimatedProfit    = expectedPlatformIncome - estimatedTotalCost
profitGap          = estimatedProfit - targetProfitAmount
maxPurchasePrice   = expectedPlatformIncome - expectedPurchaseExtraCost - targetProfitAmount
meetsTargetProfit  = estimatedProfit >= targetProfitAmount
```

所有服务端金额用 `Prisma.Decimal` 计算。若 `maxPurchasePrice < 0`，显示“不满足目标利润条件”，不得截断为 `0`。计算必须说明未包含未建模的费用、退回风险成本、人工成本或其他未输入成本。

### 7.3 目标利润作用域

优先级冻结为：

1. 本次计算传入的临时目标利润；
2. `MarketItem.defaultTargetProfitAmount`；
3. 无全局或平台默认值。

首版不把 80 元写死为系统默认值；UI 可以将 80 元作为示例/预填建议，必须由用户确认。未来若确需目标利润率，再单独设计，不能与固定金额混为同一规则。

## 8. 多平台比较、风险与过期

同一 `MarketItem` 可有多平台 `EXPECTED_INCOME`。页面可按当前已录入的预计利润降序展示并标记“当前已录入行情下的参考值较高”，但不得称为“最佳平台”或自动推荐执行出售。

标准 warning：

- 行情已过期，或未设置有效期；
- 行情未经确认；
- 预计收入低于候选采购价；
- 预估利润低于目标利润；
- 最高采购价为负数；
- 未填写预计额外成本；
- 商品 / SKU / 版本 / 配件 / 包装 / 成色匹配不完整；
- 预计收入为人工录入；
- 后续数据充分时，才可增加同款未售库存、历史售后净利润和退货率提示。

当前项目没有行情有效期配置体系。M4-A1 不得将天数散落在组件内；在用户未确认默认有效期前，`expiresAt` 应由用户填写或为空，并在为空时显示“未设置有效期，无法自动判断过期”。

## 9. 与库存、采购、销售的关系

| 场景 | M4-A V1 处理 |
|---|---|
| 尚未采购候选商品 | 只存在 `MarketItem` 和 `MarketQuote`，可进行独立试算。|
| 已采购/未售库存 | 仅对名称 + 标准化 SKU 完全一致且没有影响价格的未表达变体时，提供只读候选匹配；不模糊匹配。|
| 已售历史 | 通过 `SaleLine.productNameSnapshot + normalizeSku(skuSnapshot)` 只读比较；历史销售快照永不因商品改名改变。|
| 同 SKU 多件库存 | 多件可匹配同一 `MarketItem`，报价不重复写入每个库存。|
| 不同版本/包装/配件/成色 | 必须使用不同 `MarketItem`；无法精确匹配时显示“未匹配行情”。|

M4-A V1 不写采购订单，也不保存采购决策快照。待独立行情与计算稳定后，下一阶段才能设计“将已选择 Quote、预计收入、目标利润、最高采购价以不可变快照带入采购草稿”；该能力不得耦合进 M4-A1。

## 10. API 与页面设计（未实施）

### 10.1 API

```text
GET    /api/market-items
POST   /api/market-items
GET    /api/market-items/[id]
PATCH  /api/market-items/[id]

GET    /api/market-quotes
POST   /api/market-quotes
GET    /api/market-quotes/[id]
POST   /api/market-quotes/[id]/invalidate

POST   /api/market-decisions/calculate
```

所有接口从认证上下文取得 `ownerId`，拒绝客户端 `ownerId`，跨 owner 返回 404，未知字段返回 400。计算接口只读，不创建或修改 `PurchaseOrder`、`InventoryItem`、`SaleOrder`、售后或库存状态。

推荐 `POST /api/market-decisions/calculate` 输入：

```text
marketItemId
marketQuoteId
candidatePurchasePrice
expectedPurchaseExtraCost
targetProfitAmount?
```

输出必须回显：Quote、平台、预计收入、记录/过期时间、数据状态、候选价、额外成本、总成本、预计利润、目标利润、差额、最高采购价、是否满足目标及 warnings。

### 10.2 页面

| 路由 | 目的 |
|---|---|
| `/market-quotes` | 行情商品和各平台最新有效行情列表；显示来源、时间、过期和默认目标利润。|
| `/market-quotes/new` | 人工创建行情商品与报价；明确区分展示价格与预计收入。|
| `/market-items/[id]` | 围绕行情商品查看多平台报价、历史趋势、试算器、只读库存匹配与历史销售表现。|

详情应以 `MarketItem.id` 为中心，而不是单条 Quote ID。M4-A4 可复用现有 Recharts；图表数据由服务端返回，不在浏览器重算权威金额，且同一图不得混合挂牌价与预计收入。

## 11. 自动采集、通知与权限边界

未来自动适配器只能输出标准 Quote DTO，并保留来源、外部 ID、采集时间和失效/修正历史。平台不可用不能影响人工行情；自动数据不能静默覆盖人工确认记录。不得保存平台账号、Cookie、Token 或敏感凭证。

M4-A 不新增通知。后续可设计 `MARKET_QUOTE_UPDATED`、`MARKET_QUOTE_STALE`、`TARGET_PROFIT_NOT_MET`、`MAX_PURCHASE_PRICE_CHANGED` 事件，再评估日报、飞书、企微或邮件。

当前为 `APP_PASSWORD + DEFAULT_OWNER_ID` 单用户部署。M4-A 可沿用当前 owner 过滤模式，但公开多用户部署仍以 M4-E 的真实认证、角色与 owner 上下文为前置。

## 12. 验证规划（未实施）

未来 `pnpm verify:m4-market` 至少覆盖：

1. owner 隔离、跨 owner 404、客户端不能提交 ownerId；
2. 同名不同 SKU、同 SKU 不同版本/配件可区分；
3. 多平台历史、非负 Decimal、稳定的当前 Quote 选择、失效/无效排除；
4. 预计利润、最高采购价、目标差额、负最高采购价与 warnings；
5. 计算不会创建/修改采购、库存、销售、售后或 `SOLD`；
6. API 金额字符串、ISO 时间、未知字段 400、筛选分页；
7. 全中文页面、来源/时间/过期提示、筛选保持、无自动采购或平台执行建议；
8. 图表只消费服务端聚合，不混淆展示价格与预计收入。

## 13. 推荐实施刀法

1. **M4-A1**：`MarketItem`、`MarketQuote`、最小枚举/约束、纯加法 migration、`verify:m4-market` 骨架。若要建立商品稳定键，只限行情领域，不重构旧商品体系。
2. **M4-A2**：行情 Service、owner 隔离、Quote 当前选择、失效/修正、DTO 与只读查询 API。
3. **M4-A3**：目标利润/最高采购价的 Decimal 计算 Service、多平台对比与 warnings；不写采购、库存或销售。
4. **M4-A4**：行情列表、人工录入、行情商品详情、历史图表、采购参考计算器，以及严格的只读库存/销售匹配。
5. **M4-A5**：真实 UI 验收、跨页面经营口径检查、模块封板。

后续再考虑：M4-B 日经营报告、M4-C 通知、M4-D 合规平台适配层、M4-E 多用户认证与权限。

## 14. 需要用户确认的最小业务问题

1. 平台预计收入是否始终由用户直接填写确认，而不是以展示售价自动扣费推导？推荐：是。
2. 行情默认有效期策略：按平台不同天数、统一天数，还是首版只由用户填写 `expiresAt`？当前没有可复用配置。
3. 第一版是否将版本、配件、包装、成色全部视为会影响价格的独立 `MarketItem` 维度？推荐：只要影响售价就必须拆分。
4. 默认目标利润是否以 80 元作 UI 预填建议但不持久化为全局规则？推荐：是。
5. 最高采购价是否始终扣除用户明确填写的预计运费/额外成本？推荐：是。

## 15. 冻结结论

M4-A0 仅完成设计。M1～M3 继续 FROZEN；未修改 Prisma schema、迁移、`src/`、`package.json` 或数据库，也没有新增任何库存、采购、销售、利润或 `SOLD` 写入路径。
