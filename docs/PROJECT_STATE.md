# 项目当前状态

## M4-A0 商品 / SKU 行情与采购决策参考（设计冻结，未实施）

> 最后更新：2026-07-16

- 已完成商品、SKU、库存、销售快照、销售报表和现有平台值的只读审计；当前没有 `Product` / `Sku` 主数据模型或稳定 `productId` / `skuId`，商品身份由名称字符串、标准化 SKU 和历史快照组成。
- M4-A 将采用独立 `MarketItem + MarketQuote` 作为行情领域最小稳定键，不重构既有采购、库存或销售商品结构。行情只记录人工数据、历史和参考计算，不自动创建采购单、修改库存成本、销售订单、售后或任何库存状态。
- `EXPECTED_INCOME` 是采购试算唯一收入输入；展示价格、市场参考、销售成交价和实际到账保持不同口径。当前不存在权威平台费率，不能从展示价格或历史费用自动推导预计收入。
- 预计利润、目标差额与最高采购价仅使用用户确认的预计收入、候选采购价、预计额外成本和目标利润，由后续服务端 Decimal 计算；结果只供决策参考，不构成自动采购或平台推荐。
- 行情默认有效期、目标利润 80 元是否作为 UI 预填及各影响价格的版本/配件/包装/成色维度，待用户确认后才进入 M4-A1。
- 详见 [M4-A 行情与采购决策规格](./M4_MARKET_AND_PURCHASE_DECISION_SPEC.md)。M4-A1 尚未开始；M1～M3 保持 FROZEN。

## M3-D3-2 平台退回验货 Service（已完成，API/UI 未实现）

> 最后更新：2026-07-16

- `PlatformReturnInspectionService.inspectReturn` 是平台退回验货导致库存变化的唯一权威入口。调用方仅提交寄送明细、结论、库位/问题原因/备注和可选验货时间；库存、归属与寄送事实均由 Service 查询校验。
- 仅 `OWNED + RETURNED` 库存且对应 `PlatformShipmentLine.RETURNED` 可登记验货。`PENDING_DECISION` 保持库存 `RETURNED`；`RESTOCKED` 在同一 transaction 中恢复 `STOCKED` 并写入库位；`PROBLEM` 在同一 transaction 中转为问题件。ShipmentLine 始终保留 `RETURNED` 作为历史。
- 最终结论不可普通修改；相同最终请求幂等返回，不重复改库存或写日志。旧 `ShipmentService.confirmRestocked` 和 `applyShipmentLineAction("confirmRestocked")` 已全部委托该 Service，平台退回不再有直接 `RETURNED -> STOCKED` 路径。
- TodoService 已提供“平台退回途中”及“平台已退回待验货/待进一步判断”服务端待办。`RETURNING`、`RETURNED` 继续排除在销售、新寄送及常规可售候选外；历史旧流程直接重新入库记录不自动回填验货记录。
- `pnpm verify:m3d-platform-return` 已通过 89 项模型、Service、并发、幂等、旧入口、待办、候选保护和精确清理验证。未修改 Prisma schema 或 migration；M3-D3 尚未 FROZEN，正式 API 与 UI 留待后续刀次。

## M3-D3-1 平台退回验货数据模型（已完成，流程未实现）

> 最后更新：2026-07-15
> 当前阶段：**平台退回验货的数据模型、纯加法 migration 与模型级验证已完成；业务流程尚未实施。**

- 平台退回是得物/95 分等平台向用户退回自有库存的第三个独立业务域，不复用采购售后、销售售后或任一退款流水。
- 当前 M3-0 已能将 `SHIPPED`、`RECEIVED`、`IN_WAREHOUSE`、`LISTED` 或 `REJECTED` 进入 `RETURNING`，再进入 `RETURNED`；它不产生 `SOLD`。
- 当前 `confirmRestocked` 仍可将 `RETURNED` 直接恢复 `STOCKED`，属于后续 M3-D3-2 必须收口的旧路径；本轮未改动。
- 已落地 `PlatformReturnInspectionResult`、`PlatformReturnInspection` 与 `PlatformReturnActionLog`；`shipmentLineId` 全局唯一、`inventoryItemId` 非唯一，保证每次寄送周期一份当前结论，同时允许同一库存保留多个周期历史。
- `20260715153411_add_m3d_platform_return_inspection` 仅新增 enum、两张表、索引、Restrict/Cascade 外键和两项 CHECK 约束；不新增 `PlatformReturnCase` 或库存状态。
- `pnpm verify:m3d-platform-return` 已通过 44 项模型约束、跨周期历史、ActionLog、CHECK 与精确夹具清理验证。
- `RETURNED` 仍是自有待处理资产，不能进入销售/新寄送候选或常规提醒；后续应新增平台退回待验货/待决策提醒与独立统计桶。新模型本身不改变库存。
- 详见 [M3-D3 平台退回验货规格](./M3D_PLATFORM_RETURN_INSPECTION_SPEC.md)。M3-D1 和 M3-D2 保持 FROZEN。

