# M3-D3 V1 平台退回验货设计冻结

> 最后更新：2026-07-15
> 当前阶段：**M3-D3-1 数据模型、纯加法 migration 与模型级验证已完成；Service、API、页面和库存恢复尚未实施。**

## 1. 业务边界

平台退回是第三个独立业务域：用户将自有库存寄到得物、95 分等平台后，因平台拒收、鉴别失败、仓内退仓或主动撤回而由平台退回给用户。

| 业务域 | 实物方向 | 资金方向 | 主要事实模型 | 禁止复用 |
| --- | --- | --- | --- | --- |
| 采购售后 | 用户退回上游卖家 | 上游卖家退款给用户 | `PurchaseAfterSaleCase` | 销售售后、平台退回 |
| 销售售后 | 买家退回用户 | 用户退款给买家 | `SaleAfterSaleCase` | 采购售后、平台退回 |
| 平台退回 | 平台退回用户自有库存 | V1 不记录退款、赔付或费用结算 | `PlatformShipmentLine` + 后续 `PlatformReturnInspection` | 两类售后 Case、全部退款流水 |

平台退回不得创建或使用 `PurchaseAfterSaleCase`、`SaleAfterSaleCase`、`PurchaseRefundRecord`、`SaleRefundRecord`，也不得把库存归属改为 `RETURNING_TO_UPSTREAM_SELLER` 或 `RETURNED_TO_UPSTREAM_SELLER`。它不是销售取消，不能调用 `SalesService.cancel`，更不能写入 `SOLD`。

## 2. M3-0 现状审计

### 2.1 模型事实

- `PlatformShipmentBatch` 是批次主事实，具备平台、目的、批次物流、`outboundShippingCost`、`packagingCost`、`otherShipmentCost`、`returnShippingCost`、备注和动作日志关系。
- `PlatformShipmentLine` 是单件寄送事实，关联 `ownerId`、`batchId`、可选 `groupId` 和必填 `inventoryItemId`，并保存库存/商品/SKU/成本快照、拒收原因、退回承运商、退回单号、`returnedAt`、`returnedStorageLocation` 与备注。
- 约束为 `@@unique([ownerId, inventoryItemId, batchId])`。因此一条 line 精确对应一件库存，且同一库存不能在同一批次重复；它不是跨所有批次的唯一关系。
- `ShipmentService.createDraft` 只接收 `OWNED + STOCKED` 库存，且只阻止仍在活动 line（`DRAFT`、`SHIPPED`、`RECEIVED`、`IN_WAREHOUSE`、`LISTED`）中的库存。历史 `RETURNED` line 不会阻止该库存恢复为 `STOCKED` 后创建新的批次和新的 line。
- 所有寄送 route 现以固定 `DEFAULT_OWNER_ID` 调用服务；服务和 `applyShipmentLineAction` 使用 `ownerId` 过滤 line、batch 和库存，跨 owner 查不到即返回 404。

### 2.2 当前真实状态机

来源：`src/lib/shipment-status-machine.ts` 与 `src/server/shipments/applyShipmentLineAction.ts`。

| 动作 | 允许的当前 line 状态 | line 结果 | InventoryItem 结果 |
| --- | --- | --- | --- |
| `confirmShipped` | DRAFT | SHIPPED | PLATFORM_SHIPPED |
| `markReceived` | SHIPPED | RECEIVED | PLATFORM_RECEIVED |
| `markInWarehouse` | RECEIVED | IN_WAREHOUSE | PLATFORM_IN_WAREHOUSE |
| `markListed` | RECEIVED / IN_WAREHOUSE | LISTED | PLATFORM_LISTED |
| `markRejected` | SHIPPED / RECEIVED / IN_WAREHOUSE / LISTED | REJECTED | PLATFORM_REJECTED |
| `markReturning` | SHIPPED / RECEIVED / IN_WAREHOUSE / LISTED / REJECTED | RETURNING | RETURNING |
| `markReturned` | RETURNING | RETURNED | RETURNED |
| `confirmRestocked` | RETURNED | RETURNED（保留历史） | STOCKED |

结论：

