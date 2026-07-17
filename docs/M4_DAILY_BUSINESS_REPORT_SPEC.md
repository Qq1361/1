# M4-B0 每日经营报告与通知设计冻结

## 1. 阶段与边界

M4-A0 至 M4-A6 已完成并冻结。M4-A7 采购试算页面、M4-A8 批量采购决策暂停；M4-B 每日经营报告与通知成为后续主路线。

本文件是 M4-B0 的只读审计与设计冻结，不实现报告 Service、API、页面、定时任务、飞书发送或通知配置。M1 至 M3 继续保持 FROZEN，M4-A 已有行情和采购试算后端保留且不重构。

非目标：自动采集平台、自动采购、自动平台推荐、修改库存/销售/退款、创建采购单、发送真实飞书消息。

## 2. 当前数据能力审计

| 领域 | 当前权威来源 | M4-B 使用方式 |
| --- | --- | --- |
| 采购、到货、物流 | `PurchaseOrder`、`PurchaseOrderItem`、`LogisticsEvent`；采购服务和 `TodoService` | 昨日采购事件与当前待到货待办分开聚合 |
| 验货与入库 | `Inspection`、`InventoryItem`；`InspectionService` | 以完成时间和单件库存事实统计，不以日志条数推断件数 |
| 当前库存资产 | `getPlatformReturnSummary`（`src/server/reports/platform-return-summary.ts`） | 复用现有按 `InventoryItem.id` 去重的当前资产口径 |
| 销售财务 | `SalesReportService`（`src/server/reports/sales-report-service.ts`）及 `SaleOrder`、`SaleLine` | 复用已冻结的 CONFIRMED / SETTLED 销售口径，不以 `InventoryItem.SOLD` 推断销售 |
| 销售售后财务 | `getSalesAfterSaleFinancials`（`src/server/reports/sales-after-sales-financials.ts`） | 复用退款、净到账、成本冲回和售后净利润聚合，不复制公式 |
| 采购售后 | `PurchaseAfterSaleCase`、`PurchaseRefundRecord`、`PurchaseRefundAllocation` | 采购退款与销售退款严格分域；仅真实退款流水计入退款 |
| 平台寄送与退回 | `PlatformShipmentLine`、`PlatformReturnInspection`、平台退回汇总 | 当前平台资产和退回待处理按既有状态机派生 |
| 首页待办 | `TodoService.list`（`src/server/services/todo-service.ts`）和 `GET /api/todos` | 可复用现有采购物流、验货、库存、平台退回待办；销售确认/到账、采购售后、销售售后尚未被该 Service 覆盖 |
| 行情 | `MarketItem`、`MarketQuote`、`MarketQuery` | 仅读取手工行情、确认/失效/过期状态和当前有效预计收入；不是自动平台采集 |

当前 owner 由 `DEFAULT_OWNER_ID` 和既有访问上下文统一使用；M4-B 后续 Service/API 必须延续 owner 隔离，客户端不得提交 ownerId。

当前项目没有统一的报告时区工具、日报快照模型、飞书/邮件/Webhook 发送实现或通用通知配置。现有日期处理多为进程 `Date` 逻辑，不能作为跨环境日报的隐式时区依据。

## 3. 时间边界

后续 M4-B1 冻结报告时区为 `Asia/Shanghai`，并显式传入计算层；不得依赖 PostgreSQL 服务器或 Node 进程的隐式时区。

报告分三种数据：

1. **昨日经营事件**：用户本地昨天 `[00:00:00, 今天 00:00:00)` 的半开区间。
2. **当前经营快照**：报告生成时刻的库存、平台状态、待到账、待处理售后和风险，不受昨日区间限制。
3. **今日待办**：报告生成时调用当前待办与后续补充的售后待办来源，不按昨日事件统计。

统一 DTO 必须返回 `timezone`、`periodStart`、`periodEnd`、`generatedAt`。历史日期查询只回放该日期的事件区；当前库存、待办和风险仍明确标注为“生成时当前快照”。系统尚无每日资产快照，不能伪造历史库存快照。

## 4. 昨日销售和售后财务口径

日报仅复用销售报表的 `CONFIRMED` / `SETTLED` 统计范围；`DRAFT`、`CANCELLED` 和 `PLATFORM_LISTED` 均不构成销售事实。

