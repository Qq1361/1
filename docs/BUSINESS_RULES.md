# 业务规则

## M5-A1 采购订单商品明细维护

- 采购订单创建后可以添加、编辑和删除商品明细；最后一条明细不得删除。
- `PurchaseOrderItem.referenceAmount` 只表示该明细整条商品的参考成交总额，可空、非负、最多两位小数。它不等于单件价格、订单实付、运费、分摊成本、库存成本或采购退款净实付。
- 参考成交总额仅作明细参考，不参与 `PurchaseOrder.totalAmount`、`shippingAmount`、成本分摊、库存成本、采购退款和经营日报；数量变化不自动修改它。
- 明细服务端写入统一使用严格 Decimal 字符串校验，拒绝未知字段、科学计数法、NaN、Infinity、负数和超过两位小数的值。
- 已付款不自动锁定明细；成本分摊、库存、验货、采购售后或采购退款产生后，服务端守卫拒绝继续修改。页面不得绕过服务端守卫。

## M4-A 行情与采购决策参考（M4-A3 API 已完成）

- 行情是人工记录和经营参考，不是采购、库存、销售或售后的权威事实。系统不自动判断是否采购、不自动推荐出售平台、不自动创建采购订单，也不修改库存成本、销售利润或库存状态。
- 行情 API 继续由 `APP_PASSWORD` 保护。客户端不得提交 `ownerId`、标准化字段、来源类型或确认/失效时间；参数错误为 400，跨 owner 为 404，并发报价修正冲突为 409。
- 报价修正只能在一个事务中失效旧 Quote 并创建新 Quote；确认和同原因失效允许幂等重试。API 不直接访问 Prisma 写入，也不绕过 Market Service。
- 当前没有 `Product` / `Sku` 主数据。行情不得仅以商品名称作为永久唯一键；M4-A1 已采用独立 `MarketItem`，使用用户明确的版本、成色、包装和配件维度区分会影响价格的商品。
- 平台展示价格、`EXPECTED_INCOME`、`SaleOrder.grossAmount` 与 `SaleOrder.actualReceivedAmount` 必须分开命名和展示。采购试算只使用用户确认的 `EXPECTED_INCOME`，不从展示价格、历史 `SaleFeeLine` 或历史到账自动扣费推导。
- `estimatedProfit = expectedPlatformIncome - candidatePurchasePrice - expectedPurchaseExtraCost`；`maxPurchasePrice = expectedPlatformIncome - expectedPurchaseExtraCost - targetProfitAmount`。金额必须由服务端 Decimal 计算；负最高采购价不得截断为 0。
- 行情只保存历史 Quote；当前有效 Quote 从已确认、未失效、未过期记录中按 `recordedAt`、`createdAt`、`id` 倒序派生。决策计算必须回显用户明确选择的 Quote，不得静默选用旧行情。
- `MarketQuote` 仅允许人工 `MANUAL` 来源，使用 `MarketPlatform`、`MarketQuoteType` 和 `MarketQuoteSourceType` 独立 enum。Quote 历史通过 `MarketItem` Restrict 关系保留；创建、确认、失效、修正和 owner 隔离查询只能经过 M4-A2 Service。未来导入或自动适配器必须转为同一 Quote DTO，不得存储平台账号、Cookie 或 Token，也不得静默覆盖人工确认记录。
- 行情商品名称由 Service 做 NFKC、trim、连续空白压缩和仅英文小写的 normalizedName；SKU 必须复用既有 `normalizeSku`。同名同规格只提示疑似重复，系统不得自动合并。
- 当前有效 Quote 必须已确认、未失效、未过期且 `recordedAt <= asOf`，并按 `recordedAt`、`createdAt`、`id` 倒序稳定选择。未确认、已失效或已过期的记录仅作为历史，不得伪装为当前行情。
- Quote 纠错只能通过失效旧记录并创建替代记录完成；相同失效原因可幂等重试，不同原因必须冲突，不能覆盖历史原因。

## M3-D3-2 平台退回验货 Service 规则

