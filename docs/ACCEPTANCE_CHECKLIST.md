# 验收清单

## M6-A0 真实物流 API 接入设计验收

- [x] 审计采购 M2-A Mock、平台寄送、平台退回、采购售后、销售售后、普通销售、Todo 和日报的真实代码边界。
- [x] 确认当前不存在真实物流 Provider、通用 Carrier 枚举、通用物流定时同步或 webhook 记录。
- [x] 确认现有采购 Mock 签收会推进 `PENDING_INSPECTION`；真实接入前必须拆分物流事实与业务动作。
- [x] 使用官方页面比较聚合服务、云市场商品和快递公司直连，不把价格、额度或认证条件描述为固定事实。
- [x] 冻结五类业务物流链路、通用状态映射、人工确认边界、幂等事件、轮询、错误重试、凭证和隐私规则。
- [x] 冻结本地 V1 为主动轮询；Webhook 留待稳定公网部署后评估。
- [x] 冻结外部物流不得直接写库存、`SOLD`、验货、退款、平台业务状态或成本。
- [x] 冻结 M6-A1～M6-A4 的最小实施拆分；M6-A1 尚未开始。
- [x] M6-A0 仅修改文档，没有 schema、migration、源码、数据库、真实物流查询、飞书发送或 Windows 任务变更。

## M5-A2 采购订单商品批量添加

- [x] 详情页有独立的“批量添加商品”入口，支持新增空白行、复制行、删除行、复制第一行生成多行和一次性保存。
- [x] 每批最多 50 行，每行固定数量 1；相同商品名和 SKU 保存为独立明细，不自动合并。
- [x] 批量 API 使用严格契约、复用 SKU/Decimal 校验、owner 隔离和下游锁定守卫，并在单事务中全批提交或全批回滚。
- [x] 覆盖中文往返、参考成交总额、订单金额/退款/库存不变、分摊/验货/库存/采购售后/采购退款锁定、跨 owner 和禁止敏感字段。
- [x] `pnpm verify:m5-purchase-items` 通过 98 项有意义检查；M5-A2 未修改 schema、migration、状态机或 `SOLD` 写入规则。

## M5-A1 采购订单商品明细维护

- [x] 创建采购订单时可选填写“商品参考成交总额（可选）”，未填写显示“未填写”。
- [x] 订单创建后可添加、编辑和删除商品明细；删除最后一条明细返回冲突错误。
- [x] 创建页和详情页维护使用相同的字段和严格金额校验；非法金额和未知字段返回 400。
- [x] 付款本身不锁定明细；分摊、库存、验货、采购售后和采购退款存在时由服务端锁定。
- [x] 参考成交总额不改变订单实付、成本分摊、库存成本、采购退款或日报统计。
- [x] `pnpm verify:m5-purchase-items` 通过 98 项 M5-A1/M5-A2 检查，验证数据按精确 ID 清理。

## M4-A 行情与采购决策（M4-A3 API 已完成）

- [x] 审计确认当前不存在 `Product` / `Sku` 主数据和稳定产品外键；名称 + 标准化 SKU 仅是当前汇总键与精确筛选键。
- [x] 冻结使用独立 `MarketItem + MarketQuote` 作为行情领域稳定键，不重构 M1～M3 商品与 SKU 生命周期。
- [x] 冻结展示价格、预计收入、成交价和实际到账四种独立金额语义；采购试算只使用用户确认的 `EXPECTED_INCOME`。
- [x] 冻结利润和最高采购价为只读参考计算，不创建采购单、不修改采购成本、库存、销售、售后或 `SOLD`。
- [x] 冻结 Quote 历史优先、失效而非硬删除、来源/时间/确认状态可见，以及未来自动适配器不得覆盖人工确认数据。
- [x] M4-A3：受访问密码保护的 MarketItem / MarketQuote API 已实现；严格 Zod 校验拒绝未知字段和客户端 `ownerId`。
- [x] API 返回稳定嵌套错误契约：参数错误 400、跨 owner 404、状态与并发冲突 409、未知错误 500 且不泄露堆栈。
- [x] HTTP 验证覆盖商品/报价生命周期、当前与历史查询、分页、金额与时间序列化、owner 隔离、幂等确认与失效、并发替代 Quote、夹具精确清理和临时端口释放。
- [ ] M4-A 后续：采购决策计算、预计利润、最高采购价、多平台比较、页面、图表、通知和自动采集。

