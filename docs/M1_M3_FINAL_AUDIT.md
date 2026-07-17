# M1-M3 最终只读审计与冻结结论

审计日期：2026-07-16
范围：M1、M2-A、M2-B、M3-0、M3-A、M3-B、M3-C、M3-D1、M3-D2、M3-D3。
本文件只记录代码、数据库、迁移、脚本和文档的只读核对结果；未修改 Schema、迁移、业务数据、Service、API、页面或状态机。

## 1. 审计结论摘要

### 是否形成业务闭环

是。当前已形成：采购订单与商品明细 -> 成本分摊确认 -> Mock 物流签收 -> 单件验货 -> 单件库存/SKU -> 平台寄送或销售草稿 -> 确认销售 `SOLD` -> 到账与利润快照 -> 报表；并具备采购售后、销售售后和平台退回验货三条独立支路。

每条主链均有持久化模型、owner 范围查询、Service 事务/状态保护、HTTP 路由和验证脚本。当前未发现可复现的 P0 或 P1 问题。

### 数据库与枚举快照

- 日常开发库：`resale_erp`，`public` schema，19 个迁移均已应用。
- 正式 `ItemStatus`：`PENDING_INSPECTION`、`STOCKED`、`PLATFORM_SHIPPED`、`PLATFORM_RECEIVED`、`PLATFORM_IN_WAREHOUSE`、`PLATFORM_LISTED`、`PLATFORM_REJECTED`、`RETURNING`、`RETURNED`、`SOLD`、`PROBLEM`。
- 旧值 `LISTED`、`IN_BATCH`、`SHIPPED_TO_WAREHOUSE`、`WAREHOUSE_RECEIVED`、`INBOUND_SUCCESS`、`INBOUND_FAILED`、`PENDING_SETTLEMENT`、`SETTLED` 已退役，审计计数均为 0。
- 本次只读计数：92 个采购订单、109 条采购明细、165 条验货、160 件库存、24 个寄送批次、30 条寄送明细、102 张销售单、100 条销售明细、5 条平台退回验货。采购/销售售后案例在当前开发数据中为 0，不影响相应 Service/API/验证覆盖。

## 2. 采购主链

| 业务事实 | 权威模型/字段 | 权威写入 | 关键保护 |
|---|---|---|---|
| 采购订单 | `PurchaseOrder`、`PurchaseOrderItem` | `PurchaseOrderService.createOrder/updateOrder/deleteOrder` | 订单号按 `ownerId + orderNo` 唯一；创建/更新使用事务 |
| 实付与分摊 | `totalAmount`、`shippingAmount`、`allocatedTotalCost` | `CostAllocationService.save/reopen` | `paidTotal = totalAmount + shippingAmount`；确认时所有明细有值且合计严格相等 |
| 物流到货 | `LogisticsEvent` 与订单物流摘要 | `LogisticsService.saveTracking/refresh/manualDeliver` | 当前单号事件按 `carrierCode + trackingNo` 展示；签收不被同单号普通刷新回退 |
| 待验货 | `Inspection` | `ensurePendingInspectionsTx` | `@@unique([purchaseOrderItemId, sequence])`、`createMany(skipDuplicates)`、显式 POST 补建，GET 不写入 |
| 单件库存 | `InventoryItem` | `InspectionService.complete` | 必须先 `allocationStatus=CONFIRMED`；`inspectionId @unique` 防止重复创建 |

`CostAllocationService.calculateAllocationSummary` 使用 `Prisma.Decimal`。`InspectionService.complete` 用采购明细的 `allocatedTotalCost` 和数量执行整数分拆，余数给最后一个 `sequence`，写入 `InventoryItem.unitCost`。当前库存成本的权威来源是该冻结单件成本；销售行再保留 `SaleLine.unitCostSnapshot/costAmount`，不会回读当前库存成本作为销售历史权威。

采购售后使用独立 `PurchaseAfterSale*`、`PurchaseRefund*` 模型和 `PurchaseAfterSalesService`。退款用 `PurchaseRefundRecord` 记录一次真实金额、用 `PurchaseRefundAllocation` 归属售后行。退回上游时库存保持问题件语义，仅通过 `ownershipStatus` 从 `OWNED` 变为 `RETURNING_TO_UPSTREAM_SELLER` / `RETURNED_TO_UPSTREAM_SELLER`，不会伪装成普通本地库存。

## 3. InventoryItem 生命周期矩阵

