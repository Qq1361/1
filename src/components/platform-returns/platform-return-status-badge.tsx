import { Badge } from "@/components/ui/badge";
import {
  formatLineStatus,
  formatPlatformReturnInventoryStatus,
  formatPlatformReturnInspectionResult,
} from "@/lib/status-labels";

export function InventoryStatusBadge({ status }: { status: string }) {
  return <Badge variant={status === "PROBLEM" ? "destructive" : "secondary"}>{formatPlatformReturnInventoryStatus(status)}</Badge>;
}

export function ShipmentReturnStatusBadge({ status }: { status: string }) {
  return <Badge variant="outline">{formatLineStatus(status)}</Badge>;
}

export function ReturnInspectionBadge({ result }: { result: string | null | undefined }) {
  return (
    <Badge variant={result === "PROBLEM" ? "destructive" : result === "PENDING_DECISION" ? "outline" : "secondary"}>
      {formatPlatformReturnInspectionResult(result)}
    </Badge>
  );
}