- [x] M4-A5：已冻结预计收入、平台售价和实际到账的三类金额口径；固定目标利润、明确附加成本、最高采购价公式、费用防重复规则、即时试算边界及 M4-A6/A7 实施契约。
- [x] M4-A6：采购决策纯规则层、只读 Service、严格试算 API、Decimal 输出和当前 `EXPECTED_INCOME` 复用已完成；采购试算 UI 尚未实现。
- [ ] M4-A7：行情详情采购试算工作台与多平台只读对比（当前暂停）。
- [x] M4-A1：行情商品与行情记录模型、纯加法 migration、数据约束、Prisma Client 生成与 `verify:m4-market` 骨架。
- [x] `MarketPlatform` 覆盖得物、95分、闲鱼、其他，且不复用缺少闲鱼的寄送平台 enum。
- [x] `MarketQuoteType` 仅有 `EXPECTED_INCOME`、`LISTING_PRICE`、`MANUAL_REFERENCE`；`MarketQuoteSourceType` 仅有 `MANUAL`。
- [x] `MarketItem` 不强制复合字符串唯一；同名称/SKU 的不同版本、成色、包装或配件可保留为独立行情对象。
- [x] `MarketQuote` 使用 Restrict 历史外键；金额非负、有效期、失效原因配对、空白来源和 MarketItem 文本/目标利润均由 CHECK 保护。
- [x] M4-A1 未给采购、库存、销售、寄送或售后模型增加 `marketItemId`，未新增 Service/API/UI/计算或库存写入。
- [x] M4-A2：MarketItem/MarketQuote Service、owner 隔离、当前有效 Quote 查询、确认、失效、修正、只读列表/详情/历史 DTO 与 86 项 `verify:m4-market` 验证。
- [x] M4-A2 不保存 currentQuote 缓存；当前有效 Quote 仅从确认、未失效、未过期且非未来记录中按 `recordedAt/createdAt/id` 派生。
- [x] M4-A2 未新增 HTTP API、页面、采购利润/最高采购价计算、平台推荐、通知、自动采集或任何 M1～M3 状态写入。
- [ ] M4-A3：目标利润和最高采购价 Decimal 计算、多平台比较与风险提示。
- [ ] M4-A4：人工录入、行情列表/详情、历史图表和只读采购参考计算器。

## M4-B 每日经营报告与通知（M4-B0 设计已冻结）

- [x] M4-B0：冻结昨日事件、当前快照和今日待办三类口径；后续显式采用 `Asia/Shanghai` 与 `[start, end)`。
- [x] M4-B0：冻结销售、售后、采购退款、库存资产、平台退回和行情摘要的既有权威来源与去重边界。
- [x] M4-B0：冻结 P0 至 P3 待办/风险分级、报告 DTO、飞书群机器人和 Windows 任务计划程序的后续边界。
- [x] M4-B1：只读日报聚合层、统一 DTO、严格日期/时区 API、日报专用待办/风险/人工行情摘要及 HTTP 验证。
- [x] M4-B2：日报页面与移动端验收。
- [x] M4-B3：飞书群机器人适配器、日报摘要与手动发送。
- [ ] M4-B4：发送记录、幂等、重试和 Windows 定时执行。
- [ ] M4-A5：真实 UI 验收、跨页面口径复核与模块封板。

## M3-D3-2 平台退回验货 Service

- [x] `PlatformReturnInspectionService.inspectReturn` 对 owner、ShipmentLine、InventoryItem、`OWNED` 和 `RETURNED` 当前事实执行 transaction 内校验。
- [x] `PENDING_DECISION` 保持库存与寄送明细为 `RETURNED`；`RESTOCKED` 原子恢复 `STOCKED`；`PROBLEM` 原子转为问题件，ShipmentLine 始终保留 `RETURNED`。
- [x] 终态不可普通修改；同一终态请求幂等；并发最终请求只能留下一个有效结论、一次库存更新和一条专用 ActionLog。
- [x] 旧 `confirmRestocked` 的两个入口均已委托专用 Service，不再直接写入平台退回库存。
- [x] `RETURNING`、`RETURNED` 已有服务端待办口径，并持续排除在销售、平台寄送和正常可售候选外。
- [x] `pnpm verify:m3d-platform-return` 覆盖 89 项模型、Service、待办、候选与精确夹具清理检查。
- [ ] M3-D3-3：正式 API、DTO 与稳定错误契约。
- [ ] M3-D3-4：寄送详情、库存追溯与待办 UI。

## M3-D3 平台退回验货（设计冻结，未实施）