- `PlatformReturnInspectionService.inspectReturn` 是平台退回验货导致库存变化的唯一权威入口。调用方只能提供 `shipmentLineId`、结论、库位/问题原因/备注与可选验货时间；库存、归属和寄送状态由 Service 查询并校验。
- 仅 `OWNED + RETURNED` 库存与对应 `PlatformShipmentLine.RETURNED` 可登记验货。`PENDING_DECISION` 保持库存 `RETURNED`；`RESTOCKED` 在同一 transaction 中更新为 `STOCKED` 并写入库位；`PROBLEM` 在同一 transaction 中更新为 `PROBLEM`。所有结果均不改变库存归属、销售订单、采购/销售售后或退款流水。
- `PlatformShipmentLine` 永远保留 `RETURNED`，这是本次平台寄送退回的历史事实。最终结论不可普通修改；相同最终请求仅幂等返回，不重复改库存或写日志。
- `confirmRestocked` 仅保留兼容入口，必须委托平台退回验货 Service 并生成 `PlatformReturnInspection` 与 `PlatformReturnActionLog`；不再存在平台退回直接 `RETURNED -> STOCKED` 写入路径。
- `RETURNING` 为“平台退回途中”待办；`RETURNED` 且无验货记录或为 `PENDING_DECISION` 为“平台已退回待验货/待进一步判断”待办。两者均不能进入销售、新平台寄送或常规可售候选。历史旧流程直接重新入库记录不自动回填验货记录。

## M3-D2-1 销售售后模型边界（已冻结）

- 销售售后使用独立的 `SaleAfterSaleCase`、`SaleAfterSaleLine`、`SaleRefundRecord`、`SaleRefundAllocation`、`SaleAfterSaleInspection` 与 `SaleAfterSaleActionLog`，不得复用采购售后表或 `PurchaseRefundRecord`。
- `SaleAfterSaleType` 只使用 `REFUND_ONLY` 和 `RETURN_AND_REFUND`。采购与销售售后的差异由独立 enum 类型和业务模型表达，不在 enum 值中添加 `PURCHASE_` 或 `SALE_` 前缀。
- 原销售事实保持不变：不扩展 `SaleOrder.status`，不覆盖 `actualReceivedAmount`、`settledAt` 或 `SaleLine` 的销售、成本、利润快照。
- 本刀只保存销售售后模型；不实现 service、状态机、API、页面、退款动作、买家退货物流、验货动作或库存恢复。`InventoryItem` 在本刀不发生任何写入。

## M3-D1 采购售后规则（已冻结）

- 只有已完成验货的 `PROBLEM + OWNED` 库存可发起采购售后。`DRAFT` 不占用库存；`REQUESTED` 至 `REFUNDED` 占用被选择库存。
- 支持 `REFUND_ONLY` 与 `RETURN_AND_REFUND`；组合采购必须显式选择售后商品并逐件填写退款，未选择商品不受影响。
- 所有批准与实际退款用 Decimal 处理。订单级真实退款仅汇总 `PurchaseRefundRecord.refundAmount`，不因多个 Allocation 重复计算；累计退款及待退款额度不得超过不可变的原 `paidTotal`。
- `netPurchasePaidAmount = paidTotal - totalPurchaseRefundedAmount`。行级 `allocatedRefundAmount` 仅汇总其 Allocation；`netCashCost = costAmountSnapshot - allocatedRefundAmount`，允许为负，不包含退货运费或其他售后费用。
- 仅 `markReturnShipped` 与 `markSellerReceived` 改变资产归属，且都保持 `itemStatus=PROBLEM`。仅退款完成后仍为 OWNED；退货退款完成后为已退回上游卖家，不计入当前资产或可售统计。
- 已有采购售后 API 与页面均通过 `PurchaseAfterSalesService`；销售售后和平台退回验货仍未实现。

## InventoryItem enum retirement

The formal V1 `ItemStatus` set is `PENDING_INSPECTION`, `STOCKED`, `PLATFORM_SHIPPED`, `PLATFORM_RECEIVED`, `PLATFORM_IN_WAREHOUSE`, `PLATFORM_LISTED`, `PLATFORM_REJECTED`, `RETURNING`, `RETURNED`, `SOLD`, and `PROBLEM`.

## M3-D3 平台退回验货（设计冻结）

平台退回是平台把用户自有库存退回用户，不是采购售后（退回上游卖家），也不是销售售后（买家退回用户）。它不得使用采购/销售售后 Case、退款流水或 `InventoryOwnershipStatus.RETURNING_TO_UPSTREAM_SELLER`。

