# M7-A1 采购到库存保质期追踪

## 范围

M7-A1 在每条独立 `PurchaseOrderItem` 记录可选的 `productionDate`、`shelfLifeMonths` 和 `expiryDate`，并在验货完成创建 `InventoryItem` 时复制为不可反向修改的库存快照。

这不是 SKU 公共属性。相同商品或 SKU 的不同批次必须保留为独立采购商品行，才能拥有不同生产日期、保质期或到期日期。普通 `quantity > 1` 的单行仍沿用既有语义：该行产生的全部库存共用同一组快照。

## 日期与校验

- 三个字段均可为空；数据库使用 PostgreSQL `DATE`，API 返回 `YYYY-MM-DD`。
- `shelfLifeMonths` 只能是 1 到 600 的整数。
- `productionDate + shelfLifeMonths` 且 `expiryDate` 为空时，按日历月相加并夹到目标月最后一天。例如 2025-01-31 + 1 个月为 2025-02-28，2024-01-31 + 1 个月为 2024-02-29。
- 包装明确标注的手工 `expiryDate` 是最终值，不会因编辑生产日期或月数被静默覆盖。用户可明确清空到期日后保存，或在页面点击重新计算后再保存。
- 到期日不得早于生产日期；已过期商品仍允许如实录入，不触发状态变化。

## 快照与锁定

- 新建采购、单条添加、批量添加和未锁定明细编辑使用同一服务端校验。
- 批量添加每行数量固定为 1，行之间不会按 SKU 或到期日合并；复制行复制保质期字段，空白行不继承。
- 单件验货和批量验货共用 `InspectionService.completeTx`，从 `PurchaseOrderItem` 复制三项字段，不在验货时重新计算，也不从 SKU、名称或备注猜测。
- 验货、库存、分摊、采购售后或采购退款等下游事实存在后，采购明细继续由既有守卫锁定，不能反向修改库存快照。

## 非目标

M7-A1 不实现临期/过期提醒、筛选、排序、飞书通知、自动下架、自动状态变化、成本重算、退款/销售/售后变更、物流查询或任何 `SOLD` 写入。M7-A2 才单独评估提醒能力。

## 迁移

- `20260718172135_add_purchase_inventory_shelf_life_fields` 新增采购字段、库存生产日期/月数，并把已有库存到期日收口为 `DATE`。
- `20260718172200_fix_shelf_life_date_constraints` 补充 null-safe 月数和日期先后 CHECK，并按 `Asia/Shanghai` 保留旧时间戳原本表达的日历日期。
- 未填写新字段的历史采购明细和库存仍为 `NULL`；没有伪造或批量回填日期。

## 验证

`pnpm verify:m7-shelf-life` 覆盖 date-only 校验、月末/闰年计算、手工覆盖、单条/批量录入、严格 DTO、编辑锁定、单件与批量验货快照、库存 API 日期序列化和无 `SOLD` 写入。

## Migration compatibility correction

- `20260718172300_correct_legacy_expiry_date_timezone` corrects only legacy inventory rows whose pre-M7 timestamp-derived `expiryDate` had been converted with the wrong timezone expression. It preserves the original `Asia/Shanghai` calendar date and does not backfill any new shelf-life fields.