- [x] 平台退回与采购售后、销售售后、全部退款流水隔离；不使用 `RETURNING_TO_UPSTREAM_SELLER`。
- [x] 审计确认当前 M3-0 可从 SHIPPED / RECEIVED / IN_WAREHOUSE / LISTED / REJECTED 进入 RETURNING，再进入 RETURNED。
- [x] 审计确认当前 `confirmRestocked` 可绕过验货直接恢复 STOCKED，且 line 保留 RETURNED；后续 M3-D3-2 必须收口，当前未修改。
- [x] 冻结采用 `PlatformShipmentLine + PlatformReturnInspection + PlatformReturnActionLog`，不新增 `PlatformReturnCase` 或 ItemStatus。
- [x] M3-D3-1：`PlatformReturnInspectionResult`、`PlatformReturnInspection`、`PlatformReturnActionLog`、纯加法 migration、CHECK/索引/外键和 44 项模型验证已完成；新模型不自动改库存。
- [ ] M3-D3-2：验货 service、事务保护、旧 confirmRestocked 收口、待办与候选保护。
- [ ] M3-D3-3：API、DTO 与错误契约。
- [ ] M3-D3-4：批次详情/库存追溯/待办 UI。
- [ ] M3-D3-5：跨页面统计一致性和 `verify:m3d-platform-return` 封板。

## M3-D2-1 销售售后数据模型验收

- [x] 销售售后与采购售后使用独立模型、退款流水和验货记录；不存在统一售后主表或共用退款流水。
- [x] `SaleAfterSaleType` 仅包含 `REFUND_ONLY`、`RETURN_AND_REFUND`；领域差异由 enum 类型和模型表达，不在值中增加前缀。
- [x] 售后行精确关联 `SaleLine` 和 `InventoryItem`，且同一售后单内禁止重复销售行或库存。
- [x] 销售退款流水使用独立的全局唯一幂等键；退款分配不能重复关联同一退款流水和售后明细。
- [x] 申请退款、批准退款、实际退款和退款分配的正金额/非负约束由数据库 CHECK 保护。
- [x] 买家退货验货使用独立 `SaleAfterSaleInspection`，不复用采购 `Inspection`；本刀只保存结论，不改变库存。
- [x] 模型创建不会改变 `SaleOrder.status`、`actualReceivedAmount`、`settledAt`、销售行历史快照或 `InventoryItem` 状态。
- [x] `pnpm verify:m3d-sales` 使用唯一 runId 和精确 ID 清理；销售售后 service、API、页面、状态机、退款动作和库存恢复尚未实现。

## M3-D1 采购售后封板验收

- [x] `InventoryOwnershipStatus` 仅有 `OWNED`、`RETURNING_TO_UPSTREAM_SELLER`、`RETURNED_TO_UPSTREAM_SELLER`，现有库存默认 `OWNED`。
- [x] 采购售后模型与销售售后模型隔离；不存在统一售后主表或共用退款流水。
- [x] 采购售后行精确关联采购明细、验货和库存，并约束同一售后单内重复实物。
- [x] 请求退款、真实退款、退款分配的正金额约束由数据库 CHECK 保护。
- [x] 退款幂等键全局唯一；退款分配不能重复关联同一退款流水和售后明细。
- [x] 采购售后 service、API、页面、状态机、退款动作和资产归属写入均已完成；销售售后与平台退回验货未实现。
- [x] `pnpm verify:m3d-purchase` 使用唯一 runId 并精确清理测试数据，覆盖退款净口径和跨页 DTO。

## M3-D1-2 Purchase After-Sales Service Acceptance

- [x] Draft creation and editing validate the purchase item, inspection, inventory and owner chain without changing inventory or paid total.
- [x] Submitted cases occupy the selected inventory; duplicate active cases are rejected.
- [x] Approval, refund allocation, idempotency and order-level refund ceilings are transaction-protected.
- [x] Return shipment and seller receipt transition ownership while preserving `PROBLEM`.
- [x] Non-owned inventory is blocked from sales, shipment, reminders and unsold SKU costs.
- [x] 采购售后 API、列表、发起页和详情页已完成；失败操作保留弹窗输入并显示服务端错误。

## ItemStatus retirement acceptance

- [ ] Prisma `ItemStatus` contains only the eleven formal V1 values.
- [ ] Retired InventoryItem values are rejected by UI/API filters and are not writable.
- [ ] `PENDING_INSPECTION` remains supported.
- [ ] `SaleOrder.SETTLED` and `PlatformShipmentLine.LISTED` remain unchanged.
- [ ] `REMOVED` remains unimplemented and is absent from the schema.

> 每次修改后必须逐项验证。全部通过才能提交。