当前 M3-0 的 `RETURNING`、`RETURNED` 是平台退回物流与收到后的库存事实；`PlatformShipmentLine.RETURNED` 必须保留为这次寄送退回的历史。M3-D3-1 已落地独立 `PlatformReturnInspection` 与 `PlatformReturnActionLog`，每条 ShipmentLine 一份当前结论，ActionLog 记录判断历史；当前模型不能自动改库存。后续 M3-D3-2 才通过专用 service 决定 `RETURNED -> STOCKED`、`RETURNED -> PROBLEM` 或继续 `RETURNED`，不新增 ItemStatus，不写 SOLD，不改销售、采购退款或库存归属。详细规则见 `docs/M3D_PLATFORM_RETURN_INSPECTION_SPEC.md`。

The retired InventoryItem values `LISTED`, `IN_BATCH`, `SHIPPED_TO_WAREHOUSE`, `WAREHOUSE_RECEIVED`, `INBOUND_SUCCESS`, `INBOUND_FAILED`, `PENDING_SETTLEMENT`, and `SETTLED` must never be offered by UI, API filters, or status writers. Historical `SaleLine.preSaleItemStatus` strings are still guarded to prevent unsafe automatic restoration. Any future `REMOVED` design requires a migration, explicit entry and recovery rules, action logs, reminder exclusions, sales/shipment restrictions, API validation, and verification coverage.

> 当前阶段：M3-C V1 销售到账管理与跨页面一致性已完成并冻结
> 修改任何逻辑前请先读此文件。

---

## InventoryItem 状态写入契约

- 当前 V1 正式状态仅为：`PENDING_INSPECTION`、`STOCKED`、`PLATFORM_SHIPPED`、`PLATFORM_RECEIVED`、`PLATFORM_IN_WAREHOUSE`、`PLATFORM_LISTED`、`PLATFORM_REJECTED`、`RETURNING`、`RETURNED`、`SOLD`、`PROBLEM`。
- `LISTED`、`IN_BATCH`、`SHIPPED_TO_WAREHOUSE`、`WAREHOUSE_RECEIVED`、`INBOUND_SUCCESS`、`INBOUND_FAILED`、`PENDING_SETTLEMENT`、`SETTLED` 仅作历史读取兼容，禁止新增写入。
- 通用 `PATCH /api/inventory/[id]` 仅更新 `saleMode`、`storageLocation`，不得修改 `itemStatus`。状态变化必须由验货、平台寄送、重新入库或销售专用服务完成。
- 旧状态不得参与销售、寄送、提醒或 SKU 正常统计；SKU 汇总单独返回 `legacyStatusCount`。
- `InventoryItem.SETTLED` 不等于 `SaleOrder.SETTLED`；`InventoryItem.LISTED` 不等于寄送行 `LISTED`。
- 删除历史 enum 前，必须完成所有环境的数据审计、迁移方案、专用 API 校验与 verify 覆盖。

## 0. 核心规则

修问题不能只修表面 UI，必须检查完整链路：
1. 用户动作 → 真实业务含义
2. 数据库字段变化 → API 处理
3. 页面同步 → 待办/统计重新计算
4. 边界情况 → 验收标准

---

## 1. 采购订单

### 状态流转
```
PAID → WAITING_SHIPMENT → IN_TRANSIT → PENDING_INSPECTION → PARTIALLY_STOCKED → STOCKED
```

### 删除规则
- 仅允许删除 `PAID` 或 `WAITING_SHIPMENT` + 无 `shippedAt`/`deliveredAt`
- 已进入后续流程的前端隐藏删除按钮，显示不可删除说明
- 后端仍保留防护

---

## 2. 成本分摊

- `paidTotal = totalAmount + shippingAmount`
- 分摊合计 = paidTotal 才能确认
- 一单一商品自动分摊确认
- 单件成本 = allocatedTotalCost / quantity，余数归最后一件

---

## 3. Mock 物流

| 单号 | 状态 |
|------|------|
| 尾号1或含DELIVERED | DELIVERED → PENDING_INSPECTION |
| 尾号2或含EXCEPTION | EXCEPTION |
| 尾号3或含STALLED | STALLED |
| 其他 | IN_TRANSIT |

---

## 4. 验货

- 6 步向导，isNew=true 跳过瑕疵字段
- PASS→STOCKED，PROBLEM→PROBLEM
- 成本分摊未确认不能完成验货
- 编辑已完成验货同步更新 InventoryItem

---

## 5. 库存

### 关键字段
- `locationStatus`：LOCAL / DEWU_WAREHOUSE / RETURNING / SOLD
- `saleMode`：NONE / DEWU_LIGHTNING / DEWU_STANDARD / NINETY_FIVE / XIANYU / OTHER
- `itemStatus`：PENDING_INSPECTION / STOCKED / PLATFORM_SHIPPED / PLATFORM_RECEIVED / PLATFORM_IN_WAREHOUSE / PLATFORM_LISTED / PLATFORM_REJECTED / RETURNING / RETURNED / SOLD / PROBLEM
- `storageLocation`：用户填写的实际库位

