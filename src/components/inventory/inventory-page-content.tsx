"use client";

import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import { InventoryList } from "@/components/inventory/inventory-list";
import { InventorySkuSummary } from "@/components/inventory/inventory-sku-summary";
import { buttonVariants } from "@/components/ui/button";

export function InventoryPageContent() {
  const searchParams = useSearchParams();
  const tabParam = searchParams.get("tab");
  const [tab, setTab] = useState(tabParam === "summary" ? "summary" : "details");

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setTab(tabParam === "summary" ? "summary" : "details");
    }, 0);
    return () => window.clearTimeout(timer);
  }, [tabParam]);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-sm text-muted-foreground">单件库存</p>
          <h1 className="text-2xl font-semibold">{tab === "summary" ? "SKU 汇总" : "库存明细"}</h1>
        </div>
        <div className="inline-flex rounded-lg border bg-background p-1">
          <button
            type="button"
            className={buttonVariants({
              variant: tab === "details" ? "secondary" : "ghost",
              size: "sm",
              className: "rounded-md",
            })}
            onClick={() => setTab("details")}
          >
            库存明细
          </button>
          <button
            type="button"
            className={buttonVariants({
              variant: tab === "summary" ? "secondary" : "ghost",
              size: "sm",
              className: "rounded-md",
            })}
            onClick={() => setTab("summary")}
          >
            SKU 汇总
          </button>
        </div>
      </div>
      {tab === "summary" ? <InventorySkuSummary /> : <InventoryList />}
    </div>
  );
}
