# M6 真实物流 API 接入规格

> 阶段：M6-A1 通用物流底座已完成
>
> 日期：2026-07-18
> 实施状态：已建立通用数据层和本地 MOCK；尚未接入、购买、注册或配置任何真实物流 API

## 1. 业务目标

M6 的目标是为采购入库、平台寄送、平台退回、采购售后退回和销售售后退货提供统一、可替换、只保存必要数据的物流查询能力。

系统应当：

1. 保存承运商、运单号、当前通用物流状态和必要的轨迹事件。
2. 支持人工刷新和不依赖浏览器的定时轮询。
3. 将供应商原始状态映射为统一物流状态。
4. 在物流签收、异常和长时间无更新时生成提示或待办。
5. 在供应商未配置或暂时不可用时继续允许人工维护原业务流程。
6. 保证外部物流事实不能越权完成验货、退款、销售或库存状态流转。

M6-A0 已冻结设计；M6-A1 已实现通用数据库模型、Provider 合同、状态映射、本地 MOCK 和限定写入新物流表的 Service。

## 2. 非目标

M6-A0 和后续 M6 V1 均不负责：

- 自动下单、叫件、打印电子面单或结算运费。
- 自动完成验货或自动创建 `InventoryItem`。
- 自动判定平台入仓、鉴别通过或上架。
- 自动确认采购退款或销售退款。
- 自动将退回商品恢复为 `STOCKED` 或改成 `PROBLEM`。
- 自动写入 `SOLD`。
- 自动改变成本分摊、采购成本、销售利润或售后财务口径。
- 保存收件人完整手机号、地址、身份证或供应商 Secret。
- 暴露本地 Windows 电脑作为公网 webhook 服务器。

## 3. 当前代码审计

### 3.1 采购订单物流

真实代码位置：

- `prisma/schema.prisma:358`：`PurchaseOrder`。
- `prisma/schema.prisma:369-373`：`carrierCode`、`trackingNo`、`shippedAt`、`deliveredAt`、`logisticsStatus`。
- `prisma/schema.prisma:434`：现有 `LogisticsEvent`，强关联 `PurchaseOrder`，不是通用物流事件表。
- `src/server/validation/purchase-order.ts`：承运商和运单号当前只做 trim、长度与必填校验，没有通用 Carrier 枚举或承运商代码映射。

`PurchaseOrder` 还保存最近同步时间、最近事件时间/文本和物流异常字段。它们是采购域的快照字段，可以继续用于兼容展示，但不能承担五类物流业务的通用模型。

### 3.2 M2-A Mock Logistics

真实代码位置：

- `src/server/adapters/logistics/logistics-adapter.ts`：已有最小 `LogisticsAdapter.queryTracking` 接口。
- `src/server/adapters/logistics/mock-logistics-adapter.ts`：唯一已实现适配器。
- `src/server/services/logistics-service.ts:6`：生产代码当前硬编码 `new MockLogisticsAdapter()`。
- `src/app/api/purchase-orders/[id]/tracking/route.ts`：保存采购运单。
- `src/app/api/purchase-orders/[id]/refresh-logistics/route.ts`：刷新模拟物流。
- `src/app/api/purchase-orders/[id]/manual-delivery/route.ts`：人工确认签收。
- `src/components/purchases/logistics-card.tsx`：采购详情物流卡片和 Mock 提示。

Mock 规则为：

- 运单号包含 `DELIVERED` 或以 `1` 结尾：`DELIVERED`。
- 包含 `EXCEPTION` 或以 `2` 结尾：`EXCEPTION`。
- 包含 `STALLED` 或以 `3` 结尾：`STALLED`。
- 其他：`IN_TRANSIT`。

重要现状：当前 `LogisticsService.refresh` 不是纯展示模拟。Mock 返回 `DELIVERED` 时，会在事务中将采购订单推进为 `PENDING_INSPECTION` 并调用 `ensurePendingInspectionsTx`。它不会创建库存，也不会完成验货，但会推进采购业务状态。因此真实供应商接入前必须拆开“外部物流事实写入”和“ERP 业务动作”。

### 3.3 平台寄送

真实代码位置：

- `prisma/schema.prisma:729`：`PlatformShipmentBatch` 保存寄往平台的 `carrierCode`、`trackingNo`、`shippedAt`、`receivedAt`。
- `prisma/schema.prisma:781`：`PlatformShipmentLine` 保存行级平台状态和退回物流字段。
- `src/server/services/shipment-service.ts:208`：`confirmShipped` 人工确认发货并将库存改为 `PLATFORM_SHIPPED`。
- `src/server/services/shipment-service.ts:256`：`markReceived` 人工确认平台签收并将库存改为 `PLATFORM_RECEIVED`。
- `src/server/shipments/applyShipmentLineAction.ts`：平台入仓、上架、拒收、退回等现有状态机入口。