---

## InventoryItem 状态写入收口验收

- [ ] 通用库存 PATCH 不能写入 `itemStatus`，包括嵌套或别名绕过。
- [ ] 库存列表/API 仅接受当前正式状态；旧状态筛选返回 400。
- [ ] 销售草稿、销售确认、销售取消恢复和寄送批次均拒绝旧状态。
- [ ] 旧状态不进入效期、压货提醒和 SKU 未售/成本指标。
- [ ] 历史旧状态详情显示待迁移提示且不提供基于该状态的操作。
- [ ] `pnpm verify:item-status-contract` 使用唯一 runId 创建并精确清理测试数据。

## 自动化验证（必须全部通过）

```bash
pnpm prisma migrate dev   # 数据库迁移
pnpm prisma db seed       # 种子数据
pnpm lint                 # ESLint（0 errors）
pnpm test                 # Vitest（38 tests）
pnpm build                # Next.js build
pnpm verify:m1            # M1 采购验证（9 checks）
pnpm verify:m2a           # M2-A 物流验证（7 checks）
pnpm verify:m2b           # M2-B 验货库存验证（9 checks）
pnpm verify:m30           # M3-0 平台寄送验证（15 checks）
pnpm verify:m3a           # M3-A 销售验证
```

---

## 页面功能验收（逐页点击）

### 工作台 `/`

- [ ] 统计卡片数量正确，可点击跳转筛选页
- [ ] 待办中心显示待办列表，每条有标题+描述+动作
- [ ] 已阅读按钮：点击后待办消失，24h 后重新出现
- [ ] 处理按钮：展开菜单，动作根据类型动态显示
- [ ] 业务处理动作：修改真实数据，待办消失/变化
- [ ] 最近采购订单可点击进入详情

### 采购订单列表 `/purchases`

- [ ] 订单行可点击（cursor-pointer + hover）
- [ ] 搜索支持订单号、卖家昵称、商品名、SKU
- [ ] 筛选：采购状态、物流单号、分摊状态
- [ ] `?todo=missingTracking` / `?todo=logisticsIssues` 筛选正确
- [ ] `?tracking=missing` 筛选正确
- [ ] 清除筛选恢复正常

### 采购订单详情 `/purchases/[id]`

- [ ] 订单信息完整（含卖家昵称）
- [ ] 物流卡片：Mock 提示横幅、测试规则、必填标记
- [ ] 保存物流：填写 SF + DELIVERED1 → 刷新 → 已签收
- [ ] 保存/刷新按钮 loading 不卡死
- [ ] 手动标记已签收：二次确认 → 状态更新
- [ ] 不满足删除条件的订单不显示删除按钮
- [ ] 满足删除条件的订单可正常删除
- [ ] 从库存详情进入时显示"返回库存详情"

### 新建采购订单 `/purchases/new`

- [ ] 可添加/删除多个商品
- [ ] 卖家昵称可填写
- [ ] 创建成功后跳转订单详情
- [ ] 创建失败显示明确错误
- [ ] 按钮类型正确（添加/删除=button，提交=submit）

### 成本分摊 `/purchases/[id]/allocate`

- [ ] 一单一商品自动分摊并显示已确认
- [ ] 一单多商品显示手动分摊表
- [ ] 分摊合计不等于 paidTotal 不能确认
- [ ] 保存按钮不卡死
- [ ] 加载失败显示错误卡片（不空白）

### 待验货 `/inspections`

- [ ] 待验货记录列表正确
- [ ] 可点击进入验货向导
- [ ] 无 Base UI nativeButton 错误

### 验货向导 `/inspections/[id]`

- [ ] 6 步向导正常
- [ ] isNew=true 时跳过瑕疵字段
- [ ] isNew=false 时显示瑕疵字段
- [ ] 库位可填写
- [ ] 保存并继续不报 500
- [ ] 验货通过/问题件正常完成

### 编辑验货 `/inspections/[id]?edit=true`

- [ ] 所有字段可编辑
- [ ] 保存后库存详情同步更新
- [ ] 不重复生成库存

### 库存列表 `/inventory`

- [ ] 库位列显示
- [ ] 出售方式列显示
- [ ] 搜索支持库存编号、商品名、SKU、库位
- [ ] `?reminder=xxx` 筛选正确
- [ ] 可筛选“已售出”
- [ ] SOLD 显示“已售出”
- [ ] PLATFORM_LISTED 显示“平台已上架 / 可售”，不能显示成已售出
- [ ] RETURNED 显示“已退回，待重新入库”，不能显示成已入库
- [ ] 库存列表不暴露英文枚举

