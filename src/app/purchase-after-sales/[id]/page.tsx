import { PurchaseAfterSaleDetail } from "@/components/purchase-after-sales/purchase-after-sales-ui";
export default async function Page({ params }: { params: Promise<{ id: string }> }) { return <main className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6"><PurchaseAfterSaleDetail id={(await params).id} /></main>; }
