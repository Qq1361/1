export type DailyReportPriority = "P0" | "P1" | "P2" | "P3";

export type DailyReportTodo = {
  code: string;
  priority: DailyReportPriority;
  count: number;
  href: string;
  samples: { id: string; label: string; at: string | null }[];
};

export type DailyReportRisk = {
  code: string;
  severity: DailyReportPriority;
  count: number;
  href: string;
  oldestAt: string | null;
  samples: { id: string; label: string; at: string | null }[];
};

export type DailyInventoryExpiryRisk = {
  businessDate: string;
  counts: Record<"EXPIRED" | "WITHIN_30_DAYS" | "WITHIN_90_DAYS" | "WITHIN_180_DAYS", number>;
  samples: {
    id: string;
    name: string;
    skuText: string | null;
    displayStorageLocation: string;
    expiryDate: string | null;
    risk: "EXPIRED" | "WITHIN_30_DAYS" | "WITHIN_90_DAYS" | "WITHIN_180_DAYS";
  }[];
};

export type DailyBusinessReportDto = {
  reportDate: string;
  timezone: "Asia/Shanghai";
  periodStart: string;
  periodEnd: string;
  generatedAt: string;
  sales: Record<string, string | number>;
  purchases: Record<string, string | number>;
  inventory: Record<string, string | number>;
  inventoryExpiry: DailyInventoryExpiryRisk;
  todos: { items: DailyReportTodo[]; totalCount: number; priorityCounts: Record<DailyReportPriority, number> };
  risks: { items: DailyReportRisk[]; totalCount: number; severityCounts: Record<DailyReportPriority, number> };
  market: Record<string, string | number>;
};