### 库存详情 `/inventory/[id]`

- [ ] 位置大类 + 具体库位显示
- [ ] 出售方式可修改
- [ ] 编辑验货信息按钮可跳转
- [ ] 查看采购订单携带 returnTo
- [ ] 销售结果卡片只读展示
- [ ] SOLD 库存显示销售单号、平台、成交价、实际到账、利润
- [ ] 未售库存显示“暂无销售记录”
- [ ] CANCELLED 销售只显示为历史，不作为当前已售
- [ ] DRAFT 销售不显示为当前已售
- [ ] SOLD 但无有效销售记录显示“销售记录缺失”

---

## 效期提醒验收

- [ ] saleMode=NONE，400天 → DISTANCE_TO_395_WITHIN_7_DAYS
- [ ] saleMode=NONE，370天 → DISTANCE_TO_365_WITHIN_10_DAYS
- [ ] saleMode=NONE，293天 → EXPIRY_UNDER_365
- [ ] saleMode=NINETY_FIVE，85天 → NINETY_FIVE_EXPIRY_UNDER_90
- [ ] saleMode=NINETY_FIVE，58天 → NINETY_FIVE_EXPIRY_UNDER_60
- [ ] 同一件库存只出一个效期提醒
- [ ] PROBLEM 库存不产生效期/压货提醒

---

## 待办动作矩阵验收

| 待办类型 | 必须有的动作 | 不能有的动作 |
|---------|------------|------------|
| DISTANCE_TO_395_WITHIN_7_DAYS | 已安排得物闪电 | — |
| EXPIRY_UNDER_395 | 改走得物普通 | 已安排得物闪电 |
| DISTANCE_TO_365_WITHIN_10_DAYS | 已降价普通出售 | — |
| EXPIRY_UNDER_365 | 转闲鱼、修改效期、标记问题件 | 已降价普通出售、改走得物普通 |
| NINETY_FIVE_EXPIRY_UNDER_90 | 95分降价出售、转闲鱼 | 放到95分 |
| NINETY_FIVE_EXPIRY_UNDER_60 | 转闲鱼、修改效期、标记问题件 | 放到95分、95分降价出售 |

---

## 业务闭环验收

- [ ] 已阅读只隐藏 24h，不改业务数据
- [ ] 业务处理动作真实修改 InventoryItem
- [ ] 修改后写入 InventoryActionLog
- [ ] 预警解决写入 TodoResolution（当前阶段消失）
- [ ] 修改后所有页面同步显示（列表、详情、工作台）
- [ ] 同一订单多库存只修改被点击的一件
- [ ] API 失败时待办不消失，显示 toast 错误
- [ ] 刷新页面后数据仍存在
- [ ] 顶部统计数量和待办列表一致

## M3-0 平台寄送批次验收

### 创建和发货

- [ ] 创建草稿批次后库存 itemStatus 仍是 STOCKED
- [ ] 草稿批次占用库存，不能加入其他批次
- [ ] 确认发货后 lineStatus=SHIPPED, itemStatus=PLATFORM_SHIPPED
- [ ] 确认发货后 saleMode 按 purpose 更新
- [ ] DRAFT 批次可编辑批次信息（物流/成本/备注）
- [ ] 确认发货弹窗可补齐物流信息
- [ ] 装箱核对可勾选

### 状态流转

- [ ] 平台签收：RECEIVED / PLATFORM_RECEIVED
- [ ] 入仓成功：IN_WAREHOUSE / PLATFORM_IN_WAREHOUSE ≠ SOLD
- [ ] 鉴别通过/待结算（得物普通）：IN_WAREHOUSE / PLATFORM_IN_WAREHOUSE ≠ SOLD
- [ ] 上架可售：LISTED / PLATFORM_LISTED ≠ SOLD
- [ ] 平台拒收：REJECTED / PLATFORM_REJECTED，必须填写原因
- [ ] 退回中：RETURNING / RETURNING
- [ ] 已退回：RETURNED / RETURNED ≠ STOCKED
- [ ] 确认重新入库：itemStatus→STOCKED，line 保持 RETURNED
- [ ] 重新入库后库存可再次加入新批次

### 安全规则

- [ ] 全流程不产生 SOLD
- [ ] RECEIVED→SHIPPED 非法跳转被拦截
- [ ] LISTED→IN_WAREHOUSE 非法跳转被拦截
- [ ] SOLD/PROBLEM 库存不能执行寄送操作
- [ ] batch.status 自动汇总
- [ ] API 失败不半更新

