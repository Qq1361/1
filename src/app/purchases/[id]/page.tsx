import { OrderDetail } from "@/components/purchases/order-detail";

export default async function PurchaseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return (
    <div className="mx-auto w-full max-w-6xl px-4 py-6 sm:px-6 sm:py-8">
      <OrderDetail orderId={id} />
    </div>
  );
}
