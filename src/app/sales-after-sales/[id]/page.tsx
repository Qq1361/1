import { SalesAfterSaleDetail } from "@/components/sales-after-sales/sales-after-sales-ui";

export default async function SalesAfterSaleDetailPage({ params }: { params: Promise<{ id: string }> }) {
  return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"><SalesAfterSaleDetail id={(await params).id} /></main>;
}
