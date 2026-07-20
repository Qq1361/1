# M2-B 待验货卖家昵称搜索

`/inspections` 的每一行对应一条 `Inspection`。列表通过关联的 `PurchaseOrderItem` 读取采购订单，并使用 `PurchaseOrder.sellerNickname` 作为卖家昵称来源。

搜索在服务端执行，作用域始终限制为当前 owner、`PENDING`/`IN_PROGRESS` 的 `Inspection` 以及 `PENDING_INSPECTION` 的采购订单。关键词会 trim；空关键词等同于不筛选；超过 100 个字符或包含控制字符会被拒绝。支持采购订单号、商品名、SKU 和卖家昵称，其中昵称支持部分匹配，英文匹配不区分大小写。

列表数据与 `total` 使用完全相同的 Prisma 条件，按 `createdAt`、`id` 稳定升序分页。页面直接显示“卖家：<昵称>”；没有昵称时显示“卖家：—”。更改关键词、页码或每页数量时会清空批量验货选择。搜索本身不创建或修改 `Inspection`、`InventoryItem`、物流、销售或 `SOLD` 数据，也不新增 schema 或 migration。