## M3-D2-1 销售售后数据模型（已完成，流程未实现）

> 最后更新：2026-07-15
> 当前阶段：**销售售后数据模型、纯加法 migration 与模型级验证已完成**

- 销售售后独立使用 `SaleAfterSaleCase`、`SaleAfterSaleLine`、`SaleRefundRecord`、`SaleRefundAllocation`、`SaleAfterSaleInspection` 和 `SaleAfterSaleActionLog`，不复用采购售后模型或退款流水。
- `SaleAfterSaleType` 冻结为 `REFUND_ONLY | RETURN_AND_REFUND`；采购与销售领域的差异由独立 enum 类型和业务模型表达，不在 enum 值加入前缀。
- 原 `SaleOrder.status`、`actualReceivedAmount`、`settledAt` 与 `SaleLine` 销售/成本/利润快照保持不变；本刀不对 `InventoryItem` 产生任何状态或归属写入。
- `20260715084432_add_m3d_sales_after_sales_models` 仅新增 enum、表、索引和关系；`20260715084500_add_m3d_sales_after_sales_checks` 仅新增四项金额 CHECK 约束。
- `pnpm verify:m3d-sales` 覆盖模型关系、快照、唯一性、CHECK 约束、历史事实保护、精确清理和未实现能力边界。
- **尚未实现**销售售后 service、状态机、API、页面、退款额度/幂等业务规则、买家退货物流、退货验货动作、库存恢复、净到账/净利润报表口径。

## M3-D1 采购售后（已完成并冻结）

> 最后更新：2026-07-15
> 当前阶段：**采购售后业务、页面、退款净口径和跨页面追溯已完成**

- 采购售后独立使用 `PurchaseAfterSaleCase`、`PurchaseAfterSaleLine`、`PurchaseRefundRecord`、`PurchaseRefundAllocation` 和 `PurchaseAfterSaleActionLog`，不与销售售后共用模型或流水。
- 支持仅退款和退货退款；组合采购可只选择部分问题件，每件退款必须由用户明确填写，不自动平均或按比例分摊。
- `PurchaseAfterSalesService` 是采购售后写操作唯一入口，覆盖草稿、提交、卖家审核、寄回物流、卖家签收、实际退款、完成和取消；页面与 API 均已落地。
- 原始 `paidTotal`、成本分摊、库存成本和 `PurchaseAfterSaleLine.costAmountSnapshot` 永不覆盖。`totalPurchaseRefundedAmount` 为订单全部 `PurchaseRefundRecord.refundAmount` 的只读合计；`netPurchasePaidAmount = paidTotal - totalPurchaseRefundedAmount`。
- 行级 `allocatedRefundAmount` 只读取 `PurchaseRefundAllocation.amount` 合计；`netCashCost = costAmountSnapshot - allocatedRefundAmount`，可为负数，且当前不含退货运费或其他售后费用。
- 仅退款完成后库存仍为 `OWNED + PROBLEM`；退货退款完成后为 `RETURNED_TO_UPSTREAM_SELLER + PROBLEM`。非 OWNED 库存不参与当前库存资产、销售、寄送、提醒和未售 SKU 成本统计。
- 销售售后与平台退回验货尚未实施。`ItemStatus`、采购 `paidTotal`、`SalesService` 和 M3-0 状态机未因本阶段改变。
- `pnpm verify:m3d-purchase` 覆盖退款额度、幂等、资产归属、派生净口径、跨页 DTO 和精确测试数据清理。

## ItemStatus enum retirement rehearsal

The current Prisma `ItemStatus` contract contains exactly: `PENDING_INSPECTION`, `STOCKED`, `PLATFORM_SHIPPED`, `PLATFORM_RECEIVED`, `PLATFORM_IN_WAREHOUSE`, `PLATFORM_LISTED`, `PLATFORM_REJECTED`, `RETURNING`, `RETURNED`, `SOLD`, and `PROBLEM`.