### saleMode 修改
- 库存详情页可修改
- 工作台待办"处理"菜单可快速修改
- SOLD 不允许通过通用库存更新修改
- 修改后写入 InventoryActionLog

---

## 6. 效期提醒规则

### 普通库存（saleMode != NINETY_FIVE）

| 剩余天数 | TodoType | 标题 | 优先级 |
|---------|----------|------|--------|
| > 402 天 | — | — | — |
| 396～402 | DISTANCE_TO_395_WITHIN_7_DAYS | 距离395天门槛不足7天 | 4 |
| 376～395 | EXPIRY_UNDER_395 | 效期低于395天 | 3 |
| 366～375 | DISTANCE_TO_365_WITHIN_10_DAYS | 距离365天门槛不足10天 | 2 |
| ≤ 365 | EXPIRY_UNDER_365 | 效期低于365天 | 1 |

每件库存同一时间只显示一个最高优先级。

### 95分库存（saleMode = NINETY_FIVE）

| 剩余天数 | TodoType | 标题 |
|---------|----------|------|
| ≤ 60 | NINETY_FIVE_EXPIRY_UNDER_60 | 95分效期低于60天 |
| 61～90 | NINETY_FIVE_EXPIRY_UNDER_90 | 95分效期接近限制 |

95分不显示任何 395/365 规则提醒。

### 不提醒条件
- itemStatus = PROBLEM / SOLD
- saleMode = XIANYU / OTHER（暂无专用规则）

---

## 7. 待办处理规则

### 动作分类

| 动作 | 改业务数据 | 写 ActionLog | 写 TodoResolution |
|------|-----------|-------------|-------------------|
| 已阅读（snooze 24h） | 否 | 否 | 否 |
| 业务处理（改 saleMode 等） | 是 | 是 | 否 |
| 预警解决（writesResolution） | 是/否 | 是 | 是 |

### 核心原则
- **已阅读只隐藏 24 小时，不改业务数据**
- **业务处理动作必须真实修改 InventoryItem**
- **预警处理不永久屏蔽后续更强风险**
- 不同 todoType 是不同阶段，TodoResolution 按 `todoType + reasonKey` 独立

### 动态动作矩阵

动作根据 `todoType + saleMode + itemStatus + daysRemaining` 动态生成：

| 待办类型 | 首要动作 | 禁止动作 |
|---------|---------|---------|
| DISTANCE_TO_395_WITHIN_7_DAYS | 已安排得物闪电 | — |
| EXPIRY_UNDER_395 | 改走得物普通 | 已安排得物闪电 |
| DISTANCE_TO_365_WITHIN_10_DAYS | 已降价普通出售 | — |
| EXPIRY_UNDER_365 | 转95分(>90天) | 已降价普通出售、改走得物普通 |
| NINETY_FIVE_EXPIRY_UNDER_90 | 95分降价出售 | 放到95分 |
| NINETY_FIVE_EXPIRY_UNDER_60 | 转闲鱼 | 放到95分、95分降价出售 |

### 隐藏规则
- 已是某 saleMode → 不显示对应动作
- itemStatus = PROBLEM → 不显示标记问题件
- 已过门槛 → 不显示该平台动作

### reasonKey 规则
- 库存类：`saleMode:expiryDate:itemStatus`
- 物流类：`LOGISTICS:logisticsStatus`
- 待验货类：`INSP:inspectionId:PENDING`
- 业务状态变化 → reasonKey 变化 → 旧 snooze/resolve 自动失效

---

## 8. 限制

- 不做 M3-B 退款退货自动流程
- 销售报表已在 M3-B V1 落地，但不扩展自动同步平台账单、复杂财务系统或税务报表
- 不接真实物流
- 不接真实平台接口
- 不做 OCR
- 不自动推荐平台

---

## 9. M3-0 平台寄送状态规则

### 状态对应