1. `markRejected` 写入 `PLATFORM_REJECTED`，`markReturning` 写入 `RETURNING`，`markReturned` 写入 `RETURNED`。
2. 平台拒收不是唯一退回起点。仓内商品和已上架商品均可直接执行 `markReturning`，现有状态机已能表达仓内退仓或上架撤回的实物流向，但没有独立 `returnType`、撤回原因或退回发出时间。
3. `PLATFORM_LISTED` 不等于 `SOLD`；M3-0 的状态机明确拒绝生成 `SOLD`。
4. `confirmRestocked` 目前只检查 line 为 `RETURNED`，在 transaction 中把库存直接改为 `STOCKED`、写入库位和 `PlatformShipmentActionLog(CONFIRMED_RESTOCKED)`；line 继续为 `RETURNED`。它不记录验货结果、问题原因、验货操作人或专用验货动作日志。因此当前仍可绕过验货直接重新入库。
5. “确认重新入库”入口位于 `src/components/shipments/shipment-detail.tsx`，通过 `POST /api/shipments/lines/[lineId]/confirm-restocked` 调用 `applyShipmentLineAction`。

### 2.3 当前物流、追溯、统计与费用

- 退回物流已在 `PlatformShipmentLine`：`returnCarrierCode`、`returnTrackingNo`、`returnedAt`、`returnedStorageLocation`、`rejectedReason`、`note`。`markReturning` 写承运商/单号/备注；`markReturned` 写收到时间和库位。没有 `returnShippedAt` 或单独 `returnReceivedAt`。
- 库存详情的“平台寄送追溯”已读取批次、line、拒收原因、退回物流、`returnedAt` 和退回库位；它尚无退回验货结果。
- `TodoService` 只对 `STOCKED + OWNED` 生成库存提醒；`getReminderType` 也排除 `RETURNING`、`RETURNED`、`SOLD`、`PROBLEM`。当前没有“平台退回途中”或“已退回待验货”待办。
- SKU 汇总中，`RETURNING` 与 `RETURNED` 归入 `exceptionCount`，不计入本地可卖、平台可售或立即可卖；但作为 `OWNED` 且非 `SOLD` 的正式状态，仍计入 `unsoldCount` 和 `unsoldCostTotal`。这意味着它们当前被计为未售资产成本，却没有独立的“退回待处理”桶。
- `returnShippingCost` 已存在于批次 schema，但当前 `ShipmentService` 的创建/更新 DTO、批次页面和报表利润均未读取或写入它。发往平台运费、包材和其他寄送成本只展示为“仅记录，暂不计入利润”。不存在平台鉴别费、扣费或赔付模型；M3-D3 V1 不修改利润、采购成本或退款模型。

### 2.4 当前迁移状态

使用本地 Prisma CLI 对日常开发库做只读检查：`resale_erp`、`public`、`localhost:5432`，共发现 18 条 migration，结果为 “Database schema is up to date”。本轮没有执行任何迁移或数据库写入。

## 3. M3-D3 V1 范围

### 支持

1. `PLATFORM_REJECTION_RETURN`：平台拒收或鉴别失败后的退回。
2. `PLATFORM_WAREHOUSE_RETURN`：仓内退仓或已上架后撤回的退回。
3. 单件退回；同一批次只退其中部分 line；同一库存经重新入库后再次寄送、再次退回。
4. 复用现有 line 退回物流和寄送历史；用户收到后独立验货，再决定重新入库、问题件或待进一步判断。

### 不支持

- 自动同步得物/95 分物流、鉴别报告或退仓申请。
- 平台费用、赔付、退款、自动记账或利润改写。
- OCR、自动判断、自动重新上架、自动创建新寄送批次。
- 统一 AfterSaleCase 或把三类实物退回合并为一个按钮。

**不新增 returnType。** 当前 line 的历史状态与 `rejectedReason` 足以表达拒收来源；仓内/上架撤回通过 `markReturning` 的前序 line 状态和 action log 可追溯。若未来需要平台申请单、批准、争议或多次退回物流，再单独冻结 `PlatformReturnCase`。

## 4. 推荐模型：最小独立验货事实

M3-D3-1 已新增 `PlatformReturnInspection` 与 `PlatformReturnActionLog`，并保持不新增 `PlatformReturnCase`。

```text
PlatformReturnInspection
- id
- ownerId
- shipmentLineId
- inventoryItemId
- result: RESTOCKED | PROBLEM | PENDING_DECISION
- storageLocation?              // RESTOCKED 必填
- problemReason?                // PROBLEM 时与 note 至少一个必填
- note?
- inspectedAt?
- createdAt
- updatedAt

@@unique([shipmentLineId])
@@index([ownerId, inventoryItemId])

PlatformReturnActionLog
- id
- ownerId
- shipmentLineId
- inventoryItemId
- actionType
- fromResult?
- toResult?
- note?
- createdAt
```