`LISTED`, `IN_BATCH`, `SHIPPED_TO_WAREHOUSE`, `WAREHOUSE_RECEIVED`, `INBOUND_SUCCESS`, `INBOUND_FAILED`, `PENDING_SETTLEMENT`, and `SETTLED` are retired InventoryItem enum values. They remain only as raw historical snapshot/audit strings. `REMOVED` remains future work and is not in the V1 schema. `SaleOrder.SETTLED` and `PlatformShipmentLine.LISTED` are separate enums and remain supported.

> 最后更新：2026-07-14
> 当前阶段：**M3-C V1 销售到账管理与跨页面一致性已完成并冻结**

## 当前阶段

### ItemStatus 状态契约（V1）

`src/lib/inventory-item-status-contract.ts` 为当前 V1 的唯一状态契约来源。旧 enum 状态已从 Prisma `ItemStatus` 安全退役，仅允许作为历史 `SaleLine.preSaleItemStatus` 字符串被审计和拦截；通用库存 PATCH、销售、寄送、提醒与 SKU 汇总均不提供旧状态入口。`pnpm verify:item-status-contract` 覆盖当前契约与历史快照保护。

Prisma `ItemStatus` 的正式状态为：PENDING_INSPECTION、STOCKED、PLATFORM_SHIPPED、PLATFORM_RECEIVED、PLATFORM_IN_WAREHOUSE、PLATFORM_LISTED、PLATFORM_REJECTED、RETURNING、RETURNED、SOLD、PROBLEM。

`REMOVED / 已移出` 为后续预留状态，当前 V1 未实现，不提供页面筛选、API 写入或汇总统计。

M3-A V1 已完成，系统包含 9 大模块：采购订单、成本分摊、Mock物流、验货、库存、工作台待办、待办处理业务闭环、平台寄送批次、销售出库/到账/利润计算。

**严格禁止**：进入 M3-B/退款退货自动流程、真实平台接口、OCR、自动推荐平台。M3-0 任何操作不能把库存改成 SOLD；SOLD 唯一入口是 M3-A `SalesService.confirm`。

### M3-A V1 销售出库 / 到账 / 利润计算 ✅

- SaleOrder / SaleLine / SaleFeeLine 模型已落地
- `SalesService.createDraft / confirm / settle / cancel`
- sales API：列表、详情、创建草稿、确认销售、登记到账、取消销售
- `/sales` 列表页、`/sales/new` 创建销售草稿、`/sales/[id]` 详情页和操作区
- `/inventory/[id]` 库存详情销售追溯
- `/purchases/[id]` 采购订单详情销售追溯和订单级销售汇总
- SOLD 唯一入口：`SalesService.confirm`
- DRAFT 不占用库存、不改变库存状态；confirm 时刷新销售前状态快照
- cancel CONFIRMED 按 `preSaleItemStatus / preSaleSaleMode / preSaleStorageLocation` 恢复，不默认回 STOCKED
- SETTLED V1 禁止取消
- DRAFT / CANCELLED 不计入已售汇总
- PLATFORM_LISTED / PLATFORM_IN_WAREHOUSE / PLATFORM_RECEIVED 不等于 SOLD
- verify:m3a 覆盖销售、利润、取消、SOLD 提醒排除、追溯统计和 API 半更新防护

### M3-0 平台寄送批次 ✅

- 草稿批次（DRAFT）+ 确认发货（confirm-shipped）
- 7 个行级动作 API：签收/入仓/上架/拒收/退回中/已退回/重新入库
- 统一状态机 `src/lib/shipment-status-machine.ts`
- 统一执行函数 `src/server/shipments/applyShipmentLineAction.ts`
- 寄送批次列表 + 新建 + 详情页
- 库存选择器（搜索/分组/批量选择/筛选/分页）
- 库存详情平台寄送追溯卡片
- 状态文案统一（formatItemStatus/formatLineStatus/formatBatchStatus 等）
- verify:m30 验证脚本（15 checks）
- M3-0 全流程不产生 SOLD

## 核心开发原则

以后修任何问题必须遵守：

1. **不能只修表面 UI**。按钮显示、loading 状态、错误提示只是表象。
2. **必须修完整业务闭环**，逐层检查：
   - 用户动作 → 真实业务含义
   - 数据库字段变化 → API 处理
   - 页面同步 → 待办/统计重新计算
   - 边界情况 → 验收标准
