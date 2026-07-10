# 项目当前状态

> 最后更新：2026-07-11
> 当前阶段：**M2-B 稳定期** — 不做 M3

## 当前阶段

系统处于 M2-B 稳定期，已完成采购订单、成本分摊、Mock物流、验货、库存、工作台待办六大模块。

**严格禁止**：进入 M3、得物入仓、销售结算、真实物流接口、OCR、自动推荐平台。

## 核心开发原则

以后修任何问题必须遵守：

1. **不能只修表面 UI**。按钮显示、loading 状态、错误提示只是表象。
2. **必须修完整业务闭环**：数据变化 → 页面同步 → 提醒重新计算 → 边界情况 → 验收标准。
3. **任何 async 函数必须有 try/catch/finally**，finally 中复位 loading 状态。
4. **任何 fetch/API 调用必须有 error state UI**，不能永久空白或永久 loading。
5. **修改业务数据后必须同步所有展示位置**：列表、详情、工作台、待办计数。
6. **加了新字段必须贯穿全链路**：schema → API → service → 前端表单 → 列表 → 详情 → 搜索 → 测试。
7. **修改后必须运行全部验证命令**，缺一不可。

## 已完成阶段

### M1：采购订单与成本分摊 ✅

- 采购订单 CRUD（创建、编辑、删除）
- 一单多货 + 附件上传
- 成本分摊（一单一商品自动分摊，多商品手动分摊）
- 删除保护（已进入后续流程的订单不可删除）
- 验证脚本：`pnpm verify:m1`（9 checks）

### M2-A：采购物流 ✅

- Mock 物流适配器（DELIVERED1=签收、EXCEPTION2=异常、STALLED3=停滞）
- 物流信息保存（快递公司 + 单号 + 发货时间）
- 物流状态刷新（调用 Mock 适配器）
- 签收后自动生成待验货记录
- 手动标记已签收（兜底按钮 + 二次确认）
- 验证脚本：`pnpm verify:m2a`（7 checks）

### M2-B：验货与库存 ✅

- 手机验货向导（6 步：确认商品→外观→新旧→批号效期库位→图片→结果）
- 验货完成生成 InventoryItem（单件库存，成本按数量拆分）
- 库存列表、库存详情
- 验证脚本：`pnpm verify:m2b`（9 checks）

### M2-B Bugfix / Polish ✅

- 采购列表行可点击（hover + cursor-pointer）
- 采购表单 button type 修复（添加/删除=button，提交=submit）
- Mock 物流提示横幅 + 测试规则展示
- 手动标记已签收按钮
- InventoryItem 新增 `storageLocation` 字段
- 验货向导新增库位输入
- 库存详情/列表支持库位显示和搜索
- 已完成验货可编辑（同步更新 InventoryItem）
- 库存详情→采购订单 returnTo 返回导航
- 首页统计卡片可点击跳转筛选页
- 采购列表新增 `todo` / `tracking` 筛选参数
- 待办中心：动态提醒卡片 + 已阅读 + 业务处理动作
- 效期提醒规则（普通：395天/365天提前预警，95分：90天/60天独立规则）
- 出售方式 saleMode 可在库存详情中修改
- `ReminderState`（snooze/resolve + reasonKey 防误隐藏）
- `InventoryActionLog`（业务动作追溯）
- `TodoResolution`（预警阶段已处理记录）
- PurchaseOrder 新增 `sellerNickname` 字段
- 采购订单搜索支持订单号、卖家昵称、商品名、SKU
- Base UI Button nativeButton 错误修复
- 物流保存按钮 loading 卡死修复（独立 state + try/catch/finally）
- 成本分摊页加载空白修复（error state + try/catch/finally）

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
| Inspection | 验货记录（6步向导、验货结果） |
| InventoryItem | 单件库存（locationStatus、saleMode、itemStatus、storageLocation） |
| ReminderState | 提醒隐藏/已处理状态（snooze + reasonKey） |
| InventoryActionLog | 库存业务处理追溯 |
| TodoResolution | 预警阶段处理记录 |

## 下一步

- **待确认**：是否进入 M3（销售管理）或继续 M2-B 体验优化
- 潜在待修复项：采购订单详情页库存摘要展示（目前只显示商品明细行）

## 验证命令

```bash
pnpm lint          # ESLint
pnpm test          # Vitest（38 tests）
pnpm build         # Next.js build
pnpm verify:m1     # M1 采购验证（9 checks）
pnpm verify:m2a    # M2-A 物流验证（7 checks）
pnpm verify:m2b    # M2-B 验货库存验证（9 checks）
node scripts/ui-verify.mjs  # 浏览器 UI 点检验证（33 checks）
```