| 指标 | 权威事实 | 去重与限制 |
| --- | --- | --- |
| 销售订单数 | `SaleOrder` | 按销售订单 ID 去重；日期优先 `soldAt`，再 `confirmedAt`，最后 `createdAt`，沿用销售报表规则 |
| 销售件数 | `SaleLine` | 由符合口径的订单行计数 |
| 成交价 | `SaleOrder.grossAmount` | 只称“成交价”，不称实际到账 |
| 预计收入 | `SaleOrder.expectedIncome` | 只称“预计收入”，不代替实际到账 |
| 实际到账 | `SaleOrder.actualReceivedAmount` | 只称“实际到账” |
| 实际退款 | `SaleRefundRecord.refundAmount` | 仅真实完成退款流水；不得用批准额度或分配行重复累计 |
| 净到账 | 售后财务聚合 | 原实际到账减已完成销售退款，复用 `getSalesAfterSaleFinancials` |
| 原始利润 | 已持久化 `SaleLine.profitAmount` 汇总 | 不在日报重算利润公式 |
| 售后净利润 | 售后财务聚合 | 复用原利润、退款、售后成本和已冻结成本冲回规则 |

`SaleRefundRecord.id` 是退款去重单位；退款分配只用于行级归因，不能再加进订单级退款。SaleOrder 重新登记到账会改变当前 `actualReceivedAmount`，而系统没有不可变的日末财务快照，因此历史日报先明确为“按所选事件区和当前已保存事实重新计算”，不是封存会计报表。这是后续 M4-B4 是否建立发送/快照记录时要处理的数据沿革风险。

## 5. 昨日采购口径

后续报告需分别提供：昨日新建采购单、昨日到货采购单、昨日完成验货件数、昨日形成库存件数、昨日采购退款，以及当前待到货、待验货、采购售后待处理。

采购退款只读取 `PurchaseRefundRecord`；不可混入 `SaleRefundRecord`。形成库存以真实验货完成和库存创建事实计量，不以 ActionLog 条数推断。`ownershipStatus != OWNED` 的商品不属于当前可支配库存资产。

采购售后和销售售后当前已有各自模型与页面，但尚未进入统一 `TodoService`。M4-B1 必须为日报单独建立只读待办聚合，不能假设首页待办已完整覆盖这两类业务。

## 6. 当前库存与资产口径

当前资产必须复用 `getPlatformReturnSummary(ownerId)` 的去重策略：同一 `InventoryItem` 在当前资产中只计一次；平台退回历史周期可独立展示但不得让当前成本重复。

| 当前状态 | 日报资产分类 |
| --- | --- |
| `STOCKED` | 正常在库 |
| `PLATFORM_SHIPPED` / `PLATFORM_RECEIVED` / `PLATFORM_IN_WAREHOUSE` / `PLATFORM_LISTED` | 平台处理中资产；上架/可售不等于已售 |
| `RETURNING` | 平台退回途中 |
| `RETURNED` | 已退回待处理 |
| `PROBLEM` | 问题件 |
| `SOLD` | 不计当前未售资产 |

仅 `ownershipStatus = OWNED` 的库存进入当前可支配资产。`PENDING_DECISION` 是 `RETURNED` 的待处理子集，只能作为子项展示，不能再次加到总资产。

## 7. 今日待办、优先级与风险

现有 `TodoService` 能提供采购缺单号、物流异常/停滞、待验货、效期、压货、平台退回途中、平台退回待验货、平台退回待进一步判断。M4-B 后续需补充只读来源：销售待确认/待到账、采购售后、销售售后、买家退货已收待验货。

| 优先级 | 设计对象 | 例子 |
| --- | --- | --- |
| P0 紧急 | 数据一致性或金额/权限违规 | 超额退款、重复销售、跨 owner 风险、状态矛盾；正常流程不应产生 |
| P1 今日优先 | 已收到物品待验货、关键售后、长期未到账 | 买家退货已收待验货、平台退回已收待验货、待进一步判断、关键售后、长期未到账 |
| P2 常规 | 正常流程动作 | 采购待验货、平台退回途中、平台寄送处理中、常规物流待办 |
| P3 信息 | 数据质量与经营参考 | 缺失行情、即将过期行情、长时间未更新行情 |

每个未来风险/待办必须包含：`code`、`priority`/`severity`、`count`、`href`、有限数量的 `samples`，并定义去重单位和阈值来源。现有固定阈值如销售报表未到账 7 天、库存效期/压货阈值可复用其已冻结语义；新的售后、平台仓内、退回途中、问题件和行情阈值本轮不写死。

阈值方案冻结：M4-B1 先将各默认值集中在报告规则常量并由文档记录；尚不新增环境变量或数据库配置。以后需要用户可配置时，再做独立配置模型与页面。

## 8. 行情摘要边界

日报仅显示：启用行情商品数、有当前有效 `EXPECTED_INCOME` 的商品数、无当前有效预计收入的商品数、最近 24 小时新增/确认报价数、已过期/即将过期报价数。