### 展示

- [ ] 状态枚举全部显示中文（不暴露 PLATFORM_SHIPPED 等英文）
- [ ] 库存详情显示平台寄送追溯卡片
- [ ] 平台状态库存继续效期提醒
- [ ] 平台状态库存不进入本地压货提醒
- [ ] 统计卡片和筛选列表数量一致

## M3-A V1 销售出库验收（已完成并冻结）

详见 `docs/M3A_V1_SPEC.md`。

- [ ] 创建销售草稿不改变库存状态
- [ ] DRAFT 不占用库存，多个草稿可选择同一库存
- [ ] 确认销售后库存变 SOLD（唯一入口）
- [ ] 一件库存不能重复确认销售
- [ ] 取消 CONFIRMED 恢复 preSaleItemStatus
- [ ] SETTLED 不能取消
- [ ] actualReceivedAmount 优先计算利润
- [ ] expectedIncome 次优先计算利润
- [ ] grossAmount + feeLines 不重复扣费
- [ ] SOLD 不进效期提醒
- [ ] SOLD 不进压货提醒
- [ ] PLATFORM_LISTED 不会自动变 SOLD
- [ ] /sales/new 中 PLATFORM_LISTED 可选择，但明确“不等于已售出”
- [ ] /sales/[id] 操作区只调用 sales API，不直接写库存状态
- [ ] /inventory/[id] 销售追溯只把 CONFIRMED / SETTLED 当有效销售
- [ ] /purchases/[id] 销售汇总只统计 CONFIRMED / SETTLED
- [ ] DRAFT / CANCELLED 不计入已售汇总
- [ ] 采购订单详情每件库存显示是否已售、销售单号、利润和销售订单链接
- [ ] API 失败不半更新
- [ ] 利润刷新后仍正确

## SKU 生命周期与 ItemStatus 契约验证映射

`pnpm verify:inventory-summary` 以精确创建 ID 的测试数据覆盖以下业务要求：

1. `normalizeSku` 的空值、空格、大小写与内部字符规则由单元测试覆盖。
2. 采购 SKU 会预填到验货，并在验货完成后写入库存。
3. 单件 SKU-only 修正不会修改成本、状态、出售方式或库位。
4. 批量补录默认仅补空 SKU；跨商品请求被拒绝，不产生半更新。
5. DRAFT 销售确认时按 `inventoryItemId` 刷新 SKU 快照。
6. CONFIRMED / SETTLED 后库存 SKU 修正不回写销售历史快照。
7. 标准化后的 SKU 聚合、精确商品 + SKU 查询、空 SKU 查询与分页总数均在服务端断言。
8. STOCKED 与 PLATFORM_LISTED 不等于 SOLD；SOLD 不进入未售数量与未售成本。
9. 当前 Prisma `ItemStatus` 不含 REMOVED；页面、API、Zod、标签和汇总均不暴露该状态。
10. `includeHistorical` 在 V1 仅包含 SOLD 库存档案。
11. SKU 汇总 API / 页面保持只读，测试数据在 finally 中按精确 ID 清理。

## M3-C V1 销售到账管理验收

- [ ] CONFIRMED 销售可登记实际到账、到账时间和到账备注。
- [ ] SETTLED 销售可修改实际到账金额，但不覆盖首次到账时间。
- [ ] DRAFT / CANCELLED 登记到账返回 409。
- [ ] 负数到账金额和非法到账时间返回 400。
- [ ] 每次到账登记均保留 SaleActionLog 备注。
- [ ] 登记到账后 SaleLine.profitAmount 已按既有利润规则持久化。
- [ ] 登记到账前后库存状态不变，且没有新增 SOLD 写入路径。
- [ ] SETTLED 仍没有取消入口，后端取消请求返回 409。
- [ ] 销售列表显示最新实际到账与中文“已到账”状态。
- [ ] 销售报表、库存详情、采购订单追溯同步显示最新实际到账与已持久化利润。
- [ ] expectedIncome 不显示为实际到账，grossAmount 不显示为到账。
- [ ] 组合销售的采购订单汇总按 SaleOrder 去重，不重复累计订单级成交价、实际到账或费用。

## M3-D1-3 采购售后 API 验收

- [x] 创建、更新、提交、审核、退回、退款、完成和取消均通过 `PurchaseAfterSalesService`。
- [x] 列表、详情和可发起项查询按 owner 隔离；跨 owner 或不存在记录返回 404。
- [x] 金额为 Decimal 字符串，时间为 ISO 字符串或 `null`，不向客户端暴露 Prisma Decimal。
- [x] DRAFT 不占用问题件；进行中的采购售后不允许重复选中相同库存。
- [x] 退款流水支持幂等重试，额度/状态冲突返回 409，非法输入返回 400。
- [x] API route 不直接修改采购订单实付、库存状态或库存归属；页面已实现，销售售后未扩展。

