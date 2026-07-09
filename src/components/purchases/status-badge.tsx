import { Badge } from "@/components/ui/badge";

const allocationLabels = {
  UNALLOCATED: "未分摊",
  DRAFT: "分摊草稿",
  CONFIRMED: "已确认",
} as const;

export function AllocationBadge({
  status,
}: {
  status: keyof typeof allocationLabels;
}) {
  return (
    <Badge
      variant={status === "CONFIRMED" ? "default" : "secondary"}
      className={
        status === "DRAFT"
          ? "bg-amber-100 text-amber-800"
          : status === "CONFIRMED"
            ? "bg-emerald-700 text-white"
            : undefined
      }
    >
      {allocationLabels[status]}
    </Badge>
  );
}

export function PurchaseStatusBadge({ status }: { status: string }) {
  const label =
    {
      PAID: "已付款",
      WAITING_SHIPMENT: "待发货",
      IN_TRANSIT: "运输中",
      PENDING_INSPECTION: "待验货",
      PARTIALLY_STOCKED: "部分入库",
      STOCKED: "已入库",
      CANCELLED: "已取消",
    }[status] ?? status;
  return <Badge variant="outline">{label}</Badge>;
}
