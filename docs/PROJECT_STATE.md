# 项目当前状态

> 最后更新：2026-07-12
> 当前阶段：**M3-0 平台寄送批次已完成** — 暂不进入 M3-A

## 当前阶段

M3-0 已完成，系统包含 8 大模块：采购订单、成本分摊、Mock物流、验货、库存、工作台待办、待办处理业务闭环、平台寄送批次。

**严格禁止**：进入 M3-A（销售订单/利润计算）、得物入仓、销售结算、真实物流接口、OCR、自动推荐平台。M3-0 任何操作不能把库存改成 SOLD。

### M3-0 平台寄送批次 ✅

- 草稿批次（DRAFT）+ 确认发货（confirm-shipped）
- 7 个行级动作 API：签收/入仓/上架/拒收/退回中/已退回/重新入库
- 统一状态机 `src/lib/shipment-status-machine.ts`
- 统一执行函数 `src/server/shipments/applyShipmentLineAction.ts`
- 寄送批次列表 + 新建 + 详情页
- 库存选择器（搜索/分组/批量选择/筛选/分页）
- 库存详情平台寄送追溯卡片
- 状态文案统一（formatItemStatus/formatLineStatus/formatBatchStatus 等）
- verify:m30 验证脚本（15 checks）
- M3-0 全流程不产生 SOLD

## 核心开发原则

以后修任何问题必须遵守：

1. **不能只修表面 UI**。按钮显示、loading 状态、错误提示只是表象。
2. **必须修完整业务闭环**，逐层检查：
   - 用户动作 → 真实业务含义
   - 数据库字段变化 → API 处理
   - 页面同步 → 待办/统计重新计算
   - 边界情况 → 验收标准
3. **任何 async 函数必须有 try/catch/finally**，finally 中复位 loading 状态。
4. **任何 fetch/API 调用必须有 error state UI**，不能永久空白或永久 loading。
5. **修改业务数据后必须同步所有展示位置**：列表、详情、工作台、待办计数。
6. **加了新字段必须贯穿全链路**：schema → API → service → 前端表单 → 列表 → 详情 → 搜索 → 测试。
7. **修改后必须运行全部验证命令**，缺一不可。

## 已完成模块

### M1：采购订单与成本分摊 ✅

- 采购订单 CRUD（创建、编辑、删除）
- 一单多货 + 附件上传
- 成本分摊（一单一商品自动分摊，多商品手动分摊）
- 删除保护（已进入后续流程的订单不可删除）
- 验证脚本：`pnpm verify:m1`（9 checks）

### M2-A：采购物流 ✅

- Mock 物流适配器（DELIVERED1=签收、EXCEPTION2=异常、STALLED3=停滞）
- 物流信息保存、刷新
- 签收后自动生成待验货记录
- 手动标记已签收兜底
- 验证脚本：`pnpm verify:m2a`（7 checks）

### M2-B：验货与库存 ✅

- 手机验货向导（6 步）
- 单件库存生成（成本按数量拆分）
- 库存列表、库存详情、库位管理
- 已完成验货编辑（同步更新 InventoryItem）
- 验证脚本：`pnpm verify:m2b`（9 checks）

### M2-B：工作台待办与业务闭环 ✅

- 待办中心：动态提醒卡片 + 已阅读 + 业务处理菜单
- 效期提醒规则（普通 395/365 天规则 + 95分 90/60 天独立规则）
- 动态处理动作矩阵（根据 todoType + saleMode + itemStatus + daysRemaining）
- 出售方式 saleMode 修改
- ReminderState（snooze/resolve + reasonKey 防误隐藏）
- InventoryActionLog（业务动作追溯）
- TodoResolution（预警阶段已处理，不同阶段互不影响）
- PurchaseOrder 新增 sellerNickname
- 搜索支持订单号、卖家昵称、商品名、SKU
- 统计卡片可点击跳转筛选页
- 库存详情→采购订单 returnTo 返回导航

## 当前不可修改的约束

- **不做 M3**：不得实现销售订单、销售结算、得物入仓批次
- **不接真实物流接口**：继续使用 MockLogisticsAdapter
- **不做 OCR**
- **不做自动判断和平台推荐**
- **SaleMode / LocationStatus / ItemStatus 字段含义不得更改**
- **成本分摊规则不变**：`paidTotal = totalAmount + shippingAmount`，分摊合计必须等于 paidTotal
- **单件成本拆分规则不变**：余数分配到最后一件
- **已签收待验货流程不变**：签收→PENDING_INSPECTION→验货→生成库存

## 当前数据模型（已落地）

| 模型 | 用途 |
|------|------|
| PurchaseOrder | 采购订单（含物流字段、sellerNickname） |
| PurchaseOrderItem | 商品明细（含 allocatedTotalCost） |
| Attachment | 附件（PURCHASE_ORDER / PURCHASE_ORDER_ITEM / INSPECTION） |
| LogisticsEvent | 物流事件记录 |
| Inspection | 验货记录 |
| InventoryItem | 单件库存（locationStatus、saleMode、itemStatus、storageLocation） |
| ReminderState | 提醒隐藏/已处理状态（snooze + reasonKey） |
| InventoryActionLog | 库存业务处理追溯 |
| TodoResolution | 预警阶段处理记录 |

## 下一步

- 待确认：是否进入 M3 或继续 M2-B 体验优化
- 潜在待修复：采购订单详情页库存摘要展示

## 验证命令

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