| lineStatus | itemStatus | 中文 |
|-----------|-----------|------|
| DRAFT | STOCKED | 已入库（草稿占用） |
| SHIPPED | PLATFORM_SHIPPED | 已发往平台 |
| RECEIVED | PLATFORM_RECEIVED | 平台已签收 |
| IN_WAREHOUSE | PLATFORM_IN_WAREHOUSE | 入仓成功/鉴别通过 |
| LISTED | PLATFORM_LISTED | 平台已上架/可售 |
| REJECTED | PLATFORM_REJECTED | 平台拒收 |
| RETURNING | RETURNING | 退回中 |
| RETURNED | RETURNED | 已退回，待重新入库 |
| confirmRestocked | STOCKED | 已入库（line 保持 RETURNED） |

### 关键规则

1. **M3-0 任何操作不产生 SOLD**。SOLD 只能由后续 M3-A 手动创建销售记录产生。
2. **RETURNED ≠ STOCKED**。必须显式 confirmRestocked 后才恢复 STOCKED。
3. **入仓成功/上架 ≠ 已售出**。PLATFORM_IN_WAREHOUSE / PLATFORM_LISTED 都不是 SOLD。
4. **confirmRestocked 后库存可再次加入新批次**。旧 line 保持 RETURNED 作为历史记录。
5. **平台状态库存继续效期提醒**，但不进入本地压货提醒。
6. **草稿批次占用库存但不改 itemStatus**。

### 提醒规则

继续效期提醒：STOCKED, PLATFORM_SHIPPED, PLATFORM_RECEIVED, PLATFORM_IN_WAREHOUSE, PLATFORM_LISTED

不进入本地压货：PLATFORM_SHIPPED, PLATFORM_RECEIVED, PLATFORM_IN_WAREHOUSE, PLATFORM_LISTED, PLATFORM_REJECTED, RETURNING, RETURNED, SOLD, PROBLEM

### REMOVED 预留说明

`REMOVED / 已移出` 不是当前 Prisma `ItemStatus` 枚举成员，V1 未实现移出库存功能、写入入口或筛选项。未来启用前必须同时设计业务入口、允许来源状态、恢复规则、操作日志、提醒排除、销售和寄送限制、API 校验、migration 与 verify 覆盖。

## 10. M3-A 销售规则（V1 冻结）

详见 `docs/M3A_V1_SPEC.md`。V1 已完成并冻结。核心规则：

1. SOLD 只能由 M3-A 确认销售产生。
2. PLATFORM_LISTED / PLATFORM_IN_WAREHOUSE / PLATFORM_RECEIVED ≠ SOLD。
3. 销售取消恢复 preSaleItemStatus 快照，不默认回 STOCKED。
4. 利润三条路径互斥：actualReceivedAmount > expectedIncome > grossAmount + feeLines。
5. 销售草稿不占用库存，确认时 transaction 防重复销售。
6. DRAFT / CANCELLED 不计入已售汇总，不作为当前销售结果。
7. CONFIRMED / SETTLED 才是有效销售，采购订单销售汇总只统计这两类。
8. SETTLED V1 禁止取消；退款/退货留到 M3-B。
9. SOLD 库存不进入效期提醒、本地压货提醒、待寄送、待验货、待填物流等无关待办。
10. SOLD 库存在库存列表仍可查询，状态显示为“已售出”。

### M3-A 页面和只读追溯

- `/sales/new` 只创建 DRAFT 草稿，不改变库存状态。
- `/sales/[id]` 操作按钮只调用 sales API，不直接修改库存。
- `/inventory/[id]` 销售结果只读展示，当前有效销售只认 CONFIRMED / SETTLED。
- `/purchases/[id]` 每件库存展示销售追溯，订单级销售汇总只统计 CONFIRMED / SETTLED。
- 如果库存 `itemStatus=SOLD` 但找不到有效销售记录，页面显示“销售记录缺失，请检查数据”。
- 如果存在多个有效销售记录，页面显示数据异常提示。

## 11. 统一数据来源

所有统计卡片、待办中心、筛选列表必须基于同一套计算逻辑：

- `getReminderType()` — 唯一权威的提醒计算函数（`src/server/services/todo-service.ts`）
- `/api/todos` — 首页卡片 + 待办中心
- `/api/inventory?reminder=xxx` — 库存筛选（使用相同的 `getReminderType` + ReminderState 过滤）
- `/api/purchase-orders?todo=xxx` — 采购筛选（使用相同的 ReminderState 过滤）

禁止：不同位置使用不同的计算条件。

## 10. 验证命令

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

## 12. M3-C 销售到账规则（V1 冻结）

