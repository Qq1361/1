# 业务规则

> 当前阶段：M2-B 稳定期
> 修改任何逻辑前请先读此文件。

---

## 0. 核心规则

修问题不能只修表面 UI，必须检查完整链路：
1. 用户动作 → 真实业务含义
2. 数据库字段变化 → API 处理
3. 页面同步 → 待办/统计重新计算
4. 边界情况 → 验收标准

---

## 1. 采购订单

### 状态流转
```
PAID → WAITING_SHIPMENT → IN_TRANSIT → PENDING_INSPECTION → PARTIALLY_STOCKED → STOCKED
```

### 删除规则
- 仅允许删除 `PAID` 或 `WAITING_SHIPMENT` + 无 `shippedAt`/`deliveredAt`
- 已进入后续流程的前端隐藏删除按钮，显示不可删除说明
- 后端仍保留防护

---

## 2. 成本分摊

- `paidTotal = totalAmount + shippingAmount`
- 分摊合计 = paidTotal 才能确认
- 一单一商品自动分摊确认
- 单件成本 = allocatedTotalCost / quantity，余数归最后一件

---

## 3. Mock 物流

| 单号 | 状态 |
|------|------|
| 尾号1或含DELIVERED | DELIVERED → PENDING_INSPECTION |
| 尾号2或含EXCEPTION | EXCEPTION |
| 尾号3或含STALLED | STALLED |
| 其他 | IN_TRANSIT |

---

## 4. 验货

- 6 步向导，isNew=true 跳过瑕疵字段
- PASS→STOCKED，PROBLEM→PROBLEM
- 成本分摊未确认不能完成验货
- 编辑已完成验货同步更新 InventoryItem

---

## 5. 库存

### 关键字段
- `locationStatus`：LOCAL / DEWU_WAREHOUSE / RETURNING / SOLD
- `saleMode`：NONE / DEWU_LIGHTNING / DEWU_STANDARD / NINETY_FIVE / XIANYU / OTHER
- `itemStatus`：STOCKED / PROBLEM
- `storageLocation`：用户填写的实际库位

### saleMode 修改
- 库存详情页可修改
- 工作台待办"处理"菜单可快速修改
- SOLD / REMOVED 不允许修改
- 修改后写入 InventoryActionLog

---

## 6. 效期提醒规则

### 普通库存（saleMode != NINETY_FIVE）

| 剩余天数 | TodoType | 标题 | 优先级 |
|---------|----------|------|--------|
| > 402 天 | — | — | — |
| 396～402 | DISTANCE_TO_395_WITHIN_7_DAYS | 距离395天门槛不足7天 | 4 |
| 376～395 | EXPIRY_UNDER_395 | 效期低于395天 | 3 |
| 366～375 | DISTANCE_TO_365_WITHIN_10_DAYS | 距离365天门槛不足10天 | 2 |
| ≤ 365 | EXPIRY_UNDER_365 | 效期低于365天 | 1 |

每件库存同一时间只显示一个最高优先级。

### 95分库存（saleMode = NINETY_FIVE）

| 剩余天数 | TodoType | 标题 |
|---------|----------|------|
| ≤ 60 | NINETY_FIVE_EXPIRY_UNDER_60 | 95分效期低于60天 |
| 61～90 | NINETY_FIVE_EXPIRY_UNDER_90 | 95分效期接近限制 |

95分不显示任何 395/365 规则提醒。

### 不提醒条件
- itemStatus = PROBLEM / SOLD / REMOVED
- saleMode = XIANYU / OTHER（暂无专用规则）

---

## 7. 待办处理规则

### 动作分类

| 动作 | 改业务数据 | 写 ActionLog | 写 TodoResolution |
|------|-----------|-------------|-------------------|
| 已阅读（snooze 24h） | 否 | 否 | 否 |
| 业务处理（改 saleMode 等） | 是 | 是 | 否 |
| 预警解决（writesResolution） | 是/否 | 是 | 是 |

### 核心原则
- **已阅读只隐藏 24 小时，不改业务数据**
- **业务处理动作必须真实修改 InventoryItem**
- **预警处理不永久屏蔽后续更强风险**
- 不同 todoType 是不同阶段，TodoResolution 按 `todoType + reasonKey` 独立

### 动态动作矩阵

动作根据 `todoType + saleMode + itemStatus + daysRemaining` 动态生成：

| 待办类型 | 首要动作 | 禁止动作 |
|---------|---------|---------|
| DISTANCE_TO_395_WITHIN_7_DAYS | 已安排得物闪电 | — |
| EXPIRY_UNDER_395 | 改走得物普通 | 已安排得物闪电 |
| DISTANCE_TO_365_WITHIN_10_DAYS | 已降价普通出售 | — |
| EXPIRY_UNDER_365 | 转95分(>90天) | 已降价普通出售、改走得物普通 |
| NINETY_FIVE_EXPIRY_UNDER_90 | 95分降价出售 | 放到95分 |
| NINETY_FIVE_EXPIRY_UNDER_60 | 转闲鱼 | 放到95分、95分降价出售 |

### 隐藏规则
- 已是某 saleMode → 不显示对应动作
- itemStatus = PROBLEM → 不显示标记问题件
- 已过门槛 → 不显示该平台动作

### reasonKey 规则
- 库存类：`saleMode:expiryDate:itemStatus`
- 物流类：`LOGISTICS:logisticsStatus`
- 待验货类：`INSP:inspectionId:PENDING`
- 业务状态变化 → reasonKey 变化 → 旧 snooze/resolve 自动失效

---

## 8. 限制

- 不做 M3
- 不做销售订单
- 不做销售结算
- 不接真实物流
- 不做 OCR
- 不自动推荐平台

---

## 9. 统一数据来源

所有统计卡片、待办中心、筛选列表必须基于同一套计算逻辑：

- `getReminderType()` — 唯一权威的提醒计算函数（`src/server/services/todo-service.ts`）
- `/api/todos` — 首页卡片 + 待办中心
- `/api/inventory?reminder=xxx` — 库存筛选（使用相同的 `getReminderType` + ReminderState 过滤）
- `/api/purchase-orders?todo=xxx` — 采购筛选（使用相同的 ReminderState 过滤）

禁止：不同位置使用不同的计算条件。

## 10. 验证命令

```bash
pnpm prisma migrate dev
pnpm prisma db seed
pnpm lint
pnpm test
pnpm build
pnpm verify:m1
pnpm verify:m2a
pnpm verify:m2b
```