## M3-D1-4/5 采购售后页面与净口径验收

- [x] 采购售后列表支持关键词、状态、类型、采购订单筛选和分页。
- [x] 发起页只从 eligible-items 选择问题件，逐件填写申请退款金额。
- [x] 详情页显示 totals、历史快照、当前资产归属、物流、退款流水、分配和操作日志。
- [x] 详情页仅按 API `availableActions` 显示操作，成功后重新读取详情；失败保留表单输入。
- [x] 采购订单和 OWNED 问题库存详情均可进入采购售后；销售售后和平台退回验货仍未实现。
- [x] 订单页显示原采购实付、累计采购退款、净采购实付和案件计数；退款记录只在订单级累计一次。
- [x] 库存页显示行级退款分配、原成本快照、净现金成本与资产归属；净现金成本不含退货运费或其他售后费用。
## M3-D2-3 销售售后 API 验收

- [x] 列表、详情与可发起销售行均按 owner 隔离，支持稳定分页和 JSON-safe DTO。
- [x] 草稿、提交、批准、拒绝、买家退货、退款、完成和取消路由均通过 `SalesAfterSalesService` 写入。
- [x] 非法参数返回 400；缺失或跨 owner 返回 404；状态、库存占用和退款额度冲突返回 409。
- [x] 退款支持显式分配与幂等重试：首次 201、相同重试 200、冲突重试 409。
- [x] `verify:m3d-sales` 已覆盖路由生命周期、DTO 和服务边界；M3-B/M3-C 真实浏览器会话验证通过。

## M3-D2-4 销售售后页面验收

- [x] 销售售后列表支持关键词、状态、类型、原销售单和分页筛选，筛选保留在 URL。
- [x] 发起页只使用 `eligible-lines` 返回的销售行，逐行人工填写申请退款，缺少可靠行成交金额时明确提示。
- [x] 草稿详情复用创建表单；提交、批准、退货物流、验货、退款、完成和取消只显示服务端 `availableActions`。
- [x] 详情分区显示原始销售事实、案件/订单退款总额、历史销售快照、当前库存事实、物流、验货、退款流水和操作日志。
- [x] 销售详情显示售后摘要与入口；库存详情显示销售售后追溯，历史售后不会因库存恢复而丢失。
- [x] 页面不直接写库存状态、原实际到账、SaleLine 快照或利润，也不新增 SOLD 写入路径。

## M3-D2-2 销售售后 service 验收

- [x] `SalesAfterSalesService` 状态机覆盖草稿、提交、批准、拒绝、仅退款、退货、验货、退款、完成和取消。
- [x] 销售售后使用 owner 隔离、Serializable + FOR UPDATE、P2034 有界重试和幂等退款记录。
- [x] 订单级和行级退款上限使用 Decimal；多行退款必须显式分配且合计一致。
- [x] 退货运输/收货/待验货阶段库存保持 `SOLD`，验货后只恢复选中库存。
- [x] `RESTOCKED` 恢复为 `STOCKED`，`PROBLEM` 恢复为 `PROBLEM`，`PENDING_DECISION` 阻止完成。
- [x] 仅退款完成不恢复库存；销售订单、销售快照、到账和利润不被售后覆盖。
- [x] `SalesService.settle` 拒绝低于已退款和锁定售后金额的实际到账。
- [x] `pnpm verify:m3d-sales` 真实 service 流程通过 66 项检查。

## M3-D2-5 销售售后财务与报表验收（已完成）

- [x] 订单退款按 `SaleRefundRecord` 去重，行退款按显式 `SaleRefundAllocation` 聚合。
- [x] 仅完成且 `RESTOCKED` 的买家退货才冲回一次冻结成本；`PROBLEM` 和仅退款不冲回。
- [x] 销售详情、售后详情、库存/采购追溯和报表展示同一套原值、退款、净到账和售后净利润。
- [x] 报表图表只消费共享只读聚合结果，支持筛选联动、URL 保留和中文状态展示。
- [x] 不新增 Prisma migration、SOLD 写入或 M3-0 状态机路径。
# M3-D3-3 Platform Return Inspection API

## M3-FINAL-0 冻结验收（2026-07-16）