`ItemStatus` 是当前库存状态；`PlatformShipmentLine`、`SaleLine`、售后案例和验货记录保存历史事实。

| 当前状态 | 合法进入来源 | 合法下一步 | 权威写入者 | 可销售 | 可新寄送 | 未售资产/待办 |
|---|---|---|---|---:|---:|---|
| `PENDING_INSPECTION` | 当前仅枚举预留；待验货实际在 `PurchaseOrder.status` | 无库存实例流转 | 无当前 `InventoryItem` 写入者 | 否 | 否 | 否 |
| `STOCKED` | 采购验货 PASS；平台退回 RESTOCKED；销售退货 RESTOCKED；草稿寄送取消；销售取消快照恢复 | 平台寄送、确认销售 | Inspection/Shipment/PlatformReturn/SalesAfterSale/Sales cancel | 是 | 是 | 是；参与本地压货/效期 |
| `PLATFORM_SHIPPED` | 确认平台发货 | 签收、退回、确认销售 | ShipmentService | 是 | 否 | 是；不作为本地压货 |
| `PLATFORM_RECEIVED` | 平台签收 | 入仓、上架、拒收、退回、确认销售 | ShipmentService / action state machine | 是 | 否 | 是 |
| `PLATFORM_IN_WAREHOUSE` | 入仓/鉴别通过 | 上架、拒收、退回、确认销售 | action state machine | 是 | 否 | 是 |
| `PLATFORM_LISTED` | 平台上架/可售 | 拒收、退回、确认销售 | action state machine | 是 | 否 | 是；**不等于已售** |
| `PLATFORM_REJECTED` | 平台拒收 | 退回中 | action state machine | 否 | 否 | 异常资产 |
| `RETURNING` | 平台退回中 | 已退回 | action state machine | 否 | 否 | 平台退回待办 |
| `RETURNED` | 平台已退回 | 验货决定 `STOCKED` / `PROBLEM` / 待决策 | action state machine / PlatformReturnInspectionService | 否 | 否 | 待验货/待决策 |
| `SOLD` | `SalesService.confirm` 正常销售唯一入口 | 销售售后退货完成后 `STOCKED` / `PROBLEM`；CONFIRMED 取消按快照恢复 | Sales confirm；恢复由 Sales cancel / sales after-sale | 否 | 否 | 历史保留；排除未售资产、效期和压货 |
| `PROBLEM` | 初始验货问题；已完成验货修正；销售售后/平台退回验货问题 | 采购售后上游退回归属流转 | Inspection/SalesAfterSale/PlatformReturn | 否 | 否 | 异常资产 |

正常业务中只有 `src/server/sales/sales-service.ts` 的 `SalesService.confirm` 把库存写为 `SOLD`。它在事务内复读库存、校验 `OWNED` 与可售状态、检查其他 `CONFIRMED/SETTLED` 销售行防重卖，并刷新销售前快照。M3-0 状态机明确拒绝 SOLD 目标状态；到账和报表均不写库存。

**契约差异**：`src/lib/inventory-item-status-contract.ts` 的写入清单未列出 `SalesAfterSalesService.complete`、`SalesService.cancel` 和草稿寄送取消对 `STOCKED/PROBLEM` 的合法恢复写入。真实代码有对应事务和验证，故不是当前资金或库存错误；列为 P2 文档/契约债务。

## 4. 平台寄送与平台退回

`PlatformShipmentBatch` 保存共同物流和成本字段，`PlatformShipmentLine` 一行关联一件库存并保留成本/商品快照。`ShipmentService.createDraft` 只从 `STOCKED + OWNED` 且无活跃明细的库存创建草稿；确认发货后库存为 `PLATFORM_SHIPPED`。

正常行级状态由 `src/lib/shipment-status-machine.ts` 和 `applyShipmentLineAction` 统一约束：`DRAFT -> SHIPPED -> RECEIVED -> IN_WAREHOUSE -> LISTED`，并有 `REJECTED -> RETURNING -> RETURNED` 支路。M3-0 禁止写 SOLD。

`PlatformReturnInspection` 对 `shipmentLineId` 唯一。同一库存可有多个周期，每个 `PlatformShipmentLine` 的历史独立保存。只有 `RETURNED + OWNED` 的当前周期可由 `PlatformReturnInspectionService.inspectReturn` 写入：`RESTOCKED` 原子恢复 `STOCKED`（要求库位）；`PROBLEM` 原子转问题件；`PENDING_DECISION` 保持待决定。旧 `confirm-restocked` API 仅兼容，响应带 `Deprecation: true`，仍委托同一服务。