`LISTING_PRICE` 是挂牌价格，`MANUAL_REFERENCE` 是人工参考，都不能称为预计到账；当前行情全部来自人工录入，严禁表述成得物或 95 分自动采集结果。市场摘要不做采购建议、平台推荐或自动采购。

## 9. 统一报告 DTO

后续 `DailyBusinessReportDto` 设计如下：

```ts
{
  reportDate: "YYYY-MM-DD",
  timezone: "Asia/Shanghai",
  periodStart: "ISO-8601",
  periodEnd: "ISO-8601",
  generatedAt: "ISO-8601",
  sales: {},
  purchases: {},
  inventory: {},
  todos: { items: [{ code, label, priority, count, href, samples }] },
  risks: [{ code, severity, title, summary, count, href }],
  market: {}
}
```

所有金额返回两位小数字符串；日期返回 ISO 字符串或明确日期字符串；空数值返回 `0`、`"0.00"`、`null` 或空数组，禁止 NaN。DTO 不返回 ownerId、完整订单对象、客户隐私信息、Webhook 或数据库内部 ID。

## 10. M4-B1 已完成：只读聚合与 API

M4-B1 已新增 `daily-business-report-period.ts`、`daily-business-report.ts`、日报 DTO、集中阈值和 `GET /api/reports/daily-business`。默认且仅支持 `Asia/Shanghai`；昨日事件使用明确 UTC 半开区间，库存、待办和风险为 `generatedAt` 当前快照。

日报复用 `getSalesAfterSaleFinancials` 与 `getPlatformReturnSummary`，不复制利润、退款或资产公式；销售确认、到账、退款按各自业务事件时间统计。日报待办是独立只读聚合，不修改 `TodoService`。接口严格拒绝 `ownerId` 和未知查询参数，既不保存报告也不发送飞书。

## 11. 后续实现边界

### M4-B2：日报页面

建议路由 `/reports/daily`：日期选择、昨日经营摘要、当前库存快照、今日待办、风险、行情摘要、手动刷新、复制文本。页面仅调用报告 API，移动端优先，所有状态中文化；B2 不发送飞书。

### M4-B3：飞书群机器人适配器（已完成）

使用飞书群机器人 Webhook：Webhook 和可选签名密钥只放服务端环境变量，不入库、不输出到 UI/日志；已提供手动发送、超时/4xx/5xx 契约、正文长度控制和敏感信息过滤。数据生成失败时不得发送全 0 假报告。发送记录、同日幂等和重试由已完成的 M4-B4 Delivery Coordinator 统一处理。

### M4-B4：发送记录与 Windows 定时执行

已新增并应用最小 `DailyBusinessReportDelivery` 记录模型，字段包括 owner、报告日期、渠道、状态、尝试次数、发送时间、安全错误信息和幂等键。它提供日期去重、有限重试和发送审计，不保存 Webhook、Secret 或日报正文。

本地 Windows 优先用任务计划程序调用一次性项目命令：适合固定时间，但电脑关机、Docker、数据库和网络不可用时必须非零失败，不能发送假报告。应用内定时器不适合多实例或长期部署；未来云部署可改外部 Cron。

## 12. 验证规划

M4-B1：半开日期区间、时区、零数据、订单/库存/退款去重、当前快照与历史事件分离、owner 隔离、金额字符串、只读边界。

M4-B2：路由、日期筛选、手机布局、中文指标、当前快照标记、待办跳转、空状态、API 错误。

M4-B3：Webhook 请求格式和脱敏、签名、超时、4xx/5xx、手动测试和不发送假报告。

M4-B4：每日幂等、失败重试、发送记录、准确退出码和基础设施异常处理，已由 `verify:m4-daily-report` 真实 HTTP/mock 验证覆盖。

## 13. 风险与结论

本次审计未发现需要在 M4-B0 修复的 P0/P1 业务写入缺陷。统一时区、发送记录和空报告保护已在 M4-B1/B4 落地；不可变日末快照以及首页待办未覆盖全部售后/销售结算仍是后续边界，不改变现有 M1 至 M3 写入规则。

M4-B1 至 M4-B4 已完成，M4-A6 保持 FROZEN；日报网页、飞书手动发送、Delivery 记录、一次性 CLI 和 Windows 任务计划脚本均已落地。自动采集和 M4-C 尚未开始。
# M4-B4 自动发送边界

自动发送使用持久化 Delivery 协调层，不修改既有日报口径。当前保证为数据库幂等协调下的近似一次发送，不宣称飞书端绝对 exactly-once。