- [x] Prisma schema 有效，日常开发库全部 19 个 migration 已应用。
- [x] 旧 InventoryItem 枚举退役审计通过；11 个正式状态与状态契约一致。
- [x] 采购、物流、验货、库存、平台寄送、销售、到账、售后和平台退回均已有代码与验证证据。
- [x] 销售报表只统计 `CONFIRMED / SETTLED`；`PLATFORM_LISTED` 不等于已售。
- [x] 采购退款、销售退款和平台退回保持独立模型与金额边界。
- [x] 销售与售后相关金融派生口径复用共享只读聚合，不改写原始销售事实。
- [x] M1～M3 维持 FROZEN；M4 尚未实施。
- [ ] M4-E 多用户认证、角色权限、真实 owner 上下文与跨用户验证。
- [ ] 平台寄送/退回费用分摊进入完整经营利润前的独立规则与验收。

- [x] Strict inspection payload validation and stable platform-return error responses.
- [x] Owner-scoped history, pending, and detail DTOs.
- [x] Inspection write route delegates all authoritative writes to `PlatformReturnInspectionService`.
- [x] Legacy confirm-restocked endpoint is compatibility-only, deprecated, and cannot bypass inspection records.
- [x] M3-D3-4 platform-return inspection UI workbench: 平台退回列表、详情验货工作台、导航、待办入口、寄送批次入口和库存多周期追溯。
- [x] 平台退回途中、已退回待验货、待进一步判断三类入口均跳转到带 `category` 的平台退回列表。
- [x] ShipmentLine 历史 `RETURNED` 与 InventoryItem 当前 `STOCKED` / `PROBLEM` 分开显示；最终验货后页面不提供普通修改入口。
- [x] 旧版直接入库记录只显示提示，页面不调用 deprecated confirm-restocked；所有页面写入均经平台退回验货 API。

## M3-D3-5 平台退回统计与最终封板

- [x] 平台退回统计按当前库存去重、按寄送明细保留多周期历史；成本仅来自 `InventoryItem.unitCost`，金额 JSON-safe。
- [x] `RETURNING`、首次待验货、待进一步判断、历史重新入库、历史问题件和旧版直接入库记录具有清晰且不重复的口径。
- [x] `PENDING_DECISION` 是已退回待处理资产子集；`RESTOCKED + STOCKED` 回归本地资产，平台退回问题件不进入可售/候选。
- [x] 平台退回页、库存资产口径、首页三项入口、待办、寄送批次详情和库存详情保持一致，并使用中文业务文案。
- [x] `verify:m3d-platform-return` 覆盖真实正常寄送前置、拒收/仓内/上架退回、多周期、旧版记录、并发冲突、刷新和跨页面验收；M3-D3 已 FROZEN。

## M4-A4 行情工作台验收

- [x] “行情管理”导航可进入 `/market`。
- [x] 行情列表支持 URL 筛选、分页、移动端卡片和桌面表格。
- [x] 行情商品可通过服务端 API 创建、编辑、停用和重新启用。
- [x] 历史报价可创建、确认、失效和替代修正；失败不清空已填写内容。
- [x] 当前行情、无当前行情原因和可用操作均由 API 结果展示。
- [x] 页面无 Prisma 直连、无采购/库存/销售状态写入、无 `SOLD` 写入路径。
- [ ] 预计利润、最高采购价和采购决策计算（后续阶段）。

## M4-B2 每日经营报告页面验收

- [x] `/reports/daily` 可通过“每日经营报告”导航访问，并只读取日报 API。
- [x] 默认使用 API 昨日口径；选择日期后同步 URL，刷新后保留日期。
- [x] 所选日期销售/采购事件与生成时当前资产、待办、风险快照明确分区。
- [x] 销售、采购、库存、待办、风险和人工行情均使用服务端 DTO；页面不重算金额、资产或阈值。
- [x] `PENDING_DECISION` 显示为已退回待处理子集，不重复计入资产总数。
- [x] 空数据、400、500、网络失败、重新加载和手机端卡片布局均有页面状态。
- [x] 页面无 Prisma、写入 API、`SOLD` 写入、飞书凭证或日报正文保存路径。
- [x] M4-B3 飞书手动发送已完成；M4-B4 自动发送、去重和发送记录已完成。
# M4-B4

- [x] Delivery 记录、CLI、Windows 计划任务脚本和 mock 验收完成，M4-B 标记为 FROZEN。
- [x] 不保存 Webhook、Secret 或完整日报正文。
- [x] 同日报普通发送不重复调用飞书；可重试失败按错误类型区分，发送前生成失败或空日报不发送。