3. **任何 async 函数必须有 try/catch/finally**，finally 中复位 loading 状态。
4. **任何 fetch/API 调用必须有 error state UI**，不能永久空白或永久 loading。
5. **修改业务数据后必须同步所有展示位置**：列表、详情、工作台、待办计数。
6. **加了新字段必须贯穿全链路**：schema → API → service → 前端表单 → 列表 → 详情 → 搜索 → 测试。
7. **修改后必须运行全部验证命令**，缺一不可。

## 已完成模块

### M1：采购订单与成本分摊 ✅

- 采购订单 CRUD（创建、编辑、删除）
- 一单多货 + 附件上传
- 成本分摊（一单一商品自动分摊，多商品手动分摊）
- 删除保护（已进入后续流程的订单不可删除）
- 验证脚本：`pnpm verify:m1`（9 checks）

### M2-A：采购物流 ✅

- Mock 物流适配器（DELIVERED1=签收、EXCEPTION2=异常、STALLED3=停滞）
- 物流信息保存、刷新
- 签收后自动生成待验货记录
- 手动标记已签收兜底
- 验证脚本：`pnpm verify:m2a`（7 checks）

### M2-B：验货与库存 ✅

- 手机验货向导（6 步）
- 单件库存生成（成本按数量拆分）
- 库存列表、库存详情、库位管理
- 已完成验货编辑（同步更新 InventoryItem）
- 验证脚本：`pnpm verify:m2b`（9 checks）

### M2-B：工作台待办与业务闭环 ✅

- 待办中心：动态提醒卡片 + 已阅读 + 业务处理菜单
- 效期提醒规则（普通 395/365 天规则 + 95分 90/60 天独立规则）
- 动态处理动作矩阵（根据 todoType + saleMode + itemStatus + daysRemaining）
- 出售方式 saleMode 修改
- ReminderState（snooze/resolve + reasonKey 防误隐藏）
- InventoryActionLog（业务动作追溯）
- TodoResolution（预警阶段已处理，不同阶段互不影响）
- PurchaseOrder 新增 sellerNickname
- 搜索支持订单号、卖家昵称、商品名、SKU
- 统计卡片可点击跳转筛选页
- 库存详情→采购订单 returnTo 返回导航

## 当前不可修改的约束

- **不做后续退款/退货流程**：M3-A、M3-B V1 报表与 M3-C 到账管理已冻结；不得在未单独确认的情况下扩展退款、退货或真实平台同步。
- **不接真实物流接口**：继续使用 MockLogisticsAdapter
- **不做 OCR**
- **不做自动判断和平台推荐**
- **SaleMode / LocationStatus / ItemStatus 字段含义不得更改**
- **成本分摊规则不变**：`paidTotal = totalAmount + shippingAmount`，分摊合计必须等于 paidTotal
- **单件成本拆分规则不变**：余数分配到最后一件
- **已签收待验货流程不变**：签收→PENDING_INSPECTION→验货→生成库存

## 当前数据模型（已落地）

| 模型 | 用途 |
|------|------|
| PurchaseOrder | 采购订单（含物流字段、sellerNickname） |
| PurchaseOrderItem | 商品明细（含 allocatedTotalCost） |
| Attachment | 附件（PURCHASE_ORDER / PURCHASE_ORDER_ITEM / INSPECTION） |
| LogisticsEvent | 物流事件记录 |
| Inspection | 验货记录 |
| InventoryItem | 单件库存（locationStatus、saleMode、itemStatus、storageLocation） |
| ReminderState | 提醒隐藏/已处理状态（snooze + reasonKey） |
| InventoryActionLog | 库存业务处理追溯 |
| TodoResolution | 预警阶段处理记录 |
| SaleOrder | 销售订单（DRAFT / CONFIRMED / SETTLED / CANCELLED） |
| SaleLine | 销售明细，保存库存成本和销售前状态快照 |
| SaleFeeLine | 销售费用明细 |
| SaleActionLog | 销售动作记录 |

## 下一步

- M3-C V1 已冻结；下一步如需退款/退货、真实平台同步或新的财务能力，必须单独冻结规格。

## 下一阶段

**后续候选**：退款/退货、真实平台接口或更复杂财务能力。进入前必须重新冻结规格。

## 验证命令

```bash
pnpm prisma migrate dev
pnpm prisma db seed
pnpm lint
pnpm test
pnpm build
pnpm verify:m1
pnpm verify:m2a
pnpm verify:m2b
pnpm verify:m30
pnpm verify:m3a
```