选择理由：一条 `PlatformShipmentLine` 已表示一次寄出到退回的历史周期，也已保存退回物流。它只需要一份可更新的最终验货事实。`PENDING_DECISION` 通过 update 改为最终结果；每次录入或修订都写 `PlatformReturnActionLog`，保留判断历史。重新入库后再寄平台会创建新 line，因此不会被旧 line 的唯一验货记录阻塞。

`PlatformReturnInspection` 的 `shipmentLineId` 全局唯一；`inventoryItemId` 非唯一，允许同一库存经重新入库和再次寄送后保留多个历史周期。ShipmentLine 与 InventoryItem 外键均为 `Restrict`，ActionLog 随 Inspection `Cascade` 删除。migration 以 `btrim` CHECK 保证 RESTOCKED 的非空库位，以及 PROBLEM 的非空问题原因或备注。

`platformReasonSnapshot`、物流字段和平台状态不放入验货模型，避免重复维护已有 line 主事实。图片附件、收货/包装状态、缺件、操作人等属于未来可选的加法字段，只有存在明确表单与追溯需求时再冻结。

## 5. 后续状态与库存规则

平台寄送 line 仍保留历史状态，库存表示当前实物事实：

```text
PLATFORM_REJECTED / 平台仓内或上架状态
  -> RETURNING
  -> RETURNED
  -> PlatformReturnInspection
       RESTOCKED        -> InventoryItem.STOCKED
       PROBLEM          -> InventoryItem.PROBLEM
       PENDING_DECISION -> InventoryItem.RETURNED
```

规则：

1. 只有 `InventoryItem.itemStatus = RETURNED` 且关联 line 为 `RETURNED` 才能验货。
2. `RESTOCKED` 必须填写新库位；库存改为 `STOCKED`。
3. `PROBLEM` 必须填写问题原因或明确备注；库存改为 `PROBLEM`。
4. `PENDING_DECISION` 只保存判断，库存继续 `RETURNED`，不能当作处理完成。
5. line 永远保留 `RETURNED`，即使库存最终为 `STOCKED` 或 `PROBLEM`。这是该次平台寄送被退回的不可变历史，和库存当前事实不冲突。
6. 不修改 `InventoryOwnershipStatus`；不写 `SOLD`；不调用采购/销售售后完成逻辑或 `SalesService.cancel`。
7. 验货、库存变更与动作日志必须在专用 service 的单个 transaction 内完成，保证失败不半更新，并校验同一 owner、line 与 inventory 的精确关联。

### 旧 `confirmRestocked` 的后续收口

M3-D3-0 不删除也不修改它。M3-D3-2 应采用“保留内部受控动作、撤销直接入口”的方案：

1. 页面移除无验货的“确认重新入库”。
2. 旧 API 若需要兼容，返回明确的弃用/需验货错误；不得再直接恢复库存。
3. 仅 `PlatformReturnInspectionService` 在已记录 `RESTOCKED` 验货结论的 transaction 内调用受控库存恢复逻辑。

## 6. 统计、提醒与可选性冻结

| 当前状态 | 可售 / 销售候选 | 新寄送候选 | 当前资产口径 | M3-D3 后续展示 |
| --- | --- | --- | --- | --- |
| RETURNING | 否 | 否 | OWNED 未售成本 | 平台退回途中数量/资产 |
| RETURNED | 否 | 否 | OWNED 未售成本 | 已退回待验货数量/资产 |
| STOCKED（RESTOCKED 后） | 是 | 是 | 正常本地资产 | 正常库存 |
| PROBLEM | 否 | 否 | 问题件成本 | 问题件 |

后续 SKU 汇总和库存总览应将 `RETURNING`、`RETURNED` 从笼统的异常桶中额外展示，避免隐藏实际拥有但待处理的资产。`RETURNED` 继续计入待处理库存资产成本，不进入正常可售库存；`RETURNING` 仅计入在途资产。恢复 `STOCKED` 后才回到正常可售统计。

后续待办：

1. `RETURNING`：平台退回途中。
2. `RETURNED` 且无最终验货：平台已退回待验货。
3. 验货为 `PENDING_DECISION`：平台退回待进一步判断。
4. 验货为 `PROBLEM`：平台退回问题件。

## 7. 后续 API 与页面设计

遵循既有 `/api/shipments` 路由风格，建议：

- `GET /api/shipments/returns/pending`
- `GET /api/shipments/lines/[lineId]/return-inspection`
- `POST /api/shipments/lines/[lineId]/return-inspection`
- `PATCH /api/shipments/lines/[lineId]/return-inspection`

route 只做认证、DTO 校验与 service 委托；不得直接更新 `InventoryItem` 或 `PlatformShipmentLine`。跨 owner 或不存在返回 404；非法状态返回 409；非法输入返回 400；RESTOCKED 缺库位、PROBLEM 缺原因/备注返回 400。

