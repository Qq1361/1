# M4-B1 每日经营报告 API

## GET /api/reports/daily-business

只读生成日报，不保存报告、不创建采购、库存、销售、退款或通知记录。日报聚合本身不会发送飞书。

查询参数：

- `date`：可选，`YYYY-MM-DD`；省略时按 `Asia/Shanghai` 的昨天计算。
- `timezone`：可选，V1 仅接受 `Asia/Shanghai`。

请求拒绝 `ownerId`、未知参数、无效日期和其他时区，返回 400 与稳定错误码。owner 从服务端既有上下文取得。

响应包含 `reportDate`、`timezone`、`periodStart`、`periodEnd`、`generatedAt`、`sales`、`purchases`、`inventory`、`todos`、`risks` 和 `market`。金额固定为两位小数字符串，日期为 ISO 字符串或 `null`。

所选日期仅影响销售、采购与行情的事件区；库存、待办和风险始终是生成时刻快照。系统尚未有每日资产快照，不能将其当作历史日期库存。

## M4-B2 页面

`/reports/daily` 已完成，使用本 API 展示日报，并可通过专用手动发送接口发送摘要。页面使用 URL `date` 查询并固定传入 `Asia/Shanghai`，明确分开展示所选日期事件和 `generatedAt` 当前快照。详见 [M4-B2 页面说明](./M4_DAILY_BUSINESS_REPORT_UI.md)。

## POST /api/reports/daily-business/send-feishu

仅接受可选 `date` 和 `timezone`，并严格拒绝 `ownerId`、Webhook、Secret、消息内容、日报 DTO、重试和幂等字段及其他未知字段。服务端从环境变量读取飞书群机器人配置，调用现有日报聚合后发送摘要；不保存日报正文或凭证，发送状态由 M4-B4 Delivery 记录保存，且不修改任何业务数据。

成功只返回安全发送结果、报告日期、发送时间和待办/风险摘要数量。失败使用 `FEISHU_NOT_CONFIGURED`、`FEISHU_TIMEOUT`、`FEISHU_NETWORK_ERROR`、`FEISHU_REJECTED_REQUEST`、`FEISHU_INVALID_RESPONSE` 或日报生成/格式化错误，不返回 Webhook、Secret、签名或飞书完整响应。
# M4-B4 API

- `POST /api/reports/daily-business/send-feishu`：同日幂等发送。
- `GET /api/reports/daily-business/delivery-status?date=YYYY-MM-DD`：只读安全状态。
- `POST /api/reports/daily-business/deliveries/[id]/retry`：仅 owner 范围内的失败记录重试。

这些接口不接受 owner、Webhook、Secret、正文或 delivery 状态写入字段。
