# 验收清单

> 每次修改后必须逐项验证。全部通过才能提交。

---

## 自动化验证（必须全部通过）

```bash
pnpm prisma migrate dev   # 数据库迁移
pnpm prisma db seed       # 种子数据
pnpm lint                 # ESLint（0 errors）
pnpm test                 # Vitest（38 tests）
pnpm build                # Next.js build
pnpm verify:m1            # M1 采购验证（9 checks）
pnpm verify:m2a           # M2-A 物流验证（7 checks）
pnpm verify:m2b           # M2-B 验货库存验证（9 checks）
```

---

## 页面功能验收（逐页点击）

### 工作台 `/`

- [ ] 统计卡片数量正确，可点击跳转筛选页
- [ ] 待办中心显示待办列表，每条有标题+描述+动作
- [ ] 已阅读按钮：点击后待办消失，24h 后重新出现
- [ ] 处理按钮：展开菜单，动作根据类型动态显示
- [ ] 业务处理动作：修改真实数据，待办消失/变化
- [ ] 最近采购订单可点击进入详情

### 采购订单列表 `/purchases`

- [ ] 订单行可点击（cursor-pointer + hover）
- [ ] 搜索支持订单号、卖家昵称、商品名、SKU
- [ ] 筛选：采购状态、物流单号、分摊状态
- [ ] `?todo=missingTracking` / `?todo=logisticsIssues` 筛选正确
- [ ] `?tracking=missing` 筛选正确
- [ ] 清除筛选恢复正常

### 采购订单详情 `/purchases/[id]`

- [ ] 订单信息完整（含卖家昵称）
- [ ] 物流卡片：Mock 提示横幅、测试规则、必填标记
- [ ] 保存物流：填写 SF + DELIVERED1 → 刷新 → 已签收
- [ ] 保存/刷新按钮 loading 不卡死
- [ ] 手动标记已签收：二次确认 → 状态更新
- [ ] 不满足删除条件的订单不显示删除按钮
- [ ] 满足删除条件的订单可正常删除
- [ ] 从库存详情进入时显示"返回库存详情"

### 新建采购订单 `/purchases/new`

- [ ] 可添加/删除多个商品
- [ ] 卖家昵称可填写
- [ ] 创建成功后跳转订单详情
- [ ] 创建失败显示明确错误
- [ ] 按钮类型正确（添加/删除=button，提交=submit）

### 成本分摊 `/purchases/[id]/allocate`

- [ ] 一单一商品自动分摊并显示已确认
- [ ] 一单多商品显示手动分摊表
- [ ] 分摊合计不等于 paidTotal 不能确认
- [ ] 保存按钮不卡死
- [ ] 加载失败显示错误卡片（不空白）

### 待验货 `/inspections`

- [ ] 待验货记录列表正确
- [ ] 可点击进入验货向导
- [ ] 无 Base UI nativeButton 错误

### 验货向导 `/inspections/[id]`

- [ ] 6 步向导正常
- [ ] isNew=true 时跳过瑕疵字段
- [ ] isNew=false 时显示瑕疵字段
- [ ] 库位可填写
- [ ] 保存并继续不报 500
- [ ] 验货通过/问题件正常完成

### 编辑验货 `/inspections/[id]?edit=true`

- [ ] 所有字段可编辑
- [ ] 保存后库存详情同步更新
- [ ] 不重复生成库存

### 库存列表 `/inventory`

- [ ] 库位列显示
- [ ] 出售方式列显示
- [ ] 搜索支持库存编号、商品名、SKU、库位
- [ ] `?reminder=xxx` 筛选正确

### 库存详情 `/inventory/[id]`

- [ ] 位置大类 + 具体库位显示
- [ ] 出售方式可修改
- [ ] 编辑验货信息按钮可跳转
- [ ] 查看采购订单携带 returnTo

---

## 效期提醒验收

- [ ] saleMode=NONE，400天 → DISTANCE_TO_395_WITHIN_7_DAYS
- [ ] saleMode=NONE，370天 → DISTANCE_TO_365_WITHIN_10_DAYS
- [ ] saleMode=NONE，293天 → EXPIRY_UNDER_365
- [ ] saleMode=NINETY_FIVE，85天 → NINETY_FIVE_EXPIRY_UNDER_90
- [ ] saleMode=NINETY_FIVE，58天 → NINETY_FIVE_EXPIRY_UNDER_60
- [ ] 同一件库存只出一个效期提醒
- [ ] PROBLEM 库存不产生效期/压货提醒