平台签收、入仓、鉴别、上架均由现有业务 Service 人工维护，没有真实物流查询。外部承运商的 `DELIVERED` 只代表包裹运输签收，不等于平台业务系统确认收货、入仓或鉴别完成。

### 3.4 平台退回

`PlatformShipmentLine.returnCarrierCode`、`returnTrackingNo`、`returnedAt` 保存平台退回物流。`RETURNING` 和 `RETURNED` 是现有平台退回状态，最终恢复库存必须由 `PlatformReturnInspectionService` 的验货结果决定。

外部物流签收最多生成“平台退回可能已签收，待人工确认/验货”的提示，不得直接写 `RETURNED`、`STOCKED` 或 `PROBLEM`。

### 3.5 采购售后退回上游

真实代码位置：

- `prisma/schema.prisma:526`：`PurchaseAfterSaleCase`。
- `returnCarrierCode`、`returnTrackingNo`、`returnShippedAt`、`sellerReceivedAt` 保存退回卖家物流事实。
- `src/server/purchase-after-sales/purchase-after-sales-service.ts:370`：`markReturnShipped`。
- `src/server/purchase-after-sales/purchase-after-sales-service.ts:411`：`markSellerReceived`。

当前由用户人工登记寄回和卖家签收。外部签收不等于卖家同意退款，退款仍只由真实 `PurchaseRefundRecord` 表达。

### 3.6 销售售后买家退货

真实代码位置：

- `prisma/schema.prisma:1008`：`SaleAfterSaleCase`。
- `returnCarrierCode`、`returnTrackingNo`、`returnShippedAt`、`returnReceivedAt` 保存买家退货物流。
- `src/server/sales-after-sales/sales-after-sales-service.ts:324`：`markReturnShipped`。
- `src/server/sales-after-sales/sales-after-sales-service.ts:342`：`markReturnReceived`。
- `src/server/sales-after-sales/sales-after-sales-service.ts:359`：独立的退货验货。

当前由用户人工登记。运输中、收到和验货阶段库存继续保持 `SOLD`；只有既有售后完成事务可以按验货结果恢复 `STOCKED` 或转为 `PROBLEM`。

### 3.7 普通销售发货

`SaleOrder` 当前没有面向买家的承运商、运单号、发货时间或签收时间字段。M6 V1 不应把买家发货硬塞入售后或平台寄送模型。普通销售出库物流需在未来单独设计后才能进入真实物流同步范围。

### 3.8 待办和日报

`TodoService` 当前物流相关待办包括：

- `MISSING_TRACKING`。
- `LOGISTICS_EXCEPTION`。
- `LOGISTICS_STALLED`。
- `PENDING_INSPECTION`。
- 平台 `RETURNING`、已退回待验货和待进一步判断。

其中采购异常和停滞依赖 `PurchaseOrder.logisticsStatus`，当前来源是人工或 Mock。平台、采购售后和销售售后没有统一的外部物流异常/停滞待办。

`daily-business-report.ts` 当前按 `PurchaseOrder.deliveredAt` 统计采购到货，按采购订单状态统计待到货，按库存 `RETURNING` 统计平台退回途中，按销售售后 `RETURN_RECEIVED` 统计买家退货待验货。它没有统一物流聚合，也没有“运输中、今日签收、长期无更新、供应商同步失败”指标。

### 3.9 当前基础设施结论

| 能力 | 当前状态 |
| --- | --- |
| 通用 Carrier 枚举 | 不存在；各域使用自由字符串 |
| 运单号标准化 | 仅 trim；Mock 仅为规则匹配临时转大写 |
| 物流事件表 | 有，但仅属于采购订单，不能覆盖其他域 |
| 外部 Provider 字段 | 不存在 |
| Webhook 接收/重放记录 | 不存在 |
| 通用物流定时同步 | 不存在 |
| 外部请求适配器 | 只有采购 Mock 的最小接口 |
| 浏览器外任务框架 | 只有日报一次性 CLI/Windows 任务，可参考但不能直接混用 |

## 4. 五类物流链路边界

