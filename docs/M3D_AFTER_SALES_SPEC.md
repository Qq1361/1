# M3-D V1 售后与平台退回总览

## 冻结结论

M3-D 不采用一个模糊的统一退货主表。采购售后、销售售后和平台退回必须保持三个独立业务域：

1. 采购售后：用户是买家，上游闲鱼卖家向用户退款。
2. 销售售后：用户是卖家，用户向闲鱼买家退款。
3. 平台退回：平台把用户自有库存退回给用户，V1 不代表上下游退款。

两者的资金方向、订单来源、库存结果和财务口径不同，不能共享主表、退款流水或权威状态机。可复用的仅是金额输入、物流单号、附件上传等纯界面或技术组件。

详细冻结规则见：

- [采购售后规格](./M3D_PURCHASE_AFTER_SALES_SPEC.md)
- [销售售后规格](./M3D_SALES_AFTER_SALES_SPEC.md)
- [平台退回验货规格](./M3D_PLATFORM_RETURN_INSPECTION_SPEC.md)

本文件只定义三类退回场景的边界，不定义任何 Prisma 模型、API 或页面实现。

## 三类退回场景

| 场景 | 用户角色与资金方向 | 关联对象 | 库存语义 | 负责范围 |
| --- | --- | --- | --- | --- |
| 采购售后 | 用户是买家；上游闲鱼卖家退款给用户 | `PurchaseOrder`、`PurchaseOrderItem`、`Inspection`，以及已存在时的 `InventoryItem` | 影响采购退款、净采购成本、是否仍属于用户资产 | M3-D1 |
| 销售售后 | 用户是卖家；用户退款给闲鱼买家 | `SaleOrder`、`SaleLine`、`InventoryItem` | 影响销售退款、净到账、净利润，以及买家退货后的库存恢复 | M3-D2 |
| 平台退回 | 得物/95 分平台拒收、鉴别失败、退仓或撤回 | `PlatformShipmentLine`、后续 `PlatformReturnInspection` | 平台寄送状态机中的退回，不等同于上下游退款 | M3-D3 |

不得把三类场景都映射为 `InventoryItem.RETURNING` 或 `RETURNED`。当前这两个库存状态属于平台寄送退回语义；采购退回上游卖家和买家退货均不得复用。

## 现有系统事实

- `PurchaseOrder.status` 现有状态为 `PAID`、`WAITING_SHIPMENT`、`IN_TRANSIT`、`PENDING_INSPECTION`、`PARTIALLY_STOCKED`、`STOCKED`、`CANCELLED`。
- `PurchaseOrder` 保留原始实付构成：`totalAmount + shippingAmount`，业务中称为 `paidTotal`；当前没有采购退款、退回物流或卖家售后字段。
- `Inspection` 仅关联 `PurchaseOrderItem`。当前完成验货时，无论结果为 `PASS` 或 `PROBLEM`，都会创建一个 `InventoryItem`；其状态分别为 `STOCKED` 与 `PROBLEM`。后续将已完成验货改为问题件时，现有服务会同步库存为 `PROBLEM`。
- `SaleOrder.status` 仅有 `DRAFT`、`CONFIRMED`、`SETTLED`、`CANCELLED`。`SETTLED` 是原销售到账事实，不能被退款改写为 `CANCELLED` 或新增为 `REFUNDED`。
- `SalesService.cancel` 只处理销售草稿或已确认销售的取消；`SETTLED` 返回 409。因此它不是售后退款或买家退货的实现路径。

## 不可共用的约束

以下设计一律禁止：

1. 一个售后主表同时关联 `PurchaseOrder` 和 `SaleOrder`。
2. 一个退款流水同时表达“上游卖家退款给我”和“我退款给买家”。
3. 采购售后覆盖 `SaleOrder.actualReceivedAmount`，或销售售后覆盖采购 `paidTotal`。
4. 采购退货复用买家退货验货，或买家退货复用采购 `Inspection`。
5. 将得物/95 分平台退回写入任何 M3-D 退款模型。
6. 引入语义不明的 `REMOVED` 状态作为兜底。

## 实施顺序

1. **M3-D1 采购售后**：先解决验货问题件、退回上游、采购退款与资产归属问题。
2. **M3-D2 销售售后**：随后处理买家退款、买家退货、净到账与净利润。
3. **M3-D3 平台退回验货**：复用寄送 line 作为退回主事实，以独立验货模型处理返回本地后的质量判断；不能并入前两个售后 migration 或退款流水。

采购售后与销售售后必须使用独立 migration、独立 service、独立 API、独立 verify 脚本。建议分别命名 `verify:m3d-purchase` 与 `verify:m3d-sales`。

## 本轮限制

本轮是设计冻结和只读审计：不修改 Prisma schema，不创建 migration，不实现服务、API 或页面，不修改库存状态、不写入 `SOLD`，也不修改 M3-0 状态机。
