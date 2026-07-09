import { InventoryDetail } from "@/components/inventory/inventory-detail";

export default async function InventoryDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <div className="mx-auto max-w-6xl px-4 py-6 sm:px-6">
      <InventoryDetail id={(await params).id} />
    </div>
  );
}
