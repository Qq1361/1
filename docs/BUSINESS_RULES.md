# 业务规则

> 当前阶段：M2-B 稳定期
> 本文件记录所有已落地的业务规则。修改任何逻辑前请先读此文件。

## 1. 采购订单

### 创建
- `paidTotal = totalAmount + shippingAmount`
- 至少一条商品明细
- 闲鱼订单号必填
- 卖家昵称选填

### 删除
- 仅允许删除 `PAID` 或 `WAITING_SHIPMENT` 状态 + 无 `shippedAt`/`deliveredAt` 的订单
- 已进入后续流程（IN_TRANSIT / PENDING_INSPECTION / PARTIALLY_STOCKED / STOCKED）不可删除
- 前端隐藏删除按钮，后端仍保留防护

### 状态流转
```
PAID → WAITING_SHIPMENT → IN_TRANSIT → PENDING_INSPECTION → PARTIALLY_STOCKED → STOCKED
                                                                    ↘（有问题件）
```

## 2. 成本分摊

### 规则
- `paidTotal = totalAmount + shippingAmount`
- 分摊合计必须等于 `paidTotal` 才能确认（`CONFIRMED`）
- 不相等时只能保存草稿（`DRAFT`）

### 一单一商品
- 系统自动分摊：`allocatedTotalCost = paidTotal`
- 自动确认：`allocationStatus = CONFIRMED`

### 一单多商品
- 用户手动填写每条明细的分摊成本
- 保存草稿或确认分摊

### 单件成本拆分
- `unitCost = allocatedTotalCost / quantity`
- 不能整除时余数（分）分配到最后一件

## 3. Mock 物流

### 测试规则
| 单号特征 | 物流状态 | 事件文本 |
|---------|---------|---------|
| 尾号 1 或含 DELIVERED | DELIVERED | 快件已签收。 |
| 尾号 2 或含 EXCEPTION | EXCEPTION | 运输过程中出现异常 |
| 尾号 3 或含 STALLED | STALLED | 物流轨迹长时间未更新 |
| 其他 | IN_TRANSIT | 快件正在运输途中。 |

### 保存物流
- 快递公司代码 + 快递单号必填
- 保存后订单进入 IN_TRANSIT

### 刷新物流
- 必须已保存单号才能刷新
- 刷新后根据 Mock 规则更新物流状态
- 签收（DELIVERED）→ 订单进入 PENDING_INSPECTION → 自动生成待验货记录

### 手动标记已签收
- 兜底按钮，需二次确认
- 写入 LogisticsEvent + 更新订单状态 + 生成待验货记录
- 不重复生成 Inspection

## 4. 验货

### 验货向导（6 步）
1. 确认商品
2. 是否全新与包装（hasBox + isNew）
3. 瑕疵与使用痕迹（仅 isNew=false 时显示）
4. 批号、效期、库位
5. 验货图片
6. 备注与结果（PASS / PROBLEM）

### isNew 条件规则
- isNew=true：跳过瑕疵和使用痕迹字段，无需填写
- isNew=false：显示 hasUsageTrace、capCondition、paintCondition、leakageCondition
- 不因 isNew 自动设置 PASS/PROBLEM

### 完成验货
- PASS → 生成 InventoryItem（itemStatus=STOCKED）
- PROBLEM → 生成 InventoryItem（itemStatus=PROBLEM）
- 单件成本按 `splitUnitCosts` 规则拆分
- 所有验货完成后订单状态更新为 STOCKED 或 PARTIALLY_STOCKED
- 成本分摊未确认时不允许完成验货

### 编辑已完成验货
- 可修改验货字段、库位、效期、验货结果
- 修改 expiryDate → 同步更新 InventoryItem.expiryDate
- 修改 storageLocation → 同步更新 InventoryItem.storageLocation
- 修改验货结果（PASS↔PROBLEM）→ 同步更新 InventoryItem.itemStatus
- 不重复生成 InventoryItem

## 5. 库存

