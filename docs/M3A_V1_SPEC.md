# M3-A V1 销售出库、到账、利润计算 — 规格冻结

> 版本：V1 冻结
> 状态：已实现并冻结
> 最后更新：2026-07-12

## 一、V1 范围

### 包含

| 功能 | 说明 |
|------|------|
| SaleOrder 销售订单 | 手动创建，不接真实平台 |
| SaleLine 销售明细 | 单件/多件组合 |
| SaleFeeLine 销售费用 | 平台佣金、鉴定费、运费等 |
| 销售草稿 DRAFT | 不改变库存状态 |
| 确认销售 CONFIRMED | 库存变 SOLD（唯一入口） |
| 登记到账 SETTLED | 登记实际到账金额，重算利润 |
| 取消未到账销售 | DRAFT 直接取消；CONFIRMED 恢复快照 |
| 利润计算 | 三种优先级互斥 |
| 销售追溯 | 库存详情、采购订单详情显示销售结果 |
| 库存列表 SOLD 筛选 | SOLD 仍可查询，中文显示“已售出” |

### 不包含（V1 明确排除）

- 真实得物/95分 API 对接
- 自动同步平台销售数据
- OCR
- 自动退款退货（REFUNDED 留到后续版本）
- 自动分摊寄送批次成本到销售利润
- 自动把 PLATFORM_LISTED 当 SOLD
- 复杂财务报表
- 自动推荐平台

## 二、核心边界（不可违反）

1. **PLATFORM_LISTED ≠ SOLD**。上架可售不等于已售出。
2. **PLATFORM_IN_WAREHOUSE ≠ SOLD**。入仓成功不等于已售出。
3. **PLATFORM_RECEIVED ≠ SOLD**。平台签收不等于已售出。
4. **平台签收、入仓、上架都不能产生销售利润**。
5. **SOLD 只能由 M3-A 确认销售产生**。这是系统唯一的 SOLD 入口。
6. **M3-0 永远不能产生 SOLD**。
7. **销售确认必须使用 transaction**。
8. **销售取消必须恢复销售前状态快照，不能默认恢复 STOCKED**。

## 三、销售状态

```
DRAFT → CONFIRMED → SETTLED
  ↓         ↓
CANCELLED  (REFUNDED — 留到后续版本)
```

| 状态 | itemStatus | 说明 |
|------|-----------|------|
| DRAFT | 不变 | 草稿不改变库存，不占用库存 |
| CONFIRMED | SOLD | **唯一 SOLD 入口** |
| SETTLED | SOLD | 到账保持 SOLD |
| CANCELLED | 恢复 preSaleItemStatus | SETTLED 不能取消 |

## 四、草稿不占用库存

1. DRAFT 销售订单不改变 InventoryItem.itemStatus。
2. 多个草稿可以选择同一件库存。
3. 确认时 transaction 二次校验库存状态。
4. 防重复销售在 CONFIRMED 时拦截，不在 DRAFT 时拦截。

## 五、允许销售的库存状态

| 状态 | 可销售 |
|------|:---:|
| STOCKED | ✅ |
| PLATFORM_SHIPPED | ✅ |
| PLATFORM_RECEIVED | ✅ |
| PLATFORM_IN_WAREHOUSE | ✅ |
| PLATFORM_LISTED | ✅ |
| SOLD | ❌ |
| PROBLEM | ❌ |
| REMOVED | ❌ |
| RETURNING | ❌ |
| RETURNED | ❌ |
| PLATFORM_REJECTED | ❌ |

## 六、销售前状态快照

SaleLine 必须保存（用于取消恢复）：

- `preSaleItemStatus` — 销售前库存状态
- `preSaleSaleMode` — 销售前出售方式
- `preSaleStorageLocation` — 销售前库位
- `preSaleShipmentBatchId` — 关联寄送批次（可选）
- `preSaleShipmentLineId` — 关联寄送行（可选）

取消时恢复规则：
- PLATFORM_LISTED → 恢复 PLATFORM_LISTED
- PLATFORM_IN_WAREHOUSE → 恢复 PLATFORM_IN_WAREHOUSE
- STOCKED → 恢复 STOCKED

**不默认恢复 STOCKED。**

## 七、利润计算规则

### 优先级（互斥，同一订单只走一条路径）

**路径 1**：`actualReceivedAmount` 有值
```
利润 = actualReceivedAmount - Σ(unitCostSnapshot) - shippingCost - otherCost
```

**路径 2**：`actualReceivedAmount` 为空，`expectedIncome` 有值
```
利润 = expectedIncome - Σ(unitCostSnapshot) - shippingCost - otherCost
```

**路径 3**：两者都为空，使用 `grossAmount` + `feeLines`
```
利润 = grossAmount - Σ(feeLines.amount) - Σ(unitCostSnapshot) - shippingCost - otherCost
```

### 防重复扣费

| 路径 | 扣 feeLines | 扣 shippingCost | 扣 otherCost |
|------|:---:|:---:|:---:|
| actualReceivedAmount | ❌ | ✅ | ✅ |
| expectedIncome | ❌ | ✅ | ✅ |
| grossAmount | ✅ | ✅ | ✅ |

### 寄送批次成本

V1 不自动计入利润。在销售详情页展示关联寄送批次的成本作为参考。

### 利润归属

- SaleOrder 级别利润是权威结果
- SaleLine 级别利润为展示快照
- 行级四舍五入误差不改变订单级总利润

