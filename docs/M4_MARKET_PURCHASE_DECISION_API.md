# M4-A6 采购试算 API

## 接口

`POST /api/market/items/[marketItemId]/purchase-decision`

该接口是只读、即时试算：不保存决策，不创建采购订单，不修改行情、库存、销售或售后。

## 请求

```json
{
  "proposedPurchasePrice": "320.00",
  "targetProfitAmount": "80.00",
  "additionalCostAmount": "10.00",
  "platform": "DEWU"
}
```

三个金额均为非负、最多两位小数的十进制字符串；`platform` 可省略以返回四个平台的独立结果。接口严格拒绝 `ownerId`、`quoteId`、`expectedIncome`、计算结果、来源和任何未知字段。

## 收入与状态

- 仅当前有效、已确认的 `EXPECTED_INCOME` 可直接计算。
- `LISTING_PRICE` 缺少未来费率规则时返回 `MISSING_FEE_RULE`。
- `MANUAL_REFERENCE` 不参与计算。
- 停用商品返回 HTTP 200，所有结果为 `UNAVAILABLE / MARKET_ITEM_INACTIVE`。
- 不可计算平台不进入 `comparablePlatformOrder`；该字段仅表达数值排序，不表示自动出售推荐。

所有金额为固定两位小数字符串。建议最高采购价可为负数，保留真实结果，不归零。