V1 页面优先扩展现有位置，而非创建大型工作台：

1. 寄送批次详情：RETURNED line 展示退回原因、物流、收到时间、验货状态、验货入口和结果。
2. 库存详情：在既有平台寄送追溯中追加退回验货结果与 line 链接。
3. 首页/待办：链接到批次详情或库存详情。

只有平台退回量明显增大时，再单独设计 `/platform-returns` 工作台。

## 8. verify:m3d-platform-return 设计

未来新增 `pnpm verify:m3d-platform-return`，使用唯一 runId，finally 仅按精确 ID 清理且清理失败不得静默通过。至少覆盖：

1. PLATFORM_REJECTED 可转 RETURNING，RETURNING 可转 RETURNED，非法状态不能直接 RETURNED。
2. RETURNED 才可验货；RETURNING 和 PLATFORM_REJECTED 都不可验货或直接 STOCKED。
3. RESTOCKED 缺库位、PROBLEM 缺原因/备注被拒绝。
4. PENDING_DECISION 保持 RETURNED，且可后续改为最终决定。
5. RESTOCKED 只将选中库存改为 STOCKED；PROBLEM 只将选中库存改为 PROBLEM。
6. ShipmentLine 始终保留 RETURNED；验货不改 InventoryOwnershipStatus、不改 SaleOrder、不生成采购/销售退款流水或 SOLD。
7. 同一最终验货不得重复恢复库存；transaction 失败不得半更新。
8. 同批次未选 line 保持原状态；RESTOCKED 后可重新进入销售/寄送候选，PROBLEM 不能。
9. RETURNED 未验货与 PENDING_DECISION 都产生相应待办，最终验货后移除待验货待办。
10. 旧 `confirmRestocked` 在 M3-D3-2 后不能绕过验货。

## 9. 推荐实施刀法

1. **M3-D3-1**：已完成 `PlatformReturnInspection`、专用结果 enum/动作日志、纯加法 migration 与 `verify:m3d-platform-return` 的 44 项模型验证。
2. **M3-D3-2**：`PlatformReturnInspectionService`、并发与 transaction 规则、收口 `confirmRestocked`、待办和候选保护。
3. **M3-D3-3**：API、DTO 与稳定错误契约。
4. **M3-D3-4**：寄送详情退回验货 UI、库存追溯和待办入口。
5. **M3-D3-5**：真实页面验收、SKU/库存统计口径及跨页面一致性封板。

## 10. 本轮边界确认

- M3-D3-1 仅新增 `PlatformReturnInspectionResult`、`PlatformReturnInspection`、`PlatformReturnActionLog` 及 `20260715153411_add_m3d_platform_return_inspection` 纯加法 migration。
- 未修改 `src/` 业务代码、状态机、`applyShipmentLineAction`、`confirmRestocked`、SalesService、采购售后或销售售后。
- migration 已应用至日常开发库；未运行 reset，且新模型没有 trigger、Service 或 API 会修改库存。
- M3-D1 与 M3-D2 继续 FROZEN。
## 11. M3-D3-2 实施状态

- 已完成 `PlatformReturnInspectionService` 与纯规则模块。Service 在 Serializable transaction 内校验 owner、ShipmentLine、InventoryItem、`OWNED` 归属、`RETURNED` 当前状态和平台周期；最终库存更新使用带 `id + ownerId + itemStatus=RETURNED` 条件的 `updateMany`，并发冲突稳定返回业务冲突。
- `PENDING_DECISION` 创建或修订当前验货结论并记录专用 ActionLog，但不改变库存或寄送明细；`RESTOCKED` 原子写入库存 `STOCKED + storageLocation`；`PROBLEM` 原子写入库存 `PROBLEM`。所有情况下 ShipmentLine 继续保留 `RETURNED`。
- 旧 `ShipmentService.confirmRestocked` 与 `applyShipmentLineAction("confirmRestocked")` 均已收口为 Service 委托，不再保留平台退回直接重新入库路径。历史旧记录不自动补建 Inspection 或日志。
- TodoService 已新增平台退回途中、已退回待首次验货和待进一步判断的服务端口径；销售与寄送候选已验证继续排除 `RETURNING` / `RETURNED`。
- 本阶段未新增 HTTP API、DTO、页面或弹窗；M3-D3-3 才实现 API 契约，M3-D3-4 才实现正式 UI。M3-D3 尚未 FROZEN。
# M3-D3-3 implementation state

