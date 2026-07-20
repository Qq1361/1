# M8 仓库与库存成色基础

本阶段先建立仓库、库位和库存成色的数据基础及仓库管理页面；第二阶段将这些结构化资料接入“批量验货通过”的入库草稿。不会改变采购商品数量、销售、售后、退款、物流或 SOLD 状态机。

## 数据规则

- `Warehouse` 的名称在同一 owner 内唯一；`WarehouseLocation` 的名称在同一仓库内唯一。
- 新数据可关联 `InventoryItem.warehouseId`、`storageLocationId` 和 `condition`。成色枚举为：全新、近全新、轻微使用、使用痕迹、瑕疵。
- 保留原有 `InventoryItem.storageLocation` 自由文本字段和全部历史值，不做回填或迁移。历史展示优先级为结构化仓库/库位、旧自由文本、未设置。
- 只有当前 owner 可以读取或修改仓库、库位；服务端会拒绝跨 owner 的仓库或库位操作。
- 停用仓库/库位仍会保留在历史展示中，但 `GET /api/inventory/warehouses?activeOnly=true` 不返回它们，停用仓库不能新增库位。
- 不提供删除 API。数据库对被库存引用的仓库/库位使用 `RESTRICT`，因此不能通过级联删除丢失历史库存。

## 管理入口

库存页提供“仓库与库位”入口，对应 `/inventory/warehouses`。页面支持创建、重命名、启用/停用仓库和库位；不会转移库存或批量修改库存。

## 批量验货入库与手动库位（M8 第二、四阶段）

- 待验货列表的批量入口先打开资料弹窗。用户可将仓库、库位录入方式、手动库位或标准库位、成色、计划出售方式和公共备注显式应用到全部商品，再做逐件覆盖；确认前只存在浏览器草稿，不写数据库。
- 仓库始终选择当前 owner 的启用 `Warehouse`，不会将 A/B/C/D 仓写死。默认 `MANUAL` 模式保存 `warehouseId + storageLocation` 并清空 `storageLocationId`；可选 `STANDARD` 模式保存 `warehouseId + storageLocationId` 并清空新的自由文本。两种模式严格互斥。
- 手动库位必须 trim 后非空、不超过 100 个字符且不含控制字符；不会自动创建 `WarehouseLocation`。因此仓库没有任何标准库位时，仍可使用手动模式完成入库；标准模式会明确提示没有可用库位。
- 服务端在 Serializable 事务内重新校验 owner、启用状态、模式、手动文本和标准库位归属，任何一项过期、跨 owner 或不匹配都会让全批回滚。
- 每件仍创建独立库存。`saleMode` 为 null 或 `NONE` 时只记录计划值，不创建销售、发货或平台上架，不写入 `SOLD`。
- 采购保质期快照按 date-only 复制；实物纠正需填写依据，并以附加审计块保留旧值、新值和原因。

## 验证

```powershell
pnpm verify:m8-warehouse-foundation
pnpm verify:m8-warehouse-foundation-ui
pnpm verify:m2b-batch-inspection-details
pnpm verify:m8-inventory-bulk-management
pnpm verify:m8-manual-storage-location
```

## 库存列表批量维护（M8 第三阶段）

- 列表复用一套选择状态：单件、当前页和当前筛选结果全选；同筛选下可跨页累计，搜索、筛选或排序发生变化会清空选择。第一版服务端最多返回并操作 200 件。
- 批量调整仓位、设置成色、设置计划出售方式及修正保质期均先预览再确认。所有确认写入 `InventoryItemActionLog`，同次操作共享 batchId。
- 仅未锁定的在库自有库存可参与。已售、销售关联、平台寄送/退回和售后关联会使整批不执行；不会变更采购快照、库存状态、成本、销售、退款、售后或物流状态。

历史自由文本继续兼容：结构化标准库位显示“仓库 / 标准库位”，正式手动库位显示“仓库 / 手动文本”，只有历史文本时显示文本，只有仓库时显示“仓库 / 未填写库位”，全空显示“未设置”。前者使用独立临时夹具验证租户隔离、唯一性、停用过滤、历史字段不变、结构化字段、引用保护和不写入 SOLD。第二个脚本在 1440px 与 390px 验证仓库管理页面及重命名交互；第三个脚本验证批量验货的结构化入库资料、保质期审计和原子回滚；手动库位脚本验证两种模式、原子边界、展示和审计快照。