## M3-C V1 销售到账管理（已完成并冻结）

详见 `docs/M3C_V1_SPEC.md`。

- `GET /api/sales/settlements` 与 `/sales/settlements` 提供待到账、已到账的只读查询和到账登记入口。
- `/sales/[id]` 已对齐到账能力：CONFIRMED 可登记到账，SETTLED 可修改到账金额并展示到账时间、到账备注和操作日志。
- `actualReceivedAmount` 是实际到账；`expectedIncome` 是预计收入；`grossAmount` 是成交价，三者不得混用。
- `SalesService.settle` 重算既有利润并持久化到 `SaleLine.profitAmount`；二次登记不覆盖首次非空 `settledAt`。
- 到账不修改库存；SOLD 的唯一写入入口仍为 `SalesService.confirm`；SETTLED 仍禁止取消。
- 销售详情、销售列表、销售报表、库存追溯与采购追溯均重新读取最新持久化到账和行利润。
- 采购订单销售汇总对组合销售按 `SaleOrder.id` 去重，订单级成交价和实际到账不会因多条 `SaleLine` 重复累计。
- `verify:m3c` 已覆盖到账、利润持久化、库存不变、跨列表/报表/追溯一致性及组合销售去重。

## M3-D1-3 采购售后 API（已完成）

- `PurchaseAfterSalesService` 仍是采购售后写操作的唯一入口；采购售后 API、只读查询 DTO 与页面工作台均已完成。
- API 包含列表、详情、可发起问题件、草稿创建/编辑、提交、卖家审核、退回物流、退款、完成和取消。
- DTO 使用金额字符串与 ISO 时间，查询和写入均固定当前 owner；未授权或跨 owner 访问统一按 404 处理。
- 采购退款不覆盖 `PurchaseOrder` 原始实付、成本分摊、验货快照或 `InventoryItem.itemStatus`。

## M3-B V1 商品 / SKU 利润分析（已完成）

- 新增 `GET /api/reports/sales/products` 与 `/reports/sales/products`，仅聚合 `CONFIRMED / SETTLED` 的销售快照。
- 以 `SaleLine.productNameSnapshot + normalizeSku(skuSnapshot)` 聚合；组合销售的销售单数按订单去重，已售件数按明细计数。
- 成本和利润读取已保存的行快照；不读取当前库存成本，不重算利润，不分摊订单级实际到账到 SKU。
- 任一行没有可靠 `saleAmount` 时，SKU 成交价与毛利率显示为暂无可靠行级成交金额。
- 商品行可精确跳转销售明细和当前库存；所有报表页面与接口保持只读，未新增 SOLD 写入路径。
## M3-D2-3 销售售后 API（已完成）

- `GET /api/sales-after-sales`、`GET /api/sales-after-sales/[id]` 与 `GET /api/sales-after-sales/eligible-lines` 提供按 owner 隔离、金额 JSON-safe 的查询 DTO。
- 所有销售售后写操作仍只委托 `SalesAfterSalesService`；路由不直接更新 `InventoryItem`、`SaleOrder` 或 `SaleLine`。
- 浏览器验证已改为在临时 `APP_BASE_URL` 通过 `/access` 建立真实会话，M3-B/M3-C 不再依赖未授权的代理假设。

## M3-D2-4 销售售后页面工作台（已完成）

- 新增 `/sales-after-sales`、`/sales-after-sales/new`、`/sales-after-sales/[id]`，并在导航、销售详情和库存详情中提供明确的销售售后入口与追溯。
- 页面通过既有销售售后 API 和 `availableActions` 工作；不直接访问 Prisma、不直接更新库存、销售订单、销售快照、实际到账或利润。
- 页面将原始销售事实与售后派生金额分开显示；退款金额按 `SaleRefundRecord` 只统计一次，allocation 只表达商品归属。
- 买家退货运输、收货和验货阶段明确展示库存仍为 SOLD；只有既有 service 的 `complete` 事务会按验货结论恢复 STOCKED 或 PROBLEM。
- M3-B 的售后净利润报表口径仍未实施；M3-D1 采购售后继续 FROZEN。

## M3-D2-2 销售售后服务（已完成 service 层）