`PlatformShipmentBatch` 已有 `outboundShippingCost`、`packagingCost`、`otherShipmentCost`、`returnShippingCost`；当前平台退回统计只读取 `InventoryItem.unitCost`，这些费用没有纳入销售利润或售后净利润。这是已冻结边界。

## 5. 销售、到账与报表

| 阶段 | 权威对象 | 库存影响 | 关键规则 |
|---|---|---|---|
| 销售草稿 | `SalesService.createDraft`、`SaleOrder(DRAFT)`、`SaleLine` | 无 | 草稿不占用库存，不写 SOLD |
| 确认销售 | `SalesService.confirm` | 写 `SOLD` | 可售状态 + `OWNED` + 有效销售去重 + 销售前快照 |
| 到账 | `SalesService.settle` | 无 | 仅 `CONFIRMED/SETTLED`；可二次登记；首次非空 `settledAt` 保留；利润按行持久化 |
| 取消 | `SalesService.cancel` | DRAFT 不变；CONFIRMED 按快照恢复 | SETTLED 返回 409 |
| 报表 | `SalesReportService` | 无 | 只读；只统计 `CONFIRMED/SETTLED` |

`grossAmount` 是成交价，`expectedIncome` 是预计收入，`actualReceivedAmount` 是实际到账。`calculateSaleProfit` 按实际到账、预计收入、成交价减费用的优先次序计算，到账后把利润持久化到 `SaleLine.profitAmount`。报表和 SKU 利润分析读取销售订单/行快照，不以 `InventoryItem=SOLD` 作为销售成立依据。

## 6. 三类退回/退款边界

| 场景 | 货物流向 | 资金方向 | 关联事实 | 库存结果 | 退款与验货 |
|---|---|---|---|---|---|
| 采购售后 | 用户退给上游卖家 | 上游卖家退给用户 | PurchaseAfterSale、采购订单/明细 | 保持问题件语义，变更 ownershipStatus | PurchaseRefundRecord 订单退款；PurchaseRefundAllocation 行归属 |
| 销售售后 | 买家退给用户 | 用户退给买家 | SaleAfterSale、SaleOrder/SaleLine | 运输/待验货仍 SOLD；完成后仅选中商品恢复 STOCKED 或转 PROBLEM | SaleRefundRecord 订单退款；SaleRefundAllocation 行归属；独立退货验货 |
| 平台退回 | 平台退回给用户 | 无退款流水 | PlatformShipmentLine、PlatformReturnInspection | RETURNED 后验货决定 STOCKED/PROBLEM/PENDING_DECISION | 不创建采购或销售退款记录，不改变销售利润 |

## 7. 金额与利润口径

| 口径 | 来源 | 属性 | 使用边界 |
|---|---|---|---|
| 采购实付 | `totalAmount + shippingAmount` | 派生 | 分摊确认必须严格相等 |
| 单件采购成本 | `InventoryItem.unitCost` | 持久化快照 | 验货完成时的整数分拆 |
| 采购退款 | `PurchaseRefundRecord` | 原始事实 | 订单级只计一次；Allocation 只归属行 |
| 行净现金成本 | 成本快照减采购退款分配 | 派生 | 不含未建模的退货运费/人工 |
| 成交价/预计收入/实际到账 | `SaleOrder` 三个独立字段 | 原始事实 | 不能互换 |
| 原销售利润 | `SaleLine.profitAmount` 合计 | 持久化快照 | SalesService.settle 写入 |
| 销售退款/行退款 | SaleRefundRecord / SaleRefundAllocation | 原始事实 | 前者订单去重，后者仅表达行归属 |
| 净到账 | 原实际到账减订单退款 | 派生 | `getSalesAfterSaleFinancials` 共享只读聚合 |
| 售后净利润 | 原行利润减行退款加 RESTOCKED 成本冲回 | 派生 | PROBLEM 和仅退款不冲回成本 |

权威计算使用 `Prisma.Decimal`；API 金额序列化为字符串。部分只读前端摘要为展示使用 `Number` 聚合，不回写数据库，也不作为财务权威。

## 8. 报表与统计一致性