| 类型 | 寄件方 → 收件方 | 业务对象 | 外部签收后的提示 | 权威业务动作 |
| --- | --- | --- | --- | --- |
| `PURCHASE_INBOUND` | 上游卖家 → 用户 | `PurchaseOrder` | 采购可能已签收，待确认/验货 | 人工确认后复用现有事务推进 `PENDING_INSPECTION` 并补建 Inspection |
| `PLATFORM_OUTBOUND` | 用户 → 得物/95 分等平台 | `PlatformShipmentBatch` | 平台可能已签收 | 仍由 `ShipmentService.markReceived` 人工确认平台业务签收 |
| `PLATFORM_RETURN` | 平台 → 用户 | `PlatformShipmentLine` | 平台退回可能已签收，待确认/验货 | 人工确认退回，随后由平台退回验货 Service 决定库存 |
| `PURCHASE_AFTER_SALE_RETURN` | 用户 → 上游卖家 | `PurchaseAfterSaleCase` | 卖家可能已签收 | 人工调用 `markSellerReceived`；退款独立登记 |
| `SALES_AFTER_SALE_RETURN` | 买家 → 用户 | `SaleAfterSaleCase` | 买家退货可能已签收，待确认/验货 | 人工调用 `markReturnReceived`；验货、退款和完成各自独立 |

冻结规则：外部物流只产生物流事实、建议动作和待办。M6 V1 不直接调用上述业务 Service 进行自动状态流转。

## 5. 官方服务方案比较

以下结论基于 2026-07-18 可访问的官方页面；价格、额度、认证和承运商附加参数会变化，正式采购前必须以开通页面和合同为准。

### 5.1 聚合物流服务

#### 快递100