- 新增 `SalesAfterSalesService` 与独立规则模块，支持草稿、提交、批准、拒绝、仅退款、退货物流、退货验货、退款登记、完成和取消。
- 售后只允许 `SETTLED` 且实际到账金额大于 0 的销售订单；`DRAFT`、`CONFIRMED`、`CANCELLED` 不可发起。
- 使用 owner 隔离、Serializable 事务、行锁、P2034 有界重试和退款幂等键保护订单级、行级退款上限。
- 退货运输、收货和验货阶段库存保持 `SOLD`；完成时仅在同一事务中将选中且验货通过的库存改为 `STOCKED`，问题件改为 `PROBLEM`，不改变 `InventoryOwnershipStatus`。
- 仅退款完成不恢复库存；原 `SaleOrder`、`SaleLine` 快照、到账和利润字段不被售后覆盖。
- `SalesService.settle` 增加已完成退款及进行中已批准退款的最低到账保护，不引入新的 SOLD 写入路径。
- `pnpm verify:m3d-sales` 已覆盖真实 service 生命周期和库存边界，当前通过 66 项检查；API/UI 仍留待后续刀次。

## M3-D2-5 销售售后财务与报表封板（已完成并冻结）

- 共享只读聚合层统一订单/行级退款、净到账、恢复库存成本和售后净利润。
- 销售详情、售后详情、库存/采购追溯和 M3-B 报表复用同一派生口径；退款记录按订单去重，行级退款只读明确分配。
- M3-B 总览和 SKU 分析增加售后净指标与只读图表。实际到账不分摊到 SKU，退款趋势按退款登记时间归属。
- 不修改原销售事实、库存状态机、M3-0 或采购售后；未建模的退货运费和额外售后费用不计入当前净利润。
# M3-D3-3 (historical milestone, superseded by M3-D3-5): Platform return inspection API and query DTOs

- Added read-only platform-return history, pending, and detail APIs plus a strict inspection write API.
- All inspection writes delegate to `PlatformReturnInspectionService`; API routes do not directly write inventory, inspections, action logs, or shipment lines.
- The legacy confirm-restocked endpoint remains compatible but is deprecated and delegates through the same service.
- M3-D3 has no dedicated UI workbench yet and is not frozen.

## M3-FINAL-0 最终审计（2026-07-16）

- M1～M3 主链、三类退回边界、金额口径、写入所有权、报告去重与验证覆盖已完成只读审计，详见 `docs/M1_M3_FINAL_AUDIT.md`。
- M1、M2-A、M2-B、M3-0、M3-A、M3-B、M3-C、M3-D1、M3-D2、M3-D3 保持 FROZEN；M4 尚未开始。
- 当前系统是 `APP_PASSWORD` 保护的单用户部署，API 使用 `DEFAULT_OWNER_ID`；真实多用户认证、角色和账户隔离属于后续 M4-E，不得误标为已完成。
- 平台寄送/退回费用已可记录，但尚未纳入库存成本或销售/售后净利润分摊；当前报表口径不包含这些未建模费用。

# M3-D3-4 (completed): Platform return inspection workbench

- Added platform-return list and detail pages, navigation, todo entry points, shipment-batch links, and inventory multi-cycle return traceability.
- All pages render Chinese business labels and keep ShipmentLine historical `RETURNED` separate from the InventoryItem current state.
- The only UI write is the existing platform-return inspection API. There is no page-level Prisma access, inventory status write, new SOLD write, or legacy confirm-restocked invocation.

## M3-D3-5（已完成并冻结）：平台退回资产统计与跨页面验收

- 新增只读 `GET /api/platform-returns/summary` 与统一服务端聚合；资产按当前 `InventoryItem.id` 去重，退回历史按 `PlatformShipmentLine.id` 计数，金额只使用 `unitCost` 的 Decimal 字符串。
- `RETURNING + OWNED` 为退回途中资产；`RETURNED` 未验货或待进一步判断为已退回待处理资产；待进一步判断是子集，不重复计入资产合计。`RESTOCKED + STOCKED` 回归正常本地资产，平台退回 `PROBLEM` 单独展示。
- 平台退回页、库存资产口径、首页三项退回入口、待办、寄送详情与库存多周期追溯使用一致的当前状态/历史周期事实。旧版直接入库只做历史提示，不生成伪造验货或待办。
- `verify:m3d-platform-return` 已完成正常寄送前置、两次退回周期、资产去重、旧版兼容、刷新和真实浏览器跨页面验收。M3-D3 现已 FROZEN；M3-D1 / M3-D2 继续 FROZEN。