### InventoryItem 关键字段
- `locationStatus`：LOCAL / DEWU_WAREHOUSE / RETURNING / SOLD
- `saleMode`：NONE / DEWU_LIGHTNING / DEWU_STANDARD / NINETY_FIVE / XIANYU / OTHER
- `itemStatus`：STOCKED / PROBLEM / SOLD / REMOVED（仅当前可用状态）
- `storageLocation`：用户填写的实际库位（A箱、B箱等）
- `unitCost`：单件成本
- `expiryDate`：效期

### saleMode 修改
- 库存详情页可直接修改出售方式
- 工作台待办"处理"菜单可快速修改
- SOLD / REMOVED 状态不允许修改
- 修改后记录 InventoryActionLog

## 6. 效期提醒规则

### 普通库存（saleMode != NINETY_FIVE）

| 剩余天数 | TodoType | 标题 | 优先级 |
|---------|----------|------|--------|
| > 402 天 | 无 | — | — |
| 396～402 天 | DISTANCE_TO_395_WITHIN_7_DAYS | 距离395天门槛不足7天 | 4 |
| 376～395 天 | EXPIRY_UNDER_395 | 效期低于395天 | 3 |
| 366～375 天 | DISTANCE_TO_365_WITHIN_10_DAYS | 距离365天门槛不足10天 | 2 |
| ≤ 365 天 | EXPIRY_UNDER_365 | 效期低于365天 | 1 |

每件库存同一时间只显示一个最高优先级效期提醒。

### 95分库存（saleMode = NINETY_FIVE）

| 剩余天数 | TodoType | 标题 |
|---------|----------|------|
| ≤ 60 天 | NINETY_FIVE_EXPIRY_UNDER_60 | 95分效期低于60天 |
| 61～90 天 | NINETY_FIVE_EXPIRY_UNDER_90 | 95分效期接近限制 |

95分不显示任何 395/365 规则提醒。

### 不提醒条件
- itemStatus = PROBLEM / SOLD / REMOVED
- saleMode = XIANYU / OTHER（暂无专用规则）

## 7. 待办中心

### 待办类型
| 类型 | 来源 | 跳转 |
|------|------|------|
| 订单物流类 | PurchaseOrder | → /purchases/[id] |
| 待验货 | Inspection（单条） | → /inspections/[id] |
| 效期/压货类 | InventoryItem | → /inventory/[id] |

### 处理动作分类
- **已阅读**：24h 隐藏，写入 ReminderState（snooze），不改业务数据
- **业务处理**：真实修改 InventoryItem，写入 InventoryActionLog
- **预警解决**：写入 TodoResolution，当前阶段消失，后续更严重阶段仍可触发

### 动态动作矩阵
- 根据 todoType + saleMode + itemStatus + daysRemaining 动态生成
- 已是某 saleMode 不显示对应动作
- 已过门槛不显示该平台动作
- itemStatus=PROBLEM 不显示标记问题件

### reasonKey 规则
- 库存类：`saleMode:expiryDate:itemStatus`
- 物流类：`LOGISTICS:logisticsStatus`
- 待验货类：`INSP:inspectionId:PENDING`
- 业务状态变化 → reasonKey 变化 → 旧 snooze/resolve 自动失效

## 8. 数据追溯

### InventoryActionLog
- 所有业务处理动作写入日志
- 记录 old/new 值快照

### TodoResolution
- 唯一键：`ownerId + todoType + reasonKey`
- 不同 todoType 是不同阶段，互不影响
- 例如 DISTANCE_TO_365_WITHIN_10_DAYS 已处理 ≠ EXPIRY_UNDER_365 已处理

## 9. 验证命令

每次修改后必须运行全部：

```bash
pnpm lint          # ESLint（0 errors）
pnpm test          # Vitest（38 tests）
pnpm build         # Next.js build
pnpm verify:m1     # M1 采购验证（9 checks）
pnpm verify:m2a    # M2-A 物流验证（7 checks）
pnpm verify:m2b    # M2-B 验货库存验证（9 checks）
```