1. `grossAmount` 只能表示成交价，`expectedIncome` 只能表示预计收入，`actualReceivedAmount` 才是实际到账。
2. `settledAt` 是首次到账时间；SETTLED 二次登记允许修改实际到账金额，但已有 `settledAt` 不得被覆盖。
3. `CONFIRMED`、`SETTLED` 可以登记到账；`DRAFT`、`CANCELLED` 必须拒绝到账。
4. 每次到账登记写入 `SaleActionLog.note`；详情页展示操作日志，不通过页面直接修改数据库。
5. 到账后的利润仍使用既有 `calculateSaleProfit` 规则，并持久化到 `SaleLine.profitAmount`；M3-B 报表不重新发明利润公式。
6. 到账、二次到账和利润重算均不更新 `InventoryItem`，不写入 SOLD，也不调用平台寄送状态机。
7. SETTLED 仍禁止取消；退款、退货留待后续阶段设计。
8. 销售列表、销售报表、库存追溯和采购追溯均读取最新实际到账与已持久化的行利润；DRAFT / CANCELLED 不作为有效销售。
9. 采购订单销售汇总逐件累计库存成本和行利润；成交价、实际到账、费用、运费与其他成本属于 `SaleOrder` 级金额，组合销售中必须按销售订单去重，禁止按每条 `SaleLine` 重复累计。
## M3-D2-3 销售售后 API 规则冻结

1. 客户端不得提交 `ownerId`、售后状态、库存状态、资产归属、销售快照或利润字段。
2. 金额使用 Decimal 字符串，日期使用 ISO 字符串或 `null`；无效输入返回 400，状态或额度冲突返回 409。
3. `eligible-lines` 只读返回当前 owner 的 `SETTLED`、实际到账大于零、`OWNED + SOLD` 且未被进行中售后占用的销售行。DRAFT 不占用库存。
4. 订单退款总额只按 `SaleRefundRecord` 记录一次，不按分配或售后行重复累计。
5. API 层不新增 SOLD 写入，也不调用 M3-0 寄送状态机。

## M3-D2-4 销售售后页面规则冻结

1. 销售售后页面只读取查询 DTO，并将所有写操作委托给既有销售售后 API；`availableActions` 只控制 UI，不构成第二套状态机。
2. 原成交价、原预计收入、原实际到账和结算时间是原始销售事实；订单净到账、案件退款和订单累计退款是售后派生口径，必须分开展示。
3. 每笔退款只以 `SaleRefundRecord.refundAmount` 计入案件和订单退款；allocation 只显示行归属，禁止重复累计。
4. 退款、批准和验货均由用户逐行输入或明确选择；页面不得自动按订单到账、成本、利润或比例分摊。
5. 买家退货阶段库存保持 SOLD；页面不得本地恢复库存，只有 `SalesAfterSalesService.complete` 可以按最终验货结论事务恢复库存。

## M3-D2-2 销售售后 service 规则冻结

- 销售售后只处理已到账销售，`SaleOrder.status` 必须为 `SETTLED` 且 `actualReceivedAmount > 0`。
- `REFUND_ONLY` 和 `RETURN_AND_REFUND` 使用独立的 `SaleAfterSale*` 模型、服务和退款流水；不与采购售后模型混用。
- 订单级退款余额按已完成退款记录与当前已锁定的批准退款在 Serializable transaction 内重新计算；并发冲突重试有限次，幂等键重复请求不得产生第二条退款。
- 每条 `SaleAfterSaleLine` 必须明确退款分配。可靠的正数 `saleAmountSnapshot` 只用于行级上限，不可靠金额不自动分摊。
- 买家退货运输、收货、待验货时库存保持 `SOLD`。只有所有选中明细验货完成后，`complete` 才按 `RESTOCKED`/`PROBLEM` 原子恢复对应库存。
- 仅退款不会恢复库存；未选择的商品继续保持原状态。售后不修改原销售事实、销售快照、到账金额或持久化利润。
- 登记到账时，`actualReceivedAmount` 不得低于已完成退款加已锁定售后金额；该规则不改变 M3-B 报表口径。

## M3-D2-5 销售售后财务规则冻结

1. 原实际到账为 `SaleOrder.actualReceivedAmount`，原销售利润为已持久化 `SaleLine.profitAmount` 合计；售后不覆盖二者。
2. 累计销售退款只按 `SaleRefundRecord.refundAmount` 和唯一记录 ID 统计；行级退款只按 `SaleRefundAllocation.amount`。
3. 成本冲回仅限完成的 `RETURN_AND_REFUND + RESTOCKED`，且必须有对应 `SOLD -> STOCKED` 库存动作日志。问题件、仅退款、待判断或未完成售后不冲回成本。
4. 售后净利润为原销售利润减累计退款加恢复库存成本；当前不含未建模退货运费、平台额外费用和人工售后成本。
5. 派生金额由共享只读服务计算，页面和图表不得自行重算权威金额。
# M3-D3-3 API contract