M3-D3-3 adds the stable API contract documented in `M3D_PLATFORM_RETURN_INSPECTION_API.md`: strict inspection input, owner-scoped history/pending/detail queries, server-derived available actions, and service-only writes. It does not add a platform-return inspection UI, modify schema or migrations, or change the M3-0 normal platform shipment state machine. M3-D3 remains unfrozen pending M3-D3-4 UI work.

## 12. M3-D3-4 页面工作台（已完成）

- 新增 `/platform-returns` 和 `/platform-returns/[shipmentLineId]`，导航位于寄送批次与库存管理附近；页面只消费既有平台退回 API。
- 列表支持关键词、平台、批次、当前库存状态、验货结论、待处理和 URL 分页筛选。待办分类 `RETURNING`、`PENDING_INSPECTION`、`PENDING_DECISION` 使用既有 pending API，筛选会保留在 URL。
- 详情明确分开展示 ShipmentLine 的寄送历史 `RETURNED` 与 InventoryItem 的当前状态；`RESTOCKED` 是“可重新入库”验货结论，`STOCKED` 是“在库”库存事实，两者不会混用。
- 页面操作只根据服务端 `availableActions` 展示，并且唯一写入请求为 `POST /api/platform-returns/[shipmentLineId]/inspection`。页面不调用旧 `confirm-restocked`，不直接改库存、寄送明细或日志。
- `PENDING_DECISION` 可以继续修订或确定最终结论；`RESTOCKED` / `PROBLEM` 为最终结论。旧版直接入库记录仅展示历史提示，不伪造验货记录。
- 库存详情保留所有平台寄送与退回周期；寄送批次详情提供退回详情入口，移除了旧的“确认重新入库”页面入口。
- M3-D3 仍需 M3-D3-5 的最终跨页面验收与统计口径封板；M3-D1 / M3-D2 继续 FROZEN。

## 13. M3-D3-5 统计口径与最终封板（已完成并冻结）

M3-D3 已完成并冻结。平台退回与采购售后、销售售后继续是三个独立领域；本阶段没有引入平台退款、赔付、平台费用、退回运费、利润影响、平台同步、95 分同步、报告附件或自动创建寄送批次。

### 当前资产与历史周期

1. `PlatformShipmentLine` 表示一次平台寄送/退回的历史周期；同一 `InventoryItem` 可有多条 line。历史周期按 line ID 计数，不能因为后一次寄送覆盖前一次的退回事实。
2. `InventoryItem` 表示当前实物资产；资产统计按 inventory ID 去重，权威成本仅为 `InventoryItem.unitCost`。不读取销售行、销售利润、退款、寄送费用或平台费用，也不假定问题件已经损失。
3. `OWNED + RETURNING` 为平台退回途中资产：不属于正常本地库存、可售候选、销售候选或新寄送候选。
4. `OWNED + RETURNED` 且未验货或为 `PENDING_DECISION` 为已退回待处理资产：不属于正常本地库存或可售候选。`PENDING_DECISION` 是该资产集合的子集，只展示，不重复计入资产合计。
5. `RESTOCKED + STOCKED` 回到正常本地资产；它不再是待处理平台退回资产。`PROBLEM` 为不可售问题件；平台退回统计只将关联平台退回验货结论的当前问题件计为平台退回问题资产。
6. 旧版 `RETURNED + STOCKED + 无 PlatformReturnInspection` 只计为“历史直接重新入库”记录；不补建验货、动作日志或待办，也不把它伪造成 `RESTOCKED` 结论。

### 统一只读聚合与页面一致性

- `getPlatformReturnSummary(ownerId)` 是平台退回资产统计的单一只读来源，`GET /api/platform-returns/summary` 返回 JSON-safe 金额字符串。
- 平台退回页展示退回途中、首次待验货、待进一步判断、历史重新入库、历史问题件和待处理资产；库存页展示本地在库、平台退回途中、已退回待处理、平台退回问题件、其他未售处理中和未售资产合计。
- 首页三项平台退回入口复用该汇总的计数；待办仍按当前库存状态生成，平台退回待办不会被动作日志或通用提醒历史隐藏。
- 平台退回页、寄送批次详情、库存详情均分开展示 line 的历史状态与库存的当前状态。页面仅展示中文业务文案，内部 enum 只保留在 API/服务实现中。

### 验证冻结

`verify:m3d-platform-return` 覆盖正常平台拒收、平台仓内/上架退回、退回验货、同一库存两次退回周期、旧版直接重新入库识别、并发/最终结论冲突、候选排除、待办去重、汇总资产成本、页面刷新和跨页面追溯。M3-D1 与 M3-D2 保持 FROZEN。