| 视图/指标 | 聚合来源 | 去重规则 |
|---|---|---|
| 销售总览、销售明细、SKU 利润、图表 | `SalesReportService` + `getSalesAfterSaleFinancials` | 销售订单按 SaleOrder；订单退款按 SaleRefundRecord；行退款只按 Allocation |
| 销售/库存/采购追溯 | 销售详情 API + 共享售后财务聚合 | 有效销售仅 CONFIRMED/SETTLED；DRAFT/CANCELLED 仅历史 |
| SKU 库存汇总 | `InventoryService.skuSummary` | 商品名 + normalizeSku；SOLD 排除未售数量和成本 |
| 平台退回资产 | `getPlatformReturnSummary` + TodoService | 当前资产按 InventoryItem；历史周期按 ShipmentLine；待决策是 RETURNED 子集 |

未发现同一退款、平台退回或组合销售因页面/图表另建公式而重复聚合的证据。平台退回不进入退款/利润模型，符合当前冻结边界。

## 9. owner 隔离与访问保护

- 抽样的 Service/API 查询均带 `ownerId`；跨 owner 或不存在记录按不存在处理为 404。
- 客户端 API 无 `ownerId` 写入入口。
- 运行时仍使用固定 `DEFAULT_OWNER_ID = "default-user"`；访问保护是全局 `APP_PASSWORD` cookie，而非用户身份上下文。

结论：当前单用户部署没有发现“请求自行指定 ownerId 读取他人数据”的漏洞，但也不具备真实多用户、角色权限或账户级隔离能力。这是 M4-E 的 P2 前置，不是当前已复现 P0/P1 泄漏。

## 10. 写入所有权矩阵

| 模型/字段 | 合法 Service 或受控写入 | 调用边界 |
|---|---|---|
| PurchaseOrder / PurchaseOrderItem | PurchaseOrderService、CostAllocationService、LogisticsService | 采购 API 委托 Service |
| Inspection / 初始 InventoryItem | InspectionService | 物流签收事务调用幂等补建；验货完成原子生成库存 |
| InventoryItem.itemStatus | InspectionService、ShipmentService、applyShipmentLineAction、SalesService、SalesAfterSalesService、PlatformReturnInspectionService | 页面不直接 Prisma 写入；M3-0 禁止 SOLD |
| InventoryItem.ownershipStatus | PurchaseAfterSalesService | 上游退回独立归属流转 |
| PlatformShipmentBatch/Line | ShipmentService、applyShipmentLineAction | 批次/行状态机和历史日志 |
| SaleOrder/SaleLine/SaleFeeLine | SalesService | 草稿、确认、到账、取消 |
| PurchaseAfterSale / PurchaseRefund | PurchaseAfterSalesService | Serializable、额度和幂等键 |
| SaleAfterSale / SaleRefund | SalesAfterSalesService | Serializable、额度和幂等键 |
| PlatformReturnInspection | PlatformReturnInspectionService | 退回行唯一、幂等重试、最终结果锁定 |
| InventoryActionLog | 多个 Service；另有 `/api/inventory/action-log` 直接创建日志 | 后者不写库存，但缺少 Zod/动作白名单，列 P2 |

未发现 Route、React 组件或报表服务直接修改采购金额、销售金额、退款、`InventoryItem.itemStatus` 或写入新的 SOLD 路径。

## 11. 验证覆盖矩阵

| 能力 | 验证证据 | 主要方式 | 缺口 |
|---|---|---|---|
| M1 采购、附件、分摊 | `verify:m1` | HTTP + 数据库清理 | 全量人工 UX 未单独自动化 |
| M2-A 物流 | `verify:m2a` | Mock + HTTP | 真实第三方物流按范围未实现 |
| M2-B 验货、库存、提醒 | `verify:m2b` | 成本拆分、Service/HTTP | 无 OCR，按范围未实现 |
| M3-0 寄送 | `verify:m30` | 状态机/HTTP | 真实平台接口未实现 |
| M3-A/C 销售到账 | `verify:m3a/m3c` | Service/HTTP，M3-C Playwright | 外部平台账单同步未实现 |
| M3-B 报表 | `verify:m3b` | 聚合/API，Playwright | 无导出/财务对账 |
| SKU 与状态契约 | `verify:inventory-summary`、`verify:item-status-contract` | 单元/API/精确清理 | 历史数据治理需运营确认 |
| M3-D1/D2 售后 | `verify:m3d-purchase/m3d-sales` | Serializable、幂等、库存恢复、路由 | 无自动退款渠道 |
| M3-D3 平台退回 | `verify:m3d-platform-return` | 并发/多周期/跨页 Playwright | 未建模平台退回费用分摊 |

