# M3-C V1 销售到账管理 - 冻结说明

最后更新：2026-07-14

## 范围

M3-C V1 只补齐销售到账管理，不改变销售确认、库存状态机、平台寄送或 M3-B 报表统计口径。

- `GET /api/sales/settlements` 提供只读的待到账与已到账销售查询。
- `/sales/settlements` 集中展示并登记或修改到账金额。
- `/sales/[id]` 支持对 `CONFIRMED` 登记到账，并对 `SETTLED` 修改到账金额。
- 所有到账写入统一经由 `POST /api/sales/[id]/settle` 和 `SalesService.settle`。

## 数据口径

| 字段 | 业务含义 | 展示限制 |
| --- | --- | --- |
| `grossAmount` | 成交价 | 不能标为到账 |
| `expectedIncome` | 预计收入 | 不能标为实际到账 |
| `actualReceivedAmount` | 实际到账 | 仅有该字段时才可展示为实际到账 |
| `settledAt` | 首次到账时间 | 后续修改到账金额不覆盖首次非空值 |
| `SaleActionLog.note` | 到账备注 | 每次登记到账写入操作日志 |
| `SaleLine.profitAmount` | 已持久化的行利润 | 详情、追溯与 M3-B 报表均以此展示利润 |

## 状态与库存边界

1. 只有 `CONFIRMED` 和 `SETTLED` 可以登记到账。
2. `DRAFT` 和 `CANCELLED` 登记到账返回 `409`。
3. `SETTLED` 允许二次登记到账，更新 `actualReceivedAmount` 和行利润，但不覆盖已有 `settledAt`。
4. `SETTLED` 仍禁止取消；退款与退货不在 M3-C V1 范围内。
5. 到账操作不更新 `InventoryItem`，不写入 `itemStatus = SOLD`，也不恢复库存状态。
6. `SOLD` 的唯一写入入口仍是 `SalesService.confirm`；`PLATFORM_LISTED` 不等于 `SOLD`。

## 利润持久化

`SalesService.settle` 调用既有 `calculateSaleProfit`，不改变利润公式。

- 单个 `SaleLine`：写入整单利润。
- 多个 `SaleLine`：有可靠 `saleAmount` 时按销售金额占比分摊，否则按行数平均。
- 使用整数分处理尾差，最后一行吸收尾差，确保全部 `SaleLine.profitAmount` 合计等于整单利润。

## 页面一致性

- `/sales/[id]` 显示到账状态、实际到账、到账时间及操作日志；成功后重新拉取详情，不做假更新。
- `/sales` 显示最新 `actualReceivedAmount` 与中文销售状态。
- `/reports/sales` 与 `/reports/sales/orders` 只读，继续按 M3-B 口径读取 `SaleLine.profitAmount`。
- `/inventory/[id]` 与 `/purchases/[id]` 仅将 `CONFIRMED` / `SETTLED` 视为有效销售，并读取关联销售的最新实际到账和行利润。
- `DRAFT`、`CANCELLED` 及 `PLATFORM_LISTED` 不得被当作已售或已到账。
- 采购订单销售汇总按 `SaleOrder.id` 去重：库存成本和 `SaleLine.profitAmount` 逐行累计；成交价、实际到账、费用、销售侧运费和其他成本等订单级金额每张销售单只计算一次。
- 页面在到账成功后重新请求详情；销售列表、报表、库存追溯和采购追溯均从其只读 API 获取最新持久化数据，不以本地副本作为权威来源。

## 验证

`pnpm verify:m3c` 覆盖到账参数、状态守卫、二次登记、日志、利润持久化、库存不变，以及销售列表、报表、库存追溯、采购追溯之间的数据一致性；组合销售会额外断言采购订单汇总不重复累计订单级实际到账。