## M3-D3-4 页面规则

- 平台退回、采购售后和销售售后是独立领域；平台退回由既有寄送周期产生，页面不支持凭空创建。
- 用户页面只显示中文业务文案。`RESTOCKED` 表示“可重新入库”的验货结论，`STOCKED` 表示当前“在库”状态，二者必须分开显示。
- `availableActions` 是页面入口依据，服务端仍是状态校验权威。`RETURNING` 不显示验货入口；待进一步判断可修订；最终结论不提供普通修改。
- 旧版 `RETURNED + STOCKED + 无 Inspection` 仅作为历史直接入库提示，禁止页面自动补建或伪造验货记录。

## M3 最终冻结口径（2026-07-16）

1. `SOLD` 的正常写入唯一入口仍是 `SalesService.confirm`。到账、报表、平台寄送、平台退回和采购售后都不得新增 SOLD 写入。
2. `PLATFORM_LISTED` 仅代表平台已上架/可售，不等于已售；销售统计以 `SaleOrder.status in (CONFIRMED, SETTLED)` 为准。
3. 采购售后、销售售后、平台退回是三条独立链：采购退款使用 `PurchaseRefundRecord`，销售退款使用 `SaleRefundRecord`，平台退回不产生退款流水。
4. 原采购实付、原销售成交价、原预计收入、原实际到账和已持久化销售行利润均保留；净采购成本、净到账和售后净利润均为派生口径，不覆盖原始事实。
5. 销售退款按 `SaleRefundRecord` 做订单级去重，按 `SaleRefundAllocation` 表达行级归属；不得把订单退款复制计入每条销售行。
6. 平台退回 `RETURNED` 后只能由平台退回验货决定 `RESTOCKED`、`PROBLEM` 或 `PENDING_DECISION`；旧 confirm-restocked 接口仅兼容并已废弃。
7. 当前正式 `ItemStatus` 只有 11 个，旧枚举已退役；`PENDING_INSPECTION` 目前是采购订单生命周期状态，未创建对应库存实例。
8. 平台寄送与退回费用目前不进入库存成本、销售利润或售后净利润分摊。任何引入该成本的变更必须另行冻结分摊规则。

- Platform-return APIs retain internal English enum values; future UI maps them to Chinese.
- `RETURNING`, returned-without-inspection, and `PENDING_DECISION` are distinct pending categories.
- `PENDING_DECISION` may be revised; final `RESTOCKED` and `PROBLEM` conclusions are locked except for identical idempotent retries.
- Platform shipment history remains `RETURNED` after inspection. API routes never directly mutate the inventory or shipment state.

## M3-D3-5 平台退回资产统计冻结

1. 平台退回资产统计只能由服务端只读聚合产生。当前资产按 `InventoryItem.id` 去重，退回周期和最终验货历史按 `PlatformShipmentLine.id` / `PlatformReturnInspection.id` 计数；动作日志不改变数量或金额。
2. `OWNED + RETURNING` 是退回途中资产，`OWNED + RETURNED` 且未验货或为 `PENDING_DECISION` 是已退回待处理资产。两者不属于正常本地库存、可售候选、销售候选或新寄送候选。
3. `PENDING_DECISION` 是已退回待处理资产的子集，不得再次加入待处理资产合计。`RESTOCKED + STOCKED` 才是正常本地资产；`PROBLEM` 继续不可售，平台退回问题资产不自动认定为损失。
4. 权威资产成本只使用 `InventoryItem.unitCost`。不得混入 SaleLine、销售利润、退款、平台费用、寄送费用或推断损失。
5. 首页三项平台退回待办、平台退回工作台与库存页必须使用相同状态事实；待办在状态未改变前持续可见，不能由动作日志或通用提醒处理记录造成重复或隐藏。
6. M3-D3 已 FROZEN：不做平台同步、95 分同步、报告附件、平台赔付、退回运费/利润影响或 `PlatformReturnCase`。M3-D1 与 M3-D2 同样保持 FROZEN。

## M4-A4 行情工作台规则

