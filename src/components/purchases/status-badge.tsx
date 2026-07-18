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
            ? "bg-foreground text-background"
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

const logisticsLabels: Record<string, string> = {
  NOT_SHIPPED: "未发货",
  IN_TRANSIT: "运输中",
  OUT_FOR_DELIVERY: "派送中",
  DELIVERED: "已签收",
  EXCEPTION: "物流异常",
  STALLED: "物流停滞",
  RETURNING: "退回中",
  UNKNOWN: "未知",
};

export function LogisticsStatusBadge({ status }: { status: string }) {
  const isIssue = status === "EXCEPTION" || status === "STALLED";
  return (
    <Badge
      variant={isIssue ? "destructive" : "outline"}
      className={
        status === "DELIVERED"
          ? "border-foreground/20 bg-secondary text-secondary-foreground"
          : undefined
      }
    >
      {logisticsLabels[status] ?? status}
    </Badge>
  );
}