脚本使用唯一 `runId` 和 finally 精确清理。多数较早脚本默认回退到 `127.0.0.1:3000`，但支持 `APP_BASE_URL`；封板执行必须传入独立临时端口，不能借用旧 3000 实例。

## 12. 技术债分级

### P0

无。未发现可复现的重复销售、退款超额、半更新、状态机绕过或跨 owner 任意读取证据。

### P1

无。主链验证和数据库审计没有发现阻断当前单用户 M1-M3 闭环的一致性错误。

### P2

1. **真实多用户身份与权限尚未落地**。证据：`src/server/constants.ts` 固定 `DEFAULT_OWNER_ID`，`src/proxy.ts` 仅使用全局 `APP_PASSWORD`。当前不阻断 M4-A，但阻断公开多用户部署；最小修复是 M4-E 引入认证上下文并补跨用户 HTTP/浏览器测试。
2. **库存状态写入契约清单不完整**。证据：状态契约未列出销售售后完成、销售取消和草稿寄送取消的合法恢复写入。当前不阻断 M4，但在任何状态扩展前应更新契约和测试。
3. **库存动作日志存在直接 Route 写入**。证据：`src/app/api/inventory/action-log/route.ts` 以未校验 JSON 创建日志。不会改变库存或金额，但动作日志可被任意 actionType 污染；后续应收敛到 Service 或添加 Zod/白名单。若 M4 使用日志做经营审计，应先处理。
4. **平台寄送/退回费用未纳入完整经营利润**。费用字段已经存在但没有分摊规则。当前不阻断手工行情 M4-A；做完整经营利润比较前必须另行冻结。

### P3

1. 9 个既有 lint warning：未使用变量与 Hook 依赖项，不构成当前业务失败，但降低静态信号质量。
2. 部分只读前端摘要使用 `Number` 聚合字符串金额；后端仍为 Decimal 权威，后续应下沉为服务端 DTO。
3. 旧文档含阶段性 “in progress” 历史描述；应以本文件和最终冻结段落为准。
4. 验证启动约定不统一：多脚本依赖外部 `APP_BASE_URL`，后续测试基础设施应统一临时服务器生命周期。

## 13. 最终冻结与 M4 建议

M1-M3 可以保持 FROZEN：不为审计便利改动成本、退款、状态机或 SOLD 规则；所有未来变更继续使用现有 Service/事务边界；新状态、退款或平台费用必须先写规则和验证。

### 方向比较

| 方向 | 外部依赖 | 现有数据可用性 | 风险/投入 | 用户直接价值 |
|---|---|---|---|---|
| 平台价格自动采集 | 高：API、登录、风控/合规 | 不稳定 | 高 | 高但不确定 |
| 手工行情与采购决策参考 | 无 | SKU、成本、销售、库存、售后事实已具备 | 低到中 | 高且立即可用 |
| 飞书/企微通知 | 中：通知通道 | 待办、报表基础已具备 | 中 | 中 |
| 自动补货/复杂经营分析 | 无到中 | 只能先做部分；平台费用未建模 | 中到高 | 中 |
| 多用户/权限/部署 | 无外部行情依赖 | 需认证与审计补齐 | 高 | 团队化前置 |

### 唯一推荐主路线：M4-A 手工行情与采购决策参考 V1

不建议先做平台爬虫或自动价格采集：API 稳定性、登录、风控、合法性和数据质量都尚未被证明。M4-A 应只记录、统计和提示；不自动判断是否收货、不自动推荐出售平台、不做卖家分析。

建议拆刀：

1. **M4-A0**：口径与数据源审计，冻结 SKU 归并、手工行情来源、价格时间、目标利润与过期规则。
2. **M4-A1**：手工行情记录模型和录入，不接爬虫。
3. **M4-A2**：目标采购价与透明利润试算，只给参考，不写采购或销售状态。
4. **M4-A3**：行情趋势、库存对比和低于目标利润提醒。
5. **M4-A4**：站内/手工日经营报告，再评估飞书/企微通知。
6. **M4-A5**：外部平台适配层可行性研究，只有合规稳定数据源被证明后再立项。

## 14. 本轮执行记录

已执行：`pnpm db:validate`、Prisma migration status、`pnpm audit:item-status`、`pnpm verify:item-status-contract`。本文档完成后按封板清单重新运行 lint、test、build 和 M1-M3 全部 verify；执行时使用临时独立端口和精确清理，不使用 reset。