- 手工报价是历史记录：修改价格必须通过替代修正，不覆盖旧 Quote。
- 当前有效行情、报价过期/失效和可用操作由服务端规则派生，页面不自行判断或写回状态。
- 平台展示价格、人工参考价和预计收入必须分别显示；仅已确认的 `EXPECTED_INCOME` 可进入未来采购参考试算。

## M4-A5 采购试算规则（设计冻结，未实施）

- 采购试算只使用当前有效、已确认且未过期的 `EXPECTED_INCOME`；不得从 `LISTING_PRICE`、人工参考价、历史 `SaleFeeLine` 或历史实际到账自动推导。
- V1 使用固定目标利润额和用户明确填写的固定附加成本：`建议最高采购价 = 预计收入 - 附加成本 - 目标利润`。预计收入 Quote 已是预计到账，不得重复扣平台费用。
- 试算结果仅供参考，使用 Decimal，实时计算但不持久化；不创建采购订单，不修改库存、销售、售后或 `SOLD`。

## M4-A6 采购试算实现规则

- 唯一入口为 `POST /api/market/items/[marketItemId]/purchase-decision`；客户端不能提交 owner、Quote、预计收入或任何计算结果。
- 试算复用服务端当前行情选择；只读计算，不修改 `MarketItem`、`MarketQuote`、采购、库存、销售或售后。
- 行情管理不等于采购或出售决策：页面不得自动创建采购订单、推荐执行平台或改写库存/销售事实。

## M4-B0 每日经营报告规则（设计冻结，未实施）

- 昨日经营事件使用用户时区昨天的半开区间；当前库存/风险和今日待办始终为报告生成时刻快照，不得伪装为历史库存快照。
- 销售只复用 `CONFIRMED` / `SETTLED` 报表口径；成交价、预计收入、实际到账、退款、净到账、原利润和售后净利润保持既有字段及聚合语义。
- 当前资产复用平台退回汇总，按 `InventoryItem.id` 去重；`PENDING_DECISION` 是已退回待处理子集，不得重复加总；`PLATFORM_LISTED` 不等于已售。
- M4-B0 只冻结日报口径；日报生成、页面和飞书手动发送分别由 M4-B1 至 M4-B3 实现，M4-B4 已补齐自动发送、去重和发送记录。

## M4-B1 每日经营报告聚合规则

- 日报 API 只接受可选 `date` 和 `timezone`，拒绝客户端 ownerId 与未知参数；V1 仅支持 `Asia/Shanghai`。
- 昨日销售确认、到账和退款分别按各自业务时间计算；实际退款仅取 `SaleRefundRecord`，采购退款仅取 `PurchaseRefundRecord`。
- 当前库存、待办、风险与行情是 `generatedAt` 快照，历史 date 不表示历史库存快照；日报聚合仅查询，不写数据库。

## M4-B2 每日经营报告页面规则

- `/reports/daily` 只能读取 M4-B1 的正式日报 API；页面不得自行聚合销售、退款、库存、待办、风险或行情。
- `date` 只用于所选日期事件；库存、待办和风险必须展示为报告生成时的当前快照，并向用户明确说明。
- `PENDING_DECISION` 是已退回待处理资产子集，页面只做子集说明，不把它再次加入资产总数。
- 预计收入、实际到账、实际退款、净到账和售后净利润使用 API 原值与既有说明，页面不得重算或混称。
- 行情摘要只能表述为人工录入；页面不保存日报、不创建定时任务或业务记录。

## M4-B3 飞书日报手动发送规则

- 仅服务端可读取 `FEISHU_DAILY_REPORT_WEBHOOK_URL` 和可选 `FEISHU_DAILY_REPORT_SECRET`；客户端不得提交、显示或持久化 Webhook、Secret、签名或目标地址。
- 手动发送必须先生成正式日报，生成失败不得发送假报告。消息只含聚合摘要，不含客户资料、内部 ID、订单明细和售后说明。
- 飞书发送不写采购、库存、销售、退款或利润事实；M4-B4 仅新增发送记录，不保存日报快照正文或通知凭证。
## M4-B4 日报发送规则

- 普通发送按 owner、报告日期和飞书渠道幂等；`SENT` 记录不重复发送。
- 仅超时、网络和飞书 5xx 失败可以自动重试；参数、配置、日报生成和空报告错误不可重试。
- 发送协调器不把外部 HTTP 请求放进数据库事务；状态更新使用条件更新，避免并发重复领取。
- 日报为空时不向飞书发送全零假报告。发送不改变采购、库存、销售、退款、利润或任何库存状态。