- 官方文档：[实时查询](https://api.kuaidi100.com/document/shishichaxunchanpinjieshao)、[订阅推送](https://api.kuaidi100.com/document/5f0ffa8f2977d50a94e1023c.html)。
- 能力：主动实时查询、订阅后状态变更推送、历史轨迹和承运商代码体系。
- 鉴权：企业版授权信息和请求签名；具体字段以产品文档为准。
- 频率：官方实时查询文档要求同一运单至少间隔半小时，并建议自动管理类需求使用订阅推送。
- 计费：官方页面说明企业账号购买查询套餐，同一承运商同一运单在 40 天内多次查询不重复扣费；没有据此假设免费或无限调用。
- 资质：官方入口和购买流程以企业账号/企业管理后台表述。当前个人或小团队是否能通过所需产品审核，必须在购买前向官方确认。
- 附加参数：部分承运商可能要求手机号后四位等验证字段，不能假设只凭运单号始终可查。
- 适用性：覆盖面和统一接口适合当前多物流场景；本地 V1 可先用主动查询，云部署后再评估订阅。

#### 快递鸟

- 官方文档：[文档中心](https://www.kdniao.com/doc)、[物流跟踪 API](https://www.kdniao.com/api-follow)。
- 能力：即时查询、轨迹订阅/推送、在途监控、历史轨迹和异常状态。
- 鉴权：官方文档使用商户 ID、AppKey 和数据签名；提供测试地址和正式地址。
- 资质：官方接入流程包含注册、实名认证和产品开通；具体认证类型、套餐、承运商覆盖和商用额度需在申请时确认。
- 限额：官方页面的“适用日查询量”是产品场景描述，不应当作当前账号免费额度承诺。
- 适用性：同样适合聚合接入，可作为快递100的替代候选和供应商故障预案。

### 5.2 云市场物流接口

- 官方入口：[阿里云 API 市场](https://market.aliyun.com/apimarket/)。
- 接入方式：购买具体第三方供应商的 API 商品，通过云市场授权方式调用。
- 优点：账号、购买和试用入口集中，适合快速验证某个产品。
- 风险：云市场只是交易与授权渠道，状态码、签名、承运商覆盖、历史轨迹、回调、价格和 SLA 仍由具体商品决定；切换商品可能等同于更换供应商协议。
- 适用性：可用于短期 POC，但不作为 ERP 领域模型或错误契约。必须仍通过本项目的 Provider Adapter 隔离。

### 5.3 快递公司直连

- 官方入口：[顺丰开放平台](https://open.sf-express.com/)、[中通开放平台](https://open.zto.com/)、[圆通开放平台](https://open.yto.net.cn/)。
- 模式：每家承运商独立申请、鉴权、承运商专属参数、状态码、测试审批和维护。
- 资质：不同产品可能要求企业、商户、合作客户、月结账号或审批；不能用一个承运商的条件推断其他承运商。
- 优点：供应商原始状态和特定能力更直接。
- 缺点：多家分别开发和维护，签名、限流、错误、手机号校验、版本升级均不统一。
- 适用性：当前业务量和本地单用户部署不适合优先直连。只有聚合服务缺少关键承运商/状态，或后续业务量和合同条件足以支撑时再增加专用适配器。

### 5.4 推荐结论

优先选择聚合物流服务，并保留可替换 Provider Adapter。正式供应商在 M6-A2 前通过真实账号资格、承运商覆盖、价格、测试环境和附加查询参数验证后再冻结。

推荐顺序：

1. 快递100或快递鸟进行小规模官方测试账号验证。
2. 若聚合服务资质、价格或关键承运商不满足，再比较云市场具体商品。
3. 仅在明确缺口下为单一承运商增加直连适配器。

### 5.5 统一选型矩阵

| 候选 | 官方申请入口 | 查询模式 | 鉴权/签名 | 手机号后四位 | 承运商代码 | 历史轨迹/异常 | 测试环境 | 当前适用性 | 开发复杂度 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 快递100 | 官方文档和企业管理后台仍提供注册、购买与申请入口 | 主动查询、订阅推送 | 企业授权信息 + 请求签名 | 部分承运商或产品可能要求，正式开通前逐项确认 | 必需，使用其公司编码 | 支持，字段随产品/承运商而异 | 官方有调试与示例资源；独立沙箱能力需按所购产品确认 | 高，适合多承运商本地 ERP | 中 |
| 快递鸟 | 官方文档仍有“申请 API”、注册和产品开通入口 | 即时查询、订阅推送、在途监控 | 商户 ID + AppKey 数据签名 | 按承运商和产品确认，不能假设始终不需要 | 必需，使用其 ShipperCode | 支持轨迹和问题件状态 | 官方文档列出 sandbox 地址 | 高，可作为聚合备选 | 中 |
| 阿里云 API 市场具体商品 | API 市场仍开放，是否可购由具体商品决定 | 由商品决定，可能只有主动查询 | 云市场授权或商品供应商签名 | 由商品和承运商决定 | 通常需要，映射方式由商品决定 | 由商品决定 | 由商品决定 | 中，适合 POC；生产契约需要额外审计 | 低至中 |
| 顺丰/中通/圆通等直连 | 官方开放平台在线；具体接口需申请/审批 | 各家查询或推送能力分别确认 | 各家独立账号、签名和审批 | 顺丰等场景可能需要；各家规则不同 | 对单一承运商隐含或使用其内部代码 | 各家分别提供，字段不统一 | 由账号、产品和审批决定 | 低，不适合当前优先路线 | 高 |

矩阵中的“支持”不等于当前账号已经获批，也不构成免费额度或固定 SLA。M6-A2 必须用拟购买产品的实时官方控制台、合同和测试账号重新确认。

## 6. 推荐数据模型

本节只设计，不修改 Prisma。

### 6.1 `LogisticsShipment`

建议字段：

- `id`
- `ownerId`
- `businessType`
- `businessId`
- `carrierCode`
- `carrierName`
- `trackingNumber`
- `trackingNumberNormalized`
- `providerKey`
- `providerCarrierCode`
- `currentStatus`
- `providerStatusCode`
- `lastEventAt`
- `lastSyncedAt`
- `nextSyncAt`
- `syncStatus`
- `failureCount`
- `lastErrorCode`
- `lastErrorAt`
- `deliveredAt`
- `createdAt`
- `updatedAt`

建议约束：

- `ownerId + businessType + businessId + trackingNumberNormalized` 唯一，防止同一业务运单重复创建。
- owner、业务对象、当前状态、`nextSyncAt` 和承运商/单号组合索引。
- `providerKey` 由服务端配置决定，客户端不能提交任意 Provider 或 URL。
- `businessType + businessId` 由 Service 校验 owner 和业务对象存在性；不建立跨五类业务表的复杂多态外键。

### 6.2 `LogisticsTrackingEvent`

现有 `LogisticsEvent` 已被采购 Mock 使用且 `purchaseOrderId` 必填。为了保持纯加法迁移和历史兼容，M6-A1 建议新增 `LogisticsTrackingEvent`，而不是重命名或强行复用现表。

建议字段：

- `id`
- `ownerId`
- `logisticsShipmentId`
- `providerEventId`，可空
- `dedupeKey`
- `eventTime`
- `status`
- `location`
- `description`
- `rawStatusCode`
- `createdAt`

建议约束：

- `logisticsShipmentId + dedupeKey` 唯一。
- 有可靠 Provider Event ID 时纳入 `dedupeKey`；没有时由承运商、运单、事件时间、标准状态、地点和描述生成稳定摘要。
- 不保存完整原始响应；仅保留排障所需的非敏感状态码、描述和必要摘要。

### 6.3 现有字段复用

- 保留各业务表已有 carrier/tracking/time 字段，继续作为业务录入和兼容展示。
- 通用 `LogisticsShipment` 保存外部同步事实和同步状态。
- M6 Service 创建或绑定 Shipment 时从业务字段读取运单，不反向静默覆盖用户已确认的业务事实。
- 只有用户执行现有业务动作后，才更新对应业务状态和其确认时间。
- 不给每条库存重复保存同一批次的物流轨迹；平台寄送按 Batch、平台退回按 ShipmentLine、售后按 Case 关联。

### 6.4 运单号标准化

- 原始 `trackingNumber` 原样保存经过 trim 的可读值。
- `trackingNumberNormalized` 仅用于匹配和幂等：去首尾空白，并按承运商规则移除明确允许的展示空格/连字符。
- 未冻结承运商规则时只 trim，不擅自删除字母、前导零或业务字符。
- 承运商代码保存项目内部代码和 Provider 代码映射，不能把某供应商代码当作全局枚举。

### 6.5 隐私边界

- 不保存完整手机号、地址、身份证、Cookie、Token 或 Secret。
- 若某承运商要求手机号后四位，V1 优先在单次请求中临时提供，不写事件、日志或错误；若必须持久化，需另行设计加密、访问和删除策略后再实施。
- 供应商凭证只来自服务端环境变量。

## 7. 通用状态和映射

建议新增独立 `LogisticsCanonicalStatus`，不复用 `InventoryItem.itemStatus`、平台行状态或售后状态：

- `UNKNOWN`
- `PENDING_PICKUP`
- `PICKED_UP`
- `IN_TRANSIT`
- `ARRIVED_AT_DESTINATION`
- `OUT_FOR_DELIVERY`
- `DELIVERED`
- `EXCEPTION`
- `RETURNING`
- `CANCELLED`

通用映射原则：

| Provider 含义 | 通用状态 | ERP 建议动作 |
| --- | --- | --- |
| 暂无轨迹/待揽收 | `PENDING_PICKUP` 或 `UNKNOWN` | 显示等待揽收，不推进业务 |
| 已揽收 | `PICKED_UP` | 更新物流事实 |
| 运输/转运 | `IN_TRANSIT` | 更新物流事实和运输中统计 |
| 到达目的城市/网点 | `ARRIVED_AT_DESTINATION` | 提示即将派送，不推进业务 |
| 派送中 | `OUT_FOR_DELIVERY` | 提高轮询频率 |
| 已签收 | `DELIVERED` | 生成各业务域的人工确认建议 |
| 疑难/拒收/破损/超时 | `EXCEPTION` | 生成物流异常待办，不自动改库存 |
| 退回/退签 | `RETURNING` | 提示人工核对退回方向，不套用平台退回状态机 |
| 撤销/终止 | `CANCELLED` | 停止高频同步，保留历史 |

原始 Provider 状态码必须保留为非权威事实。未知状态映射为 `UNKNOWN` 并记录监控，不猜测业务状态。

## 8. 自动更新和人工确认边界

### 8.1 允许自动更新

M6 V1 自动同步只允许更新：

- `LogisticsShipment.currentStatus`。
- `providerStatusCode`。
- 轨迹事件。
- `lastEventAt`、`lastSyncedAt`、`nextSyncAt`。
- `syncStatus`、失败次数和稳定错误码。
- 物流待办/建议动作的只读派生结果。

### 8.2 必须人工确认

- 采购真正收到并进入待验货。
- 平台业务确认签收。
- 平台退回真正收到。
- 上游卖家确认收到退货。
- 买家退货真正收到。
- 所有验货结论、退款、重新入库、问题件、销售完成和成本处理。

### 8.3 永远禁止由外部物流直接写入

- `InventoryItem.STOCKED`
- `InventoryItem.SOLD`
- `InventoryItem.PROBLEM`
- 验货结果
- `PurchaseRefundRecord` / `SaleRefundRecord`
- 成本分摊和库存成本
- 平台入仓/鉴别/上架状态
- 售后完成状态

签收不能自动入库，因为承运商签收只证明运输环节结束，无法证明包裹内容、数量、SKU、成色、附件、包装和真伪符合要求，也无法证明平台业务系统已完成入仓或卖家已同意退款。

## 9. 查询、订阅和 Webhook

### 9.1 主动轮询

优点：

- 不需要公网回调。
- 可沿用一次性 CLI + Windows 任务计划程序模式。
- 失败不会影响浏览器和核心 ERP。
- 适合本地单用户部署。

缺点：消耗查询额度，状态存在延迟，电脑关机时不会运行。

### 9.2 订阅推送/Webhook

优点：更新更及时，通常减少重复主动查询。

缺点：需要稳定 HTTPS 公网地址、签名校验、重放防护、回调幂等、可观测性和长期在线服务。本地 Windows 电脑不应直接暴露端口。

冻结结论：M6 V1 采用主动轮询；未来部署到稳定公网服务后再评估 webhook。Provider Adapter 仍应预留 `subscribe`/`verifyWebhook` 能力边界，但 M6-A1 不实现。

## 10. 同步频率和重复查询控制

建议默认策略，最终必须受供应商套餐限制约束：

- `PENDING_PICKUP` / `PICKED_UP` / `IN_TRANSIT`：每 2～4 小时。
- `ARRIVED_AT_DESTINATION` / `OUT_FOR_DELIVERY`：每 1 小时。
- `EXCEPTION`：6～24 小时内有限重试，并生成人工待办。
- `UNKNOWN` / 长期无更新：逐步退避到每天一次。
- `DELIVERED` / `CANCELLED`：停止常规轮询。

规则：

1. 不每分钟查询，不低于供应商规定的最小间隔。
2. 每次 CLI 只选择 `nextSyncAt <= now` 的有限批次。
3. 相同 owner、Provider、承运商、标准化运单号和必要验证参数在同一轮只请求一次，再将结果扇出到合法业务引用。
4. 批量接口存在时优先批量，但仍需单运单幂等。
5. 电脑关机后由任务的“错过后尽快运行”补跑，不唤醒电脑。
6. CLI 使用非零退出码报告整体失败；单个运单失败不能阻塞其他运单。

## 11. Provider Adapter

M6-A1 建议把现有接口扩展为与业务域无关的 Adapter：

- `queryTracking(request)`
- `mapCarrierCode(internalCode)`
- `mapStatus(providerStatus)`
- `normalizeResponse(response)`
- `classifyError(error)`
- 可选的 `queryBatch(requests)` 能力探测

请求 DTO 只包含承运商、运单号和该次查询必需的最小验证字段。响应 DTO 包含 Provider 标识、通用状态、原始状态码、事件列表、查询时间和可重试信息。

Mock Adapter 保留给单元测试、verify 和本地演示；正式环境不得默认选择 Mock。未配置供应商时返回 `LOGISTICS_NOT_CONFIGURED`，页面继续允许人工维护。

## 12. 凭证和网络安全

正式变量名在供应商选定后冻结，建议前缀：

- `LOGISTICS_PROVIDER`
- `LOGISTICS_API_BASE_URL`
- `LOGISTICS_API_KEY`
- `LOGISTICS_API_SECRET`
- `LOGISTICS_CUSTOMER_ID`

规则：

1. 仅服务端读取，不使用 `NEXT_PUBLIC_`。
2. 不写数据库、不写 Git、不返回浏览器。
3. `.env.example` 只放空占位符。
4. Base URL 来自 Adapter 内置 allowlist 或部署配置，客户端不能提交 URL，防止 SSRF。
5. 日志不得输出 Secret、完整签名、完整手机号或完整 Provider 请求。
6. 错误响应只返回稳定 code 和安全 message。
7. 测试只调用本地 mock server，不调用真实供应商。

## 13. 稳定错误和重试

稳定错误：

- `LOGISTICS_NOT_CONFIGURED`
- `LOGISTICS_INVALID_TRACKING_NUMBER`
- `LOGISTICS_UNSUPPORTED_CARRIER`
- `LOGISTICS_AUTH_FAILED`
- `LOGISTICS_RATE_LIMITED`
- `LOGISTICS_TIMEOUT`
- `LOGISTICS_NETWORK_ERROR`
- `LOGISTICS_PROVIDER_REJECTED`
- `LOGISTICS_INVALID_RESPONSE`

可重试：timeout、网络错误、Provider 5xx、限流（优先遵守 `Retry-After`）。

不可自动重试：配置缺失、鉴权失败、不支持承运商、单号无效、响应结构永久不兼容、业务对象不存在和 cross-owner。

重试采用有上限的指数退避加抖动；每次任务和单运单均有最大次数。认证错误应停止该 Provider 本轮后续请求，避免持续消耗额度。禁止无限重试和静默吞错。

并发与幂等：

- 同一 Shipment 使用条件更新/租约字段避免两个任务同时同步。
- 事件以 `dedupeKey` 唯一约束防重复。
- 乱序事件保留历史，但 `currentStatus` 只按明确状态优先级和事件时间更新；更早事件不能回退当前事实。
- Provider 重复推送或轮询返回全量历史不会重复插入。

## 14. 后续 API 和页面

### 14.1 API

后续建议：

- `POST /api/logistics/shipments/[id]/refresh`：人工刷新。
- `GET /api/logistics/shipments/[id]`：读取当前物流和轨迹。
- 业务对象详情 API 返回关联物流摘要。
- M6-A3 CLI 直接调用 Service，不依赖 3000 服务或浏览器。

写 API 只委托 Logistics Service。客户端不能提交 ownerId、Provider URL、API Key、Provider 原始状态或 ERP 目标状态。

### 14.2 页面

页面显示：

- 快递公司、运单号。
- “模拟物流”或真实 Provider 来源。
- 最新通用状态和历史轨迹。
- 最后同步时间、下次同步时间、异常和安全错误。
- “物流显示已签收，等待人工确认/验货”的明确文案。
- 手动刷新和保留的人工确认业务按钮。

API 未配置或失败时订单详情仍可打开，人工保存和现有业务按钮仍可使用。生产页面隐藏 Mock 规则按钮；开发/测试模式必须明显标记“模拟物流，不代表真实快递状态”。

## 15. 待办和日报集成

M6-A4 后续通过统一物流查询 DTO 增加：

- 运输中数量。
- 今日物流签收数量。
- 超过阈值无轨迹更新。
- 物流异常。
- 外部显示签收但尚未人工确认。
- 平台退回显示签收待处理。
- 买家退货显示签收待验货。
- Provider 配置缺失或持续同步失败。

日报和 Todo 只读取共享物流聚合，不复制状态映射。人工状态和 API 状态必须显示不同来源。外部签收不计为库存入库；供应商未配置时显示“物流自动同步未启用”，不冒充实时数据。

## 16. 测试和验证规划

后续新增 `pnpm verify:m6-logistics`，至少覆盖：

1. 五种业务类型的 owner 隔离和业务对象校验。
2. 运单标准化不损坏真实单号。
3. 同一业务运单不重复创建。
4. Provider 状态到通用状态映射。
5. 未知 Provider 状态安全回退 `UNKNOWN`。
6. 相同 Provider Event ID 幂等。
7. 无 Event ID 时稳定 dedupeKey 幂等。
8. 全量历史重复返回不重复插入。
9. 乱序事件不回退当前状态。
10. DELIVERED 只生成建议，不直接推进五类业务状态。
11. 不创建库存、不写 `SOLD`、不写验货结果或退款。
12. Provider 未配置时人工流程仍可用。
13. timeout、网络、5xx 和限流的有界重试。
14. 鉴权、非法单号和不支持承运商不自动重试。
15. cross-owner 返回 NotFound 语义。
16. 凭证、签名、手机号和原始响应不进入日志/API。
17. 并发同步同一运单最多一次外部调用或一次有效写入。
18. CLI 使用唯一 runId，finally 精确清理，清理失败令验证失败。
19. 本地 mock HTTP 验证，不请求真实供应商。
20. M1～M5 全部冻结回归继续通过。

## 17. 后续实施拆分

### M6-A1：通用物流基础

- `LogisticsShipment`、`LogisticsTrackingEvent`、通用状态、同步状态和纯加法 migration。
- 通用 Provider 接口、本地 Mock、状态映射、运单标准化、幂等和纯规则测试。
- 不接真实供应商，不改现有业务状态机。

### M6-A2：首个真实聚合供应商

- 已选择快递鸟并实现真实查询 Adapter、严格配置、手动刷新 API、物流轨迹 DTO 和采购详情页面。
- 自动测试使用注入 Transport 和本地夹具，不请求快递鸟公网。
- 真实账号资格、套餐和测试/正式运单验收仍待用户配置后完成。

### M6-A3：定时同步

- 一次性同步 CLI、动态 `nextSyncAt`、限流、错误退避、并发租约和 Windows 任务安装/检查脚本。
- 不依赖 Next.js 3000 服务或浏览器。
- 先增加通用物流异常/停滞待办，不自动推进业务状态。

### M6-A4：五域集成和封板

- 采购、平台寄送、平台退回、采购售后和销售售后详情关联。
- 人工确认动作与物流签收建议对齐。
- Todo 和日报统一聚合、真实账号小流量验收、Mock/人工降级和全链路回归。
- 普通销售发货在字段和状态机另行设计前不纳入。

## 18. M6-A0 冻结结论

- 当前只有采购 M2-A Mock Logistics，没有真实物流 API。
- 当前生产业务仍依赖人工填写运单和人工确认业务节点。
- 推荐聚合 Provider + 可替换 Adapter + 本地主动轮询。
- 真实 Provider 尚未选定、购买、注册或配置。
- 物流事实与 ERP 业务状态必须分层。
- M6-A0 标记为 `COMPLETED / FROZEN`；M6-A1 的实施结果见下一节。

## 19. M6-A1 通用物流底座实施冻结

M6-A1 新增 `LogisticsShipment` 与 `LogisticsTrackingEvent`，保留采购专用 `LogisticsEvent` 不变。同一 owner 的同一 `businessType + businessId` 在 V1 只允许一条通用物流记录；运单号不做全局唯一，因为同一快件可能与多个明确业务对象有历史关联。

已冻结的五类绑定为：

- `PURCHASE_INBOUND` → `PurchaseOrder`
- `PLATFORM_OUTBOUND` → `PlatformShipmentBatch`
- `PLATFORM_RETURN` → `PlatformShipmentLine`
- `PURCHASE_AFTER_SALE_RETURN` → `PurchaseAfterSaleCase`
- `SALE_AFTER_SALE_RETURN` → `SaleAfterSaleCase`

Provider 使用服务端注册表，数据库只保存 Provider code 字符串。当前唯一注册 Provider 是无网络请求、无随机数、使用固定时间和运单号后缀规则的 `MOCK`。未知 Provider 不回退，也不允许调用方提供 URL 或可执行配置。

轨迹事件在标准化后使用 Provider 事件 ID，或由 Provider、时间、统一状态、地点、描述和原始安全状态码生成 SHA-256 `dedupeKey`。数据库唯一约束与 `createMany(skipDuplicates)` 共同保证重复同步幂等。`deliveredAt` 只在首次确认通用物流签收时写入，不代表采购收货、验货、入库、平台业务签收或退款完成。

`GenericLogisticsService` 本阶段只写入上述两张新表。Provider 失败时保留已有轨迹和当前状态，只记录可重试/终止同步状态、失败次数与安全错误码。本阶段没有公开 API、页面、定时任务、Webhook、真实密钥、真实网络查询或任何业务状态推进。

M2-A 的采购 Mock 物流仍保留，暂未迁移。M6-A2 已选择快递鸟并完成手动采购入库物流查询的本地实现与验证；真实账号、套餐和真实运单验收仍待配置。M6-A3 是定时同步，M6-A4 才处理五域页面、业务联动与日报。
- M1～M5 保持 FROZEN，本阶段没有修改其模型、状态机或金额口径。

## 20. M6-A2 第一刀：快递鸟手动真实物流查询

首个真实 Provider 冻结为快递鸟即时查询。服务端采用官方 `RequestType=1002`、固定沙箱/正式 endpoint、POST form 请求和 `MD5(RequestData + AppKey)` 后 Base64 的签名流程。endpoint 不接受浏览器、数据库或任意 URL 环境变量覆盖。

服务端配置：

- `LOGISTICS_KDNIAO_MODE=disabled|sandbox|production`，默认 `disabled`。
- `LOGISTICS_KDNIAO_EBUSINESS_ID` 与 `LOGISTICS_KDNIAO_APP_KEY` 仅保存在服务端环境。
- `LOGISTICS_KDNIAO_TIMEOUT_MS` 默认 8000，允许 1000～30000。

当前只开放 `PURCHASE_INBOUND`。采购详情页加载时只读取本地 Provider 配置和已保存轨迹，不自动调用快递鸟；用户明确点击“查询物流”时才发起一次查询，不轮询、不自动重试。M2-A 人工物流字段继续表达人工业务事实，通用物流记录只表达 Provider 查询事实，两者不会反向覆盖。

轨迹按 Asia/Shanghai 解析后存为标准时间，按事件时间稳定升序。手机号和明显座机号在写入前脱敏，完整 Provider 请求、响应、AppKey 和 DataSign 不落库、不进入 API。当前官方即时查询文档明确的订单级状态 `2/3/4` 分别映射运输中、已签收、问题件；`0`/未知值安全映射 `UNKNOWN`，兼容的 `1` 映射已揽收。单条轨迹没有官方独立状态时不根据描述猜测业务状态。

相同业务对象重复注册相同 Provider、承运商和单号时幂等返回原记录；不同绑定返回 `LOGISTICS_SHIPMENT_BINDING_CONFLICT`，不覆盖历史轨迹。本刀不提供已同步绑定的换单功能。

快递鸟 `DELIVERED` 只显示“物流服务商已签收”。它不会写 `PurchaseOrder.deliveredAt`、不会生成 Inspection、不会创建 InventoryItem，也不会推进任何 M1～M5 状态机。未配置时页面显示“真实物流查询尚未配置，当前仍可手工维护物流状态。”，旧人工流程继续可用，且不会回退到 MOCK 冒充真实结果。

状态：

- M6-A2 第一刀：`IMPLEMENTED / LOCALLY VERIFIED`。
- 真实快递鸟账号、产品开通和真实单号验收：`PENDING CONFIGURATION`。
- M6-A3 定时同步：尚未开始。