## 八、建议数据模型

### SaleOrder

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | PK |
| saleNo | String | 唯一 |
| platform | String | DEWU/NINETY_FIVE/XIANYU/OTHER |
| platformOrderNo | String? | 平台订单号 |
| platformTradeNo | String? | 平台交易号 |
| buyerName | String? | 买家名 |
| soldAt | DateTime | 销售时间 |
| grossAmount | Decimal | 成交价 |
| expectedIncome | Decimal? | 预计收入 |
| actualReceivedAmount | Decimal? | 实际到账 |
| shippingCost | Decimal | 销售侧运费 |
| otherCost | Decimal | 其他成本 |
| status | SaleOrderStatus | DRAFT/CONFIRMED/SETTLED/CANCELLED |
| note | String? | |
| confirmedAt | DateTime? | |
| settledAt | DateTime? | |
| cancelledAt | DateTime? | |
| createdAt/updatedAt | DateTime | |

### SaleLine

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | PK |
| saleOrderId | String | FK |
| inventoryItemId | String | FK |
| inventoryCodeSnapshot | String | |
| productNameSnapshot | String | |
| skuSnapshot | String? | |
| unitCostSnapshot | Decimal | 销售时库存成本 |
| saleAmount | Decimal | 该件分摊收入 |
| costAmount | Decimal | 该件库存成本 |
| profitAmount | Decimal | 该件利润 |
| sourcePurchaseOrderId | String? | |
| sourceShipmentBatchId | String? | |
| preSaleItemStatus | String | 销售前状态快照 |
| preSaleSaleMode | String? | |
| preSaleStorageLocation | String? | |
| createdAt | DateTime | |

### SaleFeeLine

| 字段 | 类型 | 说明 |
|------|------|------|
| id | String | PK |
| saleOrderId | String | FK |
| feeType | String | PLATFORM_COMMISSION/AUTHENTICATION/SHIPPING/PACKAGING/OTHER |
| amount | Decimal | |
| note | String? | |
| createdAt | DateTime | |

## 九、API 冻结

| API | 功能 | 库存影响 |
|-----|------|---------|
| POST /api/sales | 创建草稿 | 不变 |
| GET /api/sales | 列表 | — |
| GET /api/sales/[id] | 详情 | — |
| PATCH /api/sales/[id] | 编辑草稿 | 不变 |
| POST /api/sales/[id]/confirm | 确认 | → SOLD（唯一入口） |
| POST /api/sales/[id]/settle | 到账 | 保持 SOLD |
| POST /api/sales/[id]/cancel | 取消 | 恢复快照（SETTLED 禁止） |

所有写 API：Zod 校验 + Decimal + transaction + JSON 错误。

## 十、页面冻结

| 页面 | 状态 | 说明 |
|------|------|------|
| `/sales` | 已完成 | 销售订单列表，只读筛选和跳转 |
| `/sales/new` | 已完成 | 创建 DRAFT 草稿，不改变库存状态 |
| `/sales/[id]` | 已完成 | 详情、确认销售、登记到账、取消销售 |
| `/inventory/[id]` | 已完成 | 销售结果只读追溯 |
| `/purchases/[id]` | 已完成 | 每件库存销售追溯 + 订单级销售汇总 |

页面限制：

1. `/sales/[id]` 操作区只调用 sales API，不直接写库存状态。
2. `/inventory/[id]` 和 `/purchases/[id]` 只读展示销售结果，不提供销售操作按钮。
3. 库存详情当前有效销售只认 CONFIRMED / SETTLED。
4. 采购订单销售汇总只统计 CONFIRMED / SETTLED。
5. DRAFT / CANCELLED 不计入已售汇总。
6. PLATFORM_LISTED 不等于 SOLD，不能被统计为已售。

## 十一、verify:m3a 覆盖

1. 创建销售草稿不改变库存状态
2. 确认销售后库存变 SOLD
3. 一件库存不能重复确认销售
4. 多件组合成本合计正确
5. actualReceivedAmount 优先计算利润
6. expectedIncome 次优先计算利润  
7. grossAmount + feeLines 不重复扣费
8. 取消 CONFIRMED 恢复 preSaleItemStatus
9. SETTLED 不能取消
10. SOLD 不进效期提醒
11. SOLD 不进压货提醒
12. PLATFORM_LISTED 不会自动变 SOLD
13. PLATFORM_IN_WAREHOUSE 不自动计算利润
14. API 失败不半更新
15. 利润刷新后仍然正确
16. DRAFT 不占用库存
17. SOLD 不进入 `/api/todos`
18. SOLD 仍可在库存列表查询
19. 库存详情销售追溯只把 CONFIRMED / SETTLED 当有效销售，并保留 CANCELLED 历史
20. 采购订单详情销售追溯只统计 CONFIRMED / SETTLED
21. DRAFT / CANCELLED 不作为当前已售
22. CANCEL CONFIRMED 可恢复 PLATFORM_LISTED 快照

## 十二、实现顺序

已完成：

1. Schema + migration
2. SalesService + 利润计算函数
3. create/confirm/settle/cancel API
4. verify:m3a
5. `/sales` 列表、新建、详情和操作区
6. 库存详情销售追溯
7. 采购订单详情销售摘要
8. 工作台 SOLD 排除
9. 全量回归

后续进入 M3-B 前必须重新冻结规格，不得直接扩展退款/退货或真实平台接口。