---

## 待办动作矩阵验收

| 待办类型 | 必须有的动作 | 不能有的动作 |
|---------|------------|------------|
| DISTANCE_TO_395_WITHIN_7_DAYS | 已安排得物闪电 | — |
| EXPIRY_UNDER_395 | 改走得物普通 | 已安排得物闪电 |
| DISTANCE_TO_365_WITHIN_10_DAYS | 已降价普通出售 | — |
| EXPIRY_UNDER_365 | 转闲鱼、修改效期、标记问题件 | 已降价普通出售、改走得物普通 |
| NINETY_FIVE_EXPIRY_UNDER_90 | 95分降价出售、转闲鱼 | 放到95分 |
| NINETY_FIVE_EXPIRY_UNDER_60 | 转闲鱼、修改效期、标记问题件 | 放到95分、95分降价出售 |

---

## 业务闭环验收

- [ ] 已阅读只隐藏 24h，不改业务数据
- [ ] 业务处理动作真实修改 InventoryItem
- [ ] 修改后写入 InventoryActionLog
- [ ] 预警解决写入 TodoResolution（当前阶段消失）
- [ ] 修改后所有页面同步显示（列表、详情、工作台）
- [ ] 同一订单多库存只修改被点击的一件
- [ ] API 失败时待办不消失，显示 toast 错误
- [ ] 刷新页面后数据仍存在
- [ ] 顶部统计数量和待办列表一致

## M3-0 平台寄送批次验收

### 创建和发货

- [ ] 创建草稿批次后库存 itemStatus 仍是 STOCKED
- [ ] 草稿批次占用库存，不能加入其他批次
- [ ] 确认发货后 lineStatus=SHIPPED, itemStatus=PLATFORM_SHIPPED
- [ ] 确认发货后 saleMode 按 purpose 更新
- [ ] DRAFT 批次可编辑批次信息（物流/成本/备注）
- [ ] 确认发货弹窗可补齐物流信息
- [ ] 装箱核对可勾选

### 状态流转

- [ ] 平台签收：RECEIVED / PLATFORM_RECEIVED
- [ ] 入仓成功：IN_WAREHOUSE / PLATFORM_IN_WAREHOUSE ≠ SOLD
- [ ] 鉴别通过/待结算（得物普通）：IN_WAREHOUSE / PLATFORM_IN_WAREHOUSE ≠ SOLD
- [ ] 上架可售：LISTED / PLATFORM_LISTED ≠ SOLD
- [ ] 平台拒收：REJECTED / PLATFORM_REJECTED，必须填写原因
- [ ] 退回中：RETURNING / RETURNING
- [ ] 已退回：RETURNED / RETURNED ≠ STOCKED
- [ ] 确认重新入库：itemStatus→STOCKED，line 保持 RETURNED
- [ ] 重新入库后库存可再次加入新批次

### 安全规则

- [ ] 全流程不产生 SOLD
- [ ] RECEIVED→SHIPPED 非法跳转被拦截
- [ ] LISTED→IN_WAREHOUSE 非法跳转被拦截
- [ ] SOLD/PROBLEM/REMOVED 库存不能执行寄送操作
- [ ] batch.status 自动汇总
- [ ] API 失败不半更新

### 展示

- [ ] 状态枚举全部显示中文（不暴露 PLATFORM_SHIPPED 等英文）
- [ ] 库存详情显示平台寄送追溯卡片
- [ ] 平台状态库存继续效期提醒
- [ ] 平台状态库存不进入本地压货提醒
- [ ] 统计卡片和筛选列表数量一致

## M3-A V1 销售出库验收（设计冻结，待实现）

详见 `docs/M3A_V1_SPEC.md`。

- [ ] 创建销售草稿不改变库存状态
- [ ] 确认销售后库存变 SOLD（唯一入口）
- [ ] 一件库存不能重复确认销售
- [ ] 取消 CONFIRMED 恢复 preSaleItemStatus
- [ ] SETTLED 不能取消
- [ ] actualReceivedAmount 优先计算利润
- [ ] expectedIncome 次优先计算利润
- [ ] grossAmount + feeLines 不重复扣费
- [ ] SOLD 不进效期提醒
- [ ] SOLD 不进压货提醒
- [ ] PLATFORM_LISTED 不会自动变 SOLD
- [ ] API 失败不半更新
- [ ] 利润刷新后仍正确
